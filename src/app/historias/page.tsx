'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Clapperboard, Plus, Save, Download, Trash2, Copy, Loader2,
  ArrowLeft, ArrowRight, Type, ImagePlus, Bold, Underline,
  AlignLeft, AlignCenter, AlignRight, X, Highlighter,
} from 'lucide-react';
import { supabase } from '@/utils/supabase';
import { useToast } from '@/components/Toast';
import MigrationBanner from '@/components/MigrationBanner';
import { renderSlideToPng, proxied, STORY_FONTS } from '@/lib/storyRender';
import type { StoryProject, StorySlide, StoryTextLayer, MediaAsset, TextAlign } from '@/lib/studio-types';
import styles from './page.module.css';

// ── Constantes ──────────────────────────────────────────────────────────────
const MAX_SLIDES = 6;
const RECOMMENDED_MIN = 4;
const PREVIEW_W = 324; // px del preview; el lienzo real es 1080 → escala 0.3
const CANVAS_W = 1080;
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
});

const newSlide = (): EditableSlide => ({ bg_asset_id: null, bg_url: null, layers: [] });

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

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [bgInput, setBgInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const current = slides[slideIdx];
  const selectedLayer = layerIdx != null ? current?.layers[layerIdx] : undefined;

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
    setBgInput('');
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
    }
    toast('Proyecto eliminado', 'info');
  };

  // ── Slides ──────────────────────────────────────────────────────────────
  const addSlide = () => {
    if (slides.length >= MAX_SLIDES) return;
    setSlides((prev) => [...prev, newSlide()]);
    setSlideIdx(slides.length);
    setLayerIdx(null);
  };

  const removeSlide = (idx: number) => {
    if (slides.length <= 1) return;
    setSlides((prev) => prev.filter((_, i) => i !== idx));
    setSlideIdx((cur) => Math.max(0, cur >= idx ? cur - 1 : cur));
    setLayerIdx(null);
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

  // ── Capas de texto ──────────────────────────────────────────────────────
  const addLayer = () => {
    const idx = current.layers.length;
    patchSlide(slideIdx, { layers: [...current.layers, newLayer()] });
    setLayerIdx(idx);
  };

  const removeLayer = (lIdx: number) => {
    patchSlide(slideIdx, { layers: current.layers.filter((_, j) => j !== lIdx) });
    setLayerIdx(null);
  };

  const setLayer = (patch: Partial<StoryTextLayer>) => {
    if (layerIdx == null) return;
    patchLayer(slideIdx, layerIdx, patch);
  };

  // ── Drag de capas sobre el preview ──────────────────────────────────────
  const onLayerPointerDown = (lIdx: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    setLayerIdx(lIdx);
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPreviewPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || layerIdx == null || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    patchLayer(slideIdx, layerIdx, { x, y });
  };

  const endDrag = () => {
    dragging.current = false;
  };

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

  // ── Render ──────────────────────────────────────────────────────────────
  const alignBtns: { v: TextAlign; icon: React.ReactNode }[] = [
    { v: 'left', icon: <AlignLeft size={15} /> },
    { v: 'center', icon: <AlignCenter size={15} /> },
    { v: 'right', icon: <AlignRight size={15} /> },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Clapperboard size={22} className={styles.titleIcon} /> Historias
          </h1>
          <p className={styles.subtitle}>
            Armá secuencias de stories 9:16, superponé texto y exportalas como PNG listos para subir.
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
              <div
                ref={previewRef}
                className={styles.preview}
                style={{ width: PREVIEW_W, height: PREVIEW_W * (1920 / 1080) }}
                onPointerMove={onPreviewPointerMove}
                onPointerUp={endDrag}
                onPointerLeave={endDrag}
                onClick={() => setLayerIdx(null)}
              >
                {resolveBg(current) ? (
                  <img
                    src={proxied(resolveBg(current), PREVIEW_W, Math.round(PREVIEW_W * (1920 / 1080)))}
                    alt=""
                    className={styles.previewBg}
                    referrerPolicy="no-referrer"
                    draggable={false}
                  />
                ) : (
                  <div className={styles.previewEmpty}>Sin fondo</div>
                )}

                {current.layers.map((l, j) => (
                  <div
                    key={j}
                    className={`${styles.layerBox} ${j === layerIdx ? styles.layerBoxActive : ''}`}
                    style={{
                      left: `${l.x * 100}%`,
                      top: `${l.y * 100}%`,
                      transform:
                        l.align === 'center'
                          ? 'translateX(-50%)'
                          : l.align === 'right'
                            ? 'translateX(-100%)'
                            : 'none',
                      fontFamily: `"${l.font}", sans-serif`,
                      fontSize: l.size * SCALE,
                      fontWeight: l.bold ? 700 : 400,
                      color: l.color,
                      textAlign: l.align,
                      textDecoration: l.underline ? 'underline' : 'none',
                      background: l.highlight ?? 'transparent',
                      padding: l.highlight ? `${l.size * SCALE * 0.1}px ${l.size * SCALE * 0.18}px` : 0,
                      lineHeight: 1.25,
                    }}
                    onPointerDown={onLayerPointerDown(j)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setLayerIdx(j);
                    }}
                  >
                    {l.text || ' '}
                  </div>
                ))}
              </div>

              <div className={styles.slideStrip}>
                {slides.map((s, i) => (
                  <div
                    key={i}
                    className={`${styles.slideThumb} ${i === slideIdx ? styles.slideThumbActive : ''}`}
                    onClick={() => {
                      setSlideIdx(i);
                      setLayerIdx(null);
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
                {resolveBg(current) && (
                  <button className={styles.linkBtn} onClick={clearBg}>
                    <X size={13} /> Quitar fondo
                  </button>
                )}
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
              </div>

              {/* Capas */}
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
                        onClick={() => setLayerIdx(j)}
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
                            <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.control}>
                        <span>Tamaño {selectedLayer.size}px</span>
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
                        <span>Color</span>
                        <input
                          type="color"
                          className={styles.colorInput}
                          value={selectedLayer.color}
                          onChange={(e) => setLayer({ color: e.target.value })}
                        />
                      </label>
                      <label className={styles.control}>
                        <span>Resaltado</span>
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
                          title="Subrayado"
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
                            title={`Alinear ${b.v}`}
                          >
                            {b.icon}
                          </button>
                        ))}
                      </div>
                    </div>
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
