// ffmpeg.mjs — wrapper mínimo sobre ffmpeg-static para re-editar video.
//
// Aplica, en una sola pasada, los ajustes que "despistan" el detector de
// duplicados de Instagram sin alterar visiblemente el contenido:
//   - eq(saturation, contrast)      → color
//   - setpts / atempo (speed)       → velocidad (video + audio)
//   - scale + crop (zoom)           → zoom central conservando dimensiones
//   - -ss (trimStartMs)             → recorte del arranque
//
// Los valores concretos (AppliedVariantParams) los sortea variants.mjs dentro
// de los rangos de VariantParams / DEFAULT_VARIANT_PARAMS.

import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

/**
 * Construye la cadena de filtros de video (`-vf`) a partir de los params.
 * @param {import('../src/lib/studio-types').AppliedVariantParams} p
 * @returns {string}
 */
export function buildVideoFilter(p) {
  const sat = clampNum(p.saturation, 0, 3, 1);
  const con = clampNum(p.contrast, 0, 3, 1);
  const speed = clampNum(p.speed, 0.5, 2, 1);
  const zoom = clampNum(p.zoom, 1, 2, 1);

  const filters = [];
  // Color.
  filters.push(`eq=saturation=${fmt(sat)}:contrast=${fmt(con)}`);
  // Velocidad de video (audio va por atempo). Reseteamos PTS al origen tras el -ss.
  filters.push(`setpts=(PTS-STARTPTS)/${fmt(speed)}`);
  // Zoom central manteniendo las dimensiones originales (dims pares para libx264).
  if (zoom > 1.0001) {
    filters.push(`scale=ceil(iw*${fmt(zoom)}/2)*2:ceil(ih*${fmt(zoom)}/2)*2`);
    filters.push(`crop=floor(iw/${fmt(zoom)}/2)*2:floor(ih/${fmt(zoom)}/2)*2`);
  }
  return filters.join(',');
}

/**
 * Re-edita `inputPath` → `outputPath` (mp4 H.264/AAC) aplicando los params.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {import('../src/lib/studio-types').AppliedVariantParams} params
 * @param {{ hasAudio?: boolean, log?: (...a:any[])=>void }} [opts]
 * @returns {Promise<void>}
 */
export function transcodeVariant(inputPath, outputPath, params, opts = {}) {
  const log = opts.log || (() => {});
  const speed = clampNum(params.speed, 0.5, 2, 1);
  const trimStartSec = Math.max(0, clampNum(params.trimStartMs, 0, 60000, 0) / 1000);
  const vf = buildVideoFilter(params);

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  // -ss ANTES de -i: seek rápido y recorte del arranque.
  if (trimStartSec > 0) args.push('-ss', trimStartSec.toFixed(3));
  args.push('-i', inputPath);
  args.push('-vf', vf);
  // Audio: sólo si el clip trae pista (testsrc puede no tenerla).
  if (opts.hasAudio) {
    args.push('-af', `atempo=${fmt(speed)}`);
    args.push('-c:a', 'aac', '-b:a', '128k');
  } else {
    args.push('-an');
  }
  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  );

  return runFfmpeg(args, log);
}

/**
 * Detecta si un archivo de video tiene pista de audio, usando ffmpeg (sin ffprobe).
 * Robusto: ante cualquier error asume `false` (mejor -an que romper).
 * @param {string} inputPath
 * @returns {Promise<boolean>}
 */
export function hasAudioStream(inputPath) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', inputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', () => resolve(false));
    // ffmpeg sin salida sale con código 1; nos interesa sólo el stderr informativo.
    child.on('close', () => resolve(/Stream #\d+:\d+.*Audio:/i.test(stderr)));
  });
}

// ── helpers ─────────────────────────────────────────────────────────────────

function runFfmpeg(args, log) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg-static no resolvió un binario (ffmpegPath vacío).'));
      return;
    }
    log('ffmpeg', args.join(' '));
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg salió con código ${code}: ${stderr.trim().slice(-500)}`));
    });
  });
}

/** Formatea número a string con hasta 4 decimales, sin notación científica. */
function fmt(n) {
  return Number(n).toFixed(4).replace(/\.?0+$/, '') || '0';
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export { ffmpegPath };
