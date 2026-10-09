/** Diagnóstico de lectura: no llama al modelo, no imprime textos ni credenciales. */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local', quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const results = await Promise.all([
  db.from('reels').select('*').order('id').range(0, 999),
  db.from('ai_settings').select('blocks,updated_at').eq('id', 'default').maybeSingle(),
]);
for (const result of results) {
  if (result.error) {
    console.error('No se pudo leer el estado de la base:', result.error.code || 'conexión');
    process.exitCode = 1;
  }
}
if (!process.exitCode) {
  const reels = results[0].data || [];
  const groups = new Map();
  for (const reel of reels) {
    const key = String(reel.transcript || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    if (key) groups.set(key, (groups.get(key) || 0) + 1);
  }
  const saved = results[1].data;
  const blocks = saved?.blocks && typeof saved.blocks === 'object' ? saved.blocks : {};
  console.log(JSON.stringify({
    reelsRead: reels.length, possiblyMore: reels.length === 1000,
    transcribed: reels.filter((reel) => String(reel.transcript || '').trim()).length,
    uniqueTranscripts: groups.size,
    repeatedTranscripts: [...groups.values()].reduce((sum, count) => sum + count - 1, 0),
    hidden: reels.filter((reel) => reel.is_hidden).length,
    markedDuplicate: reels.filter((reel) => reel.is_duplicate).length,
    suppressed: reels.filter((reel) => reel.transcript_suppressed).length,
    curationMigrationPresent: reels.length ? 'is_hidden' in reels[0] : null,
    training: {
      saved: Boolean(saved), updatedAt: saved?.updated_at || null,
      editedKeys: Object.keys(blocks),
      disabledKeys: Object.entries(blocks).filter(([, value]) => typeof value === 'string' && !value.trim()).map(([key]) => key),
      storedCharacters: Object.values(blocks).reduce((sum, value) => sum + (typeof value === 'string' ? value.length : 0), 0),
    },
  }, null, 2));
}
