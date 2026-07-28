'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Clapperboard, Plus, Save, Download, Trash2, Copy, Loader2,
  ArrowLeft, ArrowRight, Type, ImagePlus, Bold, Underline,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, X, Highlighter,
  Sun, Shuffle, Upload, Pencil, Undo2, Images, MousePointer2, Sparkles,
} from 'lucide-react';
import { supabase } from '@/utils/supabase';
import { useToast } from '@/components/Toast';
import MigrationBanner from '@/components/MigrationBanner';
import DrivePicker from '@/components/DrivePicker';
import {
  renderSlideToPng, proxied, STORY_FONTS, CANVAS_W, CANVAS_H,
} from '@/lib/storyRender';
import type {
  StoryProject, StorySlide, StoryTextLayer, StoryImageOverlay, StoryDrawStroke,
  MediaAsset, TextAlign,
} from '@/lib/studio-types';
import styles from './page.module.css';

// ── Constantes ──────────────────────────────────────────────────────────────
const MAX_SLIDES = 6;
const RECOMMENDED_MIN = 4;
const PREVIEW_W = 324; // px del preview; el lienzo real es 1080 → escala 0.3
const PREVIEW_H = PREVIEW_W * (CANVAS_H / CANVAS_W);
const SCALE = PREVIEW_W / CANVAS_W;

/** Slide editable: extiende StorySlide con la URL de fondo resuelta (persistida en el JSONB). */
interface EditableSlide extends StorySlide {
  bg_url?: string | null;
}

// ── Fábricas ──────────────────────────────────────────────────────────────
const newLayer = (): StoryTextLayer => ({
  text: 'Tu texto',
  font: 'Inter',
  size: 96,
  color: '#ffffff',
  bold: true,
  underline: false,
  highlight: null,
  x: 0.5,
  y: 0.4,
  align: 'center',
  lineHeight: 1.25,
  widthPct: null,
  underlineWords: [],
  highlightWords: [],
});

const newSlide = (): EditableSlide => ({
  bg_asset_id: null,
  bg_url: null,
  bg_brightness: 1,
  bg_scale: 1,
  bg_pan_x: 0,
  bg_pan_y: 0,
  layers: [],
  overlays: [],
  strokes: [],
});

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Clave del borrador autosave en localStorage. */
const DRAFT_KEY = 'crevy_historias_draft_v1';

/** Normaliza una palabra para comparar contra la lista de subrayado. */
const cleanWord = (w: string) =>
  w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

const slugify = (s: string) =>
  (s || 'historias')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacríticos combinantes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'historias';

/** Detecta el 428 equivalente al consultar Supabase directo (tabla inexistente). */
const isMissingTable = (err: { code?: string; message?: string } | null) =>
  !!err &&
  (err.code === '42P01' ||
    err.code === 'PGRST205' ||
    /does not exist|schema cache|could not find the table/i.test(err.message || ''));

