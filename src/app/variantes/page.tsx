'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Wand2, Upload, Film, Link2, Loader2, Download, CalendarPlus,
  RefreshCw, X, Check, Search, ExternalLink, Video, AlertCircle,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import { supabase } from '@/utils/supabase';
import {
  DEFAULT_VARIANT_PARAMS,
  type MediaAsset,
  type VariantParams,
  type VariantJob,
  type AppliedVariantParams,
} from '@/lib/studio-types';
import styles from './page.module.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) => {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
};

/** Faltan las tablas del Studio (equivalente cliente al guard 428 del API). */
const isMissingTable = (error: { code?: string; message?: string } | null): boolean => {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const m = (error.message || '').toLowerCase();
  return m.includes('does not exist') || m.includes('schema cache');
};

const sanitize = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'video';

// Fila de reel (tabla `reels`, solo lectura).
interface ReelRow {
  id: string;
  title: string | null;
  cover_url: string | null;
  video_url: string | null;
  views: number | null;
}

// Variante + su asset embebido (video_variants.asset_id → media_assets).
interface VariantRow {
  id: string;
  job_id: string;
  asset_id: string;
  params: AppliedVariantParams;
  created_at: string;
  media_assets: { public_url: string; filename: string | null } | null;
}

// Metadatos de los rangos avanzados (VariantParams).
const PARAM_META: { key: keyof VariantParams; label: string; step: number; suffix?: string }[] = [
  { key: 'saturation', label: 'Saturación', step: 0.01 },
  { key: 'contrast', label: 'Contraste', step: 0.01 },
  { key: 'trimStartMs', label: 'Recorte inicial', step: 10, suffix: 'ms' },
  { key: 'speed', label: 'Velocidad', step: 0.01 },
  { key: 'zoom', label: 'Zoom', step: 0.01 },
];

const POLL_MS = 4000;
const POLL_DEADLINE_MS = 20 * 60 * 1000; // el worker corre afuera; cortamos a los 20 min

// ── Componente ───────────────────────────────────────────────────────────────

