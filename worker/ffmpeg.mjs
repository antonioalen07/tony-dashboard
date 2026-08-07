// ffmpeg.mjs — wrapper mínimo sobre ffmpeg-static para re-editar video.
//
// Aplica, en una sola pasada, los ajustes que "despistan" el detector de
// duplicados de Instagram sin alterar visiblemente el contenido:
//   - eq(saturation, contrast)      → color
//   - setpts / atempo (speed)       → velocidad (video + audio)
//   - scale + rotate + crop         → zoom, micro-rotación y reencuadre
//   - hflip                         → espejado horizontal (opt-in)
//   - -ss / -t (trimStart/EndMs)    → recorte del arranque y del final
//   - asetrate + atempo (pitch)     → cambio de tono del audio (opt-in)
//   - overlay                       → texto quemado, distinto por variante
//   - -map_metadata -1 + CRF/GOP    → contenedor sin huellas y bitstream distinto
//
// El texto NO se dibuja con drawtext: el escapado de `:` y `'` dentro del
// filtergraph se comporta distinto según el build de ffmpeg (el de Windows lo
// trunca en silencio). En su lugar el navegador rasteriza el texto a un PNG
// transparente y acá sólo lo componemos — sin escapar nada y con la tipografía
// exacta del editor.
//
// Los valores concretos (AppliedVariantParams) los sortea variants.mjs dentro
// de los rangos de VariantParams / DEFAULT_VARIANT_PARAMS.

import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

/**
 * Construye la cadena de filtros de video a partir de los params.
 * @param {import('../src/lib/studio-types').AppliedVariantParams} p
 * @returns {string}
 */
export function buildVideoFilter(p) {
  const sat = clampNum(p.saturation, 0, 3, 1);
  const con = clampNum(p.contrast, 0, 3, 1);
  const speed = clampNum(p.speed, 0.5, 2, 1);
  const rotate = clampNum(p.rotate, -5, 5, 0);
  const panX = clampNum(p.panX, -1, 1, 0);
  const panY = clampNum(p.panY, -1, 1, 0);
  // El zoom tiene que cubrir además lo que "come" la rotación, si no quedan
  // esquinas negras. Para ángulos chicos alcanza con 1 + 2·|sin(a)|.
  const rotCover = rotate === 0 ? 1 : 1 + 2 * Math.abs(Math.sin((rotate * Math.PI) / 180));
  const zoom = Math.max(clampNum(p.zoom, 1, 2, 1), rotCover);

  const filters = [];
  // Color.
  filters.push(`eq=saturation=${fmt(sat)}:contrast=${fmt(con)}`);
  // Velocidad de video (audio va por atempo). Reseteamos PTS al origen tras el -ss.
  filters.push(`setpts=(PTS-STARTPTS)/${fmt(speed)}`);
  // Zoom + rotación + reencuadre, manteniendo las dimensiones originales.
  if (zoom > 1.0001) {
    filters.push(`scale=ceil(iw*${fmt(zoom)}/2)*2:ceil(ih*${fmt(zoom)}/2)*2`);
    if (rotate !== 0) filters.push(`rotate=${fmt((rotate * Math.PI) / 180)}:bilinear=1`);
    // x/y se expresan como fracción del margen disponible: con pan ∈ [-1,1] el
    // recorte nunca se sale del frame y no hace falta clampear en el filtro.
    const cw = `floor(iw/${fmt(zoom)}/2)*2`;
    const ch = `floor(ih/${fmt(zoom)}/2)*2`;
    filters.push(`crop=${cw}:${ch}:(iw-ow)/2*(1+${fmt(panX)}):(ih-oh)/2*(1+${fmt(panY)})`);
  }
  // Espejado: lo último del bloque geométrico.
  if (p.mirror) filters.push('hflip');
  return filters.join(',');
}

/**
 * Re-edita `inputPath` → `outputPath` (mp4 H.264/AAC) aplicando los params.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {import('../src/lib/studio-types').AppliedVariantParams} params
 * @param {{ hasAudio?: boolean, log?: (...a:any[])=>void, overlayPath?: string|null, durationSec?: number|null }} [opts]
 * @returns {Promise<void>}
 */
export async function transcodeVariant(inputPath, outputPath, params, opts = {}) {
  const log = opts.log || (() => {});
  const speed = clampNum(params.speed, 0.5, 2, 1);
  const pitch = clampNum(params.pitch, 0.8, 1.25, 1);
  const trimStartSec = Math.max(0, clampNum(params.trimStartMs, 0, 60000, 0) / 1000);
  const trimEndSec = Math.max(0, clampNum(params.trimEndMs, 0, 60000, 0) / 1000);

  const vf = buildVideoFilter(params);

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  // -ss ANTES de -i: seek rápido y recorte del arranque.
  if (trimStartSec > 0) args.push('-ss', trimStartSec.toFixed(3));
  args.push('-i', inputPath);

  if (opts.overlayPath) {
    // El PNG del texto entra como segunda entrada; scale2ref (sin w/h: usa las
    // del video de referencia) lo lleva a las dimensiones exactas del video,
    // sin importar cuánto recortó el crop ni el aspecto del original.
    args.push('-i', opts.overlayPath);
    args.push(
      '-filter_complex',
      `[0:v]${vf}[base];[1:v][base]scale2ref[ovr][base2];[base2][ovr]overlay=0:0[v]`,
      '-map', '[v]',
    );
    if (opts.hasAudio) args.push('-map', '0:a:0');
  } else {
    args.push('-vf', vf);
  }
  // Audio: sólo si el clip trae pista (testsrc puede no tenerla).
  if (opts.hasAudio) {
    args.push('-af', buildAudioFilter(speed, pitch));
    args.push('-c:a', 'aac', '-b:a', `${randInt(112, 160)}k`);
  } else {
    args.push('-an');
  }
  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    // CRF y GOP con jitter: el bitstream sale distinto en cada variante.
    '-crf', String(randInt(19, 23)),
    '-g', String(randInt(48, 96)),
    '-pix_fmt', 'yuv420p',
    // Sin metadatos heredados (fecha, encoder, modelo de cámara, título del reel).
    '-map_metadata', '-1',
    '-movflags', '+faststart',
  );
  // Recorte del final: `-t` limita la duración de SALIDA, así que hay que
  // descontar el recorte inicial y dividir por la velocidad aplicada.
  if (trimEndSec > 0 && opts.durationSec) {
    const outDur = (opts.durationSec - trimStartSec - trimEndSec) / speed;
    if (outDur > 1) args.push('-t', outDur.toFixed(3));
  }
  args.push(outputPath);

  return runFfmpeg(args, log);
}

/** Cadena `-af`: tempo + (opcional) cambio de tono conservando el tempo pedido. */
export function buildAudioFilter(speed, pitch) {
  if (!pitch || Math.abs(pitch - 1) < 0.0005) return `atempo=${fmt(speed)}`;
  const sr = 48000;
  // asetrate cambia tono Y tempo; el atempo final devuelve el tempo al objetivo.
  return [
    `aresample=${sr}`,
    `asetrate=${Math.round(sr * pitch)}`,
    `aresample=${sr}`,
    `atempo=${fmt(clampNum(speed / pitch, 0.5, 2, 1))}`,
  ].join(',');
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

/**
 * Duración en segundos del video (parseada del stderr de ffmpeg), o null.
 * La usamos para traducir "recortar N ms del final" a un `-t` concreto.
 * @param {string} inputPath
 * @returns {Promise<number|null>}
 */
export function probeDuration(inputPath) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', inputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      if (!m) return resolve(null);
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
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

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export { ffmpegPath };
