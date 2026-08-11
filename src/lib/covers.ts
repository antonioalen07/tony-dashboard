/**
 * Portadas de los reels, guardadas en nuestro Storage.
 *
 * Las URLs que devuelve la Graph API (`thumbnail_url` / `media_url`) son del CDN
 * de Instagram y vienen FIRMADAS: caducan a los pocos días y a partir de ahí
 * responden 403. Como el sync sólo trae los últimos media, los reels viejos —
 * que suelen ser justo los de más vistas, o sea los del Top del dashboard — se
 * quedaban con la portada muerta y el panel mostraba cuadrados vacíos.
 *
 * La solución es copiar la imagen una vez al bucket `studio` y guardar esa URL,
 * que no caduca. El path es determinístico por media id, así que re-sincronizar
 * pisa el mismo objeto y la URL guardada sigue siendo válida.
 */
import { supabase } from '@/utils/supabase';

const BUCKET = 'studio';
const FETCH_TIMEOUT_MS = 8000;
/** Las portadas no cambian: que el navegador se las quede. */
const CACHE_CONTROL = '31536000';

/** ¿Esta URL ya es de nuestro Storage (o sea, no caduca)? */
export const isPersistedCover = (url: string | null | undefined): boolean =>
  !!url && url.includes('/storage/v1/object/public/');

/**
 * `src` para un <img> de portada. Las del CDN de Instagram siguen pasando por
 * wsrv.nl (bloquea el hotlinking directo); las nuestras se sirven derecho, sin
 * meter un tercero en el medio de algo que ya controlamos.
 */
export const coverSrc = (url: string | null | undefined, size?: number): string => {
  if (!url) return '';
  if (isPersistedCover(url)) return url;
  const box = size ? `&w=${size}&h=${size}&fit=cover` : '';
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}${box}`;
};

/**
 * Baja la portada y la sube al bucket. Devuelve la URL estable, o `null` si no
 * se pudo (nunca tira: una portada no vale romper un sync).
 */
export async function persistCover(sourceUrl: string, key: string): Promise<string | null> {
  if (!sourceUrl || isPersistedCover(sourceUrl)) return null;
  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;

    const bytes = await res.arrayBuffer();
    if (!bytes.byteLength) return null;

    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const path = `covers/${key}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true, cacheControl: CACHE_CONTROL });
    if (error) return null;

    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null; // timeout, red caída, CDN que ya expiró: seguimos sin portada nueva
  }
}

/** Corre `persistCover` sobre varios items sin saturar la función serverless. */
export async function persistCovers(
  items: { key: string; sourceUrl: string }[],
  concurrency = 5,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const queue = [...items];

  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const url = await persistCover(next.sourceUrl, next.key);
      if (url) out.set(next.key, url);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
