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
  /** Preset vertical: sólo se usa si no vienen `x`/`y` (jobs viejos). */
  position: VariantTextPosition;
  /** Centro del bloque, en fracción del ancho (0..1). */
  x?: number;
  /** Centro del bloque, en fracción del alto (0..1). */
  y?: number;
  style: VariantTextStyle;
  width: number;
  height: number;
}

export interface VideoMeta {
  width: number;
  height: number;
  /** Duración en segundos, o null si no se pudo leer. */
  duration: number | null;
}

/** Lee dimensiones y duración del video; si no puede, asume 9:16 de 1080. */
export function getVideoMeta(url: string): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const fallback: VideoMeta = { width: 1080, height: 1920, duration: null };
    if (typeof document === 'undefined') return resolve(fallback);
    const video = document.createElement('video');
    let settled = false;
    const done = (meta: VideoMeta) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      resolve(meta);
    };
    video.preload = 'metadata';
    video.muted = true;
    video.crossOrigin = 'anonymous';
    video.onloadedmetadata = () =>
      done({
        width: video.videoWidth || fallback.width,
        height: video.videoHeight || fallback.height,
        duration: Number.isFinite(video.duration) ? video.duration : null,
      });
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
  const { text, position, x, y, style, width, height } = opts;

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

  // Posición libre: x/y son el CENTRO del bloque. Sin ellos (jobs viejos) se
  // cae a los presets, que se ubican dentro de las zonas seguras de la story.
  const top =
    y != null ? y * canvas.height - blockH / 2
    : position === 'center' ? (canvas.height - blockH) / 2
    : position === 'bottom' ? canvas.height * 0.82 - blockH
    : canvas.height * 0.14;

  const padX = fontSize * 0.32;
  const padY = fontSize * 0.14;
  const cx = (x ?? 0.5) * canvas.width;

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
