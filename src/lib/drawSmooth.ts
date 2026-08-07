/**
 * Asistencia de fluidez para el pincel de Historias.
 *
 * Dos pasos independientes:
 *  1. `createSmoother()` filtra los puntos MIENTRAS dibujás (mata el temblor del
 *     mouse sin agregar lag perceptible), con un filtro exponencial adaptativo
 *     al estilo "1€ filter": trazo lento → mucho filtrado; trazo rápido → poco.
 *  2. `simplifyStroke()` se aplica al soltar: baja la cantidad de puntos que se
 *     persisten (Ramer–Douglas–Peucker) sin cambiar la forma visible.
 *
 * Todas las coordenadas están en fracciones del lienzo (0..1), igual que
 * StoryDrawStroke.points.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Distancia mínima (fracción del ancho) entre puntos aceptados: ~4px sobre 1080. */
const MIN_DIST = 0.0035;
/** Mezcla cuando la mano va lenta: bajo = suave (filtra el temblor). */
const SLOW_ALPHA = 0.16;
/** Mezcla cuando la mano va rápida: alto = fiel (no arrastra el trazo). */
const FAST_ALPHA = 0.75;
/** Velocidad (fracción por evento) a partir de la cual se considera trazo rápido. */
const SPEED_REF = 0.05;

export interface Smoother {
  /** Arranca un trazo nuevo en `p`. */
  reset(p: Pt): void;
  /** Procesa un punto crudo; devuelve el punto a dibujar o null si se descarta. */
  push(p: Pt): Pt | null;
  /** Cierra el trazo en el último punto crudo, para que termine donde soltaste. */
  finish(): Pt | null;
}

/**
 * @param strength 0 = sin asistencia (puntos crudos), 1 = suavizado completo.
 */
export function createSmoother(strength = 1): Smoother {
  const k = Math.min(1, Math.max(0, strength));
  let out: Pt | null = null; // último punto emitido (suavizado)
  let raw: Pt | null = null; // último punto crudo aceptado

  return {
    reset(p) {
      out = { ...p };
      raw = { ...p };
    },
    push(p) {
      if (!out || !raw) {
        this.reset(p);
        return out;
      }
      const dist = Math.hypot(p.x - raw.x, p.y - raw.y);
      if (dist < MIN_DIST * k) return null; // micro-movimiento: es temblor, no trazo
      raw = { ...p };
      // Alpha adaptativo a la velocidad; con k=0 queda en 1 (passthrough).
      const speed = Math.min(1, dist / SPEED_REF);
      const alpha = 1 - k * (1 - (SLOW_ALPHA + (FAST_ALPHA - SLOW_ALPHA) * speed));
      out = {
        x: out.x + (p.x - out.x) * alpha,
        y: out.y + (p.y - out.y) * alpha,
      };
      return out;
    },
    finish() {
      if (!raw || !out) return null;
      const dist = Math.hypot(raw.x - out.x, raw.y - out.y);
      if (dist < MIN_DIST) return null;
      out = { ...raw };
      return out;
    },
  };
}

/**
 * Ramer–Douglas–Peucker: quita los puntos que no cambian la forma del trazo
 * más allá de `tolerance` (fracción del lienzo). Reduce mucho el JSON guardado.
 */
export function simplifyStroke(points: Pt[], tolerance = 0.0012): Pt[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist <= tolerance) return [first, last];

  const left = simplifyStroke(points.slice(0, index + 1), tolerance);
  const right = simplifyStroke(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** Distancia del punto `p` al segmento a→b. */
function perpendicularDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
