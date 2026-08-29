'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, Check, Loader2, Link2, Tag } from 'lucide-react';
import { supabase } from '@/utils/supabase';
import { useToast } from '@/components/Toast';
import VideoRefLink from '@/components/VideoRefLink';
import { normalizeUrl } from '@/lib/videoEmbed';
import {
  BOARD_COLUMNS,
  PRODUCTION_MIGRATION,
  SCRIPT_FORMATS,
  ScriptCard,
  ScriptFormat,
  ScriptStatus,
  isMissingSchema,
} from '@/lib/scripts-types';
import styles from './ScriptEditorPanel.module.css';

interface ScriptEditorPanelProps {
  card: ScriptCard;
  /** Refleja los cambios en el tablero mientras se escribe (antes de guardar). */
  onChange: (card: ScriptCard) => void;
  /**
   * Cambio de etapa. Lo resuelve el tablero, no el panel: además del `status`
   * hay que recalcular la posición, o la tarjeta cae en cualquier lugar de la
   * columna nueva (conserva el orden que tenía en la vieja).
   */
  onMove: (status: ScriptStatus) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Lo que viaja a Supabase. `id`, `created_at` y `position` no se tocan acá. */
const toRow = (card: ScriptCard) => ({
  title: card.title,
  status: card.status,
  format: card.format,
  tags: card.tags,
  hook: card.hook,
  body: card.body,
  cta: card.cta,
  refs: card.refs,
  updated_at: new Date().toISOString(),
});

export default function ScriptEditorPanel({
  card,
  onChange,
  onMove,
  onClose,
  onDelete,
}: ScriptEditorPanelProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<ScriptCard>(card);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [newRef, setNewRef] = useState('');
  const [newRefLabel, setNewRefLabel] = useState('');
  const [newTag, setNewTag] = useState('');

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // El último borrador pendiente de guardar, para poder vaciarlo al cerrar.
  const pending = useRef<ScriptCard | null>(null);

  const persist = useCallback(
    async (next: ScriptCard) => {
      pending.current = null;
      setSaveState('saving');
      const { error } = await supabase.from('scripts').update(toRow(next)).eq('id', next.id);
      if (error) {
        setSaveState('error');
        toast(
          isMissingSchema(error)
            ? `Falta correr ${PRODUCTION_MIGRATION} en Supabase`
            : 'No se pudo guardar el guion',
          'error',
        );
        return;
      }
      setSaveState('saved');
    },
    [toast],
  );

  /** Cada tecleo actualiza el tablero al instante y agenda el guardado. */
  const patch = useCallback(
    (fields: Partial<ScriptCard>) => {
      setDraft((prev) => {
        const next = { ...prev, ...fields };
        pending.current = next;
        onChange(next);
        setSaveState('idle');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => persist(next), 900);
        return next;
      });
    },
    [onChange, persist],
  );

