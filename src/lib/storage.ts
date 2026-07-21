/**
 * Helpers de Storage sobre el bucket público "studio" de Supabase.
 *
 * Todas las unidades de Crevy Studio suben/borran archivos a través de acá,
 * para mantener un solo lugar donde se resuelve el path, el content-type y la
 * URL pública. No re-implementar `supabase.storage.from('studio')` en otro lado.
 */
import { supabase } from '@/utils/supabase';

const STUDIO_BUCKET = 'studio';

/** Deja el nombre de archivo apto para un path de Storage (sin espacios ni raros). */
function sanitizeFilename(filename: string): string {
  const cleaned = (filename || 'file')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-') // todo lo no [a-zA-Z0-9_.-] -> guion
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'file';
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

  const { error } = await supabase.storage
    .from(STUDIO_BUCKET)
    .upload(storage_path, file, {
      contentType: opts.contentType,
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage.from(STUDIO_BUCKET).getPublicUrl(storage_path);

  return { storage_path, public_url: data.publicUrl };
}

/** Borra un objeto del bucket "studio" por su storage_path. */
export async function deleteFromStudio(storage_path: string): Promise<void> {
  const { error } = await supabase.storage.from(STUDIO_BUCKET).remove([storage_path]);
  if (error) throw error;
}
