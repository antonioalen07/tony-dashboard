/**
 * Guías de alineación y "snap" magnético del editor de Historias.
 *
 * Todo se expresa en fracciones del lienzo (0..1), igual que StoryTextLayer y
 * StoryImageOverlay, así el resultado del snap vale tanto en el preview como en
 * el render final de 1080×1920. Las guías son de edición: NUNCA se exportan.
 */

/** Margen lateral de seguridad (fracción del ancho). 0.08 ≈ 86px sobre 1080. */
export const SAFE_X = 0.08;
/** Zona alta donde Instagram dibuja el avatar/nombre. */
export const SAFE_TOP = 0.13;
/** Zona baja donde Instagram dibuja "Enviar mensaje" y las reacciones. */
export const SAFE_BOTTOM = 0.87;

/** Caja de un elemento en el lienzo, en fracciones 0..1. */
export interface SnapBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
}

/** Posiciones candidatas a las que pegarse, por eje. */
export interface SnapTargets {
  /** Coordenadas X (guías verticales). */
  v: number[];
  /** Coordenadas Y (guías horizontales). */
  h: number[];
}

export interface SnapResult {
  /** Corrección a sumarle al ancla del elemento. */
  dx: number;
  dy: number;
  /** Guías que quedaron activas (para dibujarlas mientras se arrastra). */
  guidesV: number[];
  guidesH: number[];
}

/** Guías fijas del lienzo: centro + márgenes de seguridad. */
export function canvasTargets(): SnapTargets {
  return {
    v: [SAFE_X, 0.5, 1 - SAFE_X],
    h: [SAFE_TOP, 0.5, SAFE_BOTTOM],
  };
}

/** Convierte el rect DOM de un elemento a una caja en fracciones del preview. */
export function rectToBox(el: DOMRect, host: DOMRect): SnapBox {
  const left = (el.left - host.left) / host.width;
  const right = (el.right - host.left) / host.width;
  const top = (el.top - host.top) / host.height;
  const bottom = (el.bottom - host.top) / host.height;
  return { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

/** Caja resultante de mover un ancla, dados los offsets caja↔ancla del arrastre. */
export function boxAt(
  ax: number,
  ay: number,
  off: { ox0: number; ox1: number; oy0: number; oy1: number },
): SnapBox {
  const left = ax + off.ox0;
  const right = ax + off.ox1;
  const top = ay + off.oy0;
  const bottom = ay + off.oy1;
  return { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

/**
 * Busca, por eje, el borde (izq/centro/der) más cercano a alguna guía y
 * devuelve la corrección necesaria si cae dentro de la tolerancia.
 */
export function computeSnap(
  box: SnapBox,
  targets: SnapTargets,
  tolX: number,
  tolY: number,
): SnapResult {
  const x = bestAxis([box.left, box.cx, box.right], targets.v, tolX);
  const y = bestAxis([box.top, box.cy, box.bottom], targets.h, tolY);
  return {
    dx: x?.delta ?? 0,
    dy: y?.delta ?? 0,
    guidesV: x ? [x.target] : [],
    guidesH: y ? [y.target] : [],
  };
}

/** Mejor par (borde, guía) de un eje: el de menor distancia dentro de la tolerancia. */
function bestAxis(
  edges: number[],
  targets: number[],
  tol: number,
): { target: number; delta: number } | null {
  let best: { target: number; delta: number } | null = null;
  let bestDist = tol;
  for (const edge of edges) {
    for (const target of targets) {
      const delta = target - edge;
      const dist = Math.abs(delta);
      if (dist <= bestDist) {
        bestDist = dist;
        best = { target, delta };
      }
    }
  }
  return best;
}
