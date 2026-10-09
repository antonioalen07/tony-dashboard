import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebhookSetup, BAKO_WEBHOOK_CALLBACK_URL } from './webhook-setup.mjs';
import { parseSetupArguments } from '../../scripts/subscribe_webhooks.mjs';

const configuration = { META_APP_ID: '123', META_APP_SECRET: 'test-app-secret', META_ACCESS_TOKEN: 'test-system-token', META_PAGE_ID: '456', META_WEBHOOK_VERIFY_TOKEN: 'test-verify-secret' };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

function fixture(options = {}) {
    const env = { ...configuration, ...options.env };
    const state = { app: structuredClone(options.app || []), page: structuredClone(options.page || []), calls: [], writes: [] };
    const fetcher = async (input, init = {}) => {
        const url = new URL(input);
        const method = init.method || 'GET';
        state.calls.push({ path: url.pathname, origin: url.origin, method });
        if (url.origin === new URL(BAKO_WEBHOOK_CALLBACK_URL).origin) {
            assert.equal(init.redirect, 'error');
            assert.equal(url.searchParams.get('hub.verify_token'), env.META_WEBHOOK_VERIFY_TOKEN);
            if (options.handshakeError) throw new Error('timeout at URL with a private token');
            return new Response(options.handshakeText ?? url.searchParams.get('hub.challenge'), { status: options.handshakeStatus || 200 });
        }
        assert.equal(url.origin, 'https://graph.facebook.com');
        assert.equal(init.headers.Authorization, `Bearer ${env.META_APP_ID}|${env.META_APP_SECRET}`);
        assert.equal(url.searchParams.has('access_token'), false);
        if (url.pathname.endsWith('/debug_token')) {
            assert.equal(url.searchParams.get('input_token'), env.META_ACCESS_TOKEN);
            return response({ data: { is_valid: true, app_id: options.tokenAppId || env.META_APP_ID } });
        }
        assert.ok(url.pathname.endsWith('/subscriptions'));
        if (method === 'GET') {
            if (options.appReadError) return response({ error: { code: 100, message: options.appReadError } }, 400);
            return response({ data: state.app });
        }
        assert.equal(method, 'POST');
        assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
        const body = Object.fromEntries(new URLSearchParams(init.body));
        state.writes.push({ resource: 'app', body });
        if (!options.ignoreAppWrite)
            state.app = [...state.app.filter((entry) => entry.object !== 'instagram'), { object: body.object, active: true, callback_url: body.callback_url, fields: body.fields.split(',').map((name) => ({ name, version: 'v23.0' })) }];
        return response({ success: true });
    };
    const meta = {
        pageGet: async (path) => {
            state.calls.push({ path, origin: 'meta-page', method: 'GET' });
            assert.match(path, /subscribed_apps\?fields=id,subscribed_fields$/);
            return { data: state.page };
        },
        post: async (path, body) => {
            state.calls.push({ path, origin: 'meta-page', method: 'POST' });
            assert.equal(path, `${env.META_PAGE_ID}/subscribed_apps`);
            state.writes.push({ resource: 'page', body });
            if (!options.ignorePageWrite)
                state.page = [...state.page.filter((entry) => entry.id !== env.META_APP_ID), { id: env.META_APP_ID, subscribed_fields: body.subscribed_fields.split(',') }];
            return { success: true };
        },
    };
    return { state, setup: createWebhookSetup(env, { fetcher, meta, challenge: () => 'deterministic-challenge' }) };
}

test('CLI: modo predeterminado sólo lectura y flags de escritura explícitos', () => {
    assert.equal(parseSetupArguments([]).mode, 'status');
    assert.equal(parseSetupArguments(['--status']).mode, 'status');
    assert.deepEqual(parseSetupArguments(['--apply', '--callback', BAKO_WEBHOOK_CALLBACK_URL, '--replace-callback']), { mode: 'apply', callback: BAKO_WEBHOOK_CALLBACK_URL, replaceCallback: true, help: false });
    assert.throws(() => parseSetupArguments(['--status', '--apply']), /sin combinarlos/);
    assert.throws(() => parseSetupArguments(['--replace-callback']), /requiere --apply/);
    assert.throws(() => parseSetupArguments(['--callback']), /Completá --callback/);
});

