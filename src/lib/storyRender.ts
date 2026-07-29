/**
 * Render de slides de Historias a PNG 1080×1920 (formato story 9:16).
 *
 * Orden de dibujo: fondo (con brillo) → imágenes superpuestas → capas de texto
 * → trazos de dibujo. Las imágenes remotas pasan por el proxy wsrv.nl (mismo
 * patrón que `proxied()` en inspiracion/page.tsx) y se cargan con
 * crossOrigin='anonymous' para que el canvas NO quede tainted y `toBlob()` funcione.
 */
import type {
  StorySlide,
  StoryTextLayer,
  StoryImageOverlay,
  StoryDrawStroke,
} from '@/lib/studio-types';

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

/** Fuente disponible en el editor: `family` es lo que se persiste; `label` lo que se muestra. */
export interface StoryFont {
  label: string;
  family: string;
}

/**
 * Lista curada con estética Instagram. Las Google Fonts se cargan vía @import en
 * globals.css; las system fonts (Georgia/Impact) siempre están disponibles.
 */
export const STORY_FONTS: StoryFont[] = [
  { label: 'Inter · Clásica', family: 'Inter' },
  { label: 'Poppins · Moderna', family: 'Poppins' },
  { label: 'Bebas Neue · Fuerte', family: 'Bebas Neue' },
  { label: 'Anton · Título', family: 'Anton' },
  { label: 'Oswald · Condensada', family: 'Oswald' },
  { label: 'Archivo Black · Negra', family: 'Archivo Black' },
  { label: 'Pacifico · Neón', family: 'Pacifico' },
  { label: 'Dancing Script · Manuscrita', family: 'Dancing Script' },
  { label: 'Caveat · Marcador', family: 'Caveat' },
  { label: 'Lobster · Script', family: 'Lobster' },
  { label: 'Courier Prime · Typewriter', family: 'Courier Prime' },
  { label: 'Georgia · Serif', family: 'Georgia' },
  { label: 'Impact · Meme', family: 'Impact' },
];

/**
 * Envuelve una URL remota en el proxy de imágenes (resuelve CORS + resize).
 * Deja intactos los data:/blob: y las URLs ya proxeadas.
 */
