import test from 'node:test';
import assert from 'node:assert/strict';
import { automationDataError, optionalAutomationData, loadAutomationMedia, leadSearchFilter } from './automation-data.ts';

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
    const limited = db.calls.findIndex((call) => call.table === 'reels' && call.method === 'limit');
    assert.ok(excluded >= 0 && excluded < limited, 'los IDs de Apify se excluyen antes del límite');
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