test('status sin verify token sólo consulta y no registra nada', async () => {
    const { setup, state } = fixture({ env: { META_WEBHOOK_VERIFY_TOKEN: undefined } });
    const status = await setup.status();
    assert.equal(status.verify_token_configured, false);
    assert.deepEqual(status.instagram.missing_fields, ['comments', 'messages']);
    assert.deepEqual(status.page.missing_fields, ['feed', 'messages']);
    assert.equal(state.calls.length, 2);
    assert.ok(state.calls.every((call) => call.method === 'GET'));
    assert.deepEqual(state.writes, []);
});

test('apply exige verify token y callback explícito antes de acceder o modificar Meta', async () => {
    const missingVerify = fixture({ env: { META_WEBHOOK_VERIFY_TOKEN: undefined } });
    await assert.rejects(missingVerify.setup.apply({ callback: BAKO_WEBHOOK_CALLBACK_URL }), /META_WEBHOOK_VERIFY_TOKEN/);
    assert.deepEqual(missingVerify.state.calls, []);
    const missingCallback = fixture();
    await assert.rejects(missingCallback.setup.apply(), /Indicá el callback/);
    assert.deepEqual(missingCallback.state.calls, []);
    await assert.rejects(missingCallback.setup.apply({ callback: 'https://another.example/api/webhooks/instagram' }), /callback admitido/);
    assert.deepEqual(missingCallback.state.calls, []);
});

test('handshake fallido o respuesta distinta al challenge impiden toda mutación', async () => {
    for (const options of [{ handshakeStatus: 403 }, { handshakeText: 'different-challenge' }, { handshakeError: true }]) {
        const { setup, state } = fixture(options);
        await assert.rejects(setup.apply({ callback: BAKO_WEBHOOK_CALLBACK_URL }), /No se modificaron suscripciones/);
        assert.deepEqual(state.writes, []);
    }
});

test('access token de otra app impide modificar una integración ajena', async () => {
    const { setup, state } = fixture({ tokenAppId: '999' });
    await assert.rejects(setup.apply({ callback: BAKO_WEBHOOK_CALLBACK_URL }), /no pertenece a META_APP_ID/);
    assert.deepEqual(state.writes, []);
    assert.ok(state.calls.every((call) => call.origin !== new URL(BAKO_WEBHOOK_CALLBACK_URL).origin));
});

test('apply mantiene los campos existentes, otras apps y otros objetos de suscripción', async () => {
    const otherObject = { object: 'page', callback_url: 'https://other.example/webhook', active: true, fields: [{ name: 'feed', version: 'v23.0' }] };
    const otherApp = { id: '999', subscribed_fields: ['leadgen'] };
    const { setup, state } = fixture({
        app: [otherObject, { object: 'instagram', active: true, callback_url: BAKO_WEBHOOK_CALLBACK_URL, fields: [{ name: 'comments', version: 'v23.0' }, { name: 'mentions', version: 'v23.0' }] }],
        page: [otherApp, { id: configuration.META_APP_ID, subscribed_fields: ['feed', 'messaging_postbacks'] }],
    });
    const result = await setup.apply({ callback: BAKO_WEBHOOK_CALLBACK_URL });
    assert.deepEqual(result.changed, ['instagram', 'page']);
    assert.equal(result.handshake_verified, true);
    assert.deepEqual(result.instagram.fields, ['comments', 'mentions', 'messages']);
    assert.deepEqual(result.page.fields, ['feed', 'messaging_postbacks', 'messages']);
    assert.deepEqual(state.app.find((entry) => entry.object === 'page'), otherObject);
    assert.deepEqual(state.page.find((entry) => entry.id === '999'), otherApp);
    const handshake = state.calls.findIndex((call) => call.origin === new URL(BAKO_WEBHOOK_CALLBACK_URL).origin);
    assert.ok(state.calls.slice(0, handshake).every((call) => call.method === 'GET'));
    assert.ok(state.calls.slice(handshake + 1).some((call) => call.method === 'POST'));
    assert.equal(state.calls.filter((call) => call.method === 'GET' && call.path.includes('subscriptions')).length, 2);
    assert.equal(state.calls.filter((call) => call.method === 'GET' && call.path.includes('subscribed_apps')).length, 2);
});

