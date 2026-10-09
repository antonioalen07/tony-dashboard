import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as curation from './reel-curation.ts';

// Ejecutar el módulo real permite resolver el alias de Next sin cargar la app
// ni reemplazar la lógica por una copia que podría divergir de producción.
const exported = {};
const source = ts.transpileModule(fs.readFileSync(new URL('./automation-data.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('exports', 'require', source)(exported, (name) => {
    assert.equal(name, '@/lib/reel-curation');
    return curation;
});
const { automationDataError, optionalAutomationData, loadAutomationMedia, leadSearchFilter } = exported;

function fakeDb(responses) {
    const calls = [];
    return { calls, from(table) {
        const query = { then(resolve, reject) { return Promise.resolve(responses[table]).then(resolve, reject); } };
        for (const method of ['select', 'not', 'order', 'limit', 'eq'])
            query[method] = (...args) => { calls.push({ table, method, args }); return query; };
        return query;
    } };
}

test('los reels siguen disponibles si falla la cola de publicaciones opcional', async () => {
    const db = fakeDb({
        reels: { data: [{ instagram_id: '17999999999999999', title: 'Propio' }, { instagram_id: '3199999999999999999', title: 'Apify' }], error: null },
        publish_queue: { data: null, error: { code: '42703', message: 'internal schema with sensitive detail' } },
    });
    const data = await loadAutomationMedia(db);
    assert.equal(data.reels.length, 1);
    assert.equal(data.reels[0].title, 'Propio');
    assert.deepEqual(data.pending, []);
    assert.match(data.warnings[0], /Publicaciones programadas/);
    assert.match(data.warnings[0], /supabase_migration_automations_crm.sql/);
    assert.doesNotMatch(data.warnings[0], /sensitive detail/);
    const excluded = db.calls.findIndex((call) => call.table === 'reels' && call.method === 'not');
    assert.ok(excluded >= 0, 'los IDs de Apify se excluyen en la consulta');
    assert.equal(db.calls.some((call) => call.table === 'reels' && call.method === 'limit'), false, 'el cupo se aplica después de filtrar marcas opcionales');
});

test('las publicaciones programadas siguen disponibles si falla la carga de reels', async () => {
    const db = fakeDb({
        reels: { data: null, error: { code: '42501' } },
        publish_queue: { data: [{ id: 'pending', caption: 'Nueva publicación' }], error: null },
    });
    const data = await loadAutomationMedia(db);
    assert.deepEqual(data.reels, []);
    assert.equal(data.pending.length, 1);
    assert.match(data.warnings[0], /SUPABASE_SERVICE_ROLE_KEY/);
});

test('marcas opcionales se filtran antes del cupo y no ocultan reels con sólo transcripción desactivada', async () => {
    const hidden = Array.from({ length: 210 }, (_, i) => ({ instagram_id: String(17000000000000000n + BigInt(i)), is_hidden: true }));
    const db = fakeDb({
        reels: { data: [...hidden, { instagram_id: '17999999999999991', is_duplicate: true }, { instagram_id: '17999999999999992', transcript_suppressed: true }, { instagram_id: '17999999999999993', title: 'Legacy sin marcas' }], error: null },
        publish_queue: { data: [], error: null },
    });
    const data = await loadAutomationMedia(db);
    assert.deepEqual(data.reels.map((reel) => reel.instagram_id), ['17999999999999992', '17999999999999993']);
    assert.equal(db.calls.find((call) => call.table === 'reels' && call.method === 'select').args[0], '*', 'esquemas sin columnas nuevas siguen legibles');
});

test('estadísticas ausentes o una desconexión no bloquean la consulta principal', async () => {
    const missing = await optionalAutomationData(Promise.resolve({ data: null, error: { code: 'PGRST202' } }), [], 'Estadísticas');
    assert.deepEqual(missing.data, []);
    assert.match(missing.warnings[0], /supabase_migration_automations.sql/);
    const offline = await optionalAutomationData(Promise.reject(new Error('token=secret')), [], 'Estadísticas');
    assert.deepEqual(offline.data, []);
    assert.match(offline.warnings[0], /conectar con Supabase/);
    assert.doesNotMatch(offline.warnings[0], /secret/);
});

test('columnas faltantes del CRM generan un error de migración accionable y seguro', () => {
    const error = automationDataError({ code: '42703', message: 'column leads_2.username does not exist' }, 'followups');
    assert.equal(error.status, 428);
    assert.equal(error.migrationNeeded, true);
    assert.equal(error.migrationFile, 'supabase_migration_automations_crm.sql');
    assert.match(error.error, /Supabase/);
    assert.doesNotMatch(error.error, /leads_2/);
});

test('búsqueda por nombre, usuario y notas preserva comas, comillas y guiones bajos sin operadores', () => {
    assert.equal(leadSearchFilter('  '), '');
    assert.equal(leadSearchFilter('ana'), 'username.ilike."%ana%",display_name.ilike."%ana%",notes.ilike."%ana%"');
    const search = leadSearchFilter('ana_b, "ventas"');
    assert.equal(search, 'username.ilike."%ana\\\\_b, \\"ventas\\"%",display_name.ilike."%ana\\\\_b, \\"ventas\\"%",notes.ilike."%ana\\\\_b, \\"ventas\\"%"');
});
