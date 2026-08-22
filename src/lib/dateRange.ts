/**
 * Filtro temporal compartido por Dashboard e Instagram.
 *
 * Todo se resuelve en hora LOCAL, no UTC: `published_at` viene de Meta en UTC,
 * pero "este mes" o "últimos 7 días" significan lo que significan en el huso del
 * usuario. Por eso las fechas 'YYYY-MM-DD' de los <input type="date"> se parsean
 * a mano — `new Date('2026-05-01')` las interpreta como UTC y en UTC-3 (donde
 * está Antonio) el rango se corre un día.
 */

export type RangeKey = '7d' | '30d' | '90d' | 'month' | 'all' | 'custom';

export interface DateRange {
  key: RangeKey;
  /** 'YYYY-MM-DD'. Solo se usan con key === 'custom'; null = sin límite. */
  from: string | null;
  to: string | null;
}

export const ALL_TIME: DateRange = { key: 'all', from: null, to: null };

export const RANGE_PRESETS: { key: RangeKey; label: string; days?: number }[] = [
  { key: '7d', label: '7 días', days: 7 },
  { key: '30d', label: '30 días', days: 30 },
  { key: '90d', label: '90 días', days: 90 },
  { key: 'month', label: 'Este mes' },
  { key: 'all', label: 'Todo' },
];

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

/** 'YYYY-MM-DD' → Date local. Devuelve null si no es una fecha válida. */
function parseLocalDate(value: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Límites concretos del rango. null en un extremo = sin límite por ese lado. */
export function resolveRange(range: DateRange, now: Date = new Date()): { from: Date | null; to: Date | null } {
  switch (range.key) {
    case 'all':
      return { from: null, to: null };

    case 'month':
      return {
        from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: endOfDay(now),
      };

    case 'custom': {
      const from = parseLocalDate(range.from);
      const to = parseLocalDate(range.to);
      return { from: from ? startOfDay(from) : null, to: to ? endOfDay(to) : null };
    }

    default: {
      const preset = RANGE_PRESETS.find((p) => p.key === range.key);
      const days = preset?.days ?? 30;
      // El rango incluye hoy, así que "7 días" son hoy y los 6 anteriores.
      const from = new Date(now);
      from.setDate(from.getDate() - (days - 1));
      return { from: startOfDay(from), to: endOfDay(now) };
    }
  }
}

/** ¿El rango recorta algo? Un 'custom' sin fechas cargadas todavía no filtra. */
export function isFiltered(range: DateRange): boolean {
  const { from, to } = resolveRange(range);
  return Boolean(from || to);
}

/**
 * Filtra por `published_at`. Los items sin fecha quedan FUERA cuando hay filtro
 * activo: no se puede afirmar que caigan dentro de la ventana elegida.
 */
export function filterByRange<T extends { published_at?: string | null }>(
  items: T[],
  range: DateRange,
): T[] {
  const { from, to } = resolveRange(range);
  if (!from && !to) return items;

  const fromMs = from ? from.getTime() : -Infinity;
  const toMs = to ? to.getTime() : Infinity;

  return items.filter((it) => {
    if (!it.published_at) return false;
    const t = new Date(it.published_at).getTime();
    if (Number.isNaN(t)) return false;
    return t >= fromMs && t <= toMs;
  });
}

const shortDate = (d: Date) =>
  d.toLocaleDateString('es', { day: 'numeric', month: 'short' });

/** Texto humano del rango, para mostrar junto al conteo. */
export function rangeLabel(range: DateRange): string {
  if (range.key === 'all') return 'Histórico completo';
  if (range.key === 'month') return 'Este mes';

  if (range.key === 'custom') {
    const { from, to } = resolveRange(range);
    if (from && to) return `${shortDate(from)} – ${shortDate(to)}`;
    if (from) return `Desde el ${shortDate(from)}`;
    if (to) return `Hasta el ${shortDate(to)}`;
    return 'Elegí un rango';
  }

  const preset = RANGE_PRESETS.find((p) => p.key === range.key);
  return `Últimos ${preset?.days ?? 30} días`;
}

/** Normaliza lo que venga de sessionStorage (puede ser de una versión vieja). */
export function sanitizeRange(raw: unknown): DateRange {
  if (!raw || typeof raw !== 'object') return ALL_TIME;
  const r = raw as Partial<DateRange>;
  const keys: RangeKey[] = ['7d', '30d', '90d', 'month', 'all', 'custom'];
  if (!r.key || !keys.includes(r.key)) return ALL_TIME;
  return {
    key: r.key,
    from: typeof r.from === 'string' ? r.from : null,
    to: typeof r.to === 'string' ? r.to : null,
  };
}
