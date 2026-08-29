'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, Plus, Lightbulb, Link2, Search, Trash2, Check,
  RotateCcw, ArrowRight, ChevronLeft, ChevronRight, Loader2, Tag,
} from 'lucide-react';
import { supabase } from '@/utils/supabase';
import { useToast } from '@/components/Toast';
import MigrationBanner from '@/components/MigrationBanner';
import ScriptEditorPanel from '@/components/ScriptEditorPanel';
import VideoRefLink from '@/components/VideoRefLink';
import { normalizeUrl } from '@/lib/videoEmbed';
import { loadWork, saveWork } from '@/lib/workSession';
import {
  BOARD_COLUMNS,
  IdeaItem,
  IdeaKind,
  POSITION_STEP,
  PRODUCTION_MIGRATION,
  ScriptCard,
  ScriptStatus,
  formatLabel,
  isMissingSchema,
  positionBetween,
  toIdeaItem,
  toScriptCard,
} from '@/lib/scripts-types';
import styles from './page.module.css';

type View = 'tablero' | 'ideas';
type IdeaFilter = 'todas' | 'idea' | 'reference';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));

const firstLine = (text: string) => (text || '').split('\n').find((l) => l.trim()) || '';

const relativeDate = (iso: string) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  return new Date(iso).toLocaleDateString('es');
};

