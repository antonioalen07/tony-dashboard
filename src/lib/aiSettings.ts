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
}

export async function loadBlocks(): Promise<LoadedSettings> {
  const { data, error } = await supabase
    .from('ai_settings')
    .select('blocks, updated_at')
    .eq('id', AI_SETTINGS_ID)
    .maybeSingle();

  if (error) return { blocks: resolveBlocks(null), tableMissing: true, updatedAt: null };

  return {
    blocks: resolveBlocks(data?.blocks),
    tableMissing: false,
    updatedAt: (data?.updated_at as string) ?? null,
  };
}

/**
 * Guarda solo lo que difiere del default: así, si mañana cambia un default en
 * el código, los bloques que el usuario nunca tocó heredan la mejora en vez de
 * quedar congelados en una copia vieja.
 */
export async function saveBlocks(incoming: Partial<Record<BlockId, string>>): Promise<void> {
  const blocks: Partial<Record<BlockId, string>> = {};
  for (const def of BLOCK_DEFS) {
    const value = incoming[def.id];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed && trimmed !== def.fallback.trim()) blocks[def.id] = trimmed;
  }

  const { error } = await supabase
    .from('ai_settings')
    .upsert(
      { id: AI_SETTINGS_ID, blocks, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    );

  if (error) throw new Error(error.message);
}
