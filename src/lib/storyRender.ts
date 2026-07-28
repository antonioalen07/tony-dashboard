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
export function proxied(url: string, w = CANVAS_W, h = CANVAS_H): string {
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return url; // data:, blob:, relativas
  if (url.startsWith('https://wsrv.nl/')) return url;
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&h=${h}&fit=cover&output=png`;
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

  lines.forEach((line, i) => {
    const y = anchorY + i * lh;
    const isLast = i === lines.length - 1;
    const naturalWidth = ctx.measureText(line).width;
    const boxW = maxWidth || naturalWidth;
    const justify = layer.align === 'justify' && !isLast && maxWidth > 0;

    // Borde izquierdo de la caja según alineación.
    let left: number;
    if (layer.align === 'right') left = anchorX - boxW;
    else if (layer.align === 'center') left = anchorX - boxW / 2;
    else left = anchorX; // left y justify anclan a la izquierda

    // Reparte el espacio sobrante entre palabras cuando se justifica.
    let extraGap = 0;
    if (justify) {
      const gaps = line.split(' ').filter((w) => w !== '').length - 1;
      if (gaps > 0) extraGap = Math.max(0, (maxWidth - naturalWidth) / gaps);
    }

    // Resaltado de toda la línea (solo si NO hay resaltado por palabra).
    if (layer.highlight && !highlightSet.size && line.trim()) {
      const hlW = justify ? maxWidth : naturalWidth;
      ctx.fillStyle = layer.highlight;
      ctx.fillRect(left - padX, y - padY, hlW + padX * 2, size + padY * 2);
    }

    drawWords(ctx, line, left, y, extraGap, underlineSet, highlightSet, layer);

    // Subrayado de toda la capa (toda la línea).
    if (layer.underline && line.trim()) {
      const uy = y + size * 1.04;
      const uw = justify ? maxWidth : naturalWidth;
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = Math.max(2, size * 0.06);
      ctx.beginPath();
      ctx.moveTo(left, uy);
      ctx.lineTo(left + uw, uy);
      ctx.stroke();
    }
  });
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: StoryDrawStroke): void {
  if (stroke.points.length < 1) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const [first, ...rest] = stroke.points;
  ctx.moveTo(first.x * CANVAS_W, first.y * CANVAS_H);
  if (rest.length === 0) {
    // Un solo punto: dibuja un puntito.
    ctx.lineTo(first.x * CANVAS_W + 0.1, first.y * CANVAS_H);
  } else {
    for (const p of rest) ctx.lineTo(p.x * CANVAS_W, p.y * CANVAS_H);
  }
  ctx.stroke();
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
      if (brightness !== 1) ctx.filter = `brightness(${brightness})`;
      drawCover(ctx, img);
      ctx.filter = 'none';
    } catch {
      /* mantiene el fondo base si la imagen no carga */
    }
  }

  // Imágenes superpuestas (debajo del texto).
  for (const ov of slide.overlays ?? []) {
    try {
      const img = await loadImage(proxied(ov.src));
      const w = ov.w * CANVAS_W;
      const h = ov.h * CANVAS_H;
      ctx.drawImage(img, ov.x * CANVAS_W - w / 2, ov.y * CANVAS_H - h / 2, w, h);
    } catch {
      /* omite el overlay que no cargue */
    }
  }

  for (const layer of slide.layers) drawLayer(ctx, layer);

  // Trazos de dibujo por encima de todo.
  for (const stroke of slide.strokes ?? []) drawStroke(ctx, stroke);

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
