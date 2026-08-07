'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Shuffle, Zap, Loader2, Clock, Text,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import { supabase } from '@/utils/supabase';
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

  const unscheduled = useMemo(
    () => items.filter((it) => !it.scheduled_at && it.status === 'pending'),
    [items],
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

  const saveCaption = async (id: string, value: string) => {
    const caption = value.trim() || null;
    const { error } = await supabase.from('publish_queue').update({ caption }).eq('id', id);
    if (error) {
      // La columna es nueva: si la base no la tiene, decimos qué falta.
      toast(
        /caption/i.test(error.message || '')
          ? 'Falta la columna `caption`: volvé a correr supabase_migration_studio.sql'
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
    <div key={it.id} className={`${styles.chip} ${styles[it.status]}`} title={STATUS_LABEL[it.status]}>
      <span className={styles.chipDot} aria-hidden="true" />
      <span className={styles.chipTime}>{it.scheduled_at ? timeOf(it.scheduled_at) : '—'}</span>
      <span className={styles.chipKind}>{it.kind}</span>
      {captionId === it.id ? (
        <textarea
          className={styles.captionBox}
          defaultValue={it.caption ?? ''}
          rows={4}
          maxLength={2200}
          autoFocus
          placeholder="Caption del post…"
          onBlur={(e) => {
            if (skipBlurSave.current) { skipBlurSave.current = false; setCaptionId(null); return; }
            saveCaption(it.id, e.target.value);
          }}
          onKeyDown={(e) => {
            // Enter con Ctrl/Cmd guarda; Enter solo hace salto de línea.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
            if (e.key === 'Escape') { skipBlurSave.current = true; e.currentTarget.blur(); }
          }}
        />
      ) : editingId === it.id ? (
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
            onClick={() => setCaptionId(it.id)}
          >
            <Text size={12} />
          </button>
          {it.status === 'pending' && (
            <button className={styles.chipBtn} title="Publicar ahora" onClick={() => publishNow(it.id)}>
              <Zap size={12} />
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
      </section>
    </div>
  );
}