test('suscripciones completas son no-op y se verifican por GET tras el handshake', async () => {
    const { setup, state } = fixture({
        app: [{ object: 'instagram', active: true, callback_url: BAKO_WEBHOOK_CALLBACK_URL, fields: [{ name: 'comments' }, { name: 'messages' }, { name: 'mentions' }] }],
        page: [{ id: configuration.META_APP_ID, subscribed_fields: ['feed', 'messages', 'message_echoes'] }],
    });
    const result = await setup.apply({ callback: BAKO_WEBHOOK_CALLBACK_URL });
    assert.deepEqual(result.changed, []);
    assert.deepEqual(state.writes, []);
    assert.equal(result.handshake_verified, true);
    assert.deepEqual(result.instagram.missing_fields, []);
    assert.deepEqual(result.page.missing_fields, []);
});

test('callback distinto requiere reemplazo explícito y después preserva los campos', async () => {
    const options = { app: [{ object: 'instagram', active: true, callback_url: 'https://previous.example/webhook', fields: [{ name: 'mentions' }] }] };
    const blocked = fixture(options);
    await assert.rejects(blocked.setup.apply({ callback: BAKO_WEBHOOK_CALLBACK_URL }), /--replace-callback/);
    assert.deepEqual(blocked.state.writes, []);
    const allowed = fixture(options);
    const result = await allowed.setup.apply({ callback: BAKO_WEBHOOK_CALLBACK_URL, replaceCallback: true });
    assert.equal(result.instagram.callback_url, BAKO_WEBHOOK_CALLBACK_URL);
    assert.ok(result.instagram.fields.includes('mentions'));
});

test('campos de página fuera del enum abortan sin descartar la configuración existente', async () => {
    const { setup, state } = fixture({ page: [{ id: configuration.META_APP_ID, subscribed_fields: ['unknown_field'] }] });
    await assert.rejects(setup.apply({ callback: BAKO_WEBHOOK_CALLBACK_URL }), /fuera del enum/);
    assert.deepEqual(state.writes, []);
});

test('la verificación posterior rechaza confirmaciones que no aplicaron todos los campos', async () => {
    const { setup } = fixture({ ignorePageWrite: true });
    await assert.rejects(setup.apply({ callback: BAKO_WEBHOOK_CALLBACK_URL }), /verificación posterior/);
});

test('errores de Meta redactan todas las credenciales, variantes URL y verify token', async () => {
    const message = `Rejected ${configuration.META_APP_SECRET} ${configuration.META_ACCESS_TOKEN} ${configuration.META_WEBHOOK_VERIFY_TOKEN} ${encodeURIComponent(`${configuration.META_APP_ID}|${configuration.META_APP_SECRET}`)} https://example.com/?access_token=opaque-page-token&hub.verify_token=${configuration.META_WEBHOOK_VERIFY_TOKEN}`;
    const { setup } = fixture({ appReadError: message });
    await assert.rejects(setup.status(), (error) => {
        assert.match(error.message, /código 100/);
        for (const secret of [...Object.values(configuration).filter((value) => value.startsWith('test-')), 'opaque-page-token'])
            assert.ok(!error.message.includes(secret));
        assert.ok(!error.message.includes('https://'));
        return true;
    });
});
