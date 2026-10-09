import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { buildChatContext, boundedHistory, CHAT_LIMITS, normalizeTranscript, validateMessages } from '../src/lib/chat-context.ts';

// Resolve only the settings module's dependencies; no Supabase connection or secrets.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/utils/supabase') return { url: 'data:text/javascript,export const supabase = { from: (...args) => globalThis.__chatTestDb.from(...args) };', shortCircuit: true };
  if (specifier === '@/lib/auth') return { url: 'data:text/javascript,export const requireRole = (...args) => globalThis.__chatTestAuth(...args);', shortCircuit: true };
  if (specifier === '@/lib/llm') return { url: 'data:text/javascript,export const LLM_MODEL = "mock-model"; export const LLM_PROVIDER = "mock"; export const hasLLMKey = () => true; export const llm = { chat: { completions: { create: (...args) => globalThis.__chatTestCompletion(...args) } } };', shortCircuit: true };
  if (specifier === '@/lib/aiSettings') return { url: new URL('../src/lib/aiSettings.ts', import.meta.url).href, shortCircuit: true };
  if (specifier === '@/lib/chat-context') return { url: new URL('../src/lib/chat-context.ts', import.meta.url).href, shortCircuit: true };
  if (specifier === '@/lib/promptConfig') return { url: new URL('../src/lib/promptConfig.ts', import.meta.url).href, shortCircuit: true };
  if (specifier === '@/lib/brand') return { url: new URL('../src/lib/brand.ts', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { loadBlocks } = await import('../src/lib/aiSettings.ts');
const { composeChatSystemPrompt } = await import('../src/lib/promptConfig.ts');
const chatRoute = await import('../src/app/api/chat/route.ts');
const reel = (id, overrides = {}) => ({ instagram_id: String(id), title: `Reel ${id}`, views: 2000, transcript: `Guion completo ${id}`, ...overrides });
function fakeSettings(result) {
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return result; } };
  return { from(table) { assert.equal(table, 'ai_settings'); return query; } };
}

