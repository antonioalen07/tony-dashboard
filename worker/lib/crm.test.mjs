import test from 'node:test';
import assert from 'node:assert/strict';
import { inboundMessage, receiveMessage, pickStoryAutomation, deliverCrm } from './crm.mjs';
import { run } from '../jobs/automations.mjs';

const account = 'connected-account';
const recent = () => new Date(Date.now() - 1000).toISOString();
const rule = (fields = {}) => ({ id: 'rule', active: true, keywords: ['guia'], match_mode: 'contains', fuzzy: true, starts_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', once_per_user: true, dm_text: 'Acá tenés la guía', dm_audio_url: null, ...fields });
const inbound = (fields = {}) => ({ sender: { id: 'visitor' }, recipient: { id: account }, timestamp: Date.now() - 1000, message: { mid: 'incoming-mid', text: 'Quiero la guía' }, ...fields });

function memoryDb(tables, { failUpdate } = {}) {
    return {
        from(table) {
            const filters = [];
            let mode = 'read', fields, limit = Infinity;
            const query = {
                select() { return query; },
                update(value) { mode = 'update'; fields = value; return query; },
                eq(key, value) { filters.push((row) => row[key] === value); return query; },
                neq(key, value) { filters.push((row) => row[key] !== value); return query; },
                in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
                limit(value) { limit = value; return query; },
                single: () => query.then((result) => result.error ? result : ({ data: result.data[0], error: null })),
                maybeSingle: () => query.then((result) => result.error ? result : ({ data: result.data[0] || null, error: null })),
                then(resolve) {
                    const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row))).slice(0, limit);
                    if (mode === 'update' && failUpdate?.(table, fields)) return Promise.resolve({ data: null, error: { code: 'XX000', message: 'No se pudo persistir el resultado' } }).then(resolve);
                    if (mode === 'update') rows.forEach((row) => Object.assign(row, fields));
                    return Promise.resolve({ data: rows, error: null }).then(resolve);
                },
            };
            return query;
        },
        async rpc(name) {
            if (name === 'automation_auto_enroll') return { data: null, error: null };
            assert.equal(name, 'automation_claim');
            for (const [kind, table] of [['inbox', 'inbox_outbox'], ['story', 'story_automation_events'], ['comment', 'automation_events'], ['followup', 'followup_jobs']]) {
                const item = (tables[table] || []).find((row) => row.status === 'queued');
                if (item) { item.status = 'sending'; return { data: { kind, id: item.id }, error: null }; }
            }
            return { data: null, error: null };
        },
    };
}

function deliveryFixture(kind, { lead = {}, automation = {}, item = {}, prior = [] } = {}) {
    const table = kind === 'story' ? 'story_automation_events' : 'inbox_outbox';
    const job = { id: 'job', lead_id: 'lead', automation_id: 'rule', status: 'sending', attempts: 0, kind: 'text', text: 'Respuesta manual', ...item };
    const tables = {
        [table]: [job, ...prior],
        leads: [{ id: 'lead', ig_account_id: account, instagram_user_id: 'visitor', opted_out: false, last_inbound_at: recent(), ...lead }],
        story_automations: [rule(automation)],
    };
    const sends = [];
    const meta = { accountId: account, async send(payload) { sends.push(payload); return { message_id: 'outgoing-mid' }; } };
    return { tables, job, sends, meta, db: memoryDb(tables) };
}

test('CRM: parsea DM, audio entrante y respuesta a historia conservando el ID del remitente', () => {
    const event = inbound({ message: { mid: 'story-mid', text: 'Guía', attachments: [{ type: 'audio', payload: { url: 'https://example.com/voice.mp3', extra: 'ignored' } }, { type: 'image', payload: {} }], reply_to: { story: { id: 'story-id', url: 'https://example.com/story.jpg' } } } });
    assert.deepEqual(inboundMessage(event, account), {
        user: 'visitor', mid: 'story-mid', text: 'Guía', at: new Date(event.timestamp).toISOString(), storyId: 'story-id',
        attachments: [{ type: 'audio', payload: { url: 'https://example.com/voice.mp3' } }, { type: 'image', payload: { url: null } }],
    });
    const textOnly = inboundMessage(inbound(), account);
    assert.equal(textOnly.storyId, null);
    assert.deepEqual(textOnly.attachments, []);
    const mediaOnly = inboundMessage(inbound({ message: { mid: 'audio-only', attachments: [{ type: 'audio', payload: { url: 'https://example.com/a.mp3' } }] } }), account);
    assert.equal(mediaOnly.text, '');
    assert.equal(mediaOnly.attachments[0].type, 'audio');
});

