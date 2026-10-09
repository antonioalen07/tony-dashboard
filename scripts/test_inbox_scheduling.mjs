import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import * as validation from '../src/lib/automation-validation.ts';
import { scheduledSendAt, localDateTime } from '../src/lib/inbox-schedule.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/app/api/automations/inbox/[[...path]]/route.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const leadId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';

function fixture(fields = {}) {
    const lead = { id: leadId, ig_account_id: 'account', instagram_user_id: '12345', opted_out: false, last_inbound_at: null, ...fields };
    const rows = [];
    const db = { from(table) {
        let operation = 'read'; let payload;
        const filters = [];
        const execute = () => {
            if (table === 'leads') return { data: lead, error: null };
            const selected = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
            if (operation === 'insert') {
                const row = { id: messageId, ...payload }; rows.push(row);
                return { data: row, error: null };
            }
            if (operation === 'delete') {
                for (const row of selected) rows.splice(rows.indexOf(row), 1);
                return { data: selected.map(({ id }) => ({ id })), error: null };
            }
            return { data: selected[0] || null, error: null };
        };
        const query = {
            select() { return query; },
            eq(key, value) { filters.push([key, value]); return query; },
            insert(value) { operation = 'insert'; payload = value; return query; },
            delete() { operation = 'delete'; return query; },
            maybeSingle: async () => execute(), single: async () => execute(),
            then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
        };
        return query;
    } };
    const compiledRoute = { exports: {} };
    runInNewContext(code, { module: compiledRoute, exports: compiledRoute.exports, Request, Response, URL, Date, crypto: webcrypto, Buffer,
        process: { env: { META_IG_ACCOUNT_ID: 'account', SUPABASE_SERVICE_ROLE_KEY: 'test-only' } },
        require(name) {
            if (name === '@/lib/auth') return { requireRole: async () => ({ ok: true }) };
            if (name === '@/lib/automation-validation') return validation;
            if (name === '@/lib/inbox-schedule') return { scheduledSendAt };
            if (name === '@/lib/automation-data') return { leadSearchFilter: () => '' };
            if (name === '@/lib/storage') return { uploadStudioObject: () => { throw new Error('No usar Storage real en esta prueba'); } };
            if (name === '@/utils/supabase') return { supabase: db };
            return require(name);
        },
    });
    const request = (body) => compiledRoute.exports.POST(new Request('https://bako.example/api/automations/inbox/contact/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ path: [leadId, 'messages'] }) });
    const cancel = () => compiledRoute.exports.DELETE(new Request('https://bako.example/api/automations/inbox/contact/messages/message', { method: 'DELETE' }), { params: Promise.resolve({ path: [leadId, 'messages', messageId] }) });
    return { request, cancel, rows };
}

test('programación valida fechas con zona horaria, futuro y máximo de un año', () => {
    const now = Date.parse('2026-10-09T12:00:00Z');
    assert.equal(scheduledSendAt(undefined, now), null);
    assert.equal(scheduledSendAt('2026-10-10T10:00:00-03:00', now), '2026-10-10T13:00:00.000Z');
    for (const value of ['invalid', '2026-10-10T10:00', '2026-10-08T12:00:00Z', '2028-01-01T12:00:00Z']) assert.throws(() => scheduledSendAt(value, now));
    assert.match(localDateTime(now), /^2026-10-09T\d{2}:00$/);
});

test('API programa para dentro de tres días sin inventar una ventana de respuesta', async () => {
    const f = fixture();
    const scheduled = new Date(Date.now() + 3 * 86400000).toISOString();
    const response = await f.request({ client_id: clientId, kind: 'text', text: 'Seguimiento', scheduled_at: scheduled });
    assert.equal(response.status, 202);
    assert.equal(f.rows[0].next_attempt_at, scheduled);
    assert.equal(f.rows[0].status, 'queued');
    assert.equal(f.rows.length, 1);
});

test('API rechaza inmediato fuera de ventana y programación a opt-out u otra cuenta', async () => {
    assert.equal((await fixture().request({ kind: 'text', text: 'Hola' })).status, 409);
    const scheduled = new Date(Date.now() + 86400000).toISOString();
    for (const lead of [{ opted_out: true }, { ig_account_id: 'another' }, { instagram_user_id: null }]) {
        const f = fixture(lead);
        assert.equal((await f.request({ kind: 'text', text: 'Hola', scheduled_at: scheduled })).status, 409);
        assert.equal(f.rows.length, 0);
    }
});

test('el mismo client_id recupera el envío tras un timeout sin duplicarlo', async () => {
    const f = fixture();
    const payload = { client_id: clientId, kind: 'text', text: 'Hola', scheduled_at: new Date(Date.now() + 86400000).toISOString() };
    assert.equal((await f.request(payload)).status, 202);
    assert.equal((await f.request(payload)).status, 202);
    assert.equal(f.rows.length, 1);
    assert.equal((await f.request({ ...payload, text: 'Distinto' })).status, 409);
});

test('cancelar elimina sólo el mensaje pendiente, nunca un envío ya reclamado', async () => {
    const f = fixture();
    await f.request({ kind: 'text', text: 'Hola', scheduled_at: new Date(Date.now() + 86400000).toISOString() });
    f.rows[0].status = 'sending';
    assert.equal((await f.cancel()).status, 409);
    assert.equal(f.rows.length, 1);
    f.rows[0].status = 'queued';
    assert.equal((await f.cancel()).status, 200);
    assert.equal(f.rows.length, 0);
});

test('UI permite recuperar el mismo mensaje programado tras la fecha elegida y un timeout', async () => {
    const ui = ts.createSourceFile('AutomationInbox.tsx', readFileSync(new URL('../src/components/AutomationInbox.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const conversation = ui.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'Conversation');
    const send = conversation.body.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'sendMessage');
    const callback = ts.transpileModule(`globalThis.sendCallback=(${send.getText(ui)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const when = new Date(Date.now() - 60000).toISOString();
    const requests = []; const errors = [];
    const payload = { kind: 'text', text: 'Hola', scheduled_at: when };
    const ctx = { busy: false, recording: false, preparingAudio: false, requestingMicrophone: false,
        delivery: 'scheduled', scheduledAt: when, audioUrl: '', audioFile: null, kind: 'text', text: 'Hola', id: leadId,
        sendRef: { current: { signature: JSON.stringify(payload), id: clientId } }, Date, crypto: webcrypto, scheduledSendAt,
        date: (value) => value, api: async (path, method, body) => { requests.push({ path, method, body }); },
        refresh: async () => {}, onChanged() {}, clearAudio() {}, setBusy() {}, setError() {}, setNotice() {}, setText() {}, setDelivery() {}, setScheduledAt() {}, report(error) { errors.push(error); },
    };
    runInNewContext(callback, ctx);
    await ctx.sendCallback({ preventDefault() {} });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.client_id, clientId);
    assert.equal(errors.length, 0);
    ctx.text = 'Distinto';
    await ctx.sendCallback({ preventDefault() {} });
    assert.equal(requests.length, 1, 'un borrador nuevo con fecha pasada no se envía');
    assert.match(errors[0].message, /futuro/);
});
