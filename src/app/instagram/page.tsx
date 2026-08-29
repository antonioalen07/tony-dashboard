'use client';

import { useMemo, useState, useEffect } from 'react';
import { RefreshCw, MessageCircle, CalendarCheck } from 'lucide-react';
import ReelGrid from '@/components/ReelGrid';
import ReelDetailPanel from '@/components/ReelDetailPanel';
import DateRangeFilter from '@/components/DateRangeFilter';
import { supabase } from '@/utils/supabase';
import { useToast } from '@/components/Toast';
import { median } from '@/lib/viral';
import { ALL_TIME, filterByRange, sanitizeRange, type DateRange } from '@/lib/dateRange';
import { loadWork, saveWork } from '@/lib/workSession';
import styles from './page.module.css';

type SortMode = 'recent' | 'views' | 'er' | 'comments' | 'bookings';

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
  const [selectedReel, setSelectedReel] = useState<any>(null);
  const [reels, setReels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('recent');
  const [range, setRange] = useState<DateRange>(ALL_TIME);

  // Rango propio de esta sección: mirar el detalle de un mes acá no debería
  // reencuadrar el dashboard, ni al revés.
  useEffect(() => {
    setRange(sanitizeRange(loadWork('ig-range', ALL_TIME)));
  }, []);

  const changeRange = (next: DateRange) => {
    setRange(next);
    saveWork('ig-range', next);
  };

  const fetchReels = async () => {
    const { data } = await supabase
      .from('reels')
      .select('*')
      .order('published_at', { ascending: false });
    if (data) setReels(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchReels();
  }, []);

  const shown = useMemo(() => filterByRange(reels, range), [reels, range]);

  const sortedReels = useMemo(() => {
    const copy = [...shown];
    if (sort === 'views') copy.sort((a, b) => (b.views || 0) - (a.views || 0));
    else if (sort === 'er') copy.sort((a, b) => (b.engagement_rate || 0) - (a.engagement_rate || 0));
    else if (sort === 'comments') copy.sort((a, b) => (b.comments || 0) - (a.comments || 0));
    else if (sort === 'bookings') copy.sort((a, b) => (b.bookings || 0) - (a.bookings || 0));
    return copy;
  }, [shown, sort]);

  /**
   * Comentarios = conversaciones abiertas. Se miran en dos planos: el volumen
   * total y la TASA (comentarios por cada 1.000 de alcance), que es la que
   * permite comparar un reel chico con uno que explotó.
   */
  const commentStats = useMemo(() => {
    const total = shown.reduce((sum, r) => sum + (r.comments || 0), 0);
    const reach = shown.reduce((sum, r) => sum + (r.reach || r.views || 0), 0);
    const withComments = shown.filter((r) => (r.comments || 0) > 0).length;
    const top = shown.reduce(
      (best, r) => ((r.comments || 0) > (best?.comments || 0) ? r : best),
      null as any,
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
    const top = shown.reduce(
      (best, r) => ((r.bookings || 0) > (best?.bookings || 0) ? r : best),
      null as any,
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
  const enrichReel = async (id: string, needTranscript: boolean) => {
    if (needTranscript) {
      await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => {});
    }
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

      const { data: fresh } = await supabase
        .from('reels')
        .select('*')
        .order('published_at', { ascending: false });
      const all = fresh || [];
      setReels(all);

      const pending = all.filter(
        (r) => (r.instagram_id || '').length < 19 && (!r.ai_analysis || r.ai_analysis.length === 0 || !r.transcript)
      );

      for (let i = 0; i < pending.length; i++) {
        const r = pending[i];
        setStatus(`Procesando ${i + 1}/${pending.length}: transcripción + análisis IA…`);
        await enrichReel(r.id, !r.transcript);
      }

      await fetchReels();
      setStatus(null);
      toast(`Sincronización lista: ${data.syncedCount} reels, ${pending.length} enriquecidos`, 'success');
    } catch (e) {
      setStatus(null);
      toast('Error en la llamada de red', 'error');
    }
    setSyncing(false);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard Content</h1>
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
            <span className={styles.topCommentLabel}>Más comentado</span>
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
            <span className={styles.topCommentLabel}>El que más agendó</span>
            <span className={styles.topCommentTitle}>
              {(bizStats.top.title || 'Sin título').split('\n')[0]}
            </span>
            <span className={styles.topCommentCount}>{bizStats.top.bookings} agendas</span>
          </button>
        ) : (
          <p className={styles.bizNote}>
            Todavía no cargaste agendas en este rango. Abrí un reel y completá{' '}
            <strong>Resultados de negocio</strong>: con eso las tasas de acá arriba empiezan a decir
            algo.
          </p>
        )}
      </section>

      <div className={styles.filters}>
        <div className={styles.filterLeft}>
          <span className={styles.filterText}>Ordenar por</span>
          <div className={styles.sortGroup} role="group" aria-label="Ordenar reels">
            {SORTS.map((s) => (
              <button
                key={s.key}
                className={`${styles.sortBtn} ${sort === s.key ? styles.sortActive : ''}`}
                onClick={() => setSort(s.key)}
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
        ) : reels.length > 0 && shown.length === 0 ? (
          <p className={styles.emptyRange}>
            Ninguno de tus {reels.length} reels cae en el rango elegido. Ampliá las fechas o tocá
            <strong> Limpiar</strong>.
          </p>
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
          onClose={() => {
            setSelectedReel(null);
            fetchReels();
          }}
        />
      )}
    </div>
  );
}
