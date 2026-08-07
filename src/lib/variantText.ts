/**
 * Texto quemado de las variantes de video: se rasteriza acá, en el navegador.
 *
 * El worker NO dibuja el texto con `drawtext`: el escapado de `:` y `'` dentro
 * del filtergraph se comporta distinto según el build de ffmpeg (el de Windows
 * trunca el texto en silencio) y encima haría falta instalar fuentes en el
 * contenedor. En cambio generamos un PNG transparente del tamaño del video, lo
 * subimos al bucket y el worker lo compone con `overlay` — sin escapar nada y
 * con la misma tipografía que ves en el editor.
 */
import type { VariantTextPosition, VariantTextStyle } from '@/lib/studio-types';

/** Ancho útil del bloque de texto (deja márgenes laterales tipo Instagram). */
const TEXT_MAX_W = 0.84;
const LINE_HEIGHT = 1.25;

export interface RenderTextOptions {
  text: string;
  position: VariantTextPosition;
  style: VariantTextStyle;
  width: number;
  height: number;
}

/** Lee las dimensiones reales del video; si no puede, asume 9:16 de 1080. */
export function getVideoSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const fallback = { width: 1080, height: 1920 };
    if (typeof document === 'undefined') return resolve(fallback);
    const video = document.createElement('video');
    const done = (size: { width: number; height: number }) => {
      video.removeAttribute('src');
      video.load();
      resolve(size);
    };
    video.preload = 'metadata';
    video.muted = true;
    video.crossOrigin = 'anonymous';
    video.onloadedmetadata = () =>
      done(
        video.videoWidth && video.videoHeight
          ? { width: video.videoWidth, height: video.videoHeight }
          : fallback,
      );
    video.onerror = () => done(fallback);
    // Si el video no responde, no bloqueamos la generación del job.
    setTimeout(() => done(fallback), 6000);
    video.src = url;
  });
}

/** Corta el texto en líneas respetando los \n y haciendo word-wrap a maxWidth. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
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
  return out.filter((l, i, arr) => l !== '' || arr.length === 1);
}

/** #rrggbb + opacidad → rgba(). */
function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return `rgba(0,0,0,${alpha})`;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Rasteriza el texto a un PNG transparente del tamaño del video. */
export async function renderVariantTextPng(opts: RenderTextOptions): Promise<Blob> {
  const { text, position, style, width, height } = opts;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no soporta canvas 2D');

  const fontSize = Math.max(8, style.size * canvas.height);
  const family = `"${style.font}", sans-serif`;
  try {
    await document.fonts?.load(`bold ${fontSize}px ${family}`);
  } catch {
    /* si la fuente no carga se usa el fallback sans-serif */
  }
  ctx.font = `bold ${fontSize}px ${family}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';

  const lines = wrapLines(ctx, text, canvas.width * TEXT_MAX_W);
  const lh = fontSize * LINE_HEIGHT;
  const blockH = lines.length * lh;

  // Posición vertical del bloque, dentro de las zonas seguras de la story.
  const top =
    position === 'center' ? (canvas.height - blockH) / 2
    : position === 'bottom' ? canvas.height * 0.82 - blockH
    : canvas.height * 0.14;

  const padX = fontSize * 0.32;
  const padY = fontSize * 0.14;
  const cx = canvas.width / 2;

  lines.forEach((line, i) => {
    const y = top + i * lh;
    if (!line.trim()) return;
    const w = ctx.measureText(line).width;
    if (style.box) {
      ctx.fillStyle = rgba(style.boxColor, style.boxOpacity);
      const bx = cx - w / 2 - padX;
      const by = y - padY;
      const bw = w + padX * 2;
      const bh = fontSize + padY * 2;
      const r = Math.min(fontSize * 0.18, bh / 2);
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, bw, bh, r);
      else ctx.rect(bx, by, bw, bh);
      ctx.fill();
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, cx, y);
  });

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo generar el PNG del texto'))),
      'image/png',
    );
  });
}
