'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, MessageCircle, CalendarCheck } from 'lucide-react';
import ReelGrid, { type InstagramReel } from '@/components/ReelGrid';
import ReelDetailPanel from '@/components/ReelDetailPanel';
import DateRangeFilter from '@/components/DateRangeFilter';
import { supabase } from '@/utils/supabase';
import { useToast } from '@/components/Toast';
import { median } from '@/lib/viral';
import { ALL_TIME, filterByRange, sanitizeRange, type DateRange } from '@/lib/dateRange';
import { loadWork, saveWork } from '@/lib/workSession';
import { canEnrichReel, isActiveReel } from '@/lib/reel-curation';
import { createReelCurationReads, rememberReelCuration, applyReelCuration, reconcileReelRead, reconcileReelsRead } from '@/lib/reel-curation-ui';
import styles from './page.module.css';

type SortMode = 'recent' | 'views' | 'er' | 'comments' | 'bookings';
type ReelFilter = 'active' | 'duplicates' | 'hidden';

const REEL_FILTERS: { key: ReelFilter; label: string }[] = [
  { key: 'active', label: 'Activos' },
  { key: 'duplicates', label: 'Repetidos' },
  { key: 'hidden', label: 'Ocultos' },
];

const SORTS: { key: SortMode; label: string }[] = [
  { key: 'recent', label: 'Recientes' },
  { key: 'views', label: 'Más vistos' },
  { key: 'er', label: 'Mejor ER' },
  { key: 'comments', label: 'Más comentados' },
  { key: 'bookings', label: 'Más agendas' },
];

const fmtNum = (n: number) => {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
};