test('CRM: descarta echoes, otra cuenta, remitente propio y eventos sin identidad o fecha', () => {
    for (const event of [
        inbound({ message: { mid: 'echo', is_echo: true } }),
        inbound({ recipient: { id: 'other-account' } }),
        inbound({ sender: { id: account } }),
        inbound({ sender: {} }),
        inbound({ message: { text: 'Sin mid' } }),
        inbound({ timestamp: 0 }),
        inbound({ timestamp: -1 }),
        inbound({ timestamp: 'invalid' }),
        inbound({ timestamp: Number.NaN }),
        inbound({ timestamp: Number.POSITIVE_INFINITY }),
        inbound({ timestamp: Date.now() + 120000 }),
        inbound({ message: undefined }),
    ]) assert.equal(inboundMessage(event, account), null);
    const future = inboundMessage(inbound({ timestamp: Date.now() + 30000 }), account);
    assert.ok(Date.parse(future.at) <= Date.now(), 'la tolerancia de reloj no abre una ventana futura');
    const many = inboundMessage(inbound({ message: { mid: 'many', attachments: Array.from({ length: 30 }, () => ({ type: 'image', payload: { url: 'https://example.com/image.jpg' } })) } }), account);
    assert.equal(many.attachments.length, 20);
});

test('CRM: una regla de keyword tiene prioridad sobre la regla general y respeta fecha y estado', () => {
    const at = '2026-10-07T12:00:00Z';
    const general = rule({ id: 'general', keywords: [], created_at: '2026-01-01T00:00:00Z' });
    const specific = rule({ id: 'specific', created_at: '2026-02-01T00:00:00Z' });
    const later = rule({ id: 'later', created_at: '2026-03-01T00:00:00Z' });
    assert.equal(pickStoryAutomation('Pasame la GUÍA', [general, later, specific], at).id, 'specific');
    assert.equal(pickStoryAutomation('Otra consulta', [specific, general], at).id, 'general');
    assert.equal(pickStoryAutomation('', [general], at).id, 'general', 'una respuesta sin texto puede activar una regla general');
    assert.equal(pickStoryAutomation('Guía', [rule({ active: false }), rule({ starts_at: '2026-10-08T12:00:00Z' })], at), null);
    assert.equal(pickStoryAutomation('Guía', [specific], 'fecha-inválida'), null);
});

test('CRM: persiste DM normal sin regla y encola sólo respuestas con contexto de historia', async () => {
    const calls = [];
    const db = { async rpc(name, args) { calls.push({ name, args }); return { data: null, error: null }; } };
    const message = inboundMessage(inbound(), account);
    await receiveMessage(db, message, account, [rule()]);
    assert.equal(calls[0].name, 'crm_receive_message');
    assert.equal(calls[0].args.p_rule, null);
    assert.equal(calls[0].args.p_story_id, null);
    await receiveMessage(db, { ...message, storyId: 'story-id' }, account, [rule({ id: 'specific' }), rule({ id: 'general', keywords: [] })]);
    assert.equal(calls[1].args.p_rule, 'specific');
    assert.equal(calls[1].args.p_story_id, 'story-id');
    assert.equal(calls[1].args.p_account, account);
    assert.equal(calls[1].args.p_mid, 'incoming-mid');
    await assert.rejects(receiveMessage({ async rpc() { return { data: null, error: { message: 'Sin conexión', code: '08006' } }; } }, message, account, []), (error) => error.code === '08006');
});

test('CRM: DM manual e historia envían texto o audio nativo y guardan confirmación', async () => {
    for (const kind of ['inbox', 'story']) {
        for (const audio of [false, true]) {
            const fixture = deliveryFixture(kind, {
                item: audio ? { kind: 'audio', text: null, audio_url: 'https://example.com/manual.mp3' } : {},
                automation: audio ? { dm_text: '', dm_audio_url: 'https://example.com/story.mp3' } : {},
            });
            await deliverCrm(fixture.db, fixture.meta, kind, fixture.job.id);
            const expected = audio ? { attachment: { type: 'audio', payload: { url: kind === 'story' ? 'https://example.com/story.mp3' : 'https://example.com/manual.mp3' } } } : { text: kind === 'story' ? 'Acá tenés la guía' : 'Respuesta manual' };
            assert.deepEqual(fixture.sends, [{ recipient: { id: 'visitor' }, message: expected }]);
            assert.equal(fixture.job.status, 'sent');
            assert.equal(fixture.job.message_id, 'outgoing-mid');
            assert.ok(Number.isFinite(Date.parse(fixture.job.sent_at)));
        }
    }
});