/** Carga una imagen (para medir aspect ratio de overlays). */
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load error'));
    img.src = src;
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function HistoriasPage() {
  const { toast } = useToast();

  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<StoryProject[]>([]);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slides, setSlides] = useState<EditableSlide[]>([]);
  const [slideIdx, setSlideIdx] = useState(0);
  const [layerIdx, setLayerIdx] = useState<number | null>(null);
  const [overlayIdx, setOverlayIdx] = useState<number | null>(null);

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [bgInput, setBgInput] = useState('');
  const [uploadingBg, setUploadingBg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Dibujo a mano alzada
  const [mode, setMode] = useState<'select' | 'draw'>('select');
  const [drawColor, setDrawColor] = useState('#ffd60a');
  const [drawWidth, setDrawWidth] = useState(14); // px sobre el lienzo 1080
  const [drawGlow, setDrawGlow] = useState(true);
  const [liveStroke, setLiveStroke] = useState<StoryDrawStroke | null>(null);
  const liveRef = useRef<StoryDrawStroke | null>(null);
  const [showOverlayPicker, setShowOverlayPicker] = useState(false);

  // Texto crudo de los campos de palabras (para no comerse las comas al tipear).
  const [uwText, setUwText] = useState('');
  const [hwText, setHwText] = useState('');

  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ kind: 'layer' | 'overlay'; idx: number } | null>(null);
  const bgDragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const overlayFileRef = useRef<HTMLInputElement>(null);

  const current = slides[slideIdx];
  const selectedLayer = layerIdx != null ? current?.layers[layerIdx] : undefined;
  const selectedOverlay = overlayIdx != null ? current?.overlays?.[overlayIdx] : undefined;

  // Recarga el texto crudo de los campos de palabras al cambiar la capa seleccionada
  // (solo al cambiar de capa/slide, no en cada edición, para no comerse las comas).
  useEffect(() => {
    setUwText((current?.layers[layerIdx ?? -1]?.underlineWords ?? []).join(', '));
    setHwText((current?.layers[layerIdx ?? -1]?.highlightWords ?? []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerIdx, slideIdx]);

  // ── Carga inicial ──────────────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    const { data, error } = await supabase
      .from('story_projects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (isMissingTable(error)) {
      setMigrationNeeded(true);
      setLoading(false);
      return;
    }
    if (data) setProjects(data as StoryProject[]);
    setLoading(false);
  }, []);

  // Picker progresivo: si la API de assets (Unidad 2) existe, poblamos el grid.
  const loadAssets = useCallback(async () => {
    try {
      const res = await fetch('/api/assets?kind=image');
      if (!res.ok) return;
      const json = await res.json();
      const list: MediaAsset[] = Array.isArray(json) ? json : json?.data ?? [];
      setAssets(list.filter((a) => a.kind === 'image'));
    } catch {
      /* API aún no disponible: se usa el input de URL como fallback */
    }
  }, []);

  useEffect(() => {
    loadProjects();
    loadAssets();
  }, [loadProjects, loadAssets]);

  // ── Autosave local (borrador anti-cierre accidental) ─────────────────────
  // Guarda el estado de edición con debounce; se limpia al Guardar de verdad.
  useEffect(() => {
    if (!projectId) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ projectId, name, slides, ts: Date.now() }),
        );
      } catch {
        /* localStorage lleno o no disponible: no bloquea la edición */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [projectId, name, slides]);

  // Restaura un borrador sin guardar al volver a la página (una sola vez).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || loading) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft?.projectId && Array.isArray(draft.slides) && projects.some((p) => p.id === draft.projectId)) {
        setProjectId(draft.projectId);
        setName(draft.name ?? '');
        setSlides(draft.slides as EditableSlide[]);
        setSlideIdx(0);
        setLayerIdx(null);
        setOverlayIdx(null);
        toast('Restauramos tu borrador sin guardar', 'info');
      }
    } catch {
      /* borrador corrupto: se ignora */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, projects]);

  // ── Mutaciones de estado del editor ─────────────────────────────────────
  const patchSlide = (idx: number, patch: Partial<EditableSlide>) =>
    setSlides((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const patchLayer = (sIdx: number, lIdx: number, patch: Partial<StoryTextLayer>) =>
    setSlides((prev) =>
      prev.map((s, i) =>
        i === sIdx
          ? { ...s, layers: s.layers.map((l, j) => (j === lIdx ? { ...l, ...patch } : l)) }
          : s,
      ),
    );

  const patchOverlay = (sIdx: number, oIdx: number, patch: Partial<StoryImageOverlay>) =>
    setSlides((prev) =>
      prev.map((s, i) =>
        i === sIdx
          ? { ...s, overlays: (s.overlays ?? []).map((o, j) => (j === oIdx ? { ...o, ...patch } : o)) }
          : s,
      ),
    );

  const resolveBg = useCallback(
    (slide: EditableSlide): string => {
      if (slide.bg_url) return slide.bg_url;
      if (slide.bg_asset_id) {
        const a = assets.find((x) => x.id === slide.bg_asset_id);
        if (a) return a.public_url;
      }
      return '';
    },
    [assets],
  );

  // ── CRUD de proyectos ───────────────────────────────────────────────────
  const openProject = (p: StoryProject) => {
    setProjectId(p.id);
    setName(p.name);
    const loaded = (p.slides as EditableSlide[]) ?? [];
    setSlides(loaded.length ? loaded : [newSlide()]);
    setSlideIdx(0);
    setLayerIdx(null);
    setOverlayIdx(null);
    setBgInput('');
    setMode('select');
  };

  const createProject = async () => {
    const seed = Array.from({ length: RECOMMENDED_MIN }, () => newSlide());
    const { data, error } = await supabase
      .from('story_projects')
      .insert({ name: 'Nueva secuencia', slides: seed })
      .select()
      .single();
    if (isMissingTable(error)) {
      setMigrationNeeded(true);
      return;
    }
    if (error || !data) {
      toast(error?.message || 'No se pudo crear el proyecto', 'error');
      return;
    }
    setProjects((prev) => [data as StoryProject, ...prev]);
    openProject(data as StoryProject);
    toast('Proyecto creado', 'success');
  };

  const saveProject = async () => {
    if (!projectId) return;
    setSaving(true);
    const { error } = await supabase
      .from('story_projects')
      .update({ name: name.trim() || 'Sin título', slides, updated_at: new Date().toISOString() })
      .eq('id', projectId);
    setSaving(false);
    if (isMissingTable(error)) {
      setMigrationNeeded(true);
      return;
    }
    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast('Guardado', 'success');
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* no-op */ }
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, name: name.trim(), slides } : p)),
    );
  };

  const deleteProject = async (p: StoryProject) => {
    await supabase.from('story_projects').delete().eq('id', p.id);
    setProjects((prev) => prev.filter((x) => x.id !== p.id));
    if (p.id === projectId) {
      setProjectId(null);
      setSlides([]);
      setName('');
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* no-op */ }
    }
    toast('Proyecto eliminado', 'info');
  };

  // ── Slides ──────────────────────────────────────────────────────────────
  const addSlide = () => {
    if (slides.length >= MAX_SLIDES) return;
    setSlides((prev) => [...prev, newSlide()]);
    setSlideIdx(slides.length);
    setLayerIdx(null);
    setOverlayIdx(null);
  };

  const removeSlide = (idx: number) => {
    if (slides.length <= 1) return;
    setSlides((prev) => prev.filter((_, i) => i !== idx));
    setSlideIdx((cur) => Math.max(0, cur >= idx ? cur - 1 : cur));
    setLayerIdx(null);
    setOverlayIdx(null);
  };

  const moveSlide = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= slides.length) return;
    setSlides((prev) => {
      const copy = [...prev];
      [copy[idx], copy[to]] = [copy[to], copy[idx]];
      return copy;
    });
    setSlideIdx(to);
  };

  // ── Fondo ───────────────────────────────────────────────────────────────
  const applyBgUrl = () => {
    const url = bgInput.trim();
    if (!url) return;
    patchSlide(slideIdx, { bg_url: url, bg_asset_id: null });
    setBgInput('');
  };

  const pickAsset = (a: MediaAsset) =>
    patchSlide(slideIdx, { bg_asset_id: a.id, bg_url: a.public_url });

  const clearBg = () => patchSlide(slideIdx, { bg_url: null, bg_asset_id: null });

  const randomBg = () => {
    const imgs = assets.filter((a) => a.kind === 'image');
    if (!imgs.length) {
      toast('No hay imágenes en tu biblioteca todavía', 'info');
      return;
    }
    const a = imgs[Math.floor(Math.random() * imgs.length)];
    pickAsset(a);
    toast('Fondo aleatorio aplicado', 'success');
  };

  /** Sube un archivo de imagen a /api/assets y lo agrega a la biblioteca. */
  const uploadImageFile = async (file: File): Promise<MediaAsset | null> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', 'image');
    try {
      const res = await fetch('/api/assets', { method: 'POST', body: fd });
      if (res.status === 428) {
        setMigrationNeeded(true);
        return null;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(j.error || 'No se pudo subir la imagen', 'error');
        return null;
      }
      const j = await res.json();
      const asset: MediaAsset = {
        id: j.id,
        kind: 'image',
        filename: file.name,
        storage_path: j.storage_path,
        public_url: j.public_url,
        source: 'upload',
        created_at: new Date().toISOString(),
      };
      setAssets((prev) => (prev.some((a) => a.id === asset.id) ? prev : [asset, ...prev]));
      return asset;
    } catch {
      toast('No se pudo subir la imagen', 'error');
      return null;
    }
  };

  const onBgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingBg(true);
    const asset = await uploadImageFile(file);
    setUploadingBg(false);
    if (asset) {
      pickAsset(asset);
      toast('Imagen subida y aplicada como fondo', 'success');
    }
  };

  // ── Imágenes superpuestas (overlays) ─────────────────────────────────────
  const addOverlay = async (src: string) => {
    let srcRatio = 1; // ancho/alto natural de la imagen
    try {
      const img = await loadImg(proxied(src, 600, 600, 'inside'));
      if (img.naturalHeight) srcRatio = img.naturalWidth / img.naturalHeight;
    } catch {
      /* usa ratio 1 si no se puede medir */
    }
    const w = 0.4;
    // altura para conservar el aspecto natural dentro del lienzo 9:16
    const h = (w * CANVAS_W) / (srcRatio * CANVAS_H);
    const ov: StoryImageOverlay = { src, x: 0.5, y: 0.4, w, h, radius: 0, srcRatio };
    const nextIdx = current.overlays?.length ?? 0;
    patchSlide(slideIdx, { overlays: [...(current.overlays ?? []), ov] });
    setOverlayIdx(nextIdx);
    setLayerIdx(null);
    setShowOverlayPicker(false);
    setMode('select');
  };

  /** Fija el aspecto (ancho/alto en px) de la caja del overlay manteniendo el ancho. */
  const setOverlayAspect = (ratioWH: number, radius?: number) => {
    if (overlayIdx == null || !selectedOverlay) return;
    const h = (selectedOverlay.w * CANVAS_W) / (ratioWH * CANVAS_H);
    patchOverlay(slideIdx, overlayIdx, radius != null ? { h, radius } : { h });
  };

  const overlayShapes: { label: string; ratioWH: () => number; radius?: number }[] = [
    { label: 'Original', ratioWH: () => selectedOverlay?.srcRatio ?? 1 },
    { label: 'Cuadrada', ratioWH: () => 1 },
    { label: 'Vertical', ratioWH: () => 4 / 5 },
    { label: 'Story', ratioWH: () => 9 / 16 },
    { label: 'Círculo', ratioWH: () => 1, radius: 0.5 },
  ];

  const onOverlayFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const asset = await uploadImageFile(file);
    if (asset) await addOverlay(asset.public_url);
  };

  const removeOverlay = (oIdx: number) => {
    patchSlide(slideIdx, { overlays: (current.overlays ?? []).filter((_, j) => j !== oIdx) });
    setOverlayIdx(null);
  };

  const setOverlayWidth = (w: number) => {
    if (overlayIdx == null || !selectedOverlay) return;
    const factor = selectedOverlay.w ? w / selectedOverlay.w : 1;
    patchOverlay(slideIdx, overlayIdx, { w, h: selectedOverlay.h * factor });
  };

  // ── Capas de texto ──────────────────────────────────────────────────────
  const addLayer = () => {
    const idx = current.layers.length;
    patchSlide(slideIdx, { layers: [...current.layers, newLayer()] });
    setLayerIdx(idx);
    setOverlayIdx(null);
  };

  const removeLayer = (lIdx: number) => {
    patchSlide(slideIdx, { layers: current.layers.filter((_, j) => j !== lIdx) });
    setLayerIdx(null);
  };

  const setLayer = (patch: Partial<StoryTextLayer>) => {
    if (layerIdx == null) return;
    patchLayer(slideIdx, layerIdx, patch);
  };

  // ── Drag / dibujo sobre el preview ──────────────────────────────────────
  const previewPoint = (e: React.PointerEvent) => {
    const rect = previewRef.current!.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  };

  const startDrag = (kind: 'layer' | 'overlay', idx: number) => (e: React.PointerEvent) => {
    if (mode === 'draw') return;
    e.stopPropagation();
    if (kind === 'layer') {
      setLayerIdx(idx);
      setOverlayIdx(null);
    } else {
      setOverlayIdx(idx);
      setLayerIdx(null);
    }
    dragRef.current = { kind, idx };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPreviewPointerDown = (e: React.PointerEvent) => {
    if (!previewRef.current) return;
    if (mode === 'draw') {
      previewRef.current.setPointerCapture?.(e.pointerId);
      const stroke: StoryDrawStroke = { color: drawColor, width: drawWidth, glow: drawGlow, points: [previewPoint(e)] };
      liveRef.current = stroke;
      setLiveStroke(stroke);
      return;
    }
    // Select mode: si el toque cae en el fondo (no en capa/overlay, que hacen stopPropagation),
    // arranca el reencuadre del fondo arrastrando.
    if (resolveBg(current)) {
      previewRef.current.setPointerCapture?.(e.pointerId);
      bgDragRef.current = {
        sx: e.clientX,
        sy: e.clientY,
        px: current.bg_pan_x ?? 0,
        py: current.bg_pan_y ?? 0,
      };
    }
  };

  const onPreviewPointerMove = (e: React.PointerEvent) => {
    if (mode === 'draw') {
      if (!liveRef.current) return;
      const next = { ...liveRef.current, points: [...liveRef.current.points, previewPoint(e)] };
      liveRef.current = next;
      setLiveStroke(next);
      return;
    }
    if (bgDragRef.current && previewRef.current) {
      const rect = previewRef.current.getBoundingClientRect();
      const s = current.bg_scale ?? 1;
      const range = Math.max(0, (s - 1) / 2);
      const dx = (e.clientX - bgDragRef.current.sx) / rect.width;
      const dy = (e.clientY - bgDragRef.current.sy) / rect.height;
      patchSlide(slideIdx, {
        bg_pan_x: clamp(bgDragRef.current.px + dx, -range, range),
        bg_pan_y: clamp(bgDragRef.current.py + dy, -range, range),
      });
      return;
    }
    const d = dragRef.current;
    if (!d || !previewRef.current) return;
    const p = previewPoint(e);
    if (d.kind === 'layer') patchLayer(slideIdx, d.idx, { x: p.x, y: p.y });
    else patchOverlay(slideIdx, d.idx, { x: p.x, y: p.y });
  };

  const onPreviewPointerUp = () => {
    if (mode === 'draw' && liveRef.current) {
      const committed = liveRef.current;
      liveRef.current = null;
      setLiveStroke(null);
      patchSlide(slideIdx, { strokes: [...(current.strokes ?? []), committed] });
      return;
    }
    bgDragRef.current = null;
    dragRef.current = null;
  };

  // Rueda del mouse sobre el lienzo: zoom del overlay seleccionado, o del fondo.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (mode !== 'select') return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      if (overlayIdx != null) {
        setSlides((prev) =>
          prev.map((s, i) =>
            i === slideIdx
              ? {
                  ...s,
                  overlays: (s.overlays ?? []).map((o, j) => {
                    if (j !== overlayIdx) return o;
                    const w = clamp(o.w * factor, 0.05, 1.5);
                    const f = o.w ? w / o.w : 1;
                    return { ...o, w, h: o.h * f };
                  }),
                }
              : s,
          ),
        );
      } else {
        setSlides((prev) =>
          prev.map((s, i) => {
            if (i !== slideIdx || !(s.bg_asset_id || (s as EditableSlide).bg_url)) return s;
            const ns = clamp((s.bg_scale ?? 1) * factor, 1, 4);
            const range = Math.max(0, (ns - 1) / 2);
            return {
              ...s,
              bg_scale: ns,
              bg_pan_x: clamp(s.bg_pan_x ?? 0, -range, range),
              bg_pan_y: clamp(s.bg_pan_y ?? 0, -range, range),
            };
          }),
        );
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [mode, overlayIdx, slideIdx]);

  const undoStroke = () =>
    patchSlide(slideIdx, { strokes: (current.strokes ?? []).slice(0, -1) });
  const clearStrokes = () => patchSlide(slideIdx, { strokes: [] });

  // ── Exportar ZIP ────────────────────────────────────────────────────────
  const exportZip = async () => {
    if (!slides.length) return;
    setExporting(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < slides.length; i++) {
        const blob = await renderSlideToPng(slides[i], resolveBg(slides[i]));
        zip.file(`${String(i + 1).padStart(2, '0')}.png`, blob);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      downloadBlob(out, `historias_${slugify(name)}.zip`);
      toast(`ZIP exportado (${slides.length} PNG)`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al exportar', 'error');
    }
    setExporting(false);
  };

  // ── Helpers de render ───────────────────────────────────────────────────
  const alignBtns: { v: TextAlign; icon: React.ReactNode; title: string }[] = [
    { v: 'left', icon: <AlignLeft size={15} />, title: 'Izquierda' },
    { v: 'center', icon: <AlignCenter size={15} />, title: 'Centro' },
    { v: 'right', icon: <AlignRight size={15} />, title: 'Derecha' },
    { v: 'justify', icon: <AlignJustify size={15} />, title: 'Justificado' },
  ];

  /** Texto de una capa para el preview: respeta \n y subraya/resalta palabras concretas. */
  const renderLayerText = (l: StoryTextLayer): React.ReactNode => {
    const uSet = new Set((l.underlineWords ?? []).map(cleanWord).filter(Boolean));
    const hSet = new Set((l.highlightWords ?? []).map(cleanWord).filter(Boolean));
    const lines = (l.text || ' ').split('\n');
    return lines.map((line, li) => {
      if (!uSet.size && !hSet.size) return <span key={li} className={styles.textLine}>{line || ' '}</span>;
      const words = line.split(' ');
      return (
        <span key={li} className={styles.textLine}>
          {words.flatMap((word, wi) => {
            const clean = cleanWord(word);
            const u = !!word && uSet.has(clean);
            const h = !!word && !!l.highlight && hSet.has(clean);
            const wordSpan = (
              <span
                key={`w${wi}`}
                style={{
                  textDecoration: u ? 'underline' : undefined,
                  background: h ? l.highlight! : undefined,
                  padding: h ? '0 0.12em' : undefined,
                  borderRadius: h ? '3px' : undefined,
                }}
              >
                {word}
              </span>
            );
            return wi < words.length - 1
              ? [wordSpan, <span key={`s${wi}`}> </span>]
              : [wordSpan];
          })}
        </span>
      );
    });
  };

  const bright = current?.bg_brightness ?? 1;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Clapperboard size={22} className={styles.titleIcon} /> Historias
          </h1>
          <p className={styles.subtitle}>
            Armá secuencias de stories 9:16, superponé texto e imágenes, dibujá y exportalas como PNG listos para subir.
          </p>
        </div>
      </header>

      {migrationNeeded && <MigrationBanner />}

      {/* ---- Selector de proyectos ---- */}
      <section className="glass-panel">
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>Tus secuencias</h2>
            <p className={styles.sectionSub}>Cada secuencia guarda sus slides y capas de texto.</p>
          </div>
          <button className={styles.primaryBtn} onClick={createProject} disabled={migrationNeeded}>
            <Plus size={15} /> Nuevo proyecto
          </button>
        </div>

        {loading ? (
          <div className={styles.muted}>Cargando…</div>
        ) : projects.length === 0 ? (
          <div className={styles.empty}>
            Todavía no tenés secuencias. Creá una con <strong>Nuevo proyecto</strong>.
          </div>
        ) : (
          <div className={styles.projectChips}>
            {projects.map((p) => (
              <span
                key={p.id}
                className={`${styles.projectChip} ${p.id === projectId ? styles.projectChipActive : ''}`}
              >
                <button className={styles.projectChipName} onClick={() => openProject(p)}>
                  {p.name || 'Sin título'}
                  <em className={styles.chipCount}>{(p.slides as StorySlide[])?.length ?? 0} slides</em>
                </button>
                <button
                  className={styles.chipDelete}
                  onClick={() => deleteProject(p)}
                  aria-label={`Eliminar ${p.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ---- Editor ---- */}
      {projectId && current && (
        <section className="glass-panel">
          <div className={styles.editorToolbar}>
            <input
              className={styles.nameInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre de la secuencia"
            />
            <div className={styles.toolbarActions}>
              <button className={styles.ghostBtn} onClick={exportZip} disabled={exporting}>
                {exporting ? <Loader2 size={15} className={styles.spin} /> : <Download size={15} />}
                {exporting ? 'Exportando…' : 'Exportar ZIP'}
              </button>
              <button className={styles.primaryBtn} onClick={saveProject} disabled={saving}>
                {saving ? <Loader2 size={15} className={styles.spin} /> : <Save size={15} />}
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>

          <div className={styles.editorGrid}>
            {/* Lienzo + tira de slides */}
            <div className={styles.canvasCol}>
              {/* Modo: seleccionar / dibujar */}
              <div className={styles.modeBar}>
                <button
                  className={styles.iconToggle}
                  data-on={mode === 'select'}
                  onClick={() => setMode('select')}
                  title="Mover y editar"
                >
                  <MousePointer2 size={15} /> Mover
                </button>
                <button
                  className={styles.iconToggle}
                  data-on={mode === 'draw'}
                  onClick={() => { setMode('draw'); setLayerIdx(null); setOverlayIdx(null); }}
                  title="Dibujar a mano alzada"
                >
                  <Pencil size={15} /> Dibujar
                </button>
                {mode === 'draw' && (
                  <div className={styles.drawTools}>
                    <input
                      type="color"
                      className={styles.colorInput}
                      value={drawColor}
                      onChange={(e) => setDrawColor(e.target.value)}
                      title="Color del pincel"
                    />
                    <input
                      type="range"
                      min={4}
                      max={48}
                      value={drawWidth}
                      onChange={(e) => setDrawWidth(Number(e.target.value))}
                      title="Grosor"
                    />
                    <button
                      className={styles.iconToggle}
                      data-on={drawGlow}
                      onClick={() => setDrawGlow((v) => !v)}
                      title="Neón (halo brillante)"
                    >
                      <Sparkles size={15} />
                    </button>
                    <button className={styles.ghostBtnSm} onClick={undoStroke} title="Deshacer trazo">
                      <Undo2 size={13} />
                    </button>
                    <button className={styles.ghostBtnSm} onClick={clearStrokes} title="Borrar dibujo">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>

              <div
                ref={previewRef}
                className={`${styles.preview} ${mode === 'draw' ? styles.previewDraw : resolveBg(current) ? styles.previewPan : ''}`}
                style={{ width: PREVIEW_W, height: PREVIEW_H }}
                onPointerDown={onPreviewPointerDown}
                onPointerMove={onPreviewPointerMove}
                onPointerUp={onPreviewPointerUp}
                onPointerLeave={onPreviewPointerUp}
                onClick={() => { if (mode === 'select') { setLayerIdx(null); setOverlayIdx(null); } }}
              >
                {resolveBg(current) ? (
                  <img
                    src={proxied(resolveBg(current), PREVIEW_W, Math.round(PREVIEW_H))}
                    alt=""
                    className={styles.previewBg}
                    style={{
                      filter: bright !== 1 ? `brightness(${bright})` : undefined,
                      transform: `translate(${(current.bg_pan_x ?? 0) * 100}%, ${(current.bg_pan_y ?? 0) * 100}%) scale(${current.bg_scale ?? 1})`,
                      transformOrigin: 'center',
                    }}
                    referrerPolicy="no-referrer"
                    draggable={false}
                  />
                ) : (
                  <div className={styles.previewEmpty}>Sin fondo</div>
                )}

                {/* Imágenes superpuestas */}
                {(current.overlays ?? []).map((ov, j) => {
                  const wPx = ov.w * PREVIEW_W;
                  const hPx = ov.h * PREVIEW_H;
                  return (
                    <div
                      key={`ov-${j}`}
                      className={`${styles.overlayImg} ${j === overlayIdx && mode === 'select' ? styles.overlayImgActive : ''}`}
                      style={{
                        left: `${ov.x * 100}%`,
                        top: `${ov.y * 100}%`,
                        width: wPx,
                        height: hPx,
                        borderRadius: (ov.radius ?? 0) * Math.min(wPx, hPx),
                        pointerEvents: mode === 'draw' ? 'none' : 'auto',
                      }}
                      onPointerDown={startDrag('overlay', j)}
                      onClick={(e) => { e.stopPropagation(); if (mode === 'select') { setOverlayIdx(j); setLayerIdx(null); } }}
                    >
                      <img
                        src={proxied(ov.src, 500, 500, 'inside')}
                        alt=""
                        referrerPolicy="no-referrer"
                        draggable={false}
                      />
                    </div>
                  );
                })}

                {/* Capas de texto */}
                {current.layers.map((l, j) => (
                  <div
                    key={j}
                    className={`${styles.layerBox} ${j === layerIdx && mode === 'select' ? styles.layerBoxActive : ''}`}
                    style={{
                      left: `${l.x * 100}%`,
                      top: `${l.y * 100}%`,
                      transform: 'translateX(-50%)',
                      width: l.widthPct ? l.widthPct * PREVIEW_W : 'max-content',
                      fontFamily: `"${l.font}", sans-serif`,
                      fontSize: l.size * SCALE,
                      fontWeight: l.bold ? 700 : 400,
                      color: l.color,
                      textAlign: l.align,
                      textDecoration: l.underline ? 'underline' : 'none',
                      background: l.highlight && !(l.highlightWords?.length) ? l.highlight : 'transparent',
                      padding: l.highlight && !(l.highlightWords?.length) ? `${l.size * SCALE * 0.1}px ${l.size * SCALE * 0.18}px` : 0,
                      lineHeight: l.lineHeight ?? 1.25,
                      pointerEvents: mode === 'draw' ? 'none' : 'auto',
                      whiteSpace: l.widthPct ? 'normal' : 'pre',
                    }}
                    onPointerDown={startDrag('layer', j)}
                    onClick={(e) => { e.stopPropagation(); if (mode === 'select') { setLayerIdx(j); setOverlayIdx(null); } }}
                  >
                    {renderLayerText(l)}
                  </div>
                ))}

                {/* Trazos de dibujo */}
                <svg className={styles.drawSvg} width={PREVIEW_W} height={PREVIEW_H}>
                  <defs>
                    <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="3" result="b" />
                      <feMerge>
                        <feMergeNode in="b" />
                        <feMergeNode in="b" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {[...(current.strokes ?? []), ...(liveStroke ? [liveStroke] : [])].map((s, si) => {
                    const pts = s.points.map((p) => `${p.x * PREVIEW_W},${p.y * PREVIEW_H}`).join(' ');
                    if (s.glow) {
                      return (
                        <g key={si}>
                          <polyline
                            points={pts}
                            fill="none"
                            stroke={s.color}
                            strokeWidth={s.width * SCALE}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            filter="url(#neonGlow)"
                          />
                          <polyline
                            points={pts}
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth={Math.max(1, s.width * SCALE * 0.38)}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </g>
                      );
                    }
                    return (
                      <polyline
                        key={si}
                        points={pts}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={s.width * SCALE}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                </svg>
              </div>

              {mode === 'select' && resolveBg(current) && (
                <p className={styles.hint}>Arrastrá el fondo para reencuadrarlo · rueda del mouse para acercar/alejar</p>
              )}

              <div className={styles.slideStrip}>
                {slides.map((s, i) => (
                  <div
                    key={i}
                    className={`${styles.slideThumb} ${i === slideIdx ? styles.slideThumbActive : ''}`}
                    onClick={() => {
                      setSlideIdx(i);
                      setLayerIdx(null);
                      setOverlayIdx(null);
                    }}
                    style={
                      resolveBg(s)
                        ? { backgroundImage: `url(${proxied(resolveBg(s), 80, 142)})` }
                        : undefined
                    }
                  >
                    <span className={styles.thumbNum}>{i + 1}</span>
                    <div className={styles.thumbActions}>
                      <button onClick={(e) => { e.stopPropagation(); moveSlide(i, -1); }} disabled={i === 0} aria-label="Mover izquierda">
                        <ArrowLeft size={12} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); moveSlide(i, 1); }} disabled={i === slides.length - 1} aria-label="Mover derecha">
                        <ArrowRight size={12} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); removeSlide(i); }} disabled={slides.length <= 1} aria-label="Eliminar slide">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className={styles.addSlide}
                  onClick={addSlide}
                  disabled={slides.length >= MAX_SLIDES}
                  aria-label="Agregar slide"
                  title={slides.length >= MAX_SLIDES ? `Máximo ${MAX_SLIDES} slides` : 'Agregar slide'}
                >
                  <Plus size={18} />
                </button>
              </div>
              <p className={styles.hint}>
                {slides.length} slide{slides.length === 1 ? '' : 's'} · recomendado {RECOMMENDED_MIN}–{MAX_SLIDES}
              </p>
            </div>

            {/* Inspector */}
            <div className={styles.inspector}>
              {/* Fondo */}
              <div className={styles.inspectorBlock}>
                <h3 className={styles.inspectorTitle}><ImagePlus size={15} /> Fondo del slide {slideIdx + 1}</h3>
                <div className={styles.bgRow}>
                  <input
                    className={styles.textInput}
                    value={bgInput}
                    onChange={(e) => setBgInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && applyBgUrl()}
                    placeholder="Pegá una URL de imagen…"
                  />
                  <button className={styles.ghostBtn} onClick={applyBgUrl} disabled={!bgInput.trim()}>
                    Aplicar
                  </button>
                </div>

                <div className={styles.bgActions}>
                  <button className={styles.ghostBtnSm} onClick={() => bgFileRef.current?.click()} disabled={uploadingBg}>
                    {uploadingBg ? <Loader2 size={13} className={styles.spin} /> : <Upload size={13} />}
                    Subir de la PC
                  </button>
                  <button className={styles.ghostBtnSm} onClick={randomBg} disabled={!assets.length}>
                    <Shuffle size={13} /> Aleatorio
                  </button>
                  {resolveBg(current) && (
                    <button className={styles.ghostBtnSm} onClick={clearBg}>
                      <X size={13} /> Quitar
                    </button>
                  )}
                </div>
                <input ref={bgFileRef} type="file" accept="image/*" hidden onChange={onBgFile} />

                {/* Brillo */}
                <label className={styles.control}>
                  <span><Sun size={12} /> Brillo del fondo · {Math.round(bright * 100)}%</span>
                  <input
                    type="range"
                    min={30}
                    max={170}
                    value={Math.round(bright * 100)}
                    disabled={!resolveBg(current)}
                    onChange={(e) => patchSlide(slideIdx, { bg_brightness: Number(e.target.value) / 100 })}
                  />
                </label>

                {assets.length > 0 && (
                  <>
                    <p className={styles.pickerLabel}>O elegí de tu biblioteca:</p>
                    <div className={styles.assetGrid}>
                      {assets.map((a) => (
                        <button
                          key={a.id}
                          className={`${styles.assetThumb} ${current.bg_asset_id === a.id ? styles.assetThumbActive : ''}`}
                          onClick={() => pickAsset(a)}
                          style={{ backgroundImage: `url(${proxied(a.public_url, 80, 142)})` }}
                          title={a.filename ?? ''}
                          aria-label={`Usar ${a.filename ?? 'imagen'}`}
                        />
                      ))}
                    </div>
                  </>
                )}
                <p className={styles.pickerLabel}>O importá desde Google Drive:</p>
                <DrivePicker
                  onPicked={(a) => {
                    setAssets((prev) => (prev.some((x) => x.id === a.id) ? prev : [a, ...prev]));
                    pickAsset(a);
                  }}
                />
              </div>

              {/* Imágenes superpuestas */}
              <div className={styles.inspectorBlock}>
                <div className={styles.inspectorHead}>
                  <h3 className={styles.inspectorTitle}><Images size={15} /> Imágenes superpuestas</h3>
                  <button className={styles.ghostBtnSm} onClick={() => setShowOverlayPicker((v) => !v)}>
                    <Plus size={13} /> Agregar
                  </button>
                </div>
                <input ref={overlayFileRef} type="file" accept="image/*" hidden onChange={onOverlayFile} />

                {showOverlayPicker && (
                  <div className={styles.overlayPicker}>
                    <button className={styles.ghostBtnSm} onClick={() => overlayFileRef.current?.click()}>
                      <Upload size={13} /> Subir de la PC
                    </button>
                    {assets.length > 0 ? (
                      <>
                        <p className={styles.pickerLabel}>O elegí de tu biblioteca para superponer:</p>
                        <div className={styles.assetGrid}>
                          {assets.map((a) => (
                            <button
                              key={a.id}
                              className={styles.assetThumb}
                              onClick={() => addOverlay(a.public_url)}
                              style={{ backgroundImage: `url(${proxied(a.public_url, 80, 80)})` }}
                              title={`Superponer ${a.filename ?? 'imagen'}`}
                              aria-label={`Superponer ${a.filename ?? 'imagen'}`}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className={styles.muted}>Subí una imagen para superponerla.</p>
                    )}
                  </div>
                )}

                {(current.overlays?.length ?? 0) === 0 ? (
                  <p className={styles.muted}>Sin imágenes superpuestas. Usá <strong>Agregar</strong>; después arrastralas en el lienzo.</p>
                ) : (
                  <div className={styles.layerList}>
                    {(current.overlays ?? []).map((ov, j) => (
                      <div
                        key={j}
                        className={`${styles.layerItem} ${j === overlayIdx ? styles.layerItemActive : ''}`}
                        onClick={() => { setOverlayIdx(j); setLayerIdx(null); setMode('select'); }}
                      >
                        <span className={styles.layerItemText}>Imagen {j + 1}</span>
                        <button onClick={(e) => { e.stopPropagation(); removeOverlay(j); }} aria-label="Eliminar imagen">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {selectedOverlay && (
                  <>
                    <p className={styles.pickerLabel}>Forma:</p>
                    <div className={styles.toggleGroup}>
                      {overlayShapes.map((sh) => (
                        <button
                          key={sh.label}
                          className={styles.shapeBtn}
                          onClick={() => setOverlayAspect(sh.ratioWH(), sh.radius ?? 0)}
                        >
                          {sh.label}
                        </button>
                      ))}
                    </div>
                    <label className={styles.control}>
                      <span>Tamaño · {Math.round(selectedOverlay.w * 100)}%</span>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={Math.round(selectedOverlay.w * 100)}
                        onChange={(e) => setOverlayWidth(Number(e.target.value) / 100)}
                      />
                    </label>
                    <label className={styles.control}>
                      <span>Redondez · {Math.round((selectedOverlay.radius ?? 0) * 200)}%</span>
                      <input
                        type="range"
                        min={0}
                        max={50}
                        value={Math.round((selectedOverlay.radius ?? 0) * 100)}
                        onChange={(e) =>
                          overlayIdx != null && patchOverlay(slideIdx, overlayIdx, { radius: Number(e.target.value) / 100 })
                        }
                      />
                    </label>
                  </>
                )}
              </div>

              {/* Capas de texto */}
              <div className={styles.inspectorBlock}>
                <div className={styles.inspectorHead}>
                  <h3 className={styles.inspectorTitle}><Type size={15} /> Capas de texto</h3>
                  <button className={styles.ghostBtnSm} onClick={addLayer}><Plus size={13} /> Agregar</button>
                </div>

                {current.layers.length === 0 ? (
                  <p className={styles.muted}>Sin capas. Agregá texto para empezar.</p>
                ) : (
                  <div className={styles.layerList}>
                    {current.layers.map((l, j) => (
                      <div
                        key={j}
                        className={`${styles.layerItem} ${j === layerIdx ? styles.layerItemActive : ''}`}
                        onClick={() => { setLayerIdx(j); setOverlayIdx(null); }}
                      >
                        <span className={styles.layerItemText}>{l.text || '(vacío)'}</span>
                        <button onClick={(e) => { e.stopPropagation(); removeLayer(j); }} aria-label="Eliminar capa">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {selectedLayer && layerIdx != null && (
                  <div className={styles.layerEditor}>
                    <textarea
                      className={styles.textArea}
                      value={selectedLayer.text}
                      onChange={(e) => setLayer({ text: e.target.value })}
                      rows={2}
                      placeholder="Texto…"
                    />

                    <div className={styles.controlRow}>
                      <label className={styles.control}>
                        <span>Fuente</span>
                        <select
                          className={styles.select}
                          value={selectedLayer.font}
                          onChange={(e) => setLayer({ font: e.target.value })}
                        >
                          {STORY_FONTS.map((f) => (
                            <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>{f.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.control}>
                        <span>Tamaño · {selectedLayer.size}px</span>
                        <input
                          type="range"
                          min={32}
                          max={220}
                          value={selectedLayer.size}
                          onChange={(e) => setLayer({ size: Number(e.target.value) })}
                        />
                      </label>
                    </div>

                    <div className={styles.controlRow}>
                      <label className={styles.control}>
                        <span>Interlineado · {(selectedLayer.lineHeight ?? 1.25).toFixed(2)}</span>
                        <input
                          type="range"
                          min={80}
                          max={220}
                          value={Math.round((selectedLayer.lineHeight ?? 1.25) * 100)}
                          onChange={(e) => setLayer({ lineHeight: Number(e.target.value) / 100 })}
                        />
                      </label>
                      <label className={styles.control}>
                        <span>Ancho / borde · {selectedLayer.widthPct ? `${Math.round(selectedLayer.widthPct * 100)}%` : 'auto'}</span>
                        <input
                          type="range"
                          min={20}
                          max={100}
                          value={selectedLayer.widthPct ? Math.round(selectedLayer.widthPct * 100) : 100}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setLayer({ widthPct: v >= 100 ? null : v / 100 });
                          }}
                        />
                      </label>
                    </div>

                    <div className={styles.controlRow}>
                      <label className={styles.control}>
                        <span>Color</span>
                        <input
                          type="color"
                          className={styles.colorInput}
                          value={selectedLayer.color}
                          onChange={(e) => setLayer({ color: e.target.value })}
                        />
                      </label>
                      <label className={styles.control}>
                        <span>Resaltado (toda la capa)</span>
                        <div className={styles.highlightRow}>
                          <input
                            type="color"
                            className={styles.colorInput}
                            value={selectedLayer.highlight ?? '#ffe600'}
                            onChange={(e) => setLayer({ highlight: e.target.value })}
                          />
                          <button
                            className={styles.iconToggle}
                            data-on={selectedLayer.highlight != null}
                            onClick={() =>
                              setLayer({ highlight: selectedLayer.highlight ? null : '#ffe600' })
                            }
                            aria-pressed={selectedLayer.highlight != null}
                            title={selectedLayer.highlight ? 'Quitar resaltado' : 'Activar resaltado'}
                          >
                            <Highlighter size={15} />
                          </button>
                        </div>
                      </label>
                    </div>

                    <div className={styles.controlRow}>
                      <div className={styles.toggleGroup}>
                        <button
                          className={styles.iconToggle}
                          data-on={selectedLayer.bold}
                          onClick={() => setLayer({ bold: !selectedLayer.bold })}
                          aria-pressed={selectedLayer.bold}
                          title="Negrita"
                        >
                          <Bold size={15} />
                        </button>
                        <button
                          className={styles.iconToggle}
                          data-on={selectedLayer.underline}
                          onClick={() => setLayer({ underline: !selectedLayer.underline })}
                          aria-pressed={selectedLayer.underline}
                          title="Subrayar toda la capa"
                        >
                          <Underline size={15} />
                        </button>
                      </div>
                      <div className={styles.toggleGroup}>
                        {alignBtns.map((b) => (
                          <button
                            key={b.v}
                            className={styles.iconToggle}
                            data-on={selectedLayer.align === b.v}
                            onClick={() => setLayer({ align: b.v })}
                            aria-pressed={selectedLayer.align === b.v}
                            title={`Alinear ${b.title}`}
                          >
                            {b.icon}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className={styles.control}>
                      <span><Underline size={12} /> Subrayar palabras concretas (separadas por coma)</span>
                      <input
                        className={styles.textInput}
                        value={uwText}
                        onChange={(e) => {
                          setUwText(e.target.value);
                          setLayer({
                            underlineWords: e.target.value.split(',').map((w) => w.trim()).filter(Boolean),
                          });
                        }}
                        placeholder="ej. gratis, hoy, ahora"
                      />
                    </label>

                    <label className={styles.control}>
                      <span><Highlighter size={12} /> Resaltar palabras concretas (usa el color de resaltado)</span>
                      <input
                        className={styles.textInput}
                        value={hwText}
                        onChange={(e) => {
                          setHwText(e.target.value);
                          const words = e.target.value.split(',').map((w) => w.trim()).filter(Boolean);
                          setLayer({
                            highlightWords: words,
                            // si resaltás palabras sin color de resaltado activo, activá uno por defecto
                            highlight: words.length && !selectedLayer.highlight ? '#ffe600' : selectedLayer.highlight,
                          });
                        }}
                        placeholder="ej. gratis, ahora"
                      />
                    </label>

                    <p className={styles.hint}><Copy size={12} /> Arrastrá el texto sobre el lienzo para posicionarlo.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
