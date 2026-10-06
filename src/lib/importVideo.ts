import { supabase } from '@/utils/supabase';
import { resolveInstagramVideoUrl } from '@/lib/transcribe';
import type { MediaAsset } from '@/lib/studio-types';

/**
 * Trae un video de afuera al bucket `studio` como archivo REAL y registra el
 * media_asset. Es el único camino por el que un video externo llega al worker
 * de variantes: el worker baja `storage_path` y le pasa ffmpeg, así que tiene
 * que ser un mp4 de verdad, nunca la página de un post.
 *
 * Antes, pegar un link de Instagram en Variantes guardaba el link tal cual como
 * si fuera el archivo: el worker bajaba el HTML del post y el job fallaba con
 * "el video source no tiene stream de video".
 */

const BUCKET = 'studio';

/** ¿Es un link a un post/reel de Instagram (propio o de otra cuenta)? */
export const isInstagramPostUrl = (url: string) =>
  /^https?:\/\/(www\.)?instagram\.com\/(reel|reels|p|tv)\/[\w-]+/i.test(url.trim());

/** Saca tracking (?utm_source, ?igsh…) para que Apify reciba el permalink limpio. */
const cleanInstagramUrl = (url: string) => {
  const m = /^https?:\/\/(?:www\.)?instagram\.com\/(reel|reels|p|tv)\/([\w-]+)/i.exec(url.trim());
  return m ? `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/` : url.trim();
};

export class ImportError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

/** Valida que los bytes sean un video y no una página HTML / un error. */
function assertIsVideo(buffer: Buffer, contentType: string) {
  const head = buffer.subarray(0, 64);
  const isMp4 = head.includes(Buffer.from('ftyp'));
  const isWebm = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  if (buffer.length < 50_000 || (!isMp4 && !isWebm && !/video|octet-stream/i.test(contentType))) {
    const looksHtml = /text\/html/i.test(contentType) || head.toString('utf8').trimStart().startsWith('<');
    throw new ImportError(
      looksHtml
        ? 'El link apunta a una página web, no a un archivo de video. Si es de Instagram, pegá el link del reel.'
        : `No llegó un video válido (${buffer.length} bytes, tipo "${contentType || 'desconocido'}"). Reintentá en unos segundos.`,
    );
  }
}

/**
 * @param sourceUrl  link de un reel/post de Instagram o URL directa a un video
 * @param name       nombre legible para el asset
 * @param pathPrefix prefijo del archivo en el bucket (p. ej. `reel-<id>`)
 */
export async function importVideoFromUrl(sourceUrl: string, name: string, pathPrefix = 'link'): Promise<MediaAsset> {
  const fromInstagram = isInstagramPostUrl(sourceUrl);

  // 1) URL descargable: si es Instagram, Apify resuelve el mp4 real (CDN fresco).
  const downloadUrl = fromInstagram
    ? await resolveInstagramVideoUrl(cleanInstagramUrl(sourceUrl))
    : sourceUrl.trim();

  // 2) Bajarlo en el server (Instagram/CDN bloquean el fetch desde el navegador).
  const res = await fetch(downloadUrl, { redirect: 'follow' });
  if (!res.ok) throw new ImportError(`No se pudo descargar el video (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  assertIsVideo(buffer, res.headers.get('content-type') || '');

  // 3) Subirlo como archivo real.
  const safe = pathPrefix.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60) || 'video';
  const path = `sources/${safe}-${Date.now()}.mp4`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: 'video/mp4', upsert: true });
  if (upErr) {
    const tooBig = /exceed|maximum allowed size|payload too large|413/i.test(upErr.message);
    throw new ImportError(
      tooBig
        ? 'El video supera el límite del Storage (50 MB en el plan free). Probá con uno más corto.'
        : `No se pudo guardar el video: ${upErr.message}`,
      500,
    );
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new ImportError('No obtuve la URL pública del video subido', 500);

  // 4) Registrar el asset.
  const { data: asset, error: assetErr } = await supabase
    .from('media_assets')
    .insert({
      kind: 'video',
      filename: `${name || 'video'}`.slice(0, 120).replace(/\.mp4$/i, '') + '.mp4',
      storage_path: path,
      public_url: pub.publicUrl,
      source: fromInstagram ? 'reel' : 'upload',
    })
    .select('*')
    .single();
  if (assetErr || !asset) {
    throw new ImportError(`No se pudo registrar el asset: ${assetErr?.message || 'null'}`, 500);
  }
  return asset as MediaAsset;
}