  // Al desmontar (cerrar el panel, cambiar de tarjeta) no se pierde lo tipeado
  // en los últimos 900 ms: se manda el borrador pendiente.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      const last = pending.current;
      if (last) {
        supabase.from('scripts').update(toRow(last)).eq('id', last.id).then(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addRef = () => {
    const url = normalizeUrl(newRef);
    if (!url) return;
    const label = newRefLabel.trim();
    patch({ refs: [...draft.refs, label ? { url, label } : { url }] });
    setNewRef('');
    setNewRefLabel('');
  };

  const removeRef = (index: number) => {
    patch({ refs: draft.refs.filter((_, i) => i !== index) });
  };

  const addTag = () => {
    const tag = newTag.trim().replace(/^#/, '');
    if (!tag || draft.tags.includes(tag)) {
      setNewTag('');
      return;
    }
    patch({ tags: [...draft.tags, tag] });
    setNewTag('');
  };

  const removeTag = (tag: string) => patch({ tags: draft.tags.filter((t) => t !== tag) });

  const handleDelete = async () => {
    if (!window.confirm('¿Borrar este guion? No se puede deshacer.')) return;
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    const { error } = await supabase.from('scripts').delete().eq('id', draft.id);
    if (error) {
      toast('No se pudo borrar el guion', 'error');
      return;
    }
    onDelete(draft.id);
    toast('Guion borrado', 'info');
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside className={styles.panel} onClick={(e) => e.stopPropagation()} aria-label="Editor de guion">
        <header className={styles.head}>
          <input
            className={styles.titleInput}
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Título del guion"
            aria-label="Título del guion"
          />
          <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar editor">
            <X size={18} />
          </button>
        </header>

        <div className={styles.body}>
          {/* ---- Etapa + formato ---- */}
          <section className={styles.block}>
            <label className={styles.blockLabel} htmlFor="script-status">Etapa</label>
            <select
              id="script-status"
              className={styles.select}
              value={draft.status}
              onChange={(e) => {
                const status = e.target.value as ScriptStatus;
                setDraft((prev) => ({ ...prev, status }));
                if (pending.current) pending.current = { ...pending.current, status };
                onMove(status);
              }}
            >
              {BOARD_COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </section>

          <section className={styles.block}>
            <span className={styles.blockLabel}>Formato</span>
            <div className={styles.chips}>
              {SCRIPT_FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  title={f.hint}
                  className={`${styles.chip} ${draft.format === f.id ? styles.chipActive : ''}`}
                  onClick={() => patch({ format: draft.format === f.id ? null : (f.id as ScriptFormat) })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </section>

          {/* ---- Etiquetas libres ---- */}
          <section className={styles.block}>
            <span className={styles.blockLabel}><Tag size={12} /> Etiquetas</span>
            <div className={styles.chips}>
              {draft.tags.map((tag) => (
                <span key={tag} className={styles.tag}>
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} aria-label={`Quitar ${tag}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                className={styles.tagInput}
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder="pilar, campaña…"
                aria-label="Nueva etiqueta"
              />
            </div>
          </section>

          {/* ---- Guion: hook / cuerpo / CTA ---- */}
          <section className={styles.block}>
            <label className={styles.blockLabel} htmlFor="script-hook">Hook</label>
            <p className={styles.blockHint}>
              Cargá todas las variantes que se te ocurran, una por línea. Después elegís cuál grabás.
            </p>
            <textarea
              id="script-hook"
              className={`${styles.textarea} ${styles.textareaHook}`}
              value={draft.hook}
              onChange={(e) => patch({ hook: e.target.value })}
              placeholder={'Variante 1: …\nVariante 2: …\nVariante 3: …'}
            />
          </section>

          <section className={styles.block}>
            <label className={styles.blockLabel} htmlFor="script-body">Cuerpo</label>
            <textarea
              id="script-body"
              className={`${styles.textarea} ${styles.textareaBody}`}
              value={draft.body}
              onChange={(e) => patch({ body: e.target.value })}
              placeholder="El desarrollo: qué contás, en qué orden, qué se ve en pantalla."
            />
          </section>

          <section className={styles.block}>
            <label className={styles.blockLabel} htmlFor="script-cta">CTA</label>
            <textarea
              id="script-cta"
              className={`${styles.textarea} ${styles.textareaCta}`}
              value={draft.cta}
              onChange={(e) => patch({ cta: e.target.value })}
              placeholder="Qué le pedís al que llegó hasta acá."
            />
          </section>

          {/* ---- Referencias ---- */}
          <section className={styles.block}>
            <span className={styles.blockLabel}><Link2 size={12} /> Referencias</span>
            <p className={styles.blockHint}>
              Los videos que usás de inspiración. Se abren en un toque o se previsualizan acá mismo.
            </p>

            <div className={styles.refList}>
              {draft.refs.map((ref, i) => (
                <VideoRefLink
                  key={`${ref.url}-${i}`}
                  url={ref.url}
                  label={ref.label}
                  onRemove={() => removeRef(i)}
                />
              ))}
              {draft.refs.length === 0 && (
                <p className={styles.empty}>Todavía no hay referencias en este guion.</p>
              )}
            </div>

            <div className={styles.refForm}>
              <input
                className={styles.input}
                value={newRef}
                onChange={(e) => setNewRef(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addRef()}
                placeholder="Pegá el link del video (Instagram, YouTube, TikTok…)"
                aria-label="URL de la referencia"
              />
              <input
                className={`${styles.input} ${styles.inputShort}`}
                value={newRefLabel}
                onChange={(e) => setNewRefLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addRef()}
                placeholder="Nota (opcional)"
                aria-label="Nota de la referencia"
              />
              <button type="button" className={styles.addBtn} onClick={addRef} disabled={!newRef.trim()}>
                <Plus size={15} /> Agregar
              </button>
            </div>
          </section>
        </div>

        <footer className={styles.foot}>
          <span className={styles.saveState} data-state={saveState}>
            {saveState === 'saving' && <><Loader2 size={13} className={styles.spin} /> Guardando…</>}
            {saveState === 'saved' && <><Check size={13} /> Guardado</>}
            {saveState === 'error' && 'No se pudo guardar'}
            {saveState === 'idle' && 'Se guarda solo'}
          </span>
          <button type="button" className={styles.deleteBtn} onClick={handleDelete}>
            <Trash2 size={14} /> Borrar guion
          </button>
        </footer>
      </aside>
    </div>
  );
}
