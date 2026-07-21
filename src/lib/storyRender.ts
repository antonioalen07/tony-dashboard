/**
 * Render de slides de Historias a PNG 1080×1920 (formato story 9:16).
 *
 * El fondo se dibuja en modo "cover" y encima las capas de texto.
 * CORS: las imágenes remotas pasan por el proxy wsrv.nl (mismo patrón que
 * `proxied()` en inspiracion/page.tsx) y se cargan con crossOrigin='anonymous'
 * para que el canvas NO quede tainted y `toBlob()` funcione.
 */
import type { StorySlide, StoryTextLayer } from '@/lib/studio-types';

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

/** Lista curada de fuentes (todas disponibles como system fonts en Win/Mac; Inter vía globals). */
export const STORY_FONTS = [
  'Inter',
  'Georgia',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Courier New',
  'Impact',
  'Arial Black',
  'Comic Sans MS',
] as const;

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
    img.onerror = () => reject(new Error('No se pudo cargar la imagen de fondo'));
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

function drawLayer(ctx: CanvasRenderingContext2D, layer: StoryTextLayer): void {
  const size = layer.size;
  const lineHeight = size * 1.25;
  ctx.font = `${layer.bold ? 'bold ' : ''}${size}px "${layer.font}", sans-serif`;
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'top';

  const anchorX = layer.x * CANVAS_W;
  const anchorY = layer.y * CANVAS_H;
  const lines = (layer.text || '').split('\n');
  const padX = size * 0.18;
  const padY = size * 0.1;

  lines.forEach((line, i) => {
    const y = anchorY + i * lineHeight;
    const w = ctx.measureText(line).width;

    // Borde izquierdo del texto según alineación (para highlight/underline).
    let left: number;
    if (layer.align === 'center') left = anchorX - w / 2;
    else if (layer.align === 'right') left = anchorX - w;
    else left = anchorX;

    if (layer.highlight) {
      ctx.fillStyle = layer.highlight;
      ctx.fillRect(left - padX, y - padY, w + padX * 2, size + padY * 2);
    }

    ctx.fillStyle = layer.color;
    ctx.fillText(line, anchorX, y);

    if (layer.underline) {
      const uy = y + size * 1.04;
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = Math.max(2, size * 0.06);
      ctx.beginPath();
      ctx.moveTo(left, uy);
      ctx.lineTo(left + w, uy);
      ctx.stroke();
    }
  });
}

/** Renderiza un slide a un <canvas> 1080×1920 ya dibujado (fondo cover + capas). */
export async function renderSlideToCanvas(
  slide: StorySlide,
  bgUrl: string | null | undefined,
): Promise<HTMLCanvasElement> {
  // Asegura que las fuentes (Inter) estén listas antes de medir/pintar texto.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* no-op */
    }
  }

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
      drawCover(ctx, img);
    } catch {
      /* mantiene el fondo base si la imagen no carga */
    }
  }

  for (const layer of slide.layers) drawLayer(ctx, layer);
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
