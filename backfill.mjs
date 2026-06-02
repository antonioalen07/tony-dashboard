/**
 * Backfill: transcribe + analiza todos los reels que aún no lo estén.
 * Reutiliza los endpoints del dev server (deben estar corriendo en :3000).
 * Uso: node backfill.mjs
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: './.env.local' });

const BASE = process.env.BACKFILL_BASE || 'http://localhost:3000';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const post = async (path, id) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  let body = {};
  try { body = await res.json(); } catch {}
  return { ok: res.ok && body.success, body };
};

const main = async () => {
  // Solo reels de Meta (no los duplicados de Apify de 19 dígitos) que tengan video_url.
  const { data, error } = await supabase
    .from('reels')
    .select('id, instagram_id, title, video_url, transcript, ai_analysis')
    .order('published_at', { ascending: false });
  if (error) { console.error('Error leyendo reels:', error.message); process.exit(1); }

  const targets = data.filter((r) => (r.instagram_id || '').length < 19);
  console.log(`Reels a procesar: ${targets.length}\n`);

  let i = 0;
  for (const r of targets) {
    i++;
    const tag = `[${i}/${targets.length}] "${(r.title || '').slice(0, 38).replace(/\n/g, ' ')}"`;

    // 1) Transcripción (si falta)
    if (!r.transcript || !r.transcript.trim()) {
      if (!r.video_url) {
        console.log(`${tag} ⚠ sin video_url (sincroniza primero) — salto transcripción`);
      } else {
        process.stdout.write(`${tag} transcribiendo… `);
        const t = await post('/api/transcribe', r.id);
        console.log(t.ok ? '✓' : `✗ ${t.body.error || ''}`);
      }
    } else {
      console.log(`${tag} ya tenía transcripción`);
    }

    // 2) Análisis IA (si falta)
    if (!r.ai_analysis || r.ai_analysis.length === 0) {
      process.stdout.write(`${tag} analizando… `);
      const a = await post('/api/analyze', r.id);
      console.log(a.ok ? '✓' : `✗ ${a.body.error || ''}`);
    } else {
      console.log(`${tag} ya tenía análisis`);
    }
  }
  console.log('\n=== BACKFILL COMPLETO ===');
};

main();