export default function VariantesPage() {
  const { toast } = useToast();

  const [migrationNeeded, setMigrationNeeded] = useState(false);

  // Fuente del video base
  const [mode, setMode] = useState<'upload' | 'reel'>('upload');
  const [uploading, setUploading] = useState(false);
  const [pasteUrl, setPasteUrl] = useState('');
  const [reels, setReels] = useState<ReelRow[]>([]);
  const [reelsLoaded, setReelsLoaded] = useState(false);
  const [loadingReels, setLoadingReels] = useState(false);
  const [reelSearch, setReelSearch] = useState('');
  const [pickingReelId, setPickingReelId] = useState<string | null>(null);

  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);

  // Configuración del job
  const [numVariants, setNumVariants] = useState(6);
  const [params, setParams] = useState<VariantParams>(() => structuredClone(DEFAULT_VARIANT_PARAMS));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);

  // Job activo + variantes
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [job, setJob] = useState<VariantJob | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [stalled, setStalled] = useState(false);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Detección de migración al montar ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { error } = await supabase.from('variant_jobs').select('id', { head: true, count: 'exact' });
      if (isMissingTable(error)) setMigrationNeeded(true);
    })();
  }, []);

  // ── Carga perezosa de reels al entrar al modo "reel" ──────────────────────
  const loadReels = useCallback(async () => {
    setLoadingReels(true);
    const { data, error } = await supabase
      .from('reels')
      .select('id,title,cover_url,video_url,views')
      .not('video_url', 'is', null)
      .order('views', { ascending: false, nullsFirst: false })
      .limit(60);
    if (error) toast('No se pudieron cargar los reels', 'error');
    setReels((data as ReelRow[]) || []);
    setReelsLoaded(true);
    setLoadingReels(false);
  }, [toast]);

  const selectReelMode = () => {
    setMode('reel');
    if (!reelsLoaded && !loadingReels) loadReels();
  };

  // ── Fetch del estado del job (usado por el poll y por "Actualizar") ───────
  const fetchJobState = useCallback(async (jobId: string) => {
    const { data: jobData, error: jobErr } = await supabase
      .from('variant_jobs').select('*').eq('id', jobId).single();
    if (isMissingTable(jobErr)) { setMigrationNeeded(true); return null; }
    if (jobData) setJob(jobData as VariantJob);

    const { data: vs } = await supabase
      .from('video_variants')
      .select('id,job_id,asset_id,params,created_at, media_assets(public_url,filename)')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });
    if (vs) setVariants(vs as unknown as VariantRow[]);

    return (jobData as VariantJob) || null;
  }, []);

  // ── Poll (patrón runScan de inspiración): start + poll cada ~4s ───────────
  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + POLL_DEADLINE_MS;

    const tick = async () => {
      const j = await fetchJobState(activeJobId);
      if (cancelled) return;
      if (j && (j.status === 'done' || j.status === 'failed')) return; // terminal → parar
      if (Date.now() > deadline) { setStalled(true); return; }
      timer = setTimeout(tick, POLL_MS);
    };
    tick();

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [activeJobId, fetchJobState]);

  // ── Fuente (a): subir video ───────────────────────────────────────────────
  const insertAsset = useCallback(async (
    row: { kind: 'video'; filename: string | null; storage_path: string; public_url: string; source: MediaAsset['source'] },
  ): Promise<MediaAsset | null> => {
    const { data, error } = await supabase.from('media_assets').insert(row).select('*').single();
    if (isMissingTable(error)) { setMigrationNeeded(true); return null; }
    if (error || !data) { toast(error?.message || 'No se pudo registrar el asset', 'error'); return null; }
    return data as MediaAsset;
  }, [toast]);

  const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300 MB (mismo límite que /api/assets)

  const handleFile = async (file: File) => {
    if (!file) return;
    if (migrationNeeded) { toast('Ejecutá la migración del Studio primero', 'error'); return; }
    if (file.size > MAX_VIDEO_BYTES) {
      toast('El video supera 300MB. Comprimilo o pegá una URL pública.', 'error');
      return;
    }
    setUploading(true);
    try {
      // Subida DIRECTA cliente → Supabase Storage: evita bufferear el archivo en el
      // server de Next (que colgaba con videos grandes) y es más confiable.
      const path = `uploads/${Date.now()}-${sanitize(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from('studio')
        .upload(path, file, { contentType: file.type || 'video/mp4', upsert: false });
      if (upErr) {
        const sizeIssue = /exceed|maximum allowed size|payload too large|413/i.test(upErr.message);
        toast(
          sizeIssue
            ? 'El video supera el límite de Storage. Subí el "Upload file size limit" del proyecto en Supabase (Settings → Storage) o pegá una URL pública.'
            : `Error al subir: ${upErr.message}`,
          'error',
        );
        return;
      }
      const { data: pub } = supabase.storage.from('studio').getPublicUrl(path);
      const asset = await insertAsset({
        kind: 'video', filename: file.name, storage_path: path,
        public_url: pub.publicUrl, source: 'upload',
      });
      if (asset) {
        setSelectedAsset(asset);
        toast('Video base listo', 'success');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo subir el video', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePasteUrl = async () => {
    const url = pasteUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { toast('Pegá una URL http(s) válida', 'error'); return; }
    setUploading(true);
    try {
      const filename = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'video');
      const asset = await insertAsset({
        kind: 'video', filename, storage_path: url, public_url: url, source: 'upload',
      });
      if (asset) {
        setSelectedAsset(asset);
        setPasteUrl('');
        toast('Video base listo', 'success');
      }
    } finally {
      setUploading(false);
    }
  };

  // ── Fuente (b): elegir reel existente → bajar el mp4 real (Apify) a Storage ─
  // El reels.video_url guardado es el permalink (la página del post), no un mp4.
  // La ruta /api/assets/from-reel lo resuelve con Apify, lo baja y lo sube al
  // bucket como archivo real, para que el worker pueda procesarlo con ffmpeg.
  const pickReel = async (reel: ReelRow) => {
    if (!reel.video_url) return;
    if (migrationNeeded) { toast('Ejecutá la migración del Studio primero', 'error'); return; }
    setPickingReelId(reel.id);
    toast('Bajando el video del reel… puede tardar hasta un minuto', 'info');
    try {
      const res = await fetch('/api/assets/from-reel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reelId: reel.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data?.error || 'No se pudo preparar el reel', 'error');
        return;
      }
      setSelectedAsset(data.asset as MediaAsset);
      toast('Reel listo como base', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo preparar el reel', 'error');
    } finally {
      setPickingReelId(null);
    }
  };

  // ── Crear el job de variantes ─────────────────────────────────────────────
  const createJob = async () => {
    if (!selectedAsset) return;
    setCreating(true);
    setJob(null);
    setVariants([]);
    setSentIds(new Set());
    setStalled(false);
    setActiveJobId(null);
    try {
      const { data, error } = await supabase
        .from('variant_jobs')
        .insert({
          source_asset_id: selectedAsset.id,
          num_variants: numVariants,
          params,
          status: 'pending',
        })
        .select('*')
        .single();
      if (isMissingTable(error)) { setMigrationNeeded(true); return; }
      if (error || !data) { toast(error?.message || 'No se pudo crear el job', 'error'); return; }
      setJob(data as VariantJob);
      setActiveJobId((data as VariantJob).id);
      toast(`Job creado: ${numVariants} variantes en cola`, 'success');
    } finally {
      setCreating(false);
    }
  };

  // ── Enviar variante al calendario (publish_queue, trial_reel pending) ─────
  const sendToCalendar = async (v: VariantRow) => {
    setSendingId(v.id);
    try {
      const { error } = await supabase.from('publish_queue').insert({
        variant_id: v.id,
        kind: 'trial_reel',
        status: 'pending',
        scheduled_at: null,
      });
      if (isMissingTable(error)) { setMigrationNeeded(true); return; }
      if (error) { toast(error.message || 'No se pudo encolar', 'error'); return; }
      setSentIds((prev) => new Set(prev).add(v.id));
      toast('Enviada al calendario como reel de prueba', 'success');
    } finally {
      setSendingId(null);
    }
  };

  const resetAll = () => {
    setSelectedAsset(null);
    setActiveJobId(null);
    setJob(null);
    setVariants([]);
    setStalled(false);
    setSentIds(new Set());
    setParams(structuredClone(DEFAULT_VARIANT_PARAMS));
  };

  const setRange = (key: keyof VariantParams, idx: 0 | 1, value: number) => {
    setParams((prev) => {
      const next = structuredClone(prev);
      next[key][idx] = value;
      return next;
    });
  };

  const filteredReels = reelSearch.trim()
    ? reels.filter((r) => (r.title || '').toLowerCase().includes(reelSearch.trim().toLowerCase()))
    : reels;

  const jobRunning = job?.status === 'pending' || job?.status === 'processing';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}><Wand2 size={22} className={styles.titleIcon} /> Variantes de video</h1>
        <p className={styles.subtitle}>
          Generá múltiples re-ediciones de un mismo video (micro-ajustes de color, velocidad y encuadre)
          para testear cuál rinde mejor, y mandalas al calendario como reels de prueba.
        </p>
      </header>

      {migrationNeeded && (
        <div className={styles.migrationNotice}>
          <AlertCircle size={16} className={styles.noticeIcon} />
          <span>
            <strong>Falta un paso:</strong> ejecutá <code>supabase_migration_studio.sql</code> en el
            SQL Editor de Supabase para activar las tablas del Studio.
          </span>
        </div>
      )}

      {/* ── 1 · Video base ────────────────────────────────────────────────── */}
      <section className="glass-panel">
        <h2 className={styles.sectionTitle}><span className={styles.step}>1</span> Elegí el video base</h2>

        {selectedAsset ? (
          <div className={styles.selected}>
            <div className={styles.selectedPreview}>
              {selectedAsset.source === 'reel' ? (
                <div className={styles.reelBadge}><Film size={26} /></div>
              ) : (
                <video src={selectedAsset.public_url} className={styles.previewVideo} controls playsInline preload="metadata" />
              )}
            </div>
            <div className={styles.selectedInfo}>
              <span className={styles.selectedName}>{selectedAsset.filename || 'video'}</span>
              <span className={styles.selectedMeta}>
                Fuente: {selectedAsset.source === 'reel' ? 'reel existente' : 'subido'}
              </span>
              {selectedAsset.source === 'reel' && (
                <a href={selectedAsset.public_url} target="_blank" rel="noreferrer" className={styles.selectedLink}>
                  <ExternalLink size={13} /> Ver original
                </a>
              )}
            </div>
            <button className={styles.ghostBtn} onClick={() => setSelectedAsset(null)}>
              <X size={15} /> Cambiar
            </button>
          </div>
        ) : (
          <>
            <div className={styles.segmented} role="tablist">
              <button
                role="tab"
                aria-selected={mode === 'upload'}
                className={`${styles.segment} ${mode === 'upload' ? styles.segmentActive : ''}`}
                onClick={() => setMode('upload')}
              >
                <Upload size={15} /> Subir video
              </button>
              <button
                role="tab"
                aria-selected={mode === 'reel'}
                className={`${styles.segment} ${mode === 'reel' ? styles.segmentActive : ''}`}
                onClick={selectReelMode}
              >
                <Film size={15} /> Reel existente
              </button>
            </div>

            {mode === 'upload' ? (
              <div className={styles.uploadArea}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className={styles.fileInput}
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  disabled={uploading || migrationNeeded}
                />
                <button
                  className={styles.primaryBtn}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || migrationNeeded}
                >
                  {uploading ? <Loader2 size={16} className={styles.spin} /> : <Upload size={16} />}
                  {uploading ? 'Subiendo…' : 'Elegir archivo de video'}
                </button>

                <div className={styles.orDivider}><span>o pegá una URL pública</span></div>

                <div className={styles.urlRow}>
                  <Link2 size={16} className={styles.urlIcon} />
                  <input
                    className={styles.urlInput}
                    value={pasteUrl}
                    onChange={(e) => setPasteUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !uploading && handlePasteUrl()}
                    placeholder="https://…/video.mp4"
                    disabled={uploading || migrationNeeded}
                  />
                  <button
                    className={styles.ghostBtn}
                    onClick={handlePasteUrl}
                    disabled={uploading || migrationNeeded || !pasteUrl.trim()}
                  >
                    Usar URL
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.reelPicker}>
                <div className={styles.searchRow}>
                  <Search size={15} className={styles.searchIcon} />
                  <input
                    className={styles.urlInput}
                    value={reelSearch}
                    onChange={(e) => setReelSearch(e.target.value)}
                    placeholder="Buscar por título…"
                  />
                </div>

                {loadingReels ? (
                  <div className={styles.reelGrid}>
                    {[0, 1, 2, 3].map((i) => <div key={i} className={styles.reelSkeleton} />)}
                  </div>
                ) : filteredReels.length === 0 ? (
                  <div className={styles.empty}>No hay reels con video disponible.</div>
                ) : (
                  <div className={styles.reelGrid}>
                    {filteredReels.map((r) => (
                      <button
                        key={r.id}
                        className={styles.reelCard}
                        onClick={() => pickReel(r)}
                        disabled={pickingReelId !== null}
                      >
                        <div className={styles.reelCover}>
                          {r.cover_url
                            ? <img src={r.cover_url} alt="" referrerPolicy="no-referrer" loading="lazy" />
                            : <Video size={22} />}
                          {pickingReelId === r.id && (
                            <div className={styles.reelOverlay}><Loader2 size={18} className={styles.spin} /></div>
                          )}
                        </div>
                        <span className={styles.reelTitle}>{(r.title || 'Sin título').split('\n')[0]}</span>
                        <span className={styles.reelViews}>{fmt(r.views)} views</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── 2 · Configuración ─────────────────────────────────────────────── */}
      <section className="glass-panel">
        <h2 className={styles.sectionTitle}><span className={styles.step}>2</span> Configuración</h2>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="numVariants">
            Cantidad de variantes <strong className={styles.count}>{numVariants}</strong>
          </label>
          <div className={styles.sliderRow}>
            <input
              id="numVariants"
              type="range"
              min={5}
              max={10}
              step={1}
              value={numVariants}
              onChange={(e) => setNumVariants(Number(e.target.value))}
              className={styles.slider}
            />
            <span className={styles.sliderBounds}>5–10</span>
          </div>
        </div>

        <button
          className={styles.advancedToggle}
          onClick={() => setShowAdvanced((s) => !s)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? 'Ocultar' : 'Mostrar'} rangos avanzados de re-edición
        </button>

        {showAdvanced && (
          <div className={styles.paramsGrid}>
            {PARAM_META.map(({ key, label, step, suffix }) => (
              <div key={key} className={styles.paramRow}>
                <span className={styles.paramLabel}>{label}{suffix ? ` (${suffix})` : ''}</span>
                <div className={styles.paramInputs}>
                  <input
                    type="number"
                    step={step}
                    value={params[key][0]}
                    onChange={(e) => setRange(key, 0, Number(e.target.value))}
                    className={styles.numInput}
                    aria-label={`${label} mínimo`}
                  />
                  <span className={styles.dash}>—</span>
                  <input
                    type="number"
                    step={step}
                    value={params[key][1]}
                    onChange={(e) => setRange(key, 1, Number(e.target.value))}
                    className={styles.numInput}
                    aria-label={`${label} máximo`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          className={styles.primaryBtn}
          onClick={createJob}
          disabled={!selectedAsset || creating || migrationNeeded}
          style={{ marginTop: '1.1rem' }}
        >
          {creating ? <Loader2 size={16} className={styles.spin} /> : <Wand2 size={16} />}
          {creating ? 'Creando…' : 'Generar variantes'}
        </button>
        {!selectedAsset && <p className={styles.hint}>Elegí un video base arriba para habilitar la generación.</p>}
      </section>

      {/* ── 3 · Resultados ────────────────────────────────────────────────── */}
      {activeJobId && (
        <section className="glass-panel">
          <div className={styles.resultsHead}>
            <h2 className={styles.sectionTitle}><span className={styles.step}>3</span> Variantes generadas</h2>
            <div className={styles.resultsActions}>
              <span className={`${styles.statusChip} ${styles['st_' + (job?.status || 'pending')]}`}>
                {jobRunning && <Loader2 size={13} className={styles.spin} />}
                {job?.status === 'done' ? 'Completado'
                  : job?.status === 'failed' ? 'Falló'
                  : job?.status === 'processing' ? 'Procesando'
                  : 'En cola'}
              </span>
              {job && (
                <button className={styles.ghostBtn} onClick={() => activeJobId && fetchJobState(activeJobId)}>
                  <RefreshCw size={14} /> Actualizar
                </button>
              )}
              <button className={styles.ghostBtn} onClick={resetAll}>
                Nueva generación
              </button>
            </div>
          </div>

          {job?.status === 'failed' && job.error && (
            <div className={styles.errorBox}><AlertCircle size={15} /> {job.error}</div>
          )}

          {jobRunning && variants.length === 0 && !stalled && (
            <>
              <div className={styles.scanStatus}>
                <Loader2 size={14} className={styles.spin} />
                Esperando al worker de re-edición… ({variants.length}/{job?.num_variants ?? numVariants})
              </div>
              <div className={styles.errorBox} style={{ background: 'transparent' }}>
                <AlertCircle size={15} />
                Las variantes las genera el <strong>worker</strong> (ffmpeg), que corre aparte. Si no lo
                tenés desplegado en el VPS o corriendo local (<code>cd worker &amp;&amp; node index.mjs</code>
                con el <code>.env</code>), el job queda en cola y esto no avanza.
              </div>
            </>
          )}

          {stalled && variants.length === 0 && (
            <div className={styles.empty}>
              El job sigue <strong>en cola</strong> y el worker no respondió. Verificá que el worker de
              variantes esté corriendo, o tocá <strong>Actualizar</strong>.
            </div>
          )}

          {variants.length > 0 && (
            <div className={styles.grid}>
              {variants.map((v, i) => (
                <article key={v.id} className={styles.variantCard}>
                  <div className={styles.variantVideoWrap}>
                    {v.media_assets?.public_url ? (
                      <video
                        src={v.media_assets.public_url}
                        className={styles.variantVideo}
                        controls
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <div className={styles.variantMissing}><Video size={22} /></div>
                    )}
                    <span className={styles.variantIndex}>#{i + 1}</span>
                  </div>
                  <div className={styles.variantBody}>
                    <div className={styles.variantParams}>
                      <span>sat {v.params?.saturation?.toFixed?.(2) ?? '—'}</span>
                      <span>vel {v.params?.speed?.toFixed?.(2) ?? '—'}</span>
                      <span>zoom {v.params?.zoom?.toFixed?.(2) ?? '—'}</span>
                    </div>
                    <div className={styles.variantActions}>
                      {v.media_assets?.public_url && (
                        <a
                          href={v.media_assets.public_url}
                          download={v.media_assets.filename || `variante-${i + 1}.mp4`}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.iconBtn}
                          title="Descargar"
                        >
                          <Download size={15} />
                        </a>
                      )}
                      <button
                        className={styles.calendarBtn}
                        onClick={() => sendToCalendar(v)}
                        disabled={sendingId === v.id || sentIds.has(v.id)}
                      >
                        {sentIds.has(v.id)
                          ? <><Check size={14} /> Enviada</>
                          : sendingId === v.id
                            ? <><Loader2 size={14} className={styles.spin} /> Enviando…</>
                            : <><CalendarPlus size={14} /> Enviar al calendario</>}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
