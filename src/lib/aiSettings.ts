/**
 * Lectura/escritura del entrenamiento editable de la IA (`ai_settings`).
 *
 * Degrada sin romper: si la migración `supabase_migration_ai_config.sql` no se
 * corrió, la tabla no existe y todo cae a los defaults de promptConfig. El chat
 * y el análisis siguen funcionando exactamente como antes; la UI usa el flag
 * `tableMissing` para avisar qué falta.
 */

import { supabase } from '@/utils/supabase';
import { resolveBlocks, BLOCK_DEFS, type Blocks, type BlockId } from '@/lib/promptConfig';

/** Fila única: este dashboard es de una sola marca. */
export const AI_SETTINGS_ID = 'default';

export interface LoadedSettings {
  blocks: Blocks;
  /** true = falta correr la migración; lo guardado no se puede persistir. */
  tableMissing: boolean;
  updatedAt: string | null;
  source: 'saved' | 'defaults' | 'missing_table';
}

export async function loadBlocks(db: Pick<typeof supabase, 'from'> = supabase): Promise<LoadedSettings> {
  const { data, error } = await db
    .from('ai_settings')
    .select('blocks, updated_at')
    .eq('id', AI_SETTINGS_ID)
    .maybeSingle();

  if (error) {
    if (['42P01', 'PGRST205'].includes(error.code))
      return { blocks: resolveBlocks(null), tableMissing: true, updatedAt: null, source: 'missing_table' };
    throw new Error('No se pudo leer el entrenamiento guardado. Revisá la conexión o el acceso a la base de datos.');
  }

  return {
    blocks: resolveBlocks(data?.blocks),
    tableMissing: false,
    updatedAt: (data?.updated_at as string) ?? null,
    source: data ? 'saved' : 'defaults',
  };
}

/**
 * Guarda solo lo que difiere del default: así, si mañana cambia un default en
 * el código, los bloques que el usuario nunca tocó heredan la mejora en vez de
 * quedar congelados en una copia vieja.
 *
 * OJO con el bloque VACÍO: se persiste como string vacío, a propósito. Es la
 * forma de decir "apagué este bloque". Si no lo guardáramos, al leer volvería a
 * caer al default — que es exactamente por lo que borrar un bloque desde la app
 * reinstalaba el texto original en vez de sacarlo del prompt.
 */
export async function saveBlocks(incoming: Partial<Record<BlockId, string>>): Promise<void> {
  const blocks: Partial<Record<BlockId, string>> = {};
  for (const def of BLOCK_DEFS) {
    const value = incoming[def.id];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed === def.fallback.trim()) continue; // igual al default: que lo herede
    blocks[def.id] = trimmed;
  }

  const { error } = await supabase
    .from('ai_settings')
    .upsert(
      { id: AI_SETTINGS_ID, blocks, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    );

  if (error) throw Object.assign(new Error('No se pudo guardar el entrenamiento. Revisá el acceso a la base de datos.'), { code: error.code });
}
