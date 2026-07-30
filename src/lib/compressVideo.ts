import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Compresión de video EN EL NAVEGADOR con ffmpeg.wasm (single-thread, sin
// SharedArrayBuffer → no requiere headers COOP/COEP). El core (~30MB) se baja
// una sola vez, la primera vez que se comprime, y queda cacheado en memoria.

const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;
let currentOnProgress: ((ratio: number) => void) | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const ffmpeg = new FFmpeg();
    // Un único listener de progreso; delega en el callback vigente de cada corrida.
    ffmpeg.on('progress', ({ progress }) => {
      if (currentOnProgress) currentOnProgress(Math.min(1, Math.max(0, progress)));
    });
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadingPromise;
}

/**
 * Recomprime un video para que quepa bajo el límite de Storage: baja la
 * resolución (long edge ≤ 1920, dimensiones pares) y el bitrate (CRF 28),
 * conservando el audio. Devuelve un nuevo File mp4 con `-comprimido` en el nombre.
 *
 * @param onProgress ratio 0..1 del avance de la recodificación.
 */
export async function compressVideo(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<File> {
  const ffmpeg = await getFFmpeg();
  currentOnProgress = onProgress || null;

  const ext = file.name.match(/\.[a-z0-9]+$/i)?.[0] || '.mp4';
  const inputName = `input${ext}`;
  const outputName = 'output.mp4';

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await ffmpeg.exec([
      '-i', inputName,
      '-vf', 'scale=w=1920:h=1920:force_original_aspect_ratio=decrease:force_divisible_by=2',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outputName,
    ]);
    const data = await ffmpeg.readFile(outputName);
    // Copiar a un ArrayBuffer limpio (readFile puede venir sobre ArrayBufferLike).
    const bytes = data as Uint8Array;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: 'video/mp4' });
    const baseName = file.name.replace(/\.[a-z0-9]+$/i, '') || 'video';
    return new File([blob], `${baseName}-comprimido.mp4`, { type: 'video/mp4' });
  } finally {
    currentOnProgress = null;
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}