test('las banderas excluyen también caption y análisis; instalaciones antiguas siguen funcionando', () => {
  const result = buildChatContext([
    reel(1), reel(2, { is_hidden: true, title: 'contenido oculto privado' }),
    reel(3, { is_duplicate: true }), reel(4, { transcript_suppressed: true, transcript: null, ai_analysis: ['análisis suprimido'] }),
    reel('1234567890123456789'),
  ], 'instrucciones');
  assert.equal(result.stats.selectedScripts, 1);
  assert.equal(result.stats.excludedFlags, 3);
  assert.equal(result.stats.excludedLegacy, 1);
  assert.doesNotMatch(result.dossier, /oculto privado|análisis suprimido/);
});
test('un solo guion conserva las métricas de varias publicaciones y no confunde prefijos', () => {
  const result = buildChatContext([reel(1, { transcript: '  Mismo\n GUION ', views: 900 }), reel(2, { transcript: 'mismo guion', views: 5000, bookings: 4, qualified_leads: 2 }), reel(3, { transcript: 'mismo guion con final distinto' })], 'base');
  assert.equal(result.stats.uniqueScripts, 2);
  assert.equal(result.stats.publications, 3);
  assert.equal(result.stats.deduplicatedPublications, 1);
  assert.match(result.dossier, /agendas 4 · leads calificados 2/);
  assert.equal((result.dossier.match(/Transcripción completa/g) || []).length, 2);
  assert.equal(normalizeTranscript(' A\nB '), 'a b');
});
test('transcripciones mayores a 1200 entran completas y las que no caben quedan fuera con cobertura explícita', () => {
  const complete = `${'palabra '.repeat(300)}CTA final que debe conservarse`;
  const result = buildChatContext([reel(1, { transcript: complete }), reel(2, { transcript: 'fuera '.repeat(15_000), title: 'no cabe' })], 'base');
  assert.match(result.dossier, /CTA final que debe conservarse/);
  assert.doesNotMatch(result.dossier, /no cabe/);
  assert.equal(result.stats.omittedScripts, 1);
  assert.ok(result.stats.inputChars <= CHAT_LIMITS.inputChars);
});
test('muestra de contraste verdadera cuando todas las publicaciones están bajo el umbral', () => {
  const result = buildChatContext(Array.from({ length: 10 }, (_, i) => reel(i, { views: i })), 'base');
  assert.equal(result.stats.selectedScripts, 5);
  assert.equal(result.stats.contrastScripts, 5);
  assert.doesNotMatch(result.dossier, /ya pasó esa barra|se consideran fallidos/);
  assert.match(result.dossier, /no clasifiques automáticamente/);
});
test('una pregunta específica recupera un guion fuera del top y de la muestra de contraste', () => {
  const rows = Array.from({ length: 40 }, (_, i) => reel(i, { views: 10000 - i, transcript: `Estrategia común ${i}` }));
  rows.push(reel(99, { views: 3, transcript: 'Cómo configurar Perplexity Spaces con documentos propios' }));
  const result = buildChatContext(rows, 'base', [{ role: 'user', content: 'Buscá mi reel sobre Perplexity Spaces' }]);
  assert.match(result.dossier, /Perplexity Spaces/);
  assert.ok(result.stats.relevantScripts > 0);
  assert.ok(result.stats.selectedScripts <= CHAT_LIMITS.groups);
});
test('historial largo queda acotado sin perder la última pregunta; respuestas viejas enormes no bloquean', () => {
  const history = Array.from({ length: 500 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Mensaje ${i}` }));
  history[1].content = 'antiguo '.repeat(5000);
  history.push({ role: 'user', content: 'Última pregunta exacta' });
  const validated = validateMessages(history);
  const bounded = boundedHistory(validated);
  assert.deepEqual(bounded.messages.at(-1), history.at(-1));
  assert.ok(bounded.messages.length <= CHAT_LIMITS.historyMessages);
  assert.equal(bounded.omitted, history.length - bounded.messages.length);
  assert.equal(bounded.messages[0].role, 'user');
  assert.throws(() => validateMessages([{ role: 'user', content: 'x'.repeat(CHAT_LIMITS.messageChars + 1) }]));
});
test('presupuesto total respeta entrenamiento más historial más dossier', () => {
  const rows = Array.from({ length: 80 }, (_, i) => reel(i, { transcript: `${i} ${'texto '.repeat(900)}` }));
  const messages = [{ role: 'user', content: 'p'.repeat(5000) }, { role: 'assistant', content: 'r'.repeat(5000) }, { role: 'user', content: 'pregunta final' }];
  const result = buildChatContext(rows, 'entrenamiento '.repeat(1200), messages);
  assert.ok(result.stats.inputChars <= CHAT_LIMITS.inputChars);
  assert.ok(result.stats.omittedScripts > 0);
  assert.equal(result.history.at(-1).content, 'pregunta final');
});
test('entrenamiento editado reemplaza defaults y bloques guardados vacíos permanecen apagados', async () => {
  const loaded = await loadBlocks(fakeSettings({ data: { blocks: { voz: '', embudo: '', identidad: '', reglas: 'REGLA EDITADA ÚNICA' }, updated_at: '2026-09-19T19:33:16.287Z' }, error: null }));
  const prompt = composeChatSystemPrompt(loaded.blocks);
  assert.equal(loaded.source, 'saved');
  assert.equal(loaded.updatedAt, '2026-09-19T19:33:16.287Z');
  assert.equal(loaded.blocks.voz, '');
  assert.equal(loaded.blocks.embudo, '');
  assert.match(prompt, /REGLA EDITADA ÚNICA/);
  assert.doesNotMatch(prompt, /TOF 60%|## VOZ Y TONO|## QUIÉN SOS Y QUÉ OFRECÉS/);
});
test('sólo una tabla realmente ausente permite defaults; error de acceso/red falla sin revelar detalle', async () => {
  const missing = await loadBlocks(fakeSettings({ data: null, error: { code: 'PGRST205' } }));
  assert.equal(missing.source, 'missing_table');
  assert.equal(missing.tableMissing, true);
  for (const code of ['42501', '08006', 'PGRST301', '42703']) {
    await assert.rejects(loadBlocks(fakeSettings({ data: null, error: { code, message: 'token private content' } })), (error) => /entrenamiento guardado/.test(error.message) && !/token|private content/.test(error.message));
  }
});

function setupRoute() {
  const calls = [];
  const data = {
    ai_settings: { data: { blocks: { voz: '', reglas: 'instrucción privada editada' }, updated_at: '2026-09-19T19:33:16.287Z' }, error: null },
    reels: { data: [reel(1, { transcript: 'transcripción privada completa' })], error: null, count: 1 },
  };
  globalThis.__chatTestDb = { from(table) {
    calls.push(table);
    const query = { then(resolve, reject) { return Promise.resolve(data[table]).then(resolve, reject); }, maybeSingle() { return Promise.resolve(data[table]); } };
    for (const method of ['select', 'eq', 'order', 'range']) query[method] = () => query;
    return query;
  } };
  globalThis.__chatTestAuth = async () => ({ ok: true });
  const completions = [];
  globalThis.__chatTestCompletion = async (request) => {
    completions.push(request);
    return { choices: [{ message: { content: 'respuesta simulada' }, finish_reason: 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 20 } };
  };
  return { calls, completions, data };
}
test('diagnóstico GET no llama al modelo y no devuelve instrucciones o transcripciones privadas', async () => {
  const fake = setupRoute();
  const response = await chatRoute.GET(new Request('http://localhost/api/chat/context'));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.training.source, 'saved');
  assert.equal(data.training.updatedAt, '2026-09-19T19:33:16.287Z');
  assert.ok(data.training.disabledBlocks.includes('voz'));
  assert.equal(data.database.totalReels, 1);
  assert.equal(data.stats.transcribedScripts, 1);
  assert.equal(fake.completions.length, 0);
  assert.doesNotMatch(JSON.stringify(data), /instrucción privada|transcripción privada/);
});
test('ruta exige sesión antes de consultar el contexto', async () => {
  const fake = setupRoute();
  globalThis.__chatTestAuth = async () => ({ ok: false, res: new Response('No autorizado', { status: 401 }) });
  const response = await chatRoute.GET(new Request('http://localhost/api/chat/context'));
  assert.equal(response.status, 401);
  assert.equal(fake.calls.length, 0);
  assert.equal(fake.completions.length, 0);
});
test('POST simulado usa entrenamiento guardado y la última pregunta en el mismo contexto que diagnostica', async () => {
  const fake = setupRoute();
  const request = new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Pregunta nueva' }] }) });
  const response = await chatRoute.POST(request);
  assert.equal(response.status, 200);
  assert.equal(fake.completions.length, 1);
  assert.match(fake.completions[0].messages[0].content, /instrucción privada editada/);
  assert.doesNotMatch(fake.completions[0].messages[0].content, /## VOZ Y TONO/);
  assert.match(fake.completions[0].messages[1].content, /transcripción privada completa/);
  assert.equal(fake.completions[0].messages.at(-1).content, 'Pregunta nueva');
  const data = await response.json();
  assert.equal(data.reply, 'respuesta simulada');
  assert.deepEqual(data.usage, { inputTokens: 500, outputTokens: 20 });
});
