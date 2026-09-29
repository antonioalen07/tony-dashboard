'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Shuffle, Zap, Loader2, Clock, Text, X,
  Trash2, TriangleAlert,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import { supabase } from '@/utils/supabase';
import { deleteManyFromStudio } from '@/lib/storage';
import { distributeUneven } from '@/lib/distribute';
import type { PublishQueueItem, PublishStatus } from '@/lib/studio-types';
import styles from './page.module.css';

// Ventana de días sobre la que se reparten los pendientes al distribuir.
const DISTRIBUTE_DAYS = 14;

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const STATUS_LABEL: Record<PublishStatus, string> = {
  pending: 'Pendiente',
  publishing: 'Publicando',
  published: 'Publicado',
  failed: 'Falló',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Clave local YYYY-MM-DD de una fecha (para agrupar por día del calendario). */
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const dayKeyOf = (iso: string) => {
  const d = new Date(iso);
  return dayKey(d.getFullYear(), d.getMonth(), d.getDate());
};

/** ISO -> valor de <input type="datetime-local"> en hora local. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** valor de datetime-local (hora local) -> ISO UTC. */
const fromLocalInput = (val: string) => new Date(val).toISOString();

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** `DD/MM HH:MM` local — para listar sin ambigüedad qué se va a cancelar. */
const dateTimeOf = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Qué se puede sacar de la cola. `publishing` no: ya está en vuelo y borrar la
 * fila a mitad de camino dejaría el post subido sin registro. `published`
 * tampoco: esa fila ES el historial (ig_media_id, published_at).
 */
const isCancellable = (it: PublishQueueItem) => it.status === 'pending' || it.status === 'failed';

/** El error de Supabase indica que faltan las tablas del Studio (migración pendiente). */
const isMissingTable = (err: { code?: string; message?: string } | null) =>
  !!err && (err.code === '42P01' || err.code === 'PGRST205' ||
    /does not exist|schema cache|could not find the table/i.test(err.message || ''));

export default function CalendarioPage() {
  const { toast } = useToast();

  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [items, setItems] = useState<PublishQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [distributing, setDistributing] = useState(false);

  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [captionId, setCaptionId] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const [savingCaption, setSavingCaption] = useState(false);
  // Selección múltiple para cancelar publicaciones ya programadas.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [alsoDeleteVideo, setAlsoDeleteVideo] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Cancela el guardado en blur cuando el cierre del input viene de Escape.
  const skipBlurSave = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('publish_queue')
      .select('*')
      .order('scheduled_at', { ascending: true, nullsFirst: false });
    if (error) {
      if (isMissingTable(error)) setMigrationNeeded(true);
      else toast('No se pudo cargar la cola de publicación', 'error');
      setLoading(false);
      return;
    }
    setItems((data as PublishQueueItem[]) || []);
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Ítems con fecha agrupados por día local; y los pendientes sin fecha aparte.
  const byDay = useMemo(() => {
    const map = new Map<string, PublishQueueItem[]>();
    for (const it of items) {
      if (!it.scheduled_at) continue;
      const k = dayKeyOf(it.scheduled_at);
      const arr = map.get(k);
      if (arr) arr.push(it);
      else map.set(k, [it]);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1));
    }
    return map;
  }, [items]);

  const captionEditing = useMemo(
    () => items.find((it) => it.id === captionId) ?? null,
    [items, captionId],
  );

  const unscheduled = useMemo(
    () => items.filter((it) => !it.scheduled_at && it.status === 'pending'),
    [items],
  );

  /**
   * Lo tildado que TODAVÍA se puede cancelar. Todo (el contador, la lista del
   * confirm y el borrado) sale de acá y no del Set crudo: si la cola se recarga
   * y una publicación desapareció o el worker se la llevó a `publishing`, queda
   * fuera sola. Por eso no hace falta sincronizar `selected` con un efecto.
   */
  const selectedItems = useMemo(
    () => items.filter((it) => selected.has(it.id) && isCancellable(it)),
    [items, selected],
  );

  // Celdas del mes (semana empieza lunes), con relleno al principio y final.
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const lead = (first.getDay() + 6) % 7; // 0 = lunes
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const out: (number | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view]);

  const todayKey = dayKey(now.getFullYear(), now.getMonth(), now.getDate());

  const patch = (id: string, fields: Partial<PublishQueueItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...fields } : it)));

  const saveScheduledAt = async (id: string, localVal: string) => {
    if (!localVal) return;
    const iso = fromLocalInput(localVal);
    const { error } = await supabase.from('publish_queue').update({ scheduled_at: iso }).eq('id', id);
    if (error) { toast('No se pudo guardar la fecha', 'error'); return; }
    patch(id, { scheduled_at: iso });
    setEditingId(null);
    toast('Fecha actualizada', 'success');
  };

  const openCaption = (it: PublishQueueItem) => {
    setCaptionDraft(it.caption ?? '');
    setCaptionId(it.id);
  };

  const saveCaption = async (id: string, value: string) => {
    const caption = value.trim() || null;
    setSavingCaption(true);
    const { error } = await supabase.from('publish_queue').update({ caption }).eq('id', id);
    setSavingCaption(false);
    if (error) {
      // La columna llegó en una migración posterior a la de Studio; si la base
      // quedó atrasada, PostgREST responde "Could not find the 'caption' column".
      toast(
        /caption/i.test(error.message || '')
          ? 'Falta la columna `caption`: corré supabase_migration_ai_config.sql en Supabase'
          : 'No se pudo guardar el caption',
        'error',
      );
      return;
    }
    patch(id, { caption });
    setCaptionId(null);
    toast('Caption guardado', 'success');
  };

  const publishNow = async (id: string) => {
    const iso = new Date().toISOString();
    const { error } = await supabase.from('publish_queue').update({ scheduled_at: iso }).eq('id', id);
    if (error) { toast('No se pudo reprogramar', 'error'); return; }
    patch(id, { scheduled_at: iso });
    toast('Reprogramado para ahora — el worker lo tomará en breve', 'success');
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Abre el confirm para una sola publicación, sin tocar lo ya tildado. */
  const askCancelOne = (id: string) => {
    setSelected(new Set([id]));
    setConfirmOpen(true);
  };

  /**
   * Borra los videos de las variantes dadas: objeto del Storage + fila de
   * `media_assets`, que arrastra en cascada la de `video_variants`.
   * Devuelve cuántos archivos se borraron.
   */
  const deleteVariantMedia = async (variantIds: string[]): Promise<number> => {
    if (variantIds.length === 0) return 0;

    const { data: variants, error: vErr } = await supabase
      .from('video_variants')
      .select('asset_id')
      .in('id', variantIds);
    if (vErr) throw vErr;

    const assetIds = [...new Set((variants ?? []).map((v) => v.asset_id).filter(Boolean))] as string[];
    if (assetIds.length === 0) return 0;

    const { data: assets, error: aErr } = await supabase
      .from('media_assets')
      .select('id, storage_path')
      .in('id', assetIds);
    if (aErr) throw aErr;

    const paths = (assets ?? []).map((a) => a.storage_path).filter(Boolean) as string[];
    await deleteManyFromStudio(paths);

    // La fila va al final: borrarla cascadea a video_variants, y si el Storage
    // falla antes preferimos quedarnos con el archivo que con una fila huérfana.
    const { error: dErr } = await supabase.from('media_assets').delete().in('id', assetIds);
    if (dErr) throw dErr;

    return paths.length;
  };

  /**
   * Cancela las seleccionadas. Sacar la fila de `publish_queue` alcanza para que
   * el worker no las suba; la variante sigue en el Studio y se puede reagendar,
   * salvo que se pida borrar también el video.
   */
  const cancelSelected = async () => {
    const targets = selectedItems;
    if (targets.length === 0) return;
    setCancelling(true);

    const ids = targets.map((it) => it.id);
    const { error } = await supabase.from('publish_queue').delete().in('id', ids);
    if (error) {
      setCancelling(false);
      toast('No se pudo cancelar la publicación', 'error');
      return;
    }

    let removed = 0;
    let videoFailed = false;
    if (alsoDeleteVideo) {
      try {
        removed = await deleteVariantMedia(
          targets.map((it) => it.variant_id).filter((v): v is string => !!v),
        );
      } catch {
        videoFailed = true;
      }
    }

    const gone = new Set(ids);
    setItems((prev) => prev.filter((it) => !gone.has(it.id)));
    setSelected(new Set());
    setConfirmOpen(false);
    setCancelling(false);

    if (videoFailed) {
      toast('Saqué las publicaciones de la cola, pero no pude borrar los videos', 'error');
      return;
    }
    const n = ids.length;
    toast(
      `${n} publicación${n === 1 ? '' : 'es'} cancelada${n === 1 ? '' : 's'}` +
        (removed > 0 ? ` · ${removed} video${removed === 1 ? '' : 's'} borrado${removed === 1 ? '' : 's'}` : ''),
      'success',
    );
  };

  const distributePending = async () => {
    if (unscheduled.length === 0) { toast('No hay pendientes sin fecha para distribuir', 'info'); return; }
    setDistributing(true);
    const slots = distributeUneven(
      unscheduled.map((it) => it.id),
      { startDate: new Date(), days: DISTRIBUTE_DAYS },
    );
    let ok = 0;
    for (const slot of slots) {
      const { error } = await supabase
        .from('publish_queue')
        .update({ scheduled_at: slot.scheduled_at })
        .eq('id', slot.variant_id);
      if (error) continue;
      patch(slot.variant_id, { scheduled_at: slot.scheduled_at });
      ok++;
    }
    setDistributing(false);
    toast(
      ok > 0 ? `Distribuidos ${ok} pendiente${ok === 1 ? '' : 's'} sobre ${DISTRIBUTE_DAYS} días 📅`
        : 'No se pudo distribuir (revisá la conexión)',
      ok > 0 ? 'success' : 'error',
    );
    // Recarga para reflejar el orden real y navega al mes de inicio.
    setView({ y: now.getFullYear(), m: now.getMonth() });
    load();
  };

  const goMonth = (delta: number) =>
    setView((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });

  const renderChip = (it: PublishQueueItem) => (
    <div
      key={it.id}
      className={`${styles.chip} ${styles[it.status]}`}
      title={STATUS_LABEL[it.status]}
      data-selected={selected.has(it.id) || undefined}
    >
      {isCancellable(it) ? (
        <input
          className={styles.chipCheck}
          type="checkbox"
          checked={selected.has(it.id)}
          onChange={() => toggleSelected(it.id)}
          aria-label={`Seleccionar ${it.kind} de ${it.scheduled_at ? dateTimeOf(it.scheduled_at) : 'sin fecha'}`}
          title="Seleccionar para cancelar"
        />
      ) : (
        <span className={styles.chipDot} aria-hidden="true" />
      )}
      <span className={styles.chipTime}>{it.scheduled_at ? timeOf(it.scheduled_at) : '—'}</span>
      <span className={styles.chipKind}>{it.kind}</span>
      {editingId === it.id ? (
        <input
          className={styles.chipInput}
          type="datetime-local"
          defaultValue={it.scheduled_at ? toLocalInput(it.scheduled_at) : ''}
          autoFocus
          // Único punto de guardado: el blur. Enter fuerza el blur; Escape lo cancela.
          onBlur={(e) => {
            if (skipBlurSave.current) { skipBlurSave.current = false; setEditingId(null); return; }
            saveScheduledAt(it.id, e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { skipBlurSave.current = true; e.currentTarget.blur(); }
          }}
        />
      ) : (
        <div className={styles.chipActions}>
          <button className={styles.chipBtn} title="Editar fecha" onClick={() => setEditingId(it.id)}>
            <Clock size={12} />
          </button>
          <button
            className={styles.chipBtn}
            data-on={!!it.caption}
            title={it.caption ? `Caption: ${it.caption.slice(0, 80)}` : 'Sin caption — clic para escribirlo'}
            onClick={() => openCaption(it)}
          >
            <Text size={12} />
          </button>
          {it.status === 'pending' && (
            <button className={styles.chipBtn} title="Publicar ahora" onClick={() => publishNow(it.id)}>
              <Zap size={12} />
            </button>
          )}
          {isCancellable(it) && (
            <button
              className={styles.chipBtn}
              data-danger="true"
              title="Cancelar esta publicación"
              onClick={() => askCancelOne(it.id)}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}><CalendarDays size={22} className={styles.titleIcon} /> Calendario</h1>
          <p className={styles.subtitle}>
            Cola de publicación de Instagram. Repartí tus variantes en el tiempo y controlá qué sale cuándo.
          </p>
        </div>
      </header>

      {migrationNeeded && (
        <div className={styles.migrationNotice}>
          <strong>Falta un paso:</strong> ejecutá <code>supabase_migration_studio.sql</code> en el
          SQL Editor de Supabase para activar la cola de publicación del Studio.
        </div>
      )}

      {/* ---- Barra de selección: sólo aparece con algo tildado ---- */}
      {selectedItems.length > 0 && (
        <div className={styles.selectionBar}>
          <span className={styles.selectionCount}>
            {selectedItems.length} seleccionada{selectedItems.length === 1 ? '' : 's'}
          </span>
          <div className={styles.selectionActions}>
            <button className={styles.ghostBtn} onClick={() => setSelected(new Set())}>
              Limpiar selección
            </button>
            <button className={styles.dangerBtn} onClick={() => setConfirmOpen(true)}>
              <Trash2 size={15} /> Cancelar publicación
            </button>
          </div>
        </div>
      )}

      {/* ---- Pendientes sin agendar ---- */}
      <section className="glass-panel">
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>Sin agendar</h2>
            <p className={styles.sectionSub}>
              Variantes en cola que todavía no tienen fecha. Distribuilas de forma despareja
              (0–3 por día, hora random 11–21 h) sobre los próximos {DISTRIBUTE_DAYS} días.
            </p>
          </div>
          <button
            className={styles.primaryBtn}
            onClick={distributePending}
            disabled={distributing || migrationNeeded || unscheduled.length === 0}
          >
            {distributing ? <Loader2 size={15} className={styles.spin} /> : <Shuffle size={15} />}
            {distributing ? 'Distribuyendo…' : `Distribuir pendientes (${unscheduled.length})`}
          </button>
        </div>

        {loading ? (
          <div className={styles.empty}>Cargando cola…</div>
        ) : unscheduled.length === 0 ? (
          <div className={styles.empty}>No hay variantes sin agendar. Todo lo pendiente tiene fecha. 🎉</div>
        ) : (
          <div className={styles.unscheduledRow}>{unscheduled.map(renderChip)}</div>
        )}
      </section>

      {/* ---- Grilla mensual ---- */}
      <section className="glass-panel">
        <div className={styles.calHead}>
          <button className={styles.navBtn} onClick={() => goMonth(-1)} aria-label="Mes anterior">
            <ChevronLeft size={18} />
          </button>
          <h2 className={styles.monthLabel}>{MONTHS[view.m]} {view.y}</h2>
          <button className={styles.navBtn} onClick={() => goMonth(1)} aria-label="Mes siguiente">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className={styles.weekHead}>
          {WEEKDAYS.map((w) => <div key={w} className={styles.weekName}>{w}</div>)}
        </div>

        <div className={styles.gridScroll}>
          <div className={styles.grid}>
          {cells.map((day, i) => {
            if (day === null) return <div key={`e${i}`} className={`${styles.cell} ${styles.empty0}`} />;
            const k = dayKey(view.y, view.m, day);
            const dayItems = byDay.get(k) || [];
            const isToday = k === todayKey;
            return (
              <div key={k} className={`${styles.cell} ${isToday ? styles.today : ''}`}>
                <span className={styles.dayNum}>{day}</span>
                <div className={styles.cellItems}>{dayItems.map(renderChip)}</div>
              </div>
            );
          })}
        </div>
        </div>
      </section>

      {/* ---- Confirmación de cancelación ---- */}
      {confirmOpen && selectedItems.length > 0 && (
        <div className={styles.captionOverlay} onClick={() => !cancelling && setConfirmOpen(false)}>
          <div
            className={styles.confirmDialog}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Cancelar publicaciones"
          >
            <div className={styles.captionHead}>
              <h3 className={styles.captionTitle}>
                <TriangleAlert size={17} className={styles.warnIcon} />
                Cancelar {selectedItems.length} publicación{selectedItems.length === 1 ? '' : 'es'}
              </h3>
              <button
                className={styles.captionClose}
                onClick={() => setConfirmOpen(false)}
                disabled={cancelling}
                aria-label="Cerrar"
              >
                <X size={16} />
              </button>
            </div>

            <p className={styles.confirmText}>
              Salen de la cola, así que el worker no las sube. La variante queda en el
              Studio y la podés volver a agendar cuando quieras.
            </p>

            <ul className={styles.confirmList}>
              {selectedItems.map((it) => (
                <li key={it.id}>
                  <strong>{it.scheduled_at ? dateTimeOf(it.scheduled_at) : 'sin fecha'}</strong>
                  {' · '}{it.kind}
                  {it.caption ? ` · ${it.caption.slice(0, 40)}${it.caption.length > 40 ? '…' : ''}` : ''}
                </li>
              ))}
            </ul>

            <label className={styles.confirmCheck}>
              <input
                type="checkbox"
                checked={alsoDeleteVideo}
                onChange={(e) => setAlsoDeleteVideo(e.target.checked)}
                disabled={cancelling}
              />
              <span>
                Borrar también el video de la variante
                <em> — libera espacio en Storage, no se puede deshacer</em>
              </span>
            </label>

            <div className={styles.captionFoot}>
              <div className={styles.captionActions}>
                <button
                  className={styles.ghostBtn}
                  onClick={() => setConfirmOpen(false)}
                  disabled={cancelling}
                >
                  Volver
                </button>
                <button className={styles.dangerBtn} onClick={cancelSelected} disabled={cancelling}>
                  {cancelling ? <Loader2 size={15} className={styles.spin} /> : <Trash2 size={15} />}
                  {cancelling ? 'Cancelando…' : 'Sí, cancelar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Editor de caption ----
          Fuera de la grilla a propósito: dentro de la celda el textarea quedaba
          recortado por el overflow y no había lugar para escribir 2.200 chars. */}
      {captionEditing && (
        <div className={styles.captionOverlay} onClick={() => setCaptionId(null)}>
          <div
            className={styles.captionDialog}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Caption de la publicación"
          >
            <div className={styles.captionHead}>
              <h3 className={styles.captionTitle}>Caption del post</h3>
              <button
                className={styles.captionClose}
                onClick={() => setCaptionId(null)}
                aria-label="Cerrar"
              >
                <X size={16} />
              </button>
            </div>
            <p className={styles.captionMeta}>
              {captionEditing.kind} ·{' '}
              {captionEditing.scheduled_at
                ? new Date(captionEditing.scheduled_at).toLocaleString('es')
                : 'sin fecha'}
            </p>
            <textarea
              className={styles.captionArea}
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              rows={9}
              maxLength={2200}
              autoFocus
              placeholder="Escribí el texto que acompaña la publicación…"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setCaptionId(null);
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  saveCaption(captionEditing.id, captionDraft);
                }
              }}
            />
            <div className={styles.captionFoot}>
              <span className={styles.captionCount}>{captionDraft.length}/2200</span>
              <div className={styles.captionActions}>
                <button className={styles.ghostBtn} onClick={() => setCaptionId(null)}>
                  Cancelar
                </button>
                <button
                  className={styles.primaryBtn}
                  onClick={() => saveCaption(captionEditing.id, captionDraft)}
                  disabled={savingCaption}
                >
                  {savingCaption ? <Loader2 size={15} className={styles.spin} /> : null}
                  {savingCaption ? 'Guardando…' : 'Guardar caption'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
