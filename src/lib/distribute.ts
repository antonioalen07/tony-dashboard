/**
 * Distribución de variantes en el calendario de publicación (Crevy Studio · Unidad 8).
 *
 * Función PURA: no toca Supabase, no lee reloj global salvo el `startDate` que recibe,
 * y acepta un `rng` inyectable para poder testear de forma determinista. Los defaults
 * usan `Math.random`, así que en producción el reparto es aleatorio.
 */

/** Un ítem ya agendado: a qué variante corresponde y cuándo se publica (ISO 8601, UTC). */
export interface DistributedSlot {
  variant_id: string;
  scheduled_at: string;
}

export interface DistributeOptions {
  /** Primer día del reparto (Date o string parseable). Solo se usa su fecha, no su hora. */
  startDate: Date | string;
  /** Cantidad de días sobre los que se reparte. */
  days: number;
  /** Fuente de aleatoriedad [0,1). Inyectable para tests deterministas. */
  rng?: () => number;
}

/** Ventana horaria de publicación (hora local del `startDate`). */
export const PUBLISH_HOUR_START = 11; // 11:00 inclusive
export const PUBLISH_HOUR_END = 21; // 21:00 exclusivo (última hora posible: 20:59)

/** Máximo "natural" de publicaciones por día. Se puede exceder si no hay días suficientes. */
const MAX_PER_DAY = 3;

/**
 * Reparte `variantIds` sobre `days` días a partir de `startDate`, de forma DISPAREJA
 * (0–3 por día, no uniforme) y con hora aleatoria dentro de la ventana 11:00–21:00.
 *
 * Garantías:
 *  - La suma de ítems agendados es exactamente `variantIds.length` (no se pierde ninguno).
 *  - Cada día recibe entre 0 y {@link MAX_PER_DAY}; si `N > 3 * days` el excedente se
 *    reparte por round-robin ignorando el tope (para no dejar variantes sin agendar).
 *  - Dentro de un mismo día los horarios quedan ordenados cronológicamente.
 *
 * @returns lista en el MISMO orden de `variantIds`, cada uno con su `scheduled_at` ISO.
 */
export function distributeUneven(
  variantIds: string[],
  { startDate, days, rng = Math.random }: DistributeOptions,
): DistributedSlot[] {
  const n = variantIds.length;
  if (n === 0) return [];

  const dayCount = Math.max(1, Math.floor(days));

  // ── 1) Reparto DISPAREJO de cuántos ítems van en cada día ─────────────────
  // Varias pasadas: en cada día se tira una moneda; si sale, suma uno (hasta el tope).
  // Esto produce naturalmente días con 0, 1, 2 o 3 sin ser uniforme.
  const counts = new Array<number>(dayCount).fill(0);
  let placed = 0;
  let guard = 0;
  while (placed < n && guard < 100_000) {
    for (let d = 0; d < dayCount && placed < n; d++) {
      if (counts[d] >= MAX_PER_DAY) continue;
      if (rng() < 0.5) {
        counts[d]++;
        placed++;
      }
    }
    guard++;
  }
  // Excedente (N > 3*days): round-robin ignorando el tope, para no perder ninguno.
  let overflowDay = 0;
  while (placed < n) {
    counts[overflowDay % dayCount]++;
    overflowDay++;
    placed++;
  }

  // ── 2) Fecha base a medianoche local (solo importa el día del startDate) ──
  // Un string date-only "YYYY-MM-DD" lo parsea JS como UTC; en zonas horarias
  // negativas eso correría el día hacia atrás, así que lo tomamos literal.
  let baseY: number, baseM: number, baseD: number;
  const dateOnly = typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate);
  if (dateOnly) {
    const [y, mo, d] = (startDate as string).split('-').map(Number);
    baseY = y; baseM = mo - 1; baseD = d;
  } else {
    const base = startDate instanceof Date ? startDate : new Date(startDate);
    baseY = base.getFullYear();
    baseM = base.getMonth();
    baseD = base.getDate();
  }

  // ── 3) Asignar variantes (en orden) a cada día con horas ordenadas ────────
  const out: DistributedSlot[] = [];
  let idx = 0;
  for (let d = 0; d < dayCount; d++) {
    const perDay = counts[d];
    if (perDay === 0) continue;

    // Genera `perDay` horas aleatorias en la ventana y las ordena cronológicamente.
    const times = Array.from({ length: perDay }, () => {
      const span = PUBLISH_HOUR_END - PUBLISH_HOUR_START; // 10 horas
      const hour = PUBLISH_HOUR_START + Math.floor(rng() * span); // 11..20
      const minute = Math.floor(rng() * 60); // 0..59
      return hour * 60 + minute;
    }).sort((a, b) => a - b);

    for (const minsOfDay of times) {
      const hour = Math.floor(minsOfDay / 60);
      const minute = minsOfDay % 60;
      const when = new Date(baseY, baseM, baseD + d, hour, minute, 0, 0);
      out.push({ variant_id: variantIds[idx], scheduled_at: when.toISOString() });
      idx++;
    }
  }

  return out;
}