test('CRM: bloquea texto y audio sin ventana, con optout o con identidad de otra cuenta', async () => {
    for (const kind of ['inbox', 'story']) {
        for (const [lead, reason] of [
            [{ last_inbound_at: new Date(Date.now() - 86400001).toISOString() }, /24 horas/],
            [{ last_inbound_at: null }, /24 horas/],
            [{ last_inbound_at: new Date(Date.now() + 60000).toISOString() }, /24 horas/],
            [{ opted_out: true }, /no recibir/],
            [{ ig_account_id: 'other-account' }, /Instagram conectado/],
            [{ instagram_user_id: null }, /Instagram conectado/],
        ]) {
            const fixture = deliveryFixture(kind, { lead, item: { kind: 'audio', audio_url: 'https://example.com/a.mp3' } });
            await deliverCrm(fixture.db, fixture.meta, kind, fixture.job.id);
            assert.equal(fixture.sends.length, 0);
            assert.equal(fixture.job.status, 'blocked');
            assert.match(fixture.job.error, reason);
        }
    }
});

test('CRM: historia pausada o con un envío previo confirmado/incierto no responde de nuevo', async () => {
    for (const fixture of [
        deliveryFixture('story', { automation: { active: false } }),
        ...['sent', 'uncertain'].map((status) => deliveryFixture('story', { prior: [{ id: 'prior', automation_id: 'rule', lead_id: 'lead', status }] })),
    ]) {
        await deliverCrm(fixture.db, fixture.meta, 'story', fixture.job.id);
        assert.equal(fixture.sends.length, 0);
        assert.equal(fixture.job.status, 'blocked');
    }
    const repeat = deliveryFixture('story', { automation: { once_per_user: false }, prior: [{ id: 'prior', automation_id: 'rule', lead_id: 'lead', status: 'sent' }] });
    await deliverCrm(repeat.db, repeat.meta, 'story', repeat.job.id);
    assert.equal(repeat.sends.length, 1);
    const otherLead = deliveryFixture('story', { prior: [{ id: 'prior', automation_id: 'rule', lead_id: 'someone-else', status: 'sent' }] });
    await deliverCrm(otherLead.db, otherLead.meta, 'story', otherLead.job.id);
    assert.equal(otherLead.sends.length, 1);
});

test('CRM: si Meta envió pero falla persistir, el resultado es incierto y el worker no reenvía', async () => {
    for (const kind of ['inbox', 'story']) {
        const fixture = deliveryFixture(kind);
        const db = memoryDb(fixture.tables, { failUpdate: (_table, fields) => fields.status === 'sent' });
        await assert.rejects(deliverCrm(db, fixture.meta, kind, fixture.job.id), (error) => error.uncertain === true);
        assert.equal(fixture.sends.length, 1);
        assert.equal(fixture.job.status, 'sending');
    }
    const fixture = deliveryFixture('inbox', { item: { status: 'queued' } });
    const db = memoryDb(fixture.tables, { failUpdate: (_table, fields) => fields.status === 'sent' });
    const originalFetch = globalThis.fetch;
    let sends = 0;
    globalThis.fetch = async (url, options) => {
        if (new URL(url).pathname.endsWith('/messages')) {
            sends++;
            assert.deepEqual(JSON.parse(options.body).recipient, { id: 'visitor' });
            return new Response(JSON.stringify({ message_id: 'confirmed-send' }));
        }
        return new Response(JSON.stringify({ access_token: 'mock-page-token' }));
    };
    try {
        const ctx = { supabase: db, env: { META_ACCESS_TOKEN: 'mock-system-token', META_PAGE_ID: 'page', META_IG_ACCOUNT_ID: account }, log: () => {} };
        await run(ctx);
        assert.equal(fixture.job.status, 'uncertain');
        assert.equal(fixture.job.attempts, 1);
        assert.equal(sends, 1);
        await run(ctx);
        assert.equal(sends, 1, 'el siguiente tick no repite un DM confirmado cuya persistencia falló');
    } finally { globalThis.fetch = originalFetch; }
});
