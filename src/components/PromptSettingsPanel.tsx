'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, RotateCcw, Save, SlidersHorizontal } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { BLOCK_DEFS, DEFAULT_BLOCKS, type BlockId, type Blocks } from '@/lib/promptConfig';
import styles from './PromptSettingsPanel.module.css';

interface PromptSettingsPanelProps {
  onClose: () => void;
}

const USED_IN_LABEL: Record<'chat' | 'analisis', string> = {
  chat: 'Chat',
  analisis: 'Análisis de reels',
};

/**
 * Editor del entrenamiento de la IA. Cada bloque es una sección del prompt que
 * se puede reescribir; lo que no se toca sigue el default del código.
 *
 * Mismo patrón de panel deslizante que ReelDetailPanel para no introducir una
 * estructura de navegación nueva.
 */
export default function PromptSettingsPanel({ onClose }: PromptSettingsPanelProps) {
  const { toast } = useToast();
  const [blocks, setBlocks] = useState<Blocks>(DEFAULT_BLOCKS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);

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
  };

  const resetBlock = (id: BlockId) => {
    setBlocks((prev) => ({ ...prev, [id]: DEFAULT_BLOCKS[id] }));
    setDirty(true);
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
              Estos bloques son el prompt con el que trabaja tu estratega. Editalos para afinar cómo
              piensa. Las transcripciones y los números de tus reels se siguen leyendo solos.
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

        <div className={styles.content}>
          {loading ? (
            <div className={styles.loading}>
              <Loader2 size={16} className={styles.spin} /> Cargando entrenamiento…
            </div>
          ) : (
            BLOCK_DEFS.map((def) => {
              const isDefault = blocks[def.id].trim() === def.fallback.trim();
              return (
                <section key={def.id} className={styles.block}>
                  <div className={styles.blockHead}>
                    <div className={styles.blockLabelWrap}>
                      <h3 className={styles.blockLabel}>
                        {def.label}
                        {!isDefault && <span className={styles.editedDot} title="Personalizado" />}
                      </h3>
                      <div className={styles.tags}>
                        {def.usedIn.map((u) => (
                          <span key={u} className={styles.tag}>{USED_IN_LABEL[u]}</span>
                        ))}
                      </div>
                    </div>
                    <button
                      className={styles.resetBtn}
                      onClick={() => resetBlock(def.id)}
                      disabled={isDefault}
                      title="Volver al texto original"
                    >
                      <RotateCcw size={12} /> Original
                    </button>
                  </div>
                  <p className={styles.blockHint}>{def.hint}</p>
                  <textarea
                    className={styles.blockInput}
                    value={blocks[def.id]}
                    onChange={(e) => update(def.id, e.target.value)}
                    rows={Math.min(16, Math.max(4, blocks[def.id].split('\n').length + 1))}
                    spellCheck={false}
                  />
                </section>
              );
            })
          )}
        </div>

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