export default function GuionesPage() {
  const { toast } = useToast();

  const [view, setView] = useState<View>('tablero');
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [loading, setLoading] = useState(true);

  const [cards, setCards] = useState<ScriptCard[]>([]);
  const [ideas, setIdeas] = useState<IdeaItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Arrastre: qué tarjeta viaja y dónde caería si la soltás ahora.
  const [dragId, setDragId] = useState<string | null>(null);
  const [hint, setHint] = useState<{ status: ScriptStatus; index: number } | null>(null);

  // Composer del banco de ideas.
  const [ideaKind, setIdeaKind] = useState<IdeaKind>('idea');
  const [ideaText, setIdeaText] = useState('');
  const [ideaUrl, setIdeaUrl] = useState('');
  const [ideaTags, setIdeaTags] = useState('');
  const [savingIdea, setSavingIdea] = useState(false);

  const [ideaFilter, setIdeaFilter] = useState<IdeaFilter>('todas');
  const [showUsed, setShowUsed] = useState(false);
  const [query, setQuery] = useState('');

  // La solapa elegida sobrevive al ir y volver dentro de la misma pestaña.
  useEffect(() => {
    const saved = loadWork<View>('guiones-view', 'tablero');
    if (saved === 'ideas' || saved === 'tablero') setView(saved);
  }, []);

  const changeView = (next: View) => {
    setView(next);
    saveWork('guiones-view', next);
  };

  const load = useCallback(async () => {
    const [scriptsRes, ideasRes] = await Promise.all([
      supabase.from('scripts').select('*').order('position', { ascending: true }),
      supabase.from('ideas').select('*').order('created_at', { ascending: false }),
    ]);

    if (scriptsRes.error || ideasRes.error) {
      const err = scriptsRes.error || ideasRes.error;
      if (isMissingSchema(err)) setMigrationNeeded(true);
      else toast('No se pudieron cargar los guiones', 'error');
      setLoading(false);
      return;
    }

    setMigrationNeeded(false);
    setCards((scriptsRes.data || []).map(toScriptCard));
    setIdeas((ideasRes.data || []).map(toIdeaItem));
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const byColumn = useMemo(() => {
    const map = new Map<ScriptStatus, ScriptCard[]>();
    for (const col of BOARD_COLUMNS) map.set(col.id, []);
    for (const card of cards) map.get(card.status)?.push(card);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [cards]);

  const editing = useMemo(() => cards.find((c) => c.id === editingId) ?? null, [cards, editingId]);

  // ── Guiones ───────────────────────────────────────────────────────────────

  const createCard = useCallback(
    async (status: ScriptStatus, seed?: Partial<ScriptCard>): Promise<ScriptCard | null> => {
      const column = byColumn.get(status) ?? [];
      const last = column[column.length - 1];
      setCreating(true);
      const { data, error } = await supabase
        .from('scripts')
        .insert({
          title: seed?.title ?? '',
          status,
          format: seed?.format ?? null,
          tags: seed?.tags ?? [],
          hook: seed?.hook ?? '',
          body: seed?.body ?? '',
          cta: seed?.cta ?? '',
          refs: seed?.refs ?? [],
          position: last ? last.position + POSITION_STEP : POSITION_STEP,
        })
        .select()
        .single();
      setCreating(false);

      if (error || !data) {
        if (isMissingSchema(error)) setMigrationNeeded(true);
        else toast('No se pudo crear el guion', 'error');
        return null;
      }

      const card = toScriptCard(data);
      setCards((prev) => [...prev, card]);
      setEditingId(card.id);
      return card;
    },
    [byColumn, toast],
  );

  /**
   * Mueve una tarjeta a `status`, en la posición `visualIndex` de la columna
   * TAL CUAL se ve ahora (contando la propia tarjeta si ya está ahí).
   */
  const moveCard = useCallback(
    async (id: string, status: ScriptStatus, visualIndex: number) => {
      const card = cards.find((c) => c.id === id);
      if (!card) return;

      const column = byColumn.get(status) ?? [];
      const currentIdx = column.findIndex((c) => c.id === id);
      const rest = column.filter((c) => c.id !== id);
      const index = clamp(
        currentIdx !== -1 && visualIndex > currentIdx ? visualIndex - 1 : visualIndex,
        0,
        rest.length,
      );

      // Soltarla donde ya estaba no debería escribir en la base.
      if (card.status === status && currentIdx === index) return;

      const before = index > 0 ? rest[index - 1].position : null;
      const after = index < rest.length ? rest[index].position : null;
      const position = positionBetween(before, after);

      if (position === null) {
        // Los vecinos quedaron pegados: se renumera la columna entera.
        const ordered = [...rest.slice(0, index), card, ...rest.slice(index)];
        const renumbered = ordered.map((c, i) => ({ id: c.id, position: (i + 1) * POSITION_STEP }));
        setCards((prev) =>
          prev.map((c) => {
            const hit = renumbered.find((r) => r.id === c.id);
            return hit ? { ...c, status, position: hit.position } : c;
          }),
        );
        for (const row of renumbered) {
          const { error } = await supabase
            .from('scripts')
            .update({ status, position: row.position, updated_at: new Date().toISOString() })
            .eq('id', row.id);
          if (error) {
            toast('No se pudo reordenar la columna', 'error');
            load();
            return;
          }
        }
        return;
      }

      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status, position } : c)));

      const { error } = await supabase
        .from('scripts')
        .update({ status, position, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) {
        toast('No se pudo mover el guion', 'error');
        load();
      }
    },
    [byColumn, cards, load, toast],
  );

  /** Botones ‹ › de la tarjeta: mover de columna sin arrastrar (mobile y teclado). */
  const shiftCard = (card: ScriptCard, dir: -1 | 1) => {
    const idx = BOARD_COLUMNS.findIndex((c) => c.id === card.status);
    const next = BOARD_COLUMNS[idx + dir];
    if (!next) return;
    moveCard(card.id, next.id, (byColumn.get(next.id) ?? []).length);
  };

  const handleDrop = (status: ScriptStatus, visualIndex: number) => {
    const id = dragId;
    setDragId(null);
    setHint(null);
    if (id) moveCard(id, status, visualIndex);
  };

  // ── Banco de ideas ────────────────────────────────────────────────────────

  const createIdea = async () => {
    const content = ideaText.trim();
    const url = ideaUrl.trim() ? normalizeUrl(ideaUrl) : null;
    if (!content && !url) return;

    const tags = ideaTags
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);

    setSavingIdea(true);
    const { data, error } = await supabase
      .from('ideas')
      .insert({ kind: ideaKind, title: '', content, url, tags })
      .select()
      .single();
    setSavingIdea(false);

    if (error || !data) {
      if (isMissingSchema(error)) setMigrationNeeded(true);
      else toast('No se pudo guardar', 'error');
      return;
    }

    setIdeas((prev) => [toIdeaItem(data), ...prev]);
    setIdeaText('');
    setIdeaUrl('');
    setIdeaTags('');
    toast(ideaKind === 'idea' ? 'Idea guardada' : 'Referencia guardada', 'success');
  };

  const setIdeaUsed = async (idea: IdeaItem, used: boolean) => {
    setIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, used } : i)));
    const { error } = await supabase.from('ideas').update({ used }).eq('id', idea.id);
    if (error) {
      toast('No se pudo actualizar', 'error');
      load();
    }
  };

  const deleteIdea = async (idea: IdeaItem) => {
    setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
    const { error } = await supabase.from('ideas').delete().eq('id', idea.id);
    if (error) {
      toast('No se pudo borrar', 'error');
      load();
    }
  };

  /** Una idea del banco pasa a ser un guion en Borrador, y queda archivada. */
  const convertIdea = async (idea: IdeaItem) => {
    const card = await createCard('borrador', {
      title: idea.title || firstLine(idea.content).slice(0, 80) || 'Idea sin título',
      hook: idea.kind === 'idea' ? idea.content : '',
      body: idea.kind === 'reference' ? idea.content : '',
      tags: idea.tags,
      refs: idea.url ? [{ url: idea.url, ...(idea.title ? { label: idea.title } : {}) }] : [],
    });
    if (!card) return;
    await setIdeaUsed(idea, true);
    changeView('tablero');
    toast('Guion creado desde la idea', 'success');
  };

  const visibleIdeas = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ideas.filter((i) => {
      if (!showUsed && i.used) return false;
      if (ideaFilter !== 'todas' && i.kind !== ideaFilter) return false;
      if (!q) return true;
      return (
        i.content.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        (i.url || '').toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [ideas, ideaFilter, showUsed, query]);

  const pendingIdeas = ideas.filter((i) => !i.used).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <ClipboardList size={22} className={styles.titleIcon} /> Guiones
          </h1>
          <p className={styles.subtitle}>
            El tablero de lo que hay que grabar, y el banco de ideas y referencias del que sale.
          </p>
        </div>
        {view === 'tablero' && !migrationNeeded && (
          <button className={styles.primaryBtn} onClick={() => createCard('borrador')} disabled={creating}>
            {creating ? <Loader2 size={16} className={styles.spin} /> : <Plus size={16} />} Nuevo guion
          </button>
        )}
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Vistas de Guiones">
        <button
          role="tab"
          aria-selected={view === 'tablero'}
          className={`${styles.tab} ${view === 'tablero' ? styles.tabActive : ''}`}
          onClick={() => changeView('tablero')}
        >
          <ClipboardList size={15} /> Tablero
          {cards.length > 0 && <span className={styles.tabCount}>{cards.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={view === 'ideas'}
          className={`${styles.tab} ${view === 'ideas' ? styles.tabActive : ''}`}
          onClick={() => changeView('ideas')}
        >
          <Lightbulb size={15} /> Ideas y referencias
          {pendingIdeas > 0 && <span className={styles.tabCount}>{pendingIdeas}</span>}
        </button>
      </div>

      {migrationNeeded && <MigrationBanner file={PRODUCTION_MIGRATION} onRetry={load} />}

      {loading ? (
        <p className={styles.loading}>Cargando…</p>
      ) : view === 'tablero' ? (
        /* ---------------------------- TABLERO ---------------------------- */
        <div className={styles.board}>
          {BOARD_COLUMNS.map((col) => {
            const column = byColumn.get(col.id) ?? [];
            return (
              <section
                key={col.id}
                className={`${styles.column} ${hint?.status === col.id ? styles.columnActive : ''}`}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setHint({ status: col.id, index: column.length });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(col.id, hint?.status === col.id ? hint.index : column.length);
                }}
              >
                <div className={styles.columnHead}>
                  <div className={styles.columnTitles}>
                    <h2 className={styles.columnTitle}>
                      {col.label} <span className={styles.columnCount}>{column.length}</span>
                    </h2>
                    <p className={styles.columnHint}>{col.hint}</p>
                  </div>
                  <button
                    className={styles.columnAdd}
                    onClick={() => createCard(col.id)}
                    disabled={migrationNeeded || creating}
                    title={`Nuevo guion en ${col.label}`}
                    aria-label={`Nuevo guion en ${col.label}`}
                  >
                    <Plus size={15} />
                  </button>
                </div>

                <div className={styles.columnBody}>
                  {column.length === 0 && !hint && (
                    <p className={styles.columnEmpty}>Vacío. Arrastrá una tarjeta o tocá +.</p>
                  )}

                  {column.map((card, idx) => (
                    <div key={card.id}>
                      {hint?.status === col.id && hint.index === idx && <div className={styles.dropLine} />}
                      <article
                        className={`${styles.card} ${dragId === card.id ? styles.cardDragging : ''}`}
                        draggable
                        onDragStart={(e) => {
                          setDragId(card.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', card.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setHint(null);
                        }}
                        onDragOver={(e) => {
                          if (!dragId) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const below = e.clientY > rect.top + rect.height / 2;
                          setHint({ status: col.id, index: idx + (below ? 1 : 0) });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDrop(col.id, hint?.status === col.id ? hint.index : idx);
                        }}
                        onClick={() => setEditingId(card.id)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setEditingId(card.id);
                          }
                        }}
                      >
                        <h3 className={styles.cardTitle}>{card.title.trim() || 'Guion sin título'}</h3>

                        {(card.format || card.tags.length > 0) && (
                          <div className={styles.cardChips}>
                            {card.format && <span className={styles.formatChip}>{formatLabel(card.format)}</span>}
                            {card.tags.slice(0, 3).map((t) => (
                              <span key={t} className={styles.tagChip}>{t}</span>
                            ))}
                            {card.tags.length > 3 && (
                              <span className={styles.tagChip}>+{card.tags.length - 3}</span>
                            )}
                          </div>
                        )}

                        {firstLine(card.hook) && <p className={styles.cardHook}>{firstLine(card.hook)}</p>}

                        <div className={styles.cardFoot}>
                          <span className={styles.cardMeta}>
                            {card.refs.length > 0 && (
                              <span className={styles.cardRefs} title={`${card.refs.length} referencias`}>
                                <Link2 size={12} /> {card.refs.length}
                              </span>
                            )}
                            <span className={styles.cardDate}>{relativeDate(card.updated_at)}</span>
                          </span>
                          <span className={styles.cardMove}>
                            <button
                              onClick={(e) => { e.stopPropagation(); shiftCard(card, -1); }}
                              disabled={col.id === BOARD_COLUMNS[0].id}
                              title="Mover a la etapa anterior"
                              aria-label="Mover a la etapa anterior"
                            >
                              <ChevronLeft size={14} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); shiftCard(card, 1); }}
                              disabled={col.id === BOARD_COLUMNS[BOARD_COLUMNS.length - 1].id}
                              title="Mover a la etapa siguiente"
                              aria-label="Mover a la etapa siguiente"
                            >
                              <ChevronRight size={14} />
                            </button>
                          </span>
                        </div>
                      </article>
                    </div>
                  ))}

                  {hint?.status === col.id && hint.index >= column.length && <div className={styles.dropLine} />}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        /* ------------------------ IDEAS Y REFERENCIAS ------------------------ */
        <>
          <section className={`glass-panel ${styles.composer}`}>
            <div className={styles.composerHead}>
              <h2 className={styles.sectionTitle}>Guardar algo antes de que se te escape</h2>
              <div className={styles.kindToggle} role="group" aria-label="Tipo">
                <button
                  className={`${styles.kindBtn} ${ideaKind === 'idea' ? styles.kindActive : ''}`}
                  onClick={() => setIdeaKind('idea')}
                >
                  <Lightbulb size={14} /> Idea
                </button>
                <button
                  className={`${styles.kindBtn} ${ideaKind === 'reference' ? styles.kindActive : ''}`}
                  onClick={() => setIdeaKind('reference')}
                >
                  <Link2 size={14} /> Referencia
                </button>
              </div>
            </div>

            <textarea
              className={styles.composerText}
              value={ideaText}
              onChange={(e) => setIdeaText(e.target.value)}
              placeholder={
                ideaKind === 'idea'
                  ? '¿Qué se te ocurrió? Escribilo tal cual te salga.'
                  : 'Qué te gustó de este video y para qué lo querés usar.'
              }
            />

            <div className={styles.composerRow}>
              <input
                className={styles.input}
                value={ideaUrl}
                onChange={(e) => setIdeaUrl(e.target.value)}
                placeholder={ideaKind === 'reference' ? 'Link del video' : 'Link (opcional)'}
                aria-label="Link"
              />
              <input
                className={`${styles.input} ${styles.inputShort}`}
                value={ideaTags}
                onChange={(e) => setIdeaTags(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createIdea()}
                placeholder="Etiquetas, separadas por coma"
                aria-label="Etiquetas"
              />
              <button
                className={styles.primaryBtn}
                onClick={createIdea}
                disabled={savingIdea || migrationNeeded || (!ideaText.trim() && !ideaUrl.trim())}
              >
                {savingIdea ? <Loader2 size={15} className={styles.spin} /> : <Plus size={15} />} Guardar
              </button>
            </div>
          </section>

          <div className={styles.ideaFilters}>
            <div className={styles.filterGroup} role="group" aria-label="Filtrar">
              {([['todas', 'Todas'], ['idea', 'Ideas'], ['reference', 'Referencias']] as const).map(([id, label]) => (
                <button
                  key={id}
                  className={`${styles.filterBtn} ${ideaFilter === id ? styles.filterActive : ''}`}
                  onClick={() => setIdeaFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className={styles.usedToggle}>
              <input type="checkbox" checked={showUsed} onChange={(e) => setShowUsed(e.target.checked)} />
              Ver las ya usadas
            </label>
            <div className={styles.searchBox}>
              <Search size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar en el banco"
                aria-label="Buscar ideas"
              />
            </div>
          </div>

          {visibleIdeas.length === 0 ? (
            <p className={styles.ideasEmpty}>
              {ideas.length === 0
                ? 'El banco está vacío. Guardá acá arriba la próxima idea que se te cruce o el video que te gustó: después lo convertís en guion de un toque.'
                : 'Nada con ese filtro.'}
            </p>
          ) : (
            <div className={styles.ideaGrid}>
              {visibleIdeas.map((idea) => (
                <article key={idea.id} className={`glass-panel ${styles.ideaCard} ${idea.used ? styles.ideaUsed : ''}`}>
                  <div className={styles.ideaHead}>
                    <span className={styles.ideaKind}>
                      {idea.kind === 'idea' ? <Lightbulb size={12} /> : <Link2 size={12} />}
                      {idea.kind === 'idea' ? 'Idea' : 'Referencia'}
                    </span>
                    <span className={styles.ideaDate}>{relativeDate(idea.created_at)}</span>
                  </div>

                  {idea.content && <p className={styles.ideaText}>{idea.content}</p>}

                  {idea.url && <VideoRefLink url={idea.url} />}

                  {idea.tags.length > 0 && (
                    <div className={styles.cardChips}>
                      <Tag size={12} className={styles.tagIcon} />
                      {idea.tags.map((t) => (
                        <span key={t} className={styles.tagChip}>{t}</span>
                      ))}
                    </div>
                  )}

                  <div className={styles.ideaActions}>
                    <button className={styles.ideaBtn} onClick={() => convertIdea(idea)} disabled={creating}>
                      <ArrowRight size={14} /> Convertir en guion
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() => setIdeaUsed(idea, !idea.used)}
                      title={idea.used ? 'Devolver al banco' : 'Marcar como usada'}
                    >
                      {idea.used ? <RotateCcw size={14} /> : <Check size={14} />}
                    </button>
                    <button className={styles.iconBtn} onClick={() => deleteIdea(idea)} title="Borrar">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <ScriptEditorPanel
          key={editing.id}
          card={editing}
          onChange={(next) => setCards((prev) => prev.map((c) => (c.id === next.id ? next : c)))}
          onMove={(status) => moveCard(editing.id, status, (byColumn.get(status) ?? []).length)}
          onClose={() => setEditingId(null)}
          onDelete={(id) => {
            setCards((prev) => prev.filter((c) => c.id !== id));
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}
