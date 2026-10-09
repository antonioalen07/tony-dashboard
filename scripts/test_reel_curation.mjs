import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as curation from '../src/lib/reel-curation.ts';

const id = '11111111-1111-4111-8111-111111111111';
const originalId = '22222222-2222-4222-8222-222222222222';
function routeFixture(route, fields = {}, options = {}) {
  const reel = { id, video_url: 'https://www.instagram.com/reel/example/', transcript: 'Texto original', views: 3000,
    is_hidden: false, is_duplicate: false, transcript_suppressed: false, canonical_reel_id: null, ...fields };
  if (options.legacy) for (const key of ['is_hidden', 'is_duplicate', 'transcript_suppressed', 'canonical_reel_id']) delete reel[key];
  const original = { ...reel, id: originalId };
  const rows = [reel, original];
  const calls = { paid: 0, writes: 0, reads: 0 };
  const db = { from() {
    const filters = []; let patch;
    const execute = () => {
      if (patch) { calls.writes++; options.beforeUpdate?.(reel); } else calls.reads++;
      const selected = rows.find((row) => filters.every(([key, value]) => row[key] === value));
      if (selected && patch) Object.assign(selected, patch);
      return { data: selected ? { ...selected } : null, error: null };
    };
    const query = {
      select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
      update(value) { patch = value; return query; },
      single: async () => execute(), maybeSingle: async () => execute(),
    };
    return query;
  } };
  const source = readFileSync(new URL(`../src/app/api/${route}/route.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  runInNewContext(code, { module: compiled, exports: compiled.exports, Response, Date, console,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: Response.json } };
      if (name === '@/lib/auth') return { requireRole: async () => options.unauthorized
        ? { ok: false, res: Response.json({ error: 'No autorizado' }, { status: 401 }) } : { ok: true } };
      if (name === '@/utils/supabase') return { supabase: db };
      if (name === '@/lib/reel-curation') return curation;
      if (name === '@/lib/transcribe') return { transcribeInstagramPost: async () => { calls.paid++; return 'Texto nuevo'; } };
      if (name === '@/lib/aiSettings') return { loadBlocks: async () => ({ blocks: {} }) };
      if (name === '@/lib/promptConfig') return { composeAnalyzeSystemPrompt: () => 'Instrucciones de prueba' };
      if (name === '@/lib/llm') return { hasLLMKey: () => true, LLM_MODEL: 'mock', llm: { chat: { completions: { create: async () => {
        calls.paid++; return { choices: [{ message: { content: '{"ai_analysis":["Punto"],"improvement":"Mejora"}' } }] };
      } } } } };
      throw new Error(`Dependencia inesperada: ${name}`);
    },
  });
  const invoke = async (body = {}, method = route === 'reels/[id]' ? 'PATCH' : 'POST') => compiled.exports[method](
    new Request('https://bako.example/api/reels/test', { method, body: JSON.stringify(route === 'reels/[id]' ? body : { id, ...body }) }),
    { params: Promise.resolve({ id }) },
  );
  return { invoke, reel, calls, original };
}

test('la curación conserva métricas y los flags ausentes mantienen compatibilidad', () => {
  assert.equal(curation.canEnrichReel({}), true);
  for (const flag of ['is_hidden', 'is_duplicate', 'transcript_suppressed']) assert.equal(curation.canEnrichReel({ [flag]: true }), false);
  for (const action of ['hide', 'show', 'mark_duplicate', 'unmark_duplicate', 'delete_transcript', 'allow_transcript']) {
    assert.equal('views' in curation.curationPatch(action), false);
    assert.equal('instagram_id' in curation.curationPatch(action), false);
  }
  for (const body of [{ action: 'delete' }, { action: 'hide', views: 0 }, { action: 'mark_duplicate', canonical_reel_id: id }, { action: 'show', canonical_reel_id: originalId }])
    assert.throws(() => curation.curationInput(body, id), curation.ReelCurationInputError);
});

test('API borra transcripción/análisis y persiste repetido sin borrar publicación', async () => {
  const f = routeFixture('reels/[id]', { ai_analysis: ['Viejo'], improvement: 'Vieja' });
  assert.equal((await f.invoke({ action: 'mark_duplicate', canonical_reel_id: originalId })).status, 200);
  assert.equal(f.reel.transcript, null);
  assert.equal(f.reel.ai_analysis, null);
  assert.equal(f.reel.improvement, null);
  assert.equal(f.reel.canonical_reel_id, originalId);
  assert.equal(f.reel.transcript_suppressed, true);
  assert.equal(f.reel.views, 3000);
  assert.equal((await f.invoke({ action: 'allow_transcript' })).status, 409);
  assert.equal((await f.invoke({ action: 'unmark_duplicate' })).status, 200);
  assert.equal(f.reel.transcript_suppressed, false);
  assert.equal(f.reel.transcript, null, 'restaurar no inventa una transcripción borrada');
});

test('sin migración el cambio responde 428; sin sesión no lee ni escribe', async () => {
  const legacy = routeFixture('reels/[id]', {}, { legacy: true });
  const missing = await legacy.invoke({ action: 'hide' });
  assert.equal(missing.status, 428);
  assert.equal(legacy.calls.writes, 0);
  for (const route of ['reels/[id]', 'transcribe', 'analyze']) {
    const f = routeFixture(route, {}, { unauthorized: true });
    assert.equal((await f.invoke({ action: 'hide' })).status, 401);
    assert.equal(f.calls.reads + f.calls.writes + f.calls.paid, 0);
  }
});

test('transcribir y analizar excluidos no hacen llamadas pagas', async () => {
  for (const route of ['transcribe', 'analyze']) {
    for (const flag of ['is_hidden', 'is_duplicate', 'transcript_suppressed']) {
      const f = routeFixture(route, { [flag]: true });
      assert.equal((await f.invoke()).status, 409);
      assert.equal(f.calls.paid, 0);
      assert.equal(f.calls.writes, 0);
    }
  }
});

test('una exclusión concurrente impide guardar el resultado ya iniciado', async () => {
  for (const route of ['transcribe', 'analyze']) {
    for (const flag of ['is_hidden', 'is_duplicate', 'transcript_suppressed']) {
      const f = routeFixture(route, {}, { beforeUpdate: (reel) => { reel[flag] = true; reel.transcript = null; } });
      assert.equal((await f.invoke()).status, 409);
      assert.equal(f.calls.paid, 1);
      assert.equal(f.reel.transcript, null);
      assert.equal(f.reel.ai_analysis, undefined);
    }
    assert.equal((await routeFixture(route).invoke()).status, 200);
    assert.equal((await routeFixture(route, {}, { legacy: true }).invoke()).status, 200);
  }
});

test('SQL re-ejecutable conserva exclusiones al sincronizar y protege escritores antiguos', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE public.reels (id uuid PRIMARY KEY, instagram_id text UNIQUE, views integer, transcript text, ai_analysis jsonb, improvement text);`);
    const sql = readFileSync(new URL('../supabase_migration_reel_curation.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    await db.query('INSERT INTO reels(id,instagram_id,views,transcript) VALUES ($1,$2,50,$3)', [id, '18000000000000000', 'Original']);
    await db.query('UPDATE reels SET is_hidden=true, is_duplicate=true, transcript_suppressed=true WHERE id=$1', [id]);
    await db.query(`INSERT INTO reels(id,instagram_id,views) VALUES ($1,$2,999)
      ON CONFLICT(instagram_id) DO UPDATE SET views=EXCLUDED.views`, [id, '18000000000000000']);
    await db.query('UPDATE reels SET transcript=$2, ai_analysis=$3, improvement=$4 WHERE id=$1', [id, 'Llegó tarde', '[]', 'Llegó tarde']);
    const row = (await db.query('SELECT * FROM reels WHERE id=$1', [id])).rows[0];
    assert.equal(row.views, 999);
    assert.equal(row.is_hidden, true);
    assert.equal(row.is_duplicate, true);
    assert.equal(row.transcript_suppressed, true);
    assert.equal(row.transcript, null);
    assert.equal(row.ai_analysis, null);
    assert.equal(row.improvement, null);
    await assert.rejects(db.query('UPDATE reels SET canonical_reel_id=id WHERE id=$1', [id]), /reels_canonical_not_self/);
  } finally { await db.close(); }
});
