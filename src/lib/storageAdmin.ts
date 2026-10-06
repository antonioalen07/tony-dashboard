import { supabase } from '@/utils/supabase';

/**
 * Operaciones de mantenimiento sobre el bucket `studio` (sólo servidor: usan
 * la service key). Las variantes son lo que llena la cuota — 20-35 MB cada una
 * y 5-10 por generación — así que acá viven el recorrido del bucket (para el
 * contador de espacio) y el borrado de archivos.
 */

export const BUCKET = 'studio';

export interface StoredFile {
  path: string;
  size: number;
}

/** Lista recursiva: la API de Storage devuelve un solo nivel por llamada. */
export async function walkStorage(prefix = '', depth = 0, bucket = BUCKET): Promise<StoredFile[]> {
  if (depth > 6) return [];
  const out: StoredFile[] = [];
  const subfolders: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`No se pudo listar ${prefix || 'el bucket'}: ${error.message}`);
    if (!data?.length) break;
    for (const it of data) {
      const p = prefix ? `${prefix}/${it.name}` : it.name;
      // Las "carpetas" vienen sin id ni metadata.
      if (it.id === null || !it.metadata) subfolders.push(p);
      else out.push({ path: p, size: Number(it.metadata.size) || 0 });
    }
    if (data.length < 1000) break;
  }
  const nested = await Promise.all(subfolders.map((p) => walkStorage(p, depth + 1, bucket)));
  return out.concat(...nested);
}

/** Borra rutas del bucket en tandas (la API acepta listas, no prefijos). */
export async function removeStorage(paths: string[]): Promise<void> {
  const clean = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < clean.length; i += 100) {
    const { error } = await supabase.storage.from(BUCKET).remove(clean.slice(i, i + 100));
    if (error) throw new Error(`No se pudieron borrar archivos del Storage: ${error.message}`);
  }
}

/** Ruta dentro del bucket a partir de una URL pública del bucket (o null si es externa). */
export function pathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
}
