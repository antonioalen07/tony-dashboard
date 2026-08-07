'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Wand2, Upload, Film, Link2, Loader2, Download, CalendarPlus,
  RefreshCw, X, Check, Search, ExternalLink, Video, AlertCircle,
  Type, FlipHorizontal,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import { supabase } from '@/utils/supabase';
import { compressVideo } from '@/lib/compressVideo';
import { STORY_FONTS } from '@/lib/storyRender';
import { renderVariantTextPng, getVideoSize } from '@/lib/variantText';
import {
  DEFAULT_VARIANT_PARAMS,
  DEFAULT_VARIANT_TEXT_STYLE,
  type MediaAsset,
  type VariantParams,
  type VariantJob,
  type AppliedVariantParams,
  type VariantText,
  type VariantTextStyle,
  type VariantTextPosition,
  type MirrorMode,
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

// Claves de VariantParams que son rangos [min,max] editables.
type RangeKey = 'saturation' | 'contrast' | 'trimStartMs' | 'speed' | 'zoom'
  | 'trimEndMs' | 'rotate' | 'pan' | 'pitch';

// Metadatos de los rangos avanzados (VariantParams).
const PARAM_META: { key: RangeKey; label: string; step: number; suffix?: string }[] = [
  { key: 'saturation', label: 'Saturación', step: 0.01 },
  { key: 'contrast', label: 'Contraste', step: 0.01 },
  { key: 'trimStartMs', label: 'Recorte inicial', step: 10, suffix: 'ms' },
  { key: 'trimEndMs', label: 'Recorte final', step: 10, suffix: 'ms' },
  { key: 'speed', label: 'Velocidad', step: 0.01 },
  { key: 'zoom', label: 'Zoom', step: 0.01 },
  { key: 'rotate', label: 'Rotación', step: 0.1, suffix: '°' },
  { key: 'pan', label: 'Reencuadre', step: 0.05 },
  { key: 'pitch', label: 'Tono del audio', step: 0.005 },
];

const MIRROR_OPTIONS: { value: MirrorMode; label: string }[] = [
  { value: 'none', label: 'Ninguna' },
  { value: 'some', label: 'La mitad' },
  { value: 'all', label: 'Todas' },
];

const TEXT_POSITIONS: { value: VariantTextPosition; label: string }[] = [
  { value: 'top', label: 'Arriba' },
  { value: 'center', label: 'Centro' },
  { value: 'bottom', label: 'Abajo' },
];

const emptyText = (): VariantText => ({ text: '', position: 'top' });

/** Devuelve el rango de un param, con fallback al default (los nuevos son opcionales). */
const rangeOf = (p: VariantParams, key: RangeKey): [number, number] =>
  p[key] ?? (DEFAULT_VARIANT_PARAMS[key] as [number, number]);

const POLL_MS = 4000;
const POLL_DEADLINE_MS = 20 * 60 * 1000; // el worker corre afuera; cortamos a los 20 min

// ── Componente ───────────────────────────────────────────────────────────────

export default function VariantesPage() {
  const { toast } = useToast();

  const [migrationNeeded, setMigrationNeeded] = useState(false);

  // Fuente del video base
  const [mode, setMode] = useState<'upload' | 'reel'>('upload');
  const [uploading, setUploading] = useState(false);
  const [compressPct, setCompressPct] = useState<number | null>(null);
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
  const [preparing, setPreparing] = useState(false);

  // Textos quemados por variante
  const [mirror, setMirror] = useState<MirrorMode>('none');
  const [texts, setTexts] = useState<VariantText[]>(() => Array.from({ length: 10 }, emptyText));
  const [textStyle, setTextStyle] = useState<VariantTextStyle>(() => structuredClone(DEFAULT_VARIANT_TEXT_STYLE));
  const [previewIdx, setPreviewIdx] = useState(0);

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

  const MAX_VIDEO_BYTES = 600 * 1024 * 1024;      // 600 MB: tope de entrada (antes de comprimir)
  const COMPRESS_OVER_BYTES = 45 * 1024 * 1024;   // >45 MB → comprimir en el navegador para entrar en Storage (50 MB)

  const handleFile = async (rawFile: File) => {
    if (!rawFile) return;
    if (migrationNeeded) { toast('Ejecutá la migración del Studio primero', 'error'); return; }
    if (rawFile.size > MAX_VIDEO_BYTES) {
      toast('El video supera 600MB. Recortalo o pegá una URL pública.', 'error');
      return;
    }
    setUploading(true);
    try {
      // Si es grande, comprimir EN EL NAVEGADOR antes de subir para no chocar con
      // el límite de 50MB por archivo del Storage (plan free de Supabase).
      let file = rawFile;
      if (rawFile.size > COMPRESS_OVER_BYTES) {
        setCompressPct(0);
        toast('Comprimiendo el video en tu navegador… puede tardar un rato', 'info');
        try {
          file = await compressVideo(rawFile, (r) => setCompressPct(Math.round(r * 100)));
        } catch (e) {
          console.error('compressVideo error:', e);
          toast('No se pudo comprimir el video acá. Probá con uno más corto o pegá una URL pública.', 'error');
          return;
        } finally {
          setCompressPct(null);
        }
      }

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
            ? 'Aun comprimido el video supera el límite de Storage (50MB en plan free). Probá uno más corto o pegá una URL pública.'
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

  // ── Textos: rasterizar en el navegador y subirlos al bucket ───────────────
  // El worker sólo compone el PNG con `overlay`, así no depende de las fuentes
  // ni del escapado de drawtext del build de ffmpeg que le toque.
  const prepareTexts = useCallback(async (): Promise<VariantText[]> => {
    const wanted = texts.slice(0, numVariants);
    if (!wanted.some((t) => t.text.trim())) return [];

    const { width, height } = await getVideoSize(selectedAsset!.public_url);
    const out: VariantText[] = [];
    for (let i = 0; i < numVariants; i++) {
      const t = wanted[i] ?? emptyText();
      if (!t.text.trim()) {
        out.push({ text: '', position: t.position });
        continue;
      }
      const blob = await renderVariantTextPng({
        text: t.text, position: t.position, style: textStyle, width, height,
      });
      const path = `variant-text/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.png`;
      const { error } = await supabase.storage
        .from('studio')
        .upload(path, blob, { contentType: 'image/png', upsert: true });
      if (error) throw new Error(`No se pudo subir el texto de la variante ${i + 1}: ${error.message}`);
      const { data: pub } = supabase.storage.from('studio').getPublicUrl(path);
      out.push({ ...t, overlayUrl: pub.publicUrl });
    }
    return out;
  }, [texts, numVariants, textStyle, selectedAsset]);

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
      let preparedTexts: VariantText[] = [];
      try {
        setPreparing(true);
        preparedTexts = await prepareTexts();
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se pudieron preparar los textos', 'error');
        return;
      } finally {
        setPreparing(false);
      }

      const { data, error } = await supabase
        .from('variant_jobs')
        .insert({
          source_asset_id: selectedAsset.id,
          num_variants: numVariants,
          params: { ...params, mirror, textStyle, texts: preparedTexts },
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
    setTexts(Array.from({ length: 10 }, emptyText));
    setMirror('none');
  };

  const setRange = (key: RangeKey, idx: 0 | 1, value: number) => {
    setParams((prev) => {
      const next = structuredClone(prev);
      const range = [...rangeOf(next, key)] as [number, number];
      range[idx] = value;
      next[key] = range;
      return next;
    });
  };

  const setText = (idx: number, patch: Partial<VariantText>) => {
    setTexts((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
    setPreviewIdx(idx);
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
                  {compressPct !== null
                    ? `Comprimiendo… ${compressPct}%`
                    : uploading
                      ? 'Subiendo…'
                      : 'Elegir archivo de video'}
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
          <>
            <div className={styles.paramsGrid}>
              {PARAM_META.map(({ key, label, step, suffix }) => (
                <div key={key} className={styles.paramRow}>
                  <span className={styles.paramLabel}>{label}{suffix ? ` (${suffix})` : ''}</span>
                  <div className={styles.paramInputs}>
                    <input
                      type="number"
                      step={step}
                      value={rangeOf(params, key)[0]}
                      onChange={(e) => setRange(key, 0, Number(e.target.value))}
                      className={styles.numInput}
                      aria-label={`${label} mínimo`}
                    />
                    <span className={styles.dash}>—</span>
                    <input
                      type="number"
                      step={step}
                      value={rangeOf(params, key)[1]}
                      onChange={(e) => setRange(key, 1, Number(e.target.value))}
                      className={styles.numInput}
                      aria-label={`${label} máximo`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.mirrorRow}>
              <span className={styles.paramLabel}><FlipHorizontal size={14} /> Espejar variantes</span>
              <div className={styles.segmented} role="group">
                {MIRROR_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    className={`${styles.segment} ${mirror === o.value ? styles.segmentActive : ''}`}
                    onClick={() => setMirror(o.value)}
                    aria-pressed={mirror === o.value}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <p className={styles.hint}>
              El espejado es lo que más cambia la huella visual, pero da vuelta cualquier texto o logo
              que ya esté quemado en el video. Revisá el resultado antes de publicar.
            </p>
          </>
        )}

        <button
          className={styles.primaryBtn}
          onClick={createJob}
          disabled={!selectedAsset || creating || migrationNeeded}
          style={{ marginTop: '1.1rem' }}
        >
          {creating ? <Loader2 size={16} className={styles.spin} /> : <Wand2 size={16} />}
          {preparing ? 'Preparando textos…' : creating ? 'Creando…' : 'Generar variantes'}
        </button>
        {!selectedAsset && <p className={styles.hint}>Elegí un video base arriba para habilitar la generación.</p>}
      </section>

      {/* ── 3 · Textos en pantalla ────────────────────────────────────────── */}
      <section className="glass-panel">
        <h2 className={styles.sectionTitle}><span className={styles.step}>3</span> Textos en pantalla (opcional)</h2>
        <p className={styles.sectionSub}>
          Un texto distinto por variante es la re-edición que más “despega” una copia de otra: cambia
          píxeles en una zona grande y le da a cada versión un gancho propio. Las que dejes vacías salen sin texto.
        </p>

        <div className={styles.textLayout}>
          <div className={styles.textRows}>
            {Array.from({ length: numVariants }, (_, i) => (
              <div key={i} className={styles.textRow}>
                <span className={styles.textRowNum}>#{i + 1}</span>
                <input
                  className={styles.urlInput}
                  value={texts[i]?.text ?? ''}
                  onChange={(e) => setText(i, { text: e.target.value })}
                  onFocus={() => setPreviewIdx(i)}
                  placeholder={i === 0 ? 'Ej. Nadie te lo dice, pero…' : 'Sin texto'}
                />
                <select
                  className={styles.select}
                  value={texts[i]?.position ?? 'top'}
                  onChange={(e) => setText(i, { position: e.target.value as VariantTextPosition })}
                  aria-label={`Posición del texto de la variante ${i + 1}`}
                >
                  {TEXT_POSITIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className={styles.textSide}>
            {/* Vista previa aproximada de cómo queda quemado sobre el video */}
            <div className={styles.textPreview}>
              {texts[previewIdx]?.text.trim() ? (
                <div
                  className={styles.textPreviewBlock}
                  style={{
                    top: texts[previewIdx].position === 'top' ? '14%' : undefined,
                    bottom: texts[previewIdx].position === 'bottom' ? '18%' : undefined,
                    ...(texts[previewIdx].position === 'center'
                      ? { top: '50%', transform: 'translateY(-50%)' }
                      : {}),
                  }}
                >
                  {texts[previewIdx].text.split('\n').map((line, li) => (
                    <span
                      key={li}
                      className={styles.textPreviewLine}
                      style={{
                        fontFamily: `"${textStyle.font}", sans-serif`,
                        fontSize: `${textStyle.size * 206}px`,
                        color: textStyle.color,
                        background: textStyle.box
                          ? `color-mix(in srgb, ${textStyle.boxColor} ${Math.round(textStyle.boxOpacity * 100)}%, transparent)`
                          : 'transparent',
                      }}
                    >
                      {line}
                    </span>
                  ))}
                </div>
              ) : (
                <span className={styles.textPreviewEmpty}>Vista previa</span>
              )}
            </div>

            <label className={styles.styleField}>
              <span>Fuente</span>
              <select
                className={styles.select}
                value={textStyle.font}
                onChange={(e) => setTextStyle((s) => ({ ...s, font: e.target.value }))}
              >
                {STORY_FONTS.map((f) => (
                  <option key={f.family} value={f.family}>{f.label}</option>
                ))}
              </select>
            </label>

            <label className={styles.styleField}>
              <span>Tamaño · {Math.round(textStyle.size * 100)}% de la altura</span>
              <input
                type="range"
                min={3}
                max={12}
                value={Math.round(textStyle.size * 100)}
                onChange={(e) => setTextStyle((s) => ({ ...s, size: Number(e.target.value) / 100 }))}
              />
            </label>

            <div className={styles.styleRow}>
              <label className={styles.styleField}>
                <span>Color</span>
                <input
                  type="color"
                  className={styles.colorInput}
                  value={textStyle.color}
                  onChange={(e) => setTextStyle((s) => ({ ...s, color: e.target.value }))}
                />
              </label>
              <label className={styles.styleField}>
                <span>Caja</span>
                <input
                  type="color"
                  className={styles.colorInput}
                  value={textStyle.boxColor}
                  disabled={!textStyle.box}
                  onChange={(e) => setTextStyle((s) => ({ ...s, boxColor: e.target.value }))}
                />
              </label>
            </div>

            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={textStyle.box}
                onChange={(e) => setTextStyle((s) => ({ ...s, box: e.target.checked }))}
              />
              <span><Type size={13} /> Caja de fondo detrás del texto</span>
            </label>

            {textStyle.box && (
              <label className={styles.styleField}>
                <span>Opacidad de la caja · {Math.round(textStyle.boxOpacity * 100)}%</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(textStyle.boxOpacity * 100)}
                  onChange={(e) => setTextStyle((s) => ({ ...s, boxOpacity: Number(e.target.value) / 100 }))}
                />
              </label>
            )}
          </div>
        </div>
      </section>

      {/* ── 4 · Resultados ────────────────────────────────────────────────── */}
      {activeJobId && (
        <section className="glass-panel">
          <div className={styles.resultsHead}>
            <h2 className={styles.sectionTitle}><span className={styles.step}>4</span> Variantes generadas</h2>
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
                      {typeof v.params?.rotate === 'number' && v.params.rotate !== 0 && (
                        <span>rot {v.params.rotate.toFixed(1)}°</span>
                      )}
                      {v.params?.mirror && <span><FlipHorizontal size={11} /> espejo</span>}
                      {v.params?.text?.text && (
                        <span className={styles.variantText} title={v.params.text.text}>
                          <Type size={11} /> {v.params.text.text.split('\n')[0]}
                        </span>
                      )}
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
