'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Wand2, Upload, Film, Link2, Loader2, Download, CalendarPlus,
  RefreshCw, X, Check, Search, ExternalLink, Video, AlertCircle,
  Type, FlipHorizontal, Move, CopyCheck, ChevronDown, Trash2,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import StorageMeter, { fmtBytes } from '@/components/StorageMeter';
import { supabase } from '@/utils/supabase';
import { publicStudioUrl, uploadStudioObject } from '@/lib/storage';
import { compressVideo } from '@/lib/compressVideo';
import { STORY_FONTS } from '@/lib/storyRender';
import { storedVariantCaption } from '@/lib/variant-caption';
import { isActiveReel } from '@/lib/reel-curation';
import {
  renderVariantTextPng, drawVariantText, ensureVariantFont, getVideoMeta, type VideoMeta,
} from '@/lib/variantText';
import {
  DEFAULT_VARIANT_PARAMS,
  DEFAULT_VARIANT_TEXT_STYLE,
  TEXT_PRESET_XY,
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

const emptyText = (): VariantText => ({
  text: '', position: 'top', ...TEXT_PRESET_XY.top, startSec: 0, endSec: null,
});

/** x/y efectivos de un texto: los libres si los tiene, si no los del preset. */
const xyOf = (t: VariantText | undefined): { x: number; y: number } => {
  const preset = TEXT_PRESET_XY[t?.position ?? 'top'];
  return { x: t?.x ?? preset.x, y: t?.y ?? preset.y };
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** "12.5" → 12.5 · "" → null (campo vacío = sin límite). */
const parseSec = (v: string): number | null => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n;
};

/** Devuelve el rango de un param, con fallback al default (los nuevos son opcionales). */
const rangeOf = (p: VariantParams, key: RangeKey): [number, number] =>
  p[key] ?? (DEFAULT_VARIANT_PARAMS[key] as [number, number]);

const POLL_MS = 4000;
const POLL_DEADLINE_MS = 20 * 60 * 1000; // el worker corre afuera; cortamos a los 20 min

// Las variantes viven en la base (video_variants + Storage), pero el job activo
// era sólo estado de React: al salir de la página parecía que se habían borrado.
// Guardamos cuál era el último job para poder recuperarlo al volver.
const LAST_JOB_KEY = 'variantes:lastJobId';
const CAPTIONS_KEY = 'variantes:captions';

/** El error de Supabase es "no existe la columna caption" (migración vieja). */
const isMissingCaption = (err: { message?: string } | null) =>
  !!err && /caption/i.test(err.message || '');

// ── Componente ───────────────────────────────────────────────────────────────

export default function VariantesPage() {
  const { toast } = useToast();

  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [captionColumnMissing, setCaptionColumnMissing] = useState(false);

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
  // Segundo del video que se ve de fondo en la vista previa: es contra ese frame
  // que se alinea el texto (p. ej. para tapar un texto que el video ya trae).
  const [previewTime, setPreviewTime] = useState(0);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  // Distancia entre el puntero y el centro del bloque al agarrarlo, para que el
  // texto no salte al cursor cuando lo agarrás de una esquina.
  const dragGrab = useRef({ dx: 0, dy: 0 });
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  // Canvas de la vista previa + caja del texto dibujado (fracciones 0..1 del frame).
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [previewBox, setPreviewBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const resultsRef = useRef<HTMLElement>(null);

  // Captions por variante (índice de la variante → texto del post)
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const captionsRef = useRef<Record<string, string>>({});
  const dirtyCaptionsRef = useRef(new Set<string>());
  const captionRevisionsRef = useRef<Record<string, number>>({});
  const captionTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const captionSavesRef = useRef(new Map<string, Promise<void>>());
  const [captionStates, setCaptionStates] = useState<Record<string, string>>({});

  // Job activo + variantes
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [job, setJob] = useState<VariantJob | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [stalled, setStalled] = useState(false);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingJob, setDeletingJob] = useState(false);
  // Cambia para que el medidor de Storage vuelva a medir.
  const [storageKey, setStorageKey] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const persistCaptionDrafts = useCallback(() => {
    if (!activeJobId) return;
    try {
      // Un guardado que terminó después de cerrar/cambiar la generación no
      // puede volver a activar su caché ni reemplazar la generación actual.
      if (localStorage.getItem(LAST_JOB_KEY) !== activeJobId) return;
      localStorage.setItem(CAPTIONS_KEY, JSON.stringify({
        version: 2, jobId: activeJobId, captions: captionsRef.current,
        pendingIds: [...dirtyCaptionsRef.current],
      }));
    } catch { /* El guardado en servidor sigue disponible si Storage está bloqueado. */ }
  }, [activeJobId]);

  // ── Detección de migración al montar ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { error } = await supabase.from('variant_jobs').select('id', { head: true, count: 'exact' });
      if (isMissingTable(error)) { setMigrationNeeded(true); return; }

      // El envío al calendario escribe `caption`. Si esa columna no existe la
      // insert falla entera, así que lo avisamos acá y no recién al intentarlo.
      const { error: capErr } = await supabase.from('publish_queue').select('caption').limit(1);
      if (isMissingCaption(capErr)) setCaptionColumnMissing(true);
    })();
  }, []);

  // ── Carga perezosa de reels al entrar al modo "reel" ──────────────────────
  const loadReels = useCallback(async () => {
    setLoadingReels(true);
    const { data, error } = await supabase
      .from('reels')
      .select('*')
      .not('video_url', 'is', null)
      .order('views', { ascending: false, nullsFirst: false });
    if (error) toast('No se pudieron cargar los reels', 'error');
    setReels((data || []).filter(isActiveReel).slice(0, 60) as ReelRow[]);
    setReelsLoaded(true);
    setLoadingReels(false);
  }, [toast]);

  const selectReelMode = () => {
    setMode('reel');
    if (!reelsLoaded && !loadingReels) loadReels();
  };

  // ── Fetch del estado del job (usado por el poll y por "Actualizar") ───────
  const fetchJobState = useCallback(async (jobId: string) => {
    // Se captura ANTES de leer la base: también se invalida cuando se confirma
    // un PATCH/POST, aunque el texto visible no haya cambiado.
    const revisions = { ...captionRevisionsRef.current };
    const { data: jobData, error: jobErr } = await supabase
      .from('variant_jobs').select('*').eq('id', jobId).single();
    if (isMissingTable(jobErr)) { setMigrationNeeded(true); return null; }
    if (jobData) setJob(jobData as VariantJob);

    const { data: vs } = await supabase
      .from('video_variants')
      .select('id,job_id,asset_id,params,created_at, media_assets(public_url,filename)')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });
    if (vs) {
      const currentVariants = vs as unknown as VariantRow[];
      setVariants(currentVariants);

      // Qué variantes ya están encoladas. Se relee de la base (y no sólo del
      // estado local) para que al volver a la página sigan marcadas "Enviada"
      // y no se pueda encolar la misma variante dos veces.
      const ids = currentVariants.map((v) => v.id);
      let queueCaptions: { variant_id: string | null; caption: string | null }[] = [];
      if (ids.length) {
        const { data: queued, error: queueError } = await supabase
          .from('publish_queue')
          .select('variant_id,caption')
          .in('variant_id', ids);
        if (isMissingCaption(queueError)) setCaptionColumnMissing(true);
        if (queued) {
          queueCaptions = queued as typeof queueCaptions;
          setSentIds(new Set(
            (queued as { variant_id: string | null }[])
              .map((q) => q.variant_id)
              .filter((id): id is string => !!id),
          ));
        }
      }
      const next = { ...captionsRef.current };
      for (const variant of currentVariants) {
        if (dirtyCaptionsRef.current.has(variant.id) || (captionRevisionsRef.current[variant.id] || 0) !== (revisions[variant.id] || 0)) continue;
        const queued = queueCaptions.find((item) => item.variant_id === variant.id);
        const stored = storedVariantCaption(variant.params);
        const caption = queued ? queued.caption || '' : stored;
        if (caption !== null && next[variant.id] !== caption) {
          next[variant.id] = caption;
          captionRevisionsRef.current[variant.id] = (captionRevisionsRef.current[variant.id] || 0) + 1;
        }
      }
      captionsRef.current = next;
      setCaptions(next);
    }

    return (jobData as VariantJob) || null;
  }, []);

  // ── Recuperar la última generación al montar ──────────────────────────────
  // Sin esto, cambiar de página perdía el job y las variantes parecían borradas
  // (los mp4 siguen en Storage y las filas en video_variants).
  useEffect(() => {
    let cancelled = false;

    /** Captions que se habían escrito para ese job y nunca se enviaron. */
    const restoreCaptions = (jobId: string) => {
      try {
        const raw = localStorage.getItem(CAPTIONS_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as { version?: number; jobId?: string; captions?: Record<string, string>; pendingIds?: unknown[] };
        if (saved.jobId === jobId && saved.captions) {
          const valid = Object.fromEntries(Object.entries(saved.captions).filter(([, value]) => typeof value === 'string' && value.length <= 2200));
          captionsRef.current = valid;
          dirtyCaptionsRef.current.clear();
          // Sólo borradores pendientes tienen prioridad sobre el servidor.
          // Los captions cacheados ya guardados (y el formato viejo sin esta
          // marca) se refrescan desde la base, incluso si otro equipo los editó.
          const pending = saved.version === 2 && Array.isArray(saved.pendingIds)
            ? saved.pendingIds.filter((id): id is string => typeof id === 'string' && Object.hasOwn(valid, id))
            : [];
          pending.forEach((id) => {
            dirtyCaptionsRef.current.add(id);
            captionRevisionsRef.current[id] = (captionRevisionsRef.current[id] || 0) + 1;
          });
          setCaptionStates(Object.fromEntries(pending.map((id) => [id, 'Borrador pendiente de guardar'])));
          setCaptions(valid);
        }
      } catch { /* storage corrupto: se ignora y se reescribe */ }
    };

    (async () => {
      const stored = localStorage.getItem(LAST_JOB_KEY);
      if (stored === '') return; // el usuario cerró la generación con "Nueva generación"

      if (stored) {
        const { data } = await supabase.from('variant_jobs').select('id').eq('id', stored).maybeSingle();
        if (cancelled) return;
        if (data) { setActiveJobId(stored); restoreCaptions(stored); return; }
        localStorage.removeItem(LAST_JOB_KEY); // el job guardado ya no existe
      }

      // Sin job guardado (otro navegador, storage limpiado): caemos al más reciente.
      const { data: last } = await supabase
        .from('variant_jobs').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (cancelled || !last) return;
      setActiveJobId(last.id);
      restoreCaptions(last.id);
    })();

    return () => { cancelled = true; };
  }, []);

  // Persistir job activo + captions para poder recuperarlos al volver.
  useEffect(() => {
    if (!activeJobId) return;
    localStorage.setItem(LAST_JOB_KEY, activeJobId);
    persistCaptionDrafts();
  }, [activeJobId, captions, persistCaptionDrafts]);

  useEffect(() => {
    const timers = captionTimersRef.current;
    return () => { timers.forEach((timer) => clearTimeout(timer)); timers.clear(); };
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
      if (j && (j.status === 'done' || j.status === 'failed')) { // terminal → parar
        setStorageKey((k) => k + 1);
        return;
      }
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

      // Subida DIRECTA cliente → Supabase Storage (con URL firmada por el server):
      // evita bufferear el archivo en Next/Vercel, que corta con videos grandes.
      const path = `uploads/${Date.now()}-${sanitize(file.name)}`;
      try {
        await uploadStudioObject(path, file, { contentType: file.type || 'video/mp4', upsert: false });
      } catch (e) {
        const msg = (e as Error).message || '';
        const sizeIssue = /exceed|maximum allowed size|payload too large|413/i.test(msg);
        toast(
          sizeIssue
            ? 'Aun comprimido el video supera el límite de Storage (50MB en plan free). Probá uno más corto o pegá una URL pública.'
            : `Error al subir: ${msg}`,
          'error',
        );
        return;
      }
      const asset = await insertAsset({
        kind: 'video', filename: file.name, storage_path: path,
        public_url: publicStudioUrl(path), source: 'upload',
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

  // Pegar un link: reel/post de Instagram (tuyo o de la competencia) o un mp4.
  // El server lo baja y lo sube al Storage como archivo real; antes se guardaba
  // el link tal cual y el worker recibía la página del post en vez del video.
  const handlePasteUrl = async () => {
    const url = pasteUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { toast('Pegá una URL http(s) válida', 'error'); return; }
    if (migrationNeeded) { toast('Ejecutá la migración del Studio primero', 'error'); return; }
    setUploading(true);
    if (/instagram\.com/i.test(url)) toast('Bajando el video de Instagram… puede tardar hasta un minuto', 'info');
    try {
      const res = await fetch('/api/assets/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.asset) {
        toast(data?.error || 'No se pudo traer el video', 'error');
        return;
      }
      setSelectedAsset(data.asset as MediaAsset);
      setPasteUrl('');
      toast('Video base listo', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo traer el video', 'error');
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

  // Dimensiones y duración del video base: alinean el PNG del texto con el
  // video y acotan los tiempos de aparición que se pueden pedir.
  useEffect(() => {
    const url = selectedAsset?.public_url;
    if (!url) return;
    let cancelled = false;
    getVideoMeta(url).then((m) => { if (!cancelled) setVideoMeta(m); });
    return () => { cancelled = true; };
  }, [selectedAsset]);

  // ── Vista previa del texto: mismo dibujado que el PNG final ───────────────
  // El canvas trabaja a media resolución del video: como el tamaño de letra es
  // una fracción del alto, la proporción es idéntica y dibujar es más barato.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const vw = videoMeta?.width ?? 1080;
    const vh = videoMeta?.height ?? 1920;
    const scale = Math.min(1, 540 / vw);
    canvas.width = Math.max(2, Math.round(vw * scale));
    canvas.height = Math.max(2, Math.round(vh * scale));
    const t = texts[previewIdx];
    let cancelled = false;
    (async () => {
      await ensureVariantFont(textStyle, canvas.height);
      if (cancelled) return;
      const { x, y } = xyOf(t);
      const box = drawVariantText(canvas, {
        text: t?.text ?? '', position: t?.position ?? 'top', x, y, style: textStyle,
        width: canvas.width, height: canvas.height,
      });
      setPreviewBox(box
        ? { x: box.x / canvas.width, y: box.y / canvas.height, w: box.w / canvas.width, h: box.h / canvas.height }
        : null);
    })();
    return () => { cancelled = true; };
  }, [texts, previewIdx, textStyle, videoMeta]);

  // ── Textos: rasterizar en el navegador y subirlos al bucket ───────────────
  // El worker sólo compone el PNG con `overlay`, así no depende de las fuentes
  // ni del escapado de drawtext del build de ffmpeg que le toque.
  const prepareTexts = useCallback(async (): Promise<VariantText[]> => {
    const wanted = texts.slice(0, numVariants);
    if (!wanted.some((t) => t.text.trim())) return [];

    const { width, height } = videoMeta ?? (await getVideoMeta(selectedAsset!.public_url));
    const out: VariantText[] = [];
    for (let i = 0; i < numVariants; i++) {
      const t = wanted[i] ?? emptyText();
      if (!t.text.trim()) {
        out.push({ text: '', position: t.position });
        continue;
      }
      // Un "hasta" que no supera al "desde" es un rango imposible: lo ignoramos
      // y el texto queda hasta el final, que es lo que espera cualquiera.
      const startSec = t.startSec ?? 0;
      const endSec = t.endSec != null && t.endSec > startSec ? t.endSec : null;
      const { x, y } = xyOf(t);
      const blob = await renderVariantTextPng({
        text: t.text, position: t.position, x, y, style: textStyle, width, height,
      });
      const path = `variant-text/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.png`;
      try {
        await uploadStudioObject(path, blob, { contentType: 'image/png', upsert: true });
      } catch (e) {
        throw new Error(`No se pudo subir el texto de la variante ${i + 1}: ${(e as Error).message}`);
      }
      out.push({ ...t, startSec, endSec, overlayUrl: publicStudioUrl(path) });
    }
    return out;
  }, [texts, numVariants, textStyle, selectedAsset, videoMeta]);

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
      // Los resultados aparecen abajo: llevamos la vista hasta ahí.
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    } finally {
      setCreating(false);
    }
  };

  const captionRequest = async (method: 'PATCH' | 'POST', variantId: string, caption: string) => {
    const response = await fetch('/api/variants', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant_id: variantId, caption }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.migrationFile === 'supabase_migration_ai_config.sql') setCaptionColumnMissing(true);
      else if (data.migrationNeeded) setMigrationNeeded(true);
      throw new Error(data.error || 'No se pudo guardar la descripción.');
    }
    setCaptionColumnMissing(false);
    return data as { caption?: string; queued?: { caption: string | null }; alreadyQueued?: boolean };
  };

  // Los guardados de una variante se serializan: una respuesta vieja nunca
  // pisa una descripción más nueva cuando se escribe o se encola rápidamente.
  const saveCaption = (variantId: string, value: string) => {
    const revision = captionRevisionsRef.current[variantId] || 0;
    const previous = captionSavesRef.current.get(variantId) || Promise.resolve();
    const save = previous.catch(() => {}).then(async () => {
      setCaptionStates((current) => ({ ...current, [variantId]: 'Guardando descripción…' }));
      try {
        const response = await captionRequest('PATCH', variantId, value);
        if ((captionRevisionsRef.current[variantId] || 0) === revision && captionsRef.current[variantId] === value) {
          const saved = response.caption ?? value;
          captionRevisionsRef.current[variantId] = revision + 1;
          captionsRef.current = { ...captionsRef.current, [variantId]: saved };
          dirtyCaptionsRef.current.delete(variantId);
          persistCaptionDrafts();
          setCaptions((current) => ({ ...current, [variantId]: saved }));
          setCaptionStates((current) => ({ ...current, [variantId]: 'Descripción guardada' }));
        }
      } catch (error) {
        setCaptionStates((current) => ({ ...current, [variantId]: error instanceof Error ? error.message : 'No se pudo guardar la descripción.' }));
        throw error;
      }
    });
    captionSavesRef.current.set(variantId, save);
    return save;
  };

  const editCaption = (variantId: string, value: string) => {
    captionRevisionsRef.current[variantId] = (captionRevisionsRef.current[variantId] || 0) + 1;
    captionsRef.current = { ...captionsRef.current, [variantId]: value };
    dirtyCaptionsRef.current.add(variantId);
    persistCaptionDrafts();
    setCaptions((current) => ({ ...current, [variantId]: value }));
    setCaptionStates((current) => ({ ...current, [variantId]: 'Sin guardar' }));
    const timer = captionTimersRef.current.get(variantId);
    if (timer) clearTimeout(timer);
    captionTimersRef.current.set(variantId, setTimeout(() => {
      captionTimersRef.current.delete(variantId);
      void saveCaption(variantId, value).catch(() => {});
    }, 600));
  };

  const flushCaption = (variantId: string) => {
    const timer = captionTimersRef.current.get(variantId);
    if (timer) clearTimeout(timer);
    captionTimersRef.current.delete(variantId);
    if (dirtyCaptionsRef.current.has(variantId)) void saveCaption(variantId, captionsRef.current[variantId] || '').catch(() => {});
  };

  // ── Enviar variante al calendario (publish_queue, trial_reel pending) ─────
  const sendToCalendar = async (v: VariantRow) => {
    setSendingId(v.id);
    try {
      const caption = captionsRef.current[v.id] ?? storedVariantCaption(v.params) ?? '';
      const timer = captionTimersRef.current.get(v.id);
      if (timer) clearTimeout(timer);
      captionTimersRef.current.delete(v.id);
      await captionSavesRef.current.get(v.id)?.catch(() => {});
      const data = await captionRequest('POST', v.id, caption);
      const saved = data.queued?.caption || '';
      captionRevisionsRef.current[v.id] = (captionRevisionsRef.current[v.id] || 0) + 1;
      captionsRef.current = { ...captionsRef.current, [v.id]: saved };
      setCaptions((current) => ({ ...current, [v.id]: saved }));
      dirtyCaptionsRef.current.delete(v.id);
      persistCaptionDrafts();
      setCaptionStates((current) => ({ ...current, [v.id]: 'Descripción guardada en el calendario' }));
      setSentIds((prev) => new Set(prev).add(v.id));
      toast(data.alreadyQueued ? 'Esta variante ya estaba en el calendario' : 'Enviada al calendario como reel de prueba', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se pudo encolar la variante.', 'error');
    } finally {
      setSendingId(null);
    }
  };

  // ── Borrar variantes (filas + archivos del Storage) ───────────────────────
  const deleteVariant = async (v: VariantRow, index: number) => {
    const queued = sentIds.has(v.id);
    const msg = queued
      ? `¿Borrar la variante #${index + 1}? Está en el calendario: si todavía no se publicó, se cancela esa publicación. Lo ya publicado queda en el historial.`
      : `¿Borrar la variante #${index + 1}? Se elimina el video y libera espacio. No se puede deshacer.`;
    if (!window.confirm(msg)) return;
    setDeletingId(v.id);
    try {
      const res = await fetch(`/api/variants?id=${v.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'No se pudo borrar la variante', 'error'); return; }
      setVariants((prev) => prev.filter((x) => x.id !== v.id));
      setSentIds((prev) => { const n = new Set(prev); n.delete(v.id); return n; });
      setCaptions((prev) => { const n = { ...prev }; delete n[v.id]; return n; });
      toast(
        `Variante borrada · ${fmtBytes(data.freedBytes || 0)} liberados`
          + (data.canceledPosts ? ' · publicación pendiente cancelada' : ''),
        'success',
      );
      setStorageKey((k) => k + 1);
    } finally {
      setDeletingId(null);
    }
  };

  const deleteGeneration = async () => {
    if (!activeJobId) return;
    const n = variants.length;
    const queued = variants.filter((v) => sentIds.has(v.id)).length;
    const msg = `¿Borrar esta generación completa? Se eliminan ${n} variante${n === 1 ? '' : 's'}, sus textos y el video base (si no lo usa otra generación).`
      + (queued ? ` ${queued} está${queued === 1 ? '' : 'n'} en el calendario: lo pendiente se cancela y lo ya publicado queda en el historial.` : '')
      + ' No se puede deshacer.';
    if (!window.confirm(msg)) return;
    setDeletingJob(true);
    try {
      const res = await fetch(`/api/variants?jobId=${activeJobId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || 'No se pudo borrar la generación', 'error'); return; }
      if (data.deletedSource && selectedAsset?.id === job?.source_asset_id) {
        setSelectedAsset(null);
        setVideoMeta(null);
      }
      setActiveJobId(null);
      setJob(null);
      setVariants([]);
      setSentIds(new Set());
      setCaptions({});
      localStorage.setItem(LAST_JOB_KEY, '');
      localStorage.removeItem(CAPTIONS_KEY);
      toast(`Generación borrada · ${fmtBytes(data.freedBytes || 0)} liberados`, 'success');
      setStorageKey((k) => k + 1);
    } finally {
      setDeletingJob(false);
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
    setVideoMeta(null);
    setCaptions({});
    // Empezar de cero es explícito: la clave vacía marca "cerrado a propósito"
    // para que el próximo montaje no recupere el job que el usuario acaba de cerrar.
    localStorage.setItem(LAST_JOB_KEY, '');
    localStorage.removeItem(CAPTIONS_KEY);
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

  // ── Posición libre del texto ───────────────────────────────────────────────
  /** Mueve el bloque del texto en preview a una posición del frame (0..1). */
  const moveText = (x: number, y: number) =>
    setText(previewIdx, { x: clamp01(x), y: clamp01(y) });

  /** Coordenadas normalizadas de un punto del puntero dentro de la preview. */
  const pointerXY = (e: { clientX: number; clientY: number }) => {
    const r = previewRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onBlockPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointerXY(e);
    if (!p) return;
    const cur = xyOf(texts[previewIdx]);
    dragGrab.current = { dx: p.x - cur.x, dy: p.y - cur.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onBlockPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const p = pointerXY(e);
    if (!p) return;
    moveText(p.x - dragGrab.current.dx, p.y - dragGrab.current.dy);
  };

  const onBlockPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  /** Clic en el frame (fuera del bloque): manda el texto ahí de una. */
  const onPreviewPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // el bloque maneja lo suyo
    const p = pointerXY(e);
    if (p) moveText(p.x, p.y);
  };

  /** Flechas para ajuste fino; con Shift el paso es más grueso. */
  const onBlockKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.02 : 0.004;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const cur = xyOf(texts[previewIdx]);
    moveText(cur.x + d[0], cur.y + d[1]);
  };

  /** Mueve la preview a un segundo del video base. */
  const seekPreview = (sec: number) => {
    setPreviewTime(sec);
    const v = previewVideoRef.current;
    if (v && Number.isFinite(sec)) v.currentTime = sec;
  };

  /** El video ya trae el texto en el mismo lugar para todas: copiar posición. */
  const applyPositionToAll = () => {
    const { x, y } = xyOf(texts[previewIdx]);
    setTexts((prev) => prev.map((t) => ({ ...t, x, y })));
    toast('Posición aplicada a todas las variantes', 'success');
  };

  const filteredReels = reelSearch.trim()
    ? reels.filter((r) => (r.title || '').toLowerCase().includes(reelSearch.trim().toLowerCase()))
    : reels;

  const jobRunning = job?.status === 'pending' || job?.status === 'processing';
  const textsReady = texts.slice(0, numVariants).filter((t) => t.text.trim()).length;

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

      <StorageMeter refreshKey={storageKey} />

      {migrationNeeded && (
        <div className={styles.migrationNotice}>
          <AlertCircle size={16} className={styles.noticeIcon} />
          <span>
            <strong>Falta un paso:</strong> ejecutá <code>supabase_migration_studio.sql</code> en el
            SQL Editor de Supabase para activar las tablas del Studio.
          </span>
        </div>
      )}

      {!migrationNeeded && captionColumnMissing && (
        <div className={styles.migrationNotice}>
          <AlertCircle size={16} className={styles.noticeIcon} />
          <span>
            <strong>La base está atrasada:</strong> falta la columna <code>caption</code> en{' '}
            <code>publish_queue</code>. Actualizá la base antes de enviar variantes al calendario.
            Corré <code>supabase_migration_ai_config.sql</code> en el SQL Editor de Supabase.
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
            <button className={styles.ghostBtn} onClick={() => { setSelectedAsset(null); setVideoMeta(null); }}>
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

                <div className={styles.orDivider}><span>o pegá un link</span></div>

                <div className={styles.urlRow}>
                  <Link2 size={16} className={styles.urlIcon} />
                  <input
                    className={styles.urlInput}
                    value={pasteUrl}
                    onChange={(e) => setPasteUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !uploading && handlePasteUrl()}
                    placeholder="Link de un reel (tuyo o de otra cuenta) o de un .mp4"
                    disabled={uploading || migrationNeeded}
                  />
                  <button
                    className={styles.ghostBtn}
                    onClick={handlePasteUrl}
                    disabled={uploading || migrationNeeded || !pasteUrl.trim()}
                  >
                    {uploading && <Loader2 size={14} className={styles.spin} />} Usar link
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

      {/* ── 2 · Textos en pantalla ────────────────────────────────────────── */}
      <section className="glass-panel">
        <h2 className={styles.sectionTitle}><span className={styles.step}>2</span> Textos en pantalla <span className={styles.optional}>opcional</span></h2>
        <p className={styles.sectionSub}>
          Un texto distinto por variante es la re-edición que más “despega” una copia de otra. La vista previa
          es exactamente lo que sale en el video; si lo usás para tapar un texto que el video ya trae, cada
          variante lo sigue aunque tenga otro zoom o encuadre.
        </p>

        <div className={styles.textLayout}>
          <div className={styles.textRows}>
            <div className={styles.textHead}>
              <span className={styles.textRowNum} />
              <span>Texto</span>
              <span>Posición</span>
              <span className={styles.textTimeHead}>Desde</span>
              <span className={styles.textTimeHead}>Hasta</span>
            </div>
            {Array.from({ length: numVariants }, (_, i) => (
              <div key={i} className={`${styles.textRow} ${previewIdx === i ? styles.textRowActive : ''}`}>
                <button
                  type="button"
                  className={styles.textRowNum}
                  onClick={() => setPreviewIdx(i)}
                  title="Ver esta variante en la vista previa"
                >
                  #{i + 1}
                </button>
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
                  onChange={(e) => {
                    // El preset es un atajo: escribe las coordenadas, que después
                    // se pueden arrastrar libremente sobre la vista previa.
                    const position = e.target.value as VariantTextPosition;
                    setText(i, { position, ...TEXT_PRESET_XY[position] });
                  }}
                  aria-label={`Posición del texto de la variante ${i + 1}`}
                >
                  {TEXT_POSITIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <input
                  className={styles.timeInput}
                  type="number"
                  min={0}
                  step={0.5}
                  value={texts[i]?.startSec ?? ''}
                  onChange={(e) => setText(i, { startSec: parseSec(e.target.value) ?? 0 })}
                  placeholder="0"
                  aria-label={`Segundo en que aparece el texto de la variante ${i + 1}`}
                />
                <input
                  className={styles.timeInput}
                  type="number"
                  min={0}
                  step={0.5}
                  value={texts[i]?.endSec ?? ''}
                  onChange={(e) => setText(i, { endSec: parseSec(e.target.value) })}
                  placeholder="fin"
                  aria-label={`Segundo en que desaparece el texto de la variante ${i + 1}`}
                />
              </div>
            ))}
            <p className={styles.hint}>
              Las que dejes vacías salen sin texto. Los tiempos van en segundos del video final; dejá{' '}
              <strong>Hasta</strong> vacío para que quede hasta el final
              {videoMeta?.duration ? ` (dura ${videoMeta.duration.toFixed(1)} s)` : ''}.
            </p>

            <div className={styles.styleGrid}>
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
                <span>Tamaño · {Math.round(textStyle.size * 100)}% del alto</span>
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
                <label className={styles.checkField}>
                  <input
                    type="checkbox"
                    checked={textStyle.box}
                    onChange={(e) => setTextStyle((s) => ({ ...s, box: e.target.checked }))}
                  />
                  <span><Type size={13} /> Caja de fondo</span>
                </label>
              </div>

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

          <div className={styles.textSide}>
            <div className={styles.previewTabs} role="tablist" aria-label="Variante en la vista previa">
              {Array.from({ length: numVariants }, (_, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={previewIdx === i}
                  className={`${styles.previewTab} ${previewIdx === i ? styles.previewTabActive : ''} ${texts[i]?.text.trim() ? styles.previewTabHas : ''}`}
                  onClick={() => setPreviewIdx(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>

            {/* Vista previa sobre el frame real. El texto se dibuja con la MISMA
                función que genera el PNG del worker (drawVariantText): lo que se
                ve acá es lo que sale. */}
            <div
              ref={previewRef}
              className={styles.textPreview}
              style={{ aspectRatio: videoMeta ? `${videoMeta.width} / ${videoMeta.height}` : '9 / 16' }}
              onPointerDown={onPreviewPointerDown}
            >
              {selectedAsset?.public_url && (
                <video
                  ref={previewVideoRef}
                  src={selectedAsset.public_url}
                  className={styles.textPreviewVideo}
                  muted
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(e) => { e.currentTarget.currentTime = previewTime; }}
                />
              )}
              <canvas ref={previewCanvasRef} className={styles.textPreviewCanvas} aria-hidden="true" />

              {previewBox ? (
                <div
                  className={styles.textPreviewBlock}
                  style={{
                    left: pct(previewBox.x),
                    top: pct(previewBox.y),
                    width: pct(previewBox.w),
                    height: pct(previewBox.h),
                  }}
                  onPointerDown={onBlockPointerDown}
                  onPointerMove={onBlockPointerMove}
                  onPointerUp={onBlockPointerUp}
                  onKeyDown={onBlockKeyDown}
                  tabIndex={0}
                  role="button"
                  aria-label="Mover el texto: arrastralo o usá las flechas"
                  title="Arrastrá para mover · flechas para ajuste fino"
                />
              ) : (
                <span className={styles.textPreviewEmpty}>
                  {selectedAsset ? `Escribí el texto de la variante ${previewIdx + 1}` : 'Elegí un video base'}
                </span>
              )}
            </div>

            {selectedAsset?.public_url && (
              <label className={styles.styleField}>
                <span>Frame del video · {previewTime.toFixed(1)} s</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.1, videoMeta?.duration ?? 15)}
                  step={0.1}
                  value={previewTime}
                  onChange={(e) => seekPreview(Number(e.target.value))}
                />
              </label>
            )}

            <div className={styles.posRow}>
              <span className={styles.posReadout}>
                <Move size={12} /> x {pct(xyOf(texts[previewIdx]).x)} · y {pct(xyOf(texts[previewIdx]).y)}
              </span>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={applyPositionToAll}
                disabled={!texts[previewIdx]?.text.trim()}
                title="Copiar esta posición a las otras variantes"
              >
                <CopyCheck size={13} /> A todas
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3 · Ajustes de re-edición ─────────────────────────────────────── */}
      <section className="glass-panel">
        <div className={styles.adjustHead}>
          <h2 className={styles.sectionTitle}><span className={styles.step}>3</span> Ajustes de re-edición</h2>
          <div className={styles.mirrorRow}>
            <span className={styles.paramLabel}><FlipHorizontal size={14} /> Espejar</span>
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
        </div>
        {mirror !== 'none' && (
          <p className={styles.hint}>
            El espejado es lo que más cambia la huella visual, pero da vuelta cualquier texto o logo que ya
            traiga el video. Tus textos de arriba salen derechos.
          </p>
        )}

        <button
          className={styles.advancedToggle}
          onClick={() => setShowAdvanced((s) => !s)}
          aria-expanded={showAdvanced}
        >
          <ChevronDown size={14} className={showAdvanced ? styles.chevOpen : ''} />
          {showAdvanced ? 'Ocultar' : 'Mostrar'} rangos finos (color, velocidad, zoom, recortes)
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
        )}
      </section>

      {/* ── Barra de acción: siempre a mano, justo antes de los resultados ── */}
      <div className={styles.actionBar}>
        <label className={styles.actionCount} htmlFor="numVariants">
          <span>Variantes <strong className={styles.count}>{numVariants}</strong></span>
          <input
            id="numVariants"
            type="range"
            min={5}
            max={10}
            step={1}
            value={numVariants}
            onChange={(e) => {
              const n = Number(e.target.value);
              setNumVariants(n);
              // Bajar la cantidad no puede dejar la vista previa en una variante que ya no existe.
              setPreviewIdx((i) => Math.min(i, n - 1));
            }}
            className={styles.slider}
          />
        </label>
        <span className={styles.actionSummary}>
          {!selectedAsset
            ? 'Elegí un video base para empezar'
            : `${textsReady} con texto · ${numVariants - textsReady} sin texto${mirror !== 'none' ? ' · con espejo' : ''}`}
        </span>
        <button
          className={styles.primaryBtn}
          onClick={createJob}
          disabled={!selectedAsset || creating || migrationNeeded || jobRunning}
        >
          {creating || jobRunning ? <Loader2 size={16} className={styles.spin} /> : <Wand2 size={16} />}
          {preparing ? 'Preparando textos…'
            : creating ? 'Creando…'
            : jobRunning ? 'Generando…'
            : `Generar ${numVariants} variantes`}
        </button>
      </div>

      {/* ── 4 · Resultados ────────────────────────────────────────────────── */}
      {activeJobId && (
        <section className="glass-panel" ref={resultsRef}>
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
              <button
                className={`${styles.ghostBtn} ${styles.dangerBtn}`}
                onClick={deleteGeneration}
                disabled={deletingJob || jobRunning || !job}
                title={jobRunning ? 'Esperá a que termine de generarse' : 'Borra las variantes, sus textos y el video base'}
              >
                {deletingJob ? <Loader2 size={14} className={styles.spin} /> : <Trash2 size={14} />}
                Borrar generación
              </button>
            </div>
          </div>

          <p className={styles.retentionNote}>
            Se borran solas para no llenar el Storage: las <strong>publicadas</strong> y las que no mandes
            al calendario en <strong>48 h</strong>. Las programadas se conservan.
          </p>

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
                    <textarea
                      className={styles.captionInput}
                      value={captions[v.id] ?? ''}
                      onChange={(e) => editCaption(v.id, e.target.value)}
                      onBlur={() => flushCaption(v.id)}
                      aria-label={`Descripción del post de la variante ${i + 1}`}
                      placeholder="Descripción del post (opcional)…"
                      rows={2}
                      maxLength={2200}
                      disabled={sentIds.has(v.id) || sendingId === v.id}
                    />
                    {captionStates[v.id] && <span className={styles.captionState} role="status">{captionStates[v.id]}</span>}
                    {(captions[v.id]?.length ?? 0) > 1900 && (
                      <span className={styles.captionCount}>
                        {captions[v.id].length}/2200
                      </span>
                    )}
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
                        className={`${styles.iconBtn} ${styles.dangerIcon}`}
                        onClick={() => deleteVariant(v, i)}
                        disabled={deletingId === v.id || deletingJob}
                        title="Borrar esta variante (libera espacio)"
                        aria-label={`Borrar la variante ${i + 1}`}
                      >
                        {deletingId === v.id ? <Loader2 size={15} className={styles.spin} /> : <Trash2 size={15} />}
                      </button>
                      <button
                        className={styles.calendarBtn}
                        onClick={() => sendToCalendar(v)}
                        disabled={sendingId === v.id || sentIds.has(v.id) || captionColumnMissing}
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
