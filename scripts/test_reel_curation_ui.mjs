import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import * as dateRange from '../src/lib/dateRange.ts';
import * as curation from '../src/lib/reel-curation.ts';
import * as ui from '../src/lib/reel-curation-ui.ts';

const reel = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Reel de prueba', views: 100, comments: 3,
  instagram_id: '18000000000000000', video_url: 'https://www.instagram.com/reel/test/',
  transcript: 'Antes', ai_analysis: ['Antes'], improvement: 'Antes',
  is_hidden: false, is_duplicate: false, transcript_suppressed: false, canonical_reel_id: null,
};
const duplicate = { ...reel, ...curation.curationPatch('mark_duplicate'), views: 10 };
const settle = () => new Promise(setImmediate);

function pageFixture() {
  const hooks = [], effects = [], frames = [], reads = [], requests = [];
  let hook = 0, mounted = false;
  const slot = (initial) => {
    const index = hook++;
    hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
    return hooks[index];
  };
  const react = {
    useState(initial) { const state = slot(initial); return [state.value, (value) => { state.value = typeof value === 'function' ? value(state.value) : value; }]; },
    useRef(initial) { return slot({ current: initial }).value; },
    useEffect(effect) { if (!mounted) effects.push(effect); },
    useMemo: (factory) => factory(), useCallback: (callback) => callback,
  };
  const deferredRead = () => new Promise((resolve) => reads.push((data) => resolve({ data, error: null })));
  const supabase = { from() {
    const query = { select: () => query, eq: () => query, order: deferredRead, single: deferredRead };
    return query;
  } };
  const source = readFileSync(new URL('../src/app/instagram/page.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const compiled = { exports: {} };
  runInNewContext(code, {
    module: compiled, exports: compiled.exports, console,
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; }, cancelAnimationFrame() {},
    fetch: async (url) => { requests.push(url); assert.equal(url, '/api/sync', 'no se deben iniciar llamadas de enriquecimiento excluidas'); return { json: async () => ({ success: true, syncedCount: 1 }) }; },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) });
      if (name.startsWith('@/components/') && name !== '@/components/Toast') return { __esModule: true, default: name.split('/').pop() };
      if (name === '@/components/Toast') return { useToast: () => ({ toast() {} }) };
      if (name === '@/utils/supabase') return { supabase };
      if (name === '@/lib/viral') return { median: () => 100 };
      if (name === '@/lib/dateRange') return dateRange;
      if (name === '@/lib/workSession') return { loadWork: (_, fallback) => fallback, saveWork() {} };
      if (name === '@/lib/reel-curation') return curation;
      if (name === '@/lib/reel-curation-ui') return ui;
      if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      throw new Error(`Dependencia inesperada: ${name}`);
    },
  });
  const render = () => { hook = 0; const tree = compiled.exports.default(); mounted = true; return tree; };
  const find = (tree, predicate) => {
    if (!tree || typeof tree !== 'object') return null;
    if (Array.isArray(tree)) return tree.map((item) => find(item, predicate)).find(Boolean) || null;
    return predicate(tree) ? tree : find(tree.props?.children, predicate);
  };
  const component = (name) => find(render(), (node) => node.type === name);
  const initial = async () => {
    render(); effects.forEach((effect) => effect()); frames.forEach((frame) => frame());
    reads.shift()([{ ...reel }]); await settle();
    component('ReelGrid').props.onSelectReel({ ...reel });
    return component('ReelDetailPanel');
  };
  return { render, component, initial, reads, requests, find };
}

test('GET diferido de grilla conserva un PATCH posterior y recibe métricas nuevas', async () => {
  const f = pageFixture(); const panel = await f.initial();
  panel.props.onClose(); // Inicia fetchReels antes del PATCH.
  f.component('ReelGrid').props.onSelectReel({ ...reel });
  f.component('ReelDetailPanel').props.onUpdate(duplicate);
  f.reads.shift()([{ ...reel, views: 999, comments: 7 }]);
  await settle();
  assert.equal(f.component('ReelGrid'), null, 'el repetido no vuelve a Activos');
  const selected = f.component('ReelDetailPanel').props.reel;
  assert.equal(selected.is_duplicate, true); assert.equal(selected.transcript_suppressed, true);
  assert.equal(selected.transcript, null); assert.equal(selected.ai_analysis, null); assert.equal(selected.improvement, null);
  assert.equal(selected.views, 999); assert.equal(selected.comments, 7);
});

test('GET posterior a sync diferido no enriquece ni reactiva el reel marcado durante la lectura', async () => {
  const f = pageFixture(); const panel = await f.initial();
  const sync = f.find(f.render(), (node) => node.type === 'button' && node.props.className === 'syncBtn').props.onClick();
  await settle();
  panel.props.onUpdate(duplicate);
  f.reads.shift()([{ ...reel, views: 700 }]);
  await settle();
  assert.equal(f.component('ReelDetailPanel').props.reel.is_duplicate, true);
  assert.equal(f.component('ReelDetailPanel').props.reel.views, 700);
  assert.deepEqual(f.requests, ['/api/sync']);
  f.reads.shift()([{ ...duplicate, views: 701 }]); // Lectura final iniciada después del PATCH.
  await sync;
  assert.equal(f.component('ReelDetailPanel').props.reel.views, 701);
  assert.equal(f.component('ReelDetailPanel').props.reel.transcript, null);
});

test('refresh individual diferido respeta curación y no pisa métricas con el snapshot del PATCH', async () => {
  const f = pageFixture(); const panel = await f.initial();
  const refreshed = panel.props.readReel(reel.id);
  panel.props.onUpdate(duplicate);
  assert.equal(f.component('ReelDetailPanel').props.reel.views, 100, 'PATCH conserva las métricas actuales');
  f.reads.shift()({ ...reel, views: 888 });
  const current = await refreshed;
  assert.equal(current.is_duplicate, true); assert.equal(current.transcript, null); assert.equal(current.views, 888);
  assert.equal(f.component('ReelDetailPanel').props.reel.is_duplicate, true);
  assert.equal(f.component('ReelDetailPanel').props.reel.views, 888);
});

test('el merge sólo protege cambios posteriores al comienzo del SELECT y permite restauraciones nuevas', () => {
  const reads = ui.createReelCurationReads();
  ui.rememberReelCuration(reads, duplicate);
  const revision = reads.revision;
  const restored = { ...reel, views: 900 };
  assert.equal(ui.reconcileReelRead(restored, revision, reads), restored);
  ui.rememberReelCuration(reads, { ...reel, ...curation.curationPatch('unmark_duplicate'), transcript: null, ai_analysis: null, improvement: null });
  const incoming = ui.reconcileReelRead({ ...duplicate, views: 950 }, revision, reads);
  assert.equal(incoming.is_duplicate, false); assert.equal(incoming.transcript_suppressed, false); assert.equal(incoming.views, 950);
  assert.equal(ui.reconcileReelRead({ id: 'otro', views: 3 }, 0, reads).views, 3);
});