export function proxied(
  url: string,
  w = CANVAS_W,
  h = CANVAS_H,
  fit: 'cover' | 'inside' = 'cover',
): string {
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return url; // data:, blob:, relativas
  if (url.startsWith('https://wsrv.nl/')) return url;
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&h=${h}&fit=${fit}&output=png`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

/** Dibuja la imagen cubriendo todo el lienzo, centrada, sin deformar (object-fit: cover). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
  const scale = Math.max(CANVAS_W / img.width, CANVAS_H / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (CANVAS_W - dw) / 2, (CANVAS_H - dh) / 2, dw, dh);
}

/** Normaliza una palabra para comparar contra la lista de subrayado (sin puntuación, minúsculas). */
function cleanWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Corta el texto en líneas: respeta los \n y, si hay maxWidth, hace word-wrap. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const paragraph of (text || '').split('\n')) {
    if (!maxWidth) {
      out.push(paragraph);
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Dibuja una línea palabra por palabra (textAlign left, x manual) para poder:
 * justificar (extraGap entre palabras) y subrayar palabras concretas.
 */
function drawWords(
  ctx: CanvasRenderingContext2D,
  line: string,
  startX: number,
  y: number,
  extraGap: number,
  underlineSet: Set<string>,
  highlightSet: Set<string>,
  layer: StoryTextLayer,
): void {
  const size = layer.size;
  const spaceWidth = ctx.measureText(' ').width;
  const uy = y + size * 1.04;
  const uw = Math.max(2, size * 0.06);
  const hlPadX = size * 0.14;
  const hlPadY = size * 0.08;
  ctx.textAlign = 'left';

  let x = startX;
  for (const word of line.split(' ')) {
    if (word === '') {
      x += spaceWidth + extraGap;
      continue;
    }
    const w = ctx.measureText(word).width;
    const clean = cleanWord(word);
    // Resaltado por palabra (rectángulo detrás de la palabra).
    if (layer.highlight && highlightSet.size && highlightSet.has(clean)) {
      ctx.fillStyle = layer.highlight;
      ctx.fillRect(x - hlPadX, y - hlPadY, w + hlPadX * 2, size + hlPadY * 2);
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(word, x, y);
    if (!layer.underline && underlineSet.size && underlineSet.has(clean)) {
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = uw;
      ctx.beginPath();
      ctx.moveTo(x, uy);
      ctx.lineTo(x + w, uy);
      ctx.stroke();
    }
    x += w + spaceWidth + extraGap;
  }
}

function drawLayer(ctx: CanvasRenderingContext2D, layer: StoryTextLayer): void {
  const size = layer.size;
  const lh = size * (layer.lineHeight ?? 1.25);
  ctx.font = `${layer.bold ? 'bold ' : ''}${size}px "${layer.font}", sans-serif`;
  ctx.textBaseline = 'top';

  const maxWidth = layer.widthPct ? layer.widthPct * CANVAS_W : 0;
  const anchorX = layer.x * CANVAS_W;
  const anchorY = layer.y * CANVAS_H;
  const lines = wrapLines(ctx, layer.text || '', maxWidth);
  const underlineSet = new Set((layer.underlineWords ?? []).map(cleanWord).filter(Boolean));
  const highlightSet = new Set((layer.highlightWords ?? []).map(cleanWord).filter(Boolean));
  const padX = size * 0.18;
  const padY = size * 0.1;

  // La caja se ancla por su CENTRO en anchorX; la alineación acomoda el texto
  // DENTRO de la caja (no mueve el bloque al lado opuesto).
  const boxW = maxWidth || Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const boxLeft = anchorX - boxW / 2;

  lines.forEach((line, i) => {
    const y = anchorY + i * lh;
    const isLast = i === lines.length - 1;
    const lineWidth = ctx.measureText(line).width;
    const justify = layer.align === 'justify' && !isLast && boxW - lineWidth > 1;

    // Inicio del texto dentro de la caja según alineación.
    let startX: number;
    if (layer.align === 'right') startX = boxLeft + (boxW - lineWidth);
    else if (layer.align === 'center') startX = boxLeft + (boxW - lineWidth) / 2;
    else startX = boxLeft; // left y justify arrancan a la izquierda de la caja

    // Reparte el espacio sobrante entre palabras cuando se justifica.
    let extraGap = 0;
    if (justify) {
      const gaps = line.split(' ').filter((w) => w !== '').length - 1;
      if (gaps > 0) extraGap = Math.max(0, (boxW - lineWidth) / gaps);
    }

    // Resaltado de toda la línea (solo si NO hay resaltado por palabra).
    if (layer.highlight && !highlightSet.size && line.trim()) {
      const hlLeft = justify ? boxLeft : startX;
      const hlW = justify ? boxW : lineWidth;
      ctx.fillStyle = layer.highlight;
      ctx.fillRect(hlLeft - padX, y - padY, hlW + padX * 2, size + padY * 2);
    }

    drawWords(ctx, line, startX, y, extraGap, underlineSet, highlightSet, layer);

    // Subrayado de toda la capa (toda la línea).
    if (layer.underline && line.trim()) {
      const uy = y + size * 1.04;
      const uLeft = justify ? boxLeft : startX;
      const uW = justify ? boxW : lineWidth;
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = Math.max(2, size * 0.06);
      ctx.beginPath();
      ctx.moveTo(uLeft, uy);
      ctx.lineTo(uLeft + uW, uy);
      ctx.stroke();
    }
  });
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: StoryDrawStroke): void {
  if (stroke.points.length < 1) return;
  const buildPath = () => {
    ctx.beginPath();
    const [first, ...rest] = stroke.points;
    ctx.moveTo(first.x * CANVAS_W, first.y * CANVAS_H);
    if (rest.length === 0) ctx.lineTo(first.x * CANVAS_W + 0.1, first.y * CANVAS_H);
    else for (const p of rest) ctx.lineTo(p.x * CANVAS_W, p.y * CANVAS_H);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (stroke.glow) {
    ctx.save();
    // Halo neón: color con sombra difusa (dibujado dos veces para intensificar).
    ctx.shadowColor = stroke.color;
    ctx.shadowBlur = Math.max(10, stroke.width * 1.6);
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    buildPath();
    ctx.stroke();
    buildPath();
    ctx.stroke();
    // Núcleo brillante encima, sin sombra.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(1, stroke.width * 0.38);
    buildPath();
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  buildPath();
  ctx.stroke();
}

/** Traza (sin pintar) un rectángulo redondeado; usa ctx.roundRect si existe. */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof (ctx as CanvasRenderingContext2D & { roundRect?: unknown }).roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Dibuja una imagen cubriendo (cover) una caja destino, recortada a su forma. */
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  ov: StoryImageOverlay,
  img: HTMLImageElement,
): void {
  const w = ov.w * CANVAS_W;
  const h = ov.h * CANVAS_H;
  const dx = ov.x * CANVAS_W - w / 2;
  const dy = ov.y * CANVAS_H - h / 2;
  const r = (ov.radius ?? 0) * Math.min(w, h);

  ctx.save();
  if (r > 0) {
    roundRectPath(ctx, dx, dy, w, h, r);
    ctx.clip();
  }
  // cover: escala para llenar la caja y recorta el excedente centrado.
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, w, h);
  ctx.restore();
}

/** Espera a que las fuentes usadas por el slide estén cargadas (para medir/pintar en canvas). */
async function ensureFonts(slide: StorySlide): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const families = new Set(slide.layers.map((l) => l.font));
  try {
    await Promise.all(
      [...families].flatMap((f) => [
        document.fonts.load(`400 100px "${f}"`),
        document.fonts.load(`bold 100px "${f}"`),
      ]),
    );
    await document.fonts.ready;
  } catch {
    /* si una fuente no carga, se usa el fallback sans-serif */
  }
}

/** Renderiza un slide a un <canvas> 1080×1920 ya dibujado. */
export async function renderSlideToCanvas(
  slide: StorySlide,
  bgUrl: string | null | undefined,
): Promise<HTMLCanvasElement> {
  await ensureFonts(slide);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no soporta canvas 2D');

  // Fondo base (por si no hay imagen o falla la carga).
  ctx.fillStyle = '#0a0e0e';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (bgUrl) {
    try {
      const img = await loadImage(proxied(bgUrl));
      const brightness = slide.bg_brightness ?? 1;
      const s = slide.bg_scale ?? 1;
      const panX = slide.bg_pan_x ?? 0;
      const panY = slide.bg_pan_y ?? 0;
      ctx.save();
      if (brightness !== 1) ctx.filter = `brightness(${brightness})`;
      // zoom + desplazamiento respecto del centro (mismo modelo que el preview CSS).
      ctx.translate(CANVAS_W / 2 + panX * CANVAS_W, CANVAS_H / 2 + panY * CANVAS_H);
      ctx.scale(s, s);
      ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);
      drawCover(ctx, img);
      ctx.restore();
    } catch {
      /* mantiene el fondo base si la imagen no carga */
    }
  }

  // Precarga las imágenes de los overlays (para poder dibujar en orden de z).
  const overlays = slide.overlays ?? [];
  const overlayImgs = await Promise.all(
    overlays.map((ov) => loadImage(proxied(ov.src, 1000, 1000, 'inside')).catch(() => null)),
  );

  // Lista unificada de elementos, ordenada por z (default por tipo: overlays<texto<trazos).
  const drawables: { z: number; run: () => void }[] = [];
  overlays.forEach((ov, i) => {
    const img = overlayImgs[i];
    if (img) drawables.push({ z: ov.z ?? 10, run: () => drawOverlay(ctx, ov, img) });
  });
  for (const layer of slide.layers) drawables.push({ z: layer.z ?? 20, run: () => drawLayer(ctx, layer) });
  for (const stroke of slide.strokes ?? []) drawables.push({ z: stroke.z ?? 30, run: () => drawStroke(ctx, stroke) });
  drawables.sort((a, b) => a.z - b.z);
  for (const d of drawables) d.run();

  return canvas;
}

/** Renderiza un slide y devuelve un Blob PNG listo para descargar o zippear. */
export async function renderSlideToPng(
  slide: StorySlide,
  bgUrl: string | null | undefined,
): Promise<Blob> {
  const canvas = await renderSlideToCanvas(slide, bgUrl);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo generar el PNG'))),
      'image/png',
    );
  });
}

/** Overlay helper reexportado por conveniencia de tipos en el editor. */
export type { StoryImageOverlay };
