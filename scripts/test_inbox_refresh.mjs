import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Se ejecutan los callbacks reales de UI extraídos por AST; las respuestas
// quedan pendientes entre varios ticks para simular una API más lenta que el
// intervalo de polling. No se usan datos reales ni requests de red.
const source = ts.createSourceFile('AutomationInbox.tsx', fs.readFileSync(new URL('../src/components/AutomationInbox.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter();
function owner(name) {
  const found = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(found, `Existe ${name}`);
  return found;
}
function expression(scope, polling = false) {
  let found;
  function walk(node) {
    if (!polling && ts.isVariableDeclaration(node) && node.name.getText(source) === 'refresh') found = node.initializer.arguments[0];
    if (polling && ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0].getText(source).includes('window.setInterval')) found = node.arguments[0];
    ts.forEachChild(node, walk);
  }
  walk(owner(scope));
  assert.ok(found, `Existe ${polling ? 'polling' : 'refresh'} de ${scope}`);
  return ts.transpileModule(`globalThis.callback=(${printer.printNode(ts.EmitHint.Expression, found, source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(scope) {
  const requests = [];
  const state = {};
  const ctx = {
    search: '', page: 0, tag: '', quality: '', starred: false, id: 'lead', limit: 100,
    queryRef: { current: 0 }, requestRef: { current: 0 }, inFlightRef: { current: null },
    aliveRef: { current: true }, loadedRef: { current: false },
    api(path) { const request = deferred(); requests.push({ ...request, path }); return request.promise; },
    URLSearchParams, Date,
  };
  for (const name of ['Contacts', 'Total', 'HasMore', 'Error', 'Missing', 'Loading', 'Data', 'FetchError', 'Clock', 'Draft']) ctx[`set${name}`] = (value) => { state[name] = value; };
  vm.createContext(ctx);
  vm.runInContext(expression(scope), ctx);
  const response = (label) => scope === 'AutomationInbox'
    ? { leads: [{ id: label }], total: 1, hasMore: false }
    : { lead: { display_name: label, notes: '', qualification: 'new' }, messages: [{ id: label }], canReply: true };
  const refresh = (force = false) => scope === 'AutomationInbox' ? ctx.callback(false, force) : ctx.callback(force);
  const visible = () => scope === 'AutomationInbox' ? state.Contacts?.[0]?.id : state.Data?.messages[0]?.id;
  return { ctx, requests, state, response, refresh, visible };
}

for (const scope of ['AutomationInbox', 'Conversation']) {
  test(`${scope}: polling lento comparte request en vuelo y aplica su respuesta`, async () => {
    const scenario = fixture(scope);
    const first = scenario.refresh();
    const nextTick = scenario.refresh();
    const laterTick = scenario.refresh();
    assert.equal(first, nextTick);
    assert.equal(first, laterTick);
    assert.equal(scenario.requests.length, 1);
    scenario.requests[0].resolve(scenario.response('incoming'));
    await first;
    assert.equal(scenario.visible(), 'incoming');
    assert.equal(scenario.ctx.inFlightRef.current, null);
    const following = scenario.refresh();
    assert.equal(scenario.requests.length, 2);
    scenario.requests[1].resolve(scenario.response('later'));
    await following;
    assert.equal(scenario.visible(), 'later');
  });
  test(`${scope}: actualizar después de una mutación invalida la lectura anterior`, async () => {
    const scenario = fixture(scope);
    const old = scenario.refresh();
    const forced = scenario.refresh(true);
    assert.equal(scenario.requests.length, 2);
    scenario.requests[1].resolve(scenario.response('fresh'));
    await forced;
    scenario.requests[0].resolve(scenario.response('stale'));
    await old;
    assert.equal(scenario.visible(), 'fresh');
  });
  test(`${scope}: reiniciar efecto no comparte una lectura invalidada`, async () => {
    const scenario = fixture(scope);
    const old = scenario.refresh();
    const counter = scope === 'AutomationInbox' ? scenario.ctx.queryRef : scenario.ctx.requestRef;
    counter.current++;
    const restarted = scenario.refresh();
    assert.equal(scenario.requests.length, 2);
    scenario.requests[0].resolve(scenario.response('stale'));
    await old;
    assert.equal(scenario.visible(), undefined);
    scenario.requests[1].resolve(scenario.response('fresh'));
    await restarted;
    assert.equal(scenario.visible(), 'fresh');
  });
  test(`${scope}: recuperar foco o visibilidad refresca y limpia listeners al salir`, () => {
    const windowListeners = new Map();
    const documentListeners = new Map();
    let refreshes = 0;
    const ctx = {
      refresh: () => { refreshes++; }, queryRef: { current: 0 }, requestRef: { current: 0 }, aliveRef: { current: true },
      clearTimeout: () => {}, clearInterval: () => {},
      window: {
        setTimeout: () => 1, setInterval: () => 2,
        addEventListener: (name, callback) => windowListeners.set(name, callback),
        removeEventListener: (name) => windowListeners.delete(name),
      },
      document: {
        visibilityState: 'hidden',
        addEventListener: (name, callback) => documentListeners.set(name, callback),
        removeEventListener: (name) => documentListeners.delete(name),
      },
    };
    vm.createContext(ctx);
    vm.runInContext(expression(scope, true), ctx);
    const cleanup = ctx.callback();
    windowListeners.get('focus')();
    assert.equal(refreshes, 0);
    ctx.document.visibilityState = 'visible';
    documentListeners.get('visibilitychange')();
    windowListeners.get('focus')();
    assert.equal(refreshes, 2);
    cleanup();
    assert.equal(windowListeners.size, 0);
    assert.equal(documentListeners.size, 0);
  });
}
