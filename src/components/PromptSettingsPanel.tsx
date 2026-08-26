'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, RotateCcw, Save, SlidersHorizontal, Eraser, Eye } from 'lucide-react';
import { useToast } from '@/components/Toast';
import {
  BLOCK_DEFS,
  DEFAULT_BLOCKS,
  type BlockId,
  type Blocks,
  type PromptTarget,
} from '@/lib/promptConfig';
import styles from './PromptSettingsPanel.module.css';

interface PromptSettingsPanelProps {
  onClose: () => void;
}

const USED_IN_LABEL: Record<PromptTarget, string> = {
  chat: 'Chat',
  analisis: 'Análisis de reels',
  adaptar: 'Adaptar virales',
};

type PreviewTab = PromptTarget;

const PREVIEW_TABS: { id: PreviewTab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'analisis', label: 'Análisis de reels' },
  { id: 'adaptar', label: 'Adaptar virales' },
];

/**
 * Editor del entrenamiento de la IA. Cada bloque es una sección del prompt.
 *
 * Tres estados por bloque, y la diferencia importa:
 *   - igual al default  → hereda mejoras del código
 *   - editado           → gana sobre el default
 *   - VACÍO             → apagado: no entra al prompt (no vuelve al default)
 *
 * El preview muestra el prompt final tal cual lo recibe el modelo. Si borraste
 * algo del entrenamiento y seguís viéndolo en el chat, se comprueba acá.
 */