export default function InstagramIntelligence() {
  const { toast } = useToast();
  const [selectedReel, setSelectedReel] = useState<InstagramReel | null>(null);
  const [reels, setReels] = useState<InstagramReel[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('recent');
  const [reelFilter, setReelFilter] = useState<ReelFilter>('active');
  const [loadError, setLoadError] = useState('');
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const curationReads = useRef(createReelCurationReads());

  const changeRange = (next: DateRange) => {
    setRange(next);
    saveWork('ig-range', next);
  };

  const fetchReels = useCallback(async () => {
    const readRevision = curationReads.current.revision;
    const { data, error } = await supabase
      .from('reels')
      .select('*')
      .order('published_at', { ascending: false });
    if (error) setLoadError('No se pudieron cargar los reels. Volvé a intentar.');
    else {
      const incoming = reconcileReelsRead((data || []) as InstagramReel[], readRevision, curationReads.current);
      setReels(incoming);
      setSelectedReel((current) => current ? incoming.find((item) => item.id === current.id) || current : null);
      setLoadError('');
    }
    setLoading(false);
  }, []);

  const readReel = useCallback(async (id: string) => {
    const readRevision = curationReads.current.revision;
    const { data } = await supabase.from('reels').select('*').eq('id', id).single();
    if (!data) return null;
    const incoming = reconcileReelRead(data as InstagramReel, readRevision, curationReads.current);
    setReels((current) => current.map((item) => item.id === id ? incoming : item));
    setSelectedReel((current) => current?.id === id ? incoming : current);
    return incoming;
  }, []);

  useEffect(() => {
    // La primera pintura coincide con el servidor; luego recuperamos el rango
    // de esta sección y consultamos sus reels desde el navegador.
    const frame = requestAnimationFrame(() => {
      setRange(sanitizeRange(loadWork('ig-range', ALL_TIME)));
      void fetchReels();
    });
    return () => cancelAnimationFrame(frame);
  }, [fetchReels]);

  const shown = useMemo(() => filterByRange(reels, range), [reels, range]);
  const reelCounts = useMemo(() => ({
    active: shown.filter(isActiveReel).length,
    duplicates: shown.filter((reel) => !reel.is_hidden && reel.is_duplicate).length,
    hidden: shown.filter((reel) => reel.is_hidden).length,
  }), [shown]);
  const visibleReels = useMemo(() => shown.filter((reel) => reelFilter === 'hidden'
    ? reel.is_hidden
    : !reel.is_hidden && (reelFilter === 'duplicates' ? reel.is_duplicate : !reel.is_duplicate)), [shown, reelFilter]);

  const sortedReels = useMemo(() => {
    const copy = [...visibleReels];
    if (sort === 'views') copy.sort((a, b) => (b.views || 0) - (a.views || 0));
    else if (sort === 'er') copy.sort((a, b) => (b.engagement_rate || 0) - (a.engagement_rate || 0));
    else if (sort === 'comments') copy.sort((a, b) => (b.comments || 0) - (a.comments || 0));
    else if (sort === 'bookings') copy.sort((a, b) => (b.bookings || 0) - (a.bookings || 0));
    return copy;
  }, [visibleReels, sort]);

  /**
   * Comentarios = conversaciones abiertas. Se miran en dos planos: el volumen
   * total y la TASA (comentarios por cada 1.000 de alcance), que es la que
   * permite comparar un reel chico con uno que explotó.
   */
  const commentStats = useMemo(() => {
    const total = shown.reduce((sum, r) => sum + (r.comments || 0), 0);
    const reach = shown.reduce((sum, r) => sum + (r.reach || r.views || 0), 0);
    const withComments = shown.filter((r) => (r.comments || 0) > 0).length;
    const top = shown.filter(isActiveReel).reduce(
      (best, r) => ((r.comments || 0) > (best?.comments || 0) ? r : best),
      null as InstagramReel | null,
    );
    return {
      total,
      avgPerReel: shown.length > 0 ? total / shown.length : 0,
      // Por 1.000 de alcance: en esta cuenta los números por reel son chicos y
      // un porcentaje se leería siempre como "0,4 %".
      rate: reach > 0 ? (total * 1000) / reach : 0,
      withComments,
      top: top && (top.comments || 0) > 0 ? top : null,
    };
  }, [shown]);

  /**
   * Resultados de negocio: lo único que no viene de Meta. Se carga a mano por
   * reel y responde la pregunta que las vistas no responden — de todas estas
   * conversaciones, ¿cuántas terminaron en una reunión?
   *
   * Un reel "medido" es uno donde ya cargaste el dato (aunque sea 0). Los que
   * están sin medir no se cuentan como cero: ensuciarían todas las tasas.
   */
  const bizStats = useMemo(() => {
    const measured = shown.filter(
      (r) => typeof r.bookings === 'number' || typeof r.qualified_leads === 'number'
    );
    const bookings = shown.reduce((sum, r) => sum + (r.bookings || 0), 0);
    const leads = shown.reduce((sum, r) => sum + (r.qualified_leads || 0), 0);
    // Las tasas se calculan SOLO sobre los reels medidos: comparar agendas
    // cargadas contra los comentarios de reels sin medir daría un número bajo
    // que parece una conversión mala y no lo es.
    const comments = measured.reduce((sum, r) => sum + (r.comments || 0), 0);
    const reach = measured.reduce((sum, r) => sum + (r.reach || r.views || 0), 0);
    const top = shown.filter(isActiveReel).reduce(
      (best, r) => ((r.bookings || 0) > (best?.bookings || 0) ? r : best),
      null as InstagramReel | null,
    );
    return {
      bookings,
      leads,
      measured: measured.length,
      withBookings: shown.filter((r) => (r.bookings || 0) > 0).length,
      perThousand: reach > 0 ? (bookings * 1000) / reach : null,
      commentToBooking: comments > 0 ? (bookings * 100) / comments : null,
      leadToBooking: leads > 0 ? (bookings * 100) / leads : null,
      top: top && (top.bookings || 0) > 0 ? top : null,
    };
  }, [shown]);

  const medianViews = useMemo(
    () => median(shown.map((r) => r.views || 0).filter((v: number) => v > 0)),
    [shown]
  );

  // Enriquecimiento automático: transcribe + analiza los reels que aún no lo estén.
  const enrichReel = async (reel: InstagramReel, readRevision: number) => {
    const current = reconcileReelRead(reel, readRevision, curationReads.current);
    if (!canEnrichReel(current)) return;
    const id = current.id;
    const needTranscript = !current.transcript && Boolean(current.video_url?.startsWith('http'));
    if (needTranscript) {
      await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => {});
    }
    if (!canEnrichReel(reconcileReelRead(reel, readRevision, curationReads.current))) return;
    await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  };

  const handleSync = async () => {
    setSyncing(true);
    setStatus('Sincronizando métricas desde Meta…');
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) {
        setStatus(null);
        toast('Error en la sincronización: ' + data.error, 'error');
        setSyncing(false);
        return;
      }

      const readRevision = curationReads.current.revision;
      const { data: fresh, error: refreshError } = await supabase
        .from('reels')
        .select('*')
        .order('published_at', { ascending: false });
      if (refreshError) throw new Error('No se pudieron cargar los reels sincronizados.');
      const all = reconcileReelsRead((fresh || []) as InstagramReel[], readRevision, curationReads.current);
      setReels(all);
      setSelectedReel((current) => current ? all.find((item) => item.id === current.id) || current : null);

      const pending = all.filter(
        (r) => canEnrichReel(r)
          && (r.instagram_id || '').length < 19
          && (!r.ai_analysis?.length || (!r.transcript && r.video_url?.startsWith('http')))
      );

      for (let i = 0; i < pending.length; i++) {
        const r = pending[i];
        setStatus(`Procesando ${i + 1}/${pending.length}: transcripción + análisis IA…`);
        await enrichReel(r, readRevision);
      }

      await fetchReels();
      setStatus(null);
      toast(`Sincronización lista: ${data.syncedCount} reels, ${pending.length} enriquecidos`, 'success');
    } catch {
      setStatus(null);
      toast('Error en la llamada de red', 'error');
    }
    setSyncing(false);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>BAKO</h1>
          <p className={styles.subtitle}>Análisis profundo de tus Reels</p>
        </div>
        <button onClick={handleSync} disabled={syncing} className={styles.syncBtn}>
          <RefreshCw size={16} className={syncing ? styles.spin : ''} />
          {syncing ? 'Sincronizando…' : 'Sincronizar Reels'}
        </button>
      </header>

      <DateRangeFilter
        value={range}
        onChange={changeRange}
        count={loading ? undefined : shown.length}
        total={loading ? undefined : reels.length}
      />
      {loadError && <div className={styles.loadError} role="alert">{loadError}<button type="button" onClick={() => void fetchReels()}>Reintentar</button></div>}

      <section className={`glass-panel ${styles.commentsPanel}`}>
        <div className={styles.commentsHead}>
          <h2 className={styles.commentsTitle}>
            <MessageCircle size={15} className={styles.commentsIcon} /> Conversaciones generadas
          </h2>
          <p className={styles.commentsSub}>
            Comentarios sobre {shown.length} reel{shown.length === 1 ? '' : 's'} en el rango elegido.
          </p>
        </div>
        <div className={styles.commentsGrid}>
          <div className={styles.commentStat}>
            <span className={styles.commentValue}>{fmtNum(commentStats.total)}</span>
            <span className={styles.commentLabel}>Comentarios totales</span>
          </div>
          <div className={styles.commentStat}>
            <span className={styles.commentValue}>{commentStats.avgPerReel.toFixed(1)}</span>
            <span className={styles.commentLabel}>Promedio por reel</span>
          </div>
          <div className={styles.commentStat}>
            <span className={styles.commentValue}>{commentStats.rate.toFixed(1)}</span>
            <span className={styles.commentLabel}>Por 1k de alcance</span>
          </div>
          <div className={styles.commentStat}>
            <span className={styles.commentValue}>
              {commentStats.withComments}
              <span className={styles.commentValueSoft}>/{shown.length}</span>
            </span>
            <span className={styles.commentLabel}>Reels con conversación</span>
          </div>
        </div>
        {commentStats.top && (
          <button
            className={styles.topComment}
            onClick={() => setSelectedReel(commentStats.top)}
            title="Abrir el análisis de este reel"
          >
            <span className={styles.topCommentLabel}>Más comentado entre activos</span>
            <span className={styles.topCommentTitle}>
              {(commentStats.top.title || 'Sin título').split('\n')[0]}
            </span>
            <span className={styles.topCommentCount}>{commentStats.top.comments} comentarios</span>
          </button>
        )}
      </section>

      <section className={`glass-panel ${styles.bizPanel}`}>
        <div className={styles.commentsHead}>
          <h2 className={styles.commentsTitle}>
            <CalendarCheck size={15} className={styles.commentsIcon} /> Resultados de negocio
          </h2>
          <p className={styles.commentsSub}>
            Agendas y leads calificados que cargás a mano en cada reel.{' '}
            {bizStats.measured} de {shown.length} reel{shown.length === 1 ? '' : 's'} del rango ya
            están medidos.
          </p>
        </div>

        <div className={styles.bizGrid}>
          <div className={styles.bizStat}>
            <span className={styles.bizValue}>{fmtNum(bizStats.bookings)}</span>
            <span className={styles.bizLabel}>Agendas totales</span>
          </div>
          <div className={styles.bizStat}>
            <span className={styles.bizValue}>{fmtNum(bizStats.leads)}</span>
            <span className={styles.bizLabel}>Leads calificados</span>
          </div>
          <div className={styles.bizStat}>
            <span className={styles.bizValue}>
              {bizStats.commentToBooking != null ? `${bizStats.commentToBooking.toFixed(0)}%` : '—'}
            </span>
            <span className={styles.bizLabel}>De conversación a agenda</span>
          </div>
          <div className={styles.bizStat}>
            <span className={styles.bizValue}>
              {bizStats.leadToBooking != null ? `${bizStats.leadToBooking.toFixed(0)}%` : '—'}
            </span>
            <span className={styles.bizLabel}>De lead calificado a agenda</span>
          </div>
          <div className={styles.bizStat}>
            <span className={styles.bizValue}>
              {bizStats.perThousand != null ? bizStats.perThousand.toFixed(1) : '—'}
            </span>
            <span className={styles.bizLabel}>Agendas por 1k de alcance</span>
          </div>
          <div className={styles.bizStat}>
            <span className={styles.bizValue}>
              {bizStats.withBookings}
              <span className={styles.commentValueSoft}>/{shown.length}</span>
            </span>
            <span className={styles.bizLabel}>Reels que trajeron agendas</span>
          </div>
        </div>

        {bizStats.top ? (
          <button
            className={styles.topComment}
            onClick={() => setSelectedReel(bizStats.top)}
            title="Abrir el detalle de este reel"
          >
            <span className={styles.topCommentLabel}>Más agendas entre activos</span>
            <span className={styles.topCommentTitle}>
              {(bizStats.top.title || 'Sin título').split('\n')[0]}
            </span>
            <span className={styles.topCommentCount}>{bizStats.top.bookings} agendas</span>
          </button>
        ) : (
          <p className={styles.bizNote}>
            {bizStats.bookings > 0 ? 'Las agendas de este rango están en reels ocultos o repetidos. Podés consultarlas desde esos filtros.' : <>Todavía no cargaste agendas en este rango. Abrí un reel y completá <strong>Resultados de negocio</strong> para empezar a medir su conversión.</>}
          </p>
        )}
      </section>

      <div className={styles.filters}>
        <div className={styles.visibilityFilters}>
          <div className={styles.sortGroup} role="group" aria-label="Filtrar reels por estado">
            {REEL_FILTERS.map((filter) => <button key={filter.key} type="button" className={`${styles.sortBtn} ${reelFilter === filter.key ? styles.sortActive : ''}`} aria-pressed={reelFilter === filter.key} onClick={() => setReelFilter(filter.key)}>{filter.label} <span className={styles.filterCount}>{reelCounts[filter.key]}</span></button>)}
          </div>
          <p className={styles.filterHint}>Ocultos y repetidos conservan sus métricas. Los repetidos se excluyen del análisis IA.</p>
        </div>
        <div className={styles.filterLeft}>
          <span className={styles.filterText}>Ordenar por</span>
          <div className={styles.sortGroup} role="group" aria-label="Ordenar reels">
            {SORTS.map((s) => (
              <button
                key={s.key}
                className={`${styles.sortBtn} ${sort === s.key ? styles.sortActive : ''}`}
                onClick={() => setSort(s.key)}
                aria-pressed={sort === s.key}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {status && <span className={styles.statusText}>{status}</span>}
      </div>

      <div className={styles.gridContainer}>
        {loading ? (
          <p style={{ color: 'var(--text-secondary)' }}>Cargando reels desde Supabase…</p>
        ) : loadError && reels.length === 0 ? null : reels.length > 0 && shown.length === 0 ? (
          <p className={styles.emptyRange}>
            Ninguno de tus {reels.length} reels cae en el rango elegido. Ampliá las fechas o tocá
            <strong> Limpiar</strong>.
          </p>
        ) : shown.length > 0 && visibleReels.length === 0 ? (
          <p className={styles.emptyRange}>{reelFilter === 'active' ? 'No hay reels activos en este rango. Revisá Repetidos u Ocultos para restaurarlos.' : reelFilter === 'duplicates' ? 'No hay reels marcados como repetidos en este rango.' : 'No hay reels ocultos en este rango.'}</p>
        ) : (
          <ReelGrid reels={sortedReels} onSelectReel={setSelectedReel} />
        )}
      </div>

      {selectedReel && (
        <ReelDetailPanel
          // El panel arranca sus campos de carga manual del reel que recibe:
          // sin key, cambiar de reel sin cerrar dejaría los números del anterior.
          key={selectedReel.id}
          reel={selectedReel}
          medianViews={medianViews}
          avgCommentRate={commentStats.rate}
          reels={reels}
          readReel={readReel}
          onUpdate={(updated) => {
            const fields = rememberReelCuration(curationReads.current, updated);
            setReels((current) => current.map((item) => item.id === updated.id ? applyReelCuration(item, fields) : item));
            setSelectedReel((current) => current?.id === updated.id ? applyReelCuration(current, fields) : current);
          }}
          onClose={() => {
            setSelectedReel(null);
            void fetchReels();
          }}
        />
      )}
    </div>
  );
}
