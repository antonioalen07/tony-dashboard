import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { storedVariantCaption } from '../src/lib/variant-caption.ts';

// Ejecutamos las funciones REALES de la página extraídas por AST. Así las
// pruebas ejercitan el orden de fetch/PATCH/restauración sin copiar su lógica
// ni necesitar un navegador, una sesión o llamadas a Supabase/Meta.
const source = ts.createSourceFile('page.tsx', fs.readFileSync(new URL('../src/app/variantes/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter();
function extract(name) {
  let found;
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer;
    ts.forEachChild(node, walk);
  }
  walk(source);
  assert.ok(found, `Existe ${name} en la página`);
  if (ts.isCallExpression(found) && found.expression.getText(source) === 'useCallback') found = found.arguments[0];
  return ts.transpileModule(`globalThis.${name}=(${printer.printNode(ts.EmitHint.Expression, found, source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function context(storage = new Map([['variantes:lastJobId', 'job']])) {
  const read = deferred();
  const state = { captions: {}, posts: [] };
  const ctx = {
    activeJobId: 'job', LAST_JOB_KEY: 'variantes:lastJobId', CAPTIONS_KEY: 'variantes:captions',
    captionsRef: { current: {} }, captionRevisionsRef: { current: {} }, dirtyCaptionsRef: { current: new Set() },
    captionTimersRef: { current: new Map() }, captionSavesRef: { current: new Map() },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    // El debounce no se ejecuta: simulamos salir de la página antes de 600 ms.
    setTimeout: () => 1, clearTimeout: () => {},
    setCaptionStates: () => {}, setCaptionColumnMissing: () => {}, setMigrationNeeded: () => {},
    setJob: () => {}, setVariants: () => {}, setSentIds: () => {}, setSendingId: () => {}, toast: () => {},
    setCaptions: (value) => { state.captions = typeof value === 'function' ? value(state.captions) : value; },
    isMissingTable: () => false, isMissingCaption: () => false, storedVariantCaption,
    captionRequest: async (method, id, value) => {
      if (method === 'POST') { state.posts.push({ id, caption: value }); return { queued: { caption: value }, alreadyQueued: false }; }
      return { caption: value };
    },
    supabase: {
      from() {
        const query = {
          select() { return query; }, eq() { return query; },
          single() { return Promise.resolve({ data: { id: 'job', status: 'done' }, error: null }); },
          order() { return read.promise; },
          in() { return Promise.resolve({ data: [], error: null }); },
        };
        return query;
      },
    },
    Object, Set, Map, Promise,
  };
  vm.createContext(ctx);
  for (const name of ['persistCaptionDrafts', 'fetchJobState', 'restoreCaptions', 'saveCaption', 'editCaption', 'sendToCalendar']) vm.runInContext(extract(name), ctx);
  return { ctx, state, read, storage };
}
const oldVariant = () => ({ data: [{ id: 'variant', params: { caption: 'Anterior' } }], error: null });

for (const afterEdit of [false, true]) {
  test(`fetch iniciado ${afterEdit ? 'después' : 'antes'} de editar no pisa descripción tras confirmar PATCH`, async () => {
    const scenario = context();
    if (afterEdit) scenario.ctx.editCaption('variant', 'Nuevo');
    const request = scenario.ctx.fetchJobState('job');
    if (!afterEdit) scenario.ctx.editCaption('variant', 'Nuevo');
    await scenario.ctx.saveCaption('variant', 'Nuevo');
    assert.equal(scenario.ctx.dirtyCaptionsRef.current.has('variant'), false);
    scenario.read.resolve(oldVariant());
    await request;
    assert.equal(scenario.ctx.captionsRef.current.variant, 'Nuevo');
    await scenario.ctx.sendToCalendar({ id: 'variant', params: { caption: 'Anterior' } });
    assert.equal(scenario.state.posts[0].caption, 'Nuevo');
  });
}
test('navegar antes del debounce restaura borrador pendiente y conserva su descripción', async () => {
  const initial = context();
  initial.ctx.editCaption('variant', 'Borrador sin debounce');
  const reloaded = context(initial.storage);
  reloaded.ctx.restoreCaptions('job');
  assert.equal(reloaded.ctx.dirtyCaptionsRef.current.has('variant'), true);
  reloaded.read.resolve(oldVariant());
  await reloaded.ctx.fetchJobState('job');
  assert.equal(reloaded.ctx.captionsRef.current.variant, 'Borrador sin debounce');
});
test('PATCH fallido mantiene borrador pendiente después de recargar', async () => {
  const initial = context();
  initial.ctx.editCaption('variant', 'Borrador con error');
  initial.ctx.captionRequest = async () => { throw new Error('offline'); };
  await assert.rejects(initial.ctx.saveCaption('variant', 'Borrador con error'));
  const reloaded = context(initial.storage);
  reloaded.ctx.restoreCaptions('job');
  reloaded.read.resolve(oldVariant());
  await reloaded.ctx.fetchJobState('job');
  assert.equal(reloaded.ctx.captionsRef.current.variant, 'Borrador con error');
});
test('caché guardada limpia permite recuperar descripción modificada desde otro equipo', async () => {
  const storage = new Map([
    ['variantes:lastJobId', 'job'],
    ['variantes:captions', JSON.stringify({ version: 2, jobId: 'job', captions: { variant: 'Cache anterior' }, pendingIds: [] })],
  ]);
  const scenario = context(storage);
  scenario.ctx.restoreCaptions('job');
  scenario.read.resolve({ data: [{ id: 'variant', params: { caption: 'Servidor de otro equipo' } }], error: null });
  await scenario.ctx.fetchJobState('job');
  assert.equal(scenario.ctx.captionsRef.current.variant, 'Servidor de otro equipo');
});