export default function PromptSettingsPanel({ onClose }: PromptSettingsPanelProps) {
  const { toast } = useToast();
  const [blocks, setBlocks] = useState<Blocks>(DEFAULT_BLOCKS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);

  const [previewTab, setPreviewTab] = useState<PreviewTab | null>(null);
  const [preview, setPreview] = useState<Record<PreviewTab, string> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/ai-settings');
        const data = await res.json();
        if (data.blocks) setBlocks(data.blocks);
        setTableMissing(Boolean(data.tableMissing));
      } catch {
        toast('No se pudo cargar el entrenamiento', 'error');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (id: BlockId, value: string) => {
    setBlocks((prev) => ({ ...prev, [id]: value }));
    setDirty(true);
    setPreview(null); // el preview guardado dejó de reflejar lo que hay en pantalla
  };

  const resetBlock = (id: BlockId) => update(id, DEFAULT_BLOCKS[id]);
  const clearBlock = (id: BlockId) => update(id, '');

  /** Trae el prompt final ya compuesto en el servidor (post-guardado). */
  const loadPreview = async (tab: PreviewTab) => {
    setPreviewTab(tab);
    if (preview) return;
    setPreviewLoading(true);
    try {
      const res = await fetch('/api/ai-settings?preview=1');
      const data = await res.json();
      if (data.preview) setPreview(data.preview);
      else toast('No se pudo armar el preview', 'error');
    } catch {
      toast('Error de red al cargar el preview', 'error');
    }
    setPreviewLoading(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/ai-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'No se pudo guardar', 'error');
      } else {
        if (data.blocks) setBlocks(data.blocks);
        setDirty(false);
        setTableMissing(false);
        setPreview(null);
        toast('Entrenamiento guardado — la IA ya lo usa', 'success');
      }
    } catch {
      toast('Error de red al guardar', 'error');
    }
    setSaving(false);
  };

  return (
    <div className={styles.panelOverlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Entrenamiento de la IA">
        <div className={styles.topBar}>
          <div className={styles.topInfo}>
            <h2 className={styles.panelTitle}>
              <SlidersHorizontal size={16} className={styles.titleIcon} /> Entrenamiento de la IA
            </h2>
            <p className={styles.panelSub}>
              Estos bloques SON el prompt completo con el que trabaja tu estratega: no hay texto
              oculto fuera de acá. Un bloque vacío no se le manda a la IA. Las transcripciones y los
              números de tus reels se siguen leyendo solos.
            </p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        {tableMissing && (
          <div className={styles.notice}>
            <strong>Falta un paso:</strong> corré <code>supabase_migration_ai_config.sql</code> en el
            SQL Editor de Supabase. Hasta entonces podés ver los bloques pero no guardarlos.
          </div>
        )}

        <div className={styles.previewBar}>
          <div className={styles.previewTabs}>
            <button
              className={`${styles.previewTab} ${previewTab === null ? styles.previewTabActive : ''}`}
              onClick={() => setPreviewTab(null)}
            >
              Bloques
            </button>
            {PREVIEW_TABS.map((t) => (
              <button
                key={t.id}
                className={`${styles.previewTab} ${previewTab === t.id ? styles.previewTabActive : ''}`}
                onClick={() => loadPreview(t.id)}
              >
                <Eye size={11} /> {t.label}
              </button>
            ))}
          </div>
        </div>

        {previewTab !== null ? (
          <div className={styles.content}>
            <p className={styles.previewNote}>
              Esto es <strong>textualmente</strong> lo que recibe el modelo, con lo último que
              guardaste. Si borraste algo del entrenamiento y todavía aparece acá, está entrando por
              otro bloque: buscalo con Ctrl+F y vacialo.
              {dirty && ' Ojo: tenés cambios sin guardar que todavía no se ven en este preview.'}
            </p>
            {previewLoading ? (
              <div className={styles.loading}>
                <Loader2 size={16} className={styles.spin} /> Armando el prompt…
              </div>
            ) : (
              <pre className={styles.previewPre}>{preview?.[previewTab] ?? ''}</pre>
            )}
          </div>
        ) : (
          <div className={styles.content}>
            {loading ? (
              <div className={styles.loading}>
                <Loader2 size={16} className={styles.spin} /> Cargando entrenamiento…
              </div>
            ) : (
              BLOCK_DEFS.map((def) => {
                const value = blocks[def.id];
                const isDefault = value.trim() === def.fallback.trim();
                const isOff = !value.trim();
                return (
                  <section
                    key={def.id}
                    className={`${styles.block} ${isOff ? styles.blockOff : ''}`}
                  >
                    <div className={styles.blockHead}>
                      <div className={styles.blockLabelWrap}>
                        <h3 className={styles.blockLabel}>
                          {def.label}
                          {!isDefault && !isOff && (
                            <span className={styles.editedDot} title="Personalizado" />
                          )}
                          {isOff && <span className={styles.offTag}>apagado</span>}
                        </h3>
                        <div className={styles.tags}>
                          {def.usedIn.map((u) => (
                            <span key={u} className={styles.tag}>{USED_IN_LABEL[u]}</span>
                          ))}
                        </div>
                      </div>
                      <div className={styles.blockActions}>
                        <button
                          className={styles.resetBtn}
                          onClick={() => clearBlock(def.id)}
                          disabled={isOff}
                          title="Sacar este bloque del prompt (no vuelve al texto original)"
                        >
                          <Eraser size={12} /> Vaciar
                        </button>
                        <button
                          className={styles.resetBtn}
                          onClick={() => resetBlock(def.id)}
                          disabled={isDefault}
                          title="Volver al texto original"
                        >
                          <RotateCcw size={12} /> Original
                        </button>
                      </div>
                    </div>
                    <p className={styles.blockHint}>{def.hint}</p>
                    <textarea
                      className={styles.blockInput}
                      value={value}
                      onChange={(e) => update(def.id, e.target.value)}
                      placeholder="Vacío = este bloque no se le manda a la IA."
                      rows={Math.min(16, Math.max(4, value.split('\n').length + 1))}
                      spellCheck={false}
                    />
                  </section>
                );
              })
            )}
          </div>
        )}

        <div className={styles.footer}>
          <span className={styles.footerHint}>
            {dirty ? 'Hay cambios sin guardar' : 'Todo guardado'}
          </span>
          <button className={styles.saveBtn} onClick={save} disabled={saving || loading || !dirty}>
            {saving ? <Loader2 size={15} className={styles.spin} /> : <Save size={15} />}
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
