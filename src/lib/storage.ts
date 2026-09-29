/**
 * Helpers de Storage sobre el bucket público "studio" de Supabase.
 *
 * Todas las unidades de BAKO Studio suben/borran archivos a través de acá,
 * para mantener un solo lugar donde se resuelve el path, el content-type y la
 * URL pública. No re-implementar `supabase.storage.from('studio')` en otro lado.
 *
 * Subidas: en el servidor van derecho con la service key. En el navegador NO
 * hay key de Supabase y el archivo tampoco puede pasar por Vercel (4.5 MB máx
 * por request), así que se pide una URL firmada a /api/storage/sign-upload y
 * se hace un PUT directo a Supabase.
 */
import { supabase } from '@/utils/supabase';

const STUDIO_BUCKET = 'studio';
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');

/** Deja el nombre de archivo apto para un path de Storage (sin espacios ni raros). */
function sanitizeFilename(filename: string): string {
  const cleaned = (filename || 'file')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-') // todo lo no [a-zA-Z0-9_.-] -> guion
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'file';
}

/**
 * URL pública de un objeto del bucket, apuntando DIRECTO a Supabase. El cliente
 * del navegador pasa por /api/db, así que su `getPublicUrl` daría una URL del
 * gateway; los <img>/<video> tienen que ir al bucket, no a una función.
 */
export function publicStudioUrl(storage_path: string): string {
  const encoded = storage_path.split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/public/${STUDIO_BUCKET}/${encoded}`;
}

export interface StudioUploadOptions {
  contentType: string;
  upsert?: boolean;
  /** Segundos de cache en el CDN/navegador (default de Supabase: 3600). */
  cacheControl?: string;
}

function storageErrorMessage(text: string, status: number): string {
  try {
    const j = JSON.parse(text);
    return j.message || j.error || `Error al subir (${status})`;
  } catch {
    return text || `Error al subir (${status})`;
  }
}

/** Sube un objeto a un path exacto del bucket "studio" (servidor o navegador). */
export async function uploadStudioObject(
  storage_path: string,
  body: File | Blob | Buffer | ArrayBuffer,
  opts: StudioUploadOptions,
): Promise<void> {
  if (typeof window === 'undefined') {
    const { error } = await supabase.storage.from(STUDIO_BUCKET).upload(storage_path, body, {
      contentType: opts.contentType,
      upsert: Boolean(opts.upsert),
      cacheControl: opts.cacheControl,
    });
    if (error) throw error;
    return;
  }

  const signRes = await fetch('/api/storage/sign-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: storage_path, upsert: Boolean(opts.upsert) }),
  });
  if (!signRes.ok) {
    const j = await signRes.json().catch(() => ({}));
    throw new Error(j.error || `No se pudo autorizar la subida (${signRes.status})`);
  }
  const { signedUrl } = (await signRes.json()) as { signedUrl: string };

  const put = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      'content-type': opts.contentType,
      'x-upsert': String(Boolean(opts.upsert)),
      'cache-control': `max-age=${opts.cacheControl ?? '3600'}`,
    },
    body: body as BodyInit,
  });
  if (!put.ok) throw new Error(storageErrorMessage(await put.text().catch(() => ''), put.status));
}

export interface UploadResult {
  storage_path: string;
  public_url: string;
}

/**
 * Sube un archivo al bucket "studio" bajo un path único `${uuid}-${filename}`.
 * Acepta File/Blob (rutas web) o Buffer (workers / server-side).
 */
export async function uploadToStudio(
  file: File | Blob | Buffer,
  opts: { filename: string; contentType: string }
): Promise<UploadResult> {
  const storage_path = `${crypto.randomUUID()}-${sanitizeFilename(opts.filename)}`;
  await uploadStudioObject(storage_path, file, { contentType: opts.contentType, upsert: false });
  return { storage_path, public_url: publicStudioUrl(storage_path) };
}

/** Borra un objeto del bucket "studio" por su storage_path. */
export async function deleteFromStudio(storage_path: string): Promise<void> {
  const { error } = await supabase.storage.from(STUDIO_BUCKET).remove([storage_path]);
  if (error) throw error;
}

/**
 * Borra varios objetos en UNA llamada. Para limpiezas en lote (cancelar varias
 * publicaciones juntas): un `remove` por archivo serían N roundtrips por el
 * gateway, y si falla a mitad deja el lote borrado por la mitad.
 */
export async function deleteManyFromStudio(storage_paths: string[]): Promise<void> {
  if (storage_paths.length === 0) return;
  const { error } = await supabase.storage.from(STUDIO_BUCKET).remove(storage_paths);
  if (error) throw error;
}
