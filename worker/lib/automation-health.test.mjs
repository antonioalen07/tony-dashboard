import test from 'node:test';
import assert from 'node:assert/strict';
import { getAutomationHealth } from './automation-health.mjs';

const env = { META_ACCESS_TOKEN: 'private-system-token', META_APP_ID: 'app123', META_APP_SECRET: 'private-app-secret', META_WEBHOOK_VERIFY_TOKEN: 'private-verify-token', META_PAGE_ID: 'page123', META_IG_ACCOUNT_ID: 'ig123' };
const callback = 'https://bako.example/api/webhooks/instagram';
const checkedAt = '2026-10-08T12:00:00.000Z';
const subscription = () => ({ object: 'instagram', active: true, callback_url: callback, fields: [{ name: 'comments' }, { name: 'messages' }] });

function metadataDb({ comments = {}, messages = {}, stories = {}, outbox = {} } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const row = { automation_events: comments, lead_messages: messages, story_automations: stories, inbox_outbox: outbox }[table];
      assert.ok(row, `unexpected table ${table}`);
      const schemaOnly = table === 'story_automations' || table === 'inbox_outbox';
      const column = table === 'automation_events' ? 'created_at' : schemaOnly ? 'id' : 'received_at';
      const filters = [];
      const query = {
        select(columns, options) { calls.push({ table, columns, options, filters }); assert.equal(columns, table === 'lead_messages' ? 'received_at,leads!inner()' : column); assert.deepEqual(options, schemaOnly ? undefined : { count: 'exact' }); return query; },
        eq(field, value) { assert.equal(table, 'lead_messages'); filters.push({ field, value }); return query; },
        order(field, options) { assert.equal(field, column); assert.deepEqual(options, { ascending: false }); return query; },
        limit(count) {
          assert.equal(count, schemaOnly ? 0 : 1);
          if (schemaOnly) return Promise.resolve({ data: [], error: row.error || null });
          const rows = row.rows?.filter((item) => filters.every(({ field, value }) => field === 'direction' ? item.direction === value : item.leads?.ig_account_id === value)).sort((a, b) => Date.parse(b[column]) - Date.parse(a[column]));
          return Promise.resolve({ data: rows ? rows.slice(0, 1).map((item) => ({ [column]: item[column] })) : row.date ? [{ [column]: row.date }] : [], count: rows ? rows.length : row.count ?? 0, error: row.error || null });
        },
      };
      return query;
    },
  };
}

function fixture({ app = [subscription()], page = [{ id: env.META_APP_ID, subscribed_fields: ['feed'] }], appError, db = metadataDb() } = {}) {
  const requests = [];
  return {
    db, requests,
    options: {
      now: () => Date.parse(checkedAt), expectedCallbackUrl: callback,
      async fetcher(url, options) {
        requests.push({ url: String(url), options });
        assert.equal(options.method, 'GET');
        assert.equal(new URL(url).searchParams.has('access_token'), false);
        assert.equal(options.headers.Authorization, `Bearer ${env.META_APP_ID}|${env.META_APP_SECRET}`);
        return new Response(JSON.stringify(appError ? { error: appError } : { data: app }), { status: appError ? 400 : 200 });
      },
      meta: {
        async pageGet(path) { assert.equal(path, 'page123/subscribed_apps?fields=id,subscribed_fields'); return { data: page }; },
      },
    },
  };
}

test('health: Instagram fields and correct Page app are checked independently; zero counts are valid', async () => {
  const fx = fixture();
  const result = await getAutomationHealth(env, fx.db, fx.options);
  assert.equal(result.status, 'ready');
  assert.equal(result.checkedAt, checkedAt);
  assert.equal(result.meta.status, 'connected');
  assert.equal(result.meta.appSubscribed, true);
  assert.equal(result.meta.pageSubscribed, true);
  assert.equal(result.meta.commentsSubscribed, true);
  assert.equal(result.meta.messagesSubscribed, true);
  assert.equal(result.meta.callbackMatches, true);
  assert.deepEqual(result.meta.pageSubscribedFields, ['feed'], 'Page messages is not a requirement for Instagram messages');
  assert.equal(result.database.commentsRecorded, 0);
  assert.equal(result.database.inboundMessagesRecorded, 0);
  assert.equal(result.database.lastCommentEventAt, null);
  assert.equal(result.worker.status, 'unknown');
  assert.equal(fx.db.calls.length, 4);
  const serialized = JSON.stringify(result);
  for (const secret of [env.META_ACCESS_TOKEN, env.META_APP_SECRET, env.META_WEBHOOK_VERIFY_TOKEN]) assert.equal(serialized.includes(secret), false);
});

test('health: empty subscriptions mean disconnected, not unknown or successful', async () => {
  const fx = fixture({ app: [], page: [] });
  const result = await getAutomationHealth(env, fx.db, fx.options);
  assert.equal(result.status, 'needs_configuration');
  assert.equal(result.meta.status, 'disconnected');
  assert.equal(result.meta.appSubscribed, false);
  assert.equal(result.meta.pageSubscribed, false);
  assert.equal(result.meta.commentsSubscribed, false);
  assert.equal(result.meta.messagesSubscribed, false);
  assert.equal(result.meta.callbackMatches, false);
});

test('health: another app on the Page cannot satisfy the correct app subscription', async () => {
  const fx = fixture({ page: [{ id: 'other-app', subscribed_fields: ['feed', 'messages'] }] });
  const result = await getAutomationHealth(env, fx.db, fx.options);
  assert.equal(result.meta.appSubscribed, true);
  assert.equal(result.meta.pageSubscribed, false);
  assert.deepEqual(result.meta.pageSubscribedFields, []);
  assert.equal(result.meta.status, 'disconnected');
});

test('health: missing Instagram messages, inactive subscription, and callback mismatch are detectable', async () => {
  for (const app of [
    { ...subscription(), fields: [{ name: 'comments' }] },
    { ...subscription(), active: false },
    { ...subscription(), callback_url: 'https://other.example/webhook?access_token=private-token' },
  ]) {
    const fx = fixture({ app: [app] });
    const result = await getAutomationHealth(env, fx.db, fx.options);
    assert.equal(result.meta.status, 'disconnected');
    assert.equal(result.status, 'needs_configuration');
    assert.equal(JSON.stringify(result).includes('private-token'), false);
  }
});

test('health: remote and database failures are unverified and never reveal error content', async () => {
  const privateContent = `${env.META_APP_SECRET} ${env.META_ACCESS_TOKEN} private-client-DM`;
  const fx = fixture({ appError: { code: 190, message: privateContent }, db: metadataDb({ comments: { error: { code: '08006', message: privateContent } }, messages: { error: { code: 'PRIVATECLIENT', message: privateContent } } }) });
  fx.options.meta.pageGet = async () => { throw new Error(privateContent); };
  const result = await getAutomationHealth(env, fx.db, fx.options);
  assert.equal(result.status, 'unverified');
  assert.equal(result.meta.status, 'unverified');
  assert.equal(result.meta.appSubscribed, null);
  assert.equal(result.meta.pageSubscribed, null);
  assert.equal(result.database.commentsRecorded, null);
  assert.equal(result.database.inbox, 'unverified');
  assert.ok(result.meta.errors.some((error) => error.code === 190));
  assert.equal(result.database.errors[1].code, null);
  const output = JSON.stringify(result);
  for (const secret of [env.META_ACCESS_TOKEN, env.META_APP_SECRET, 'private-client-DM', 'PRIVATECLIENT']) assert.equal(output.includes(secret), false);
});

test('health: absent schema is reported safely as migration required', async () => {
  const db = metadataDb({ comments: { error: { code: 'PGRST205', message: 'private database details' } }, messages: { error: { code: '42P01', message: 'private database details' } } });
  const fx = fixture({ db });
  const result = await getAutomationHealth(env, db, fx.options);
  assert.equal(result.status, 'migration_required');
  assert.equal(result.database.automations, 'migration_required');
  assert.equal(result.database.inbox, 'migration_required');
  assert.equal(result.database.commentsRecorded, null);
  assert.equal(JSON.stringify(result).includes('private database details'), false);
});

test('health: partial CRM migration cannot appear ready when Inbox dependencies are missing', async () => {
  for (const missingTable of ['stories', 'outbox']) {
    const db = metadataDb({ comments: { count: 3 }, messages: { count: 2 }, [missingTable]: { error: { code: 'PGRST205', message: 'private table details' } } });
    const fx = fixture({ db });
    const result = await getAutomationHealth(env, db, fx.options);
    assert.equal(result.status, 'migration_required');
    assert.equal(result.database.automations, 'available');
    assert.equal(result.database.inbox, 'migration_required');
    assert.equal(result.database.inboundMessagesRecorded, 2);
    assert.deepEqual(result.database.errors.map((error) => error.check), [missingTable === 'stories' ? 'story_automations' : 'inbox_outbox']);
    assert.equal(JSON.stringify(result).includes('private table details'), false);
    const schemaChecks = db.calls.filter((call) => ['story_automations', 'inbox_outbox'].includes(call.table));
    assert.equal(schemaChecks.length, 2);
    assert.ok(schemaChecks.every((call) => call.columns === 'id' && call.options === undefined));
  }
  const db = metadataDb({ messages: { error: { code: '42703', message: 'direction column missing' } } });
  const fx = fixture({ db });
  assert.equal((await getAutomationHealth(env, db, fx.options)).database.inbox, 'migration_required');
});

test('health: latest DM and count exclude outbound messages and other Instagram accounts', async () => {
  const db = metadataDb({ messages: { rows: [
    { received_at: '2026-10-08T11:35:00Z', direction: 'inbound', leads: { ig_account_id: env.META_IG_ACCOUNT_ID }, text: 'PRIVATE INBOUND CONTENT', id: 'PRIVATE MESSAGE ID' },
    { received_at: '2026-10-08T11:40:00Z', direction: 'outbound', leads: { ig_account_id: env.META_IG_ACCOUNT_ID }, text: 'PRIVATE OUTBOUND CONTENT' },
    { received_at: '2026-10-08T11:50:00Z', direction: 'inbound', leads: { ig_account_id: 'other-account' }, text: 'OTHER ACCOUNT PRIVATE CONTENT' },
  ] } });
  const fx = fixture({ db });
  const result = await getAutomationHealth(env, db, fx.options);
  assert.equal(result.status, 'ready');
  assert.equal(result.database.inboundMessagesRecorded, 1);
  assert.equal(result.database.lastInboundMessageAt, '2026-10-08T11:35:00.000Z');
  assert.deepEqual(db.calls.find((call) => call.table === 'lead_messages').filters, [
    { field: 'direction', value: 'inbound' }, { field: 'leads.ig_account_id', value: env.META_IG_ACCOUNT_ID },
  ]);
  const output = JSON.stringify(result);
  for (const privateValue of ['PRIVATE INBOUND CONTENT', 'PRIVATE MESSAGE ID', 'PRIVATE OUTBOUND CONTENT', 'OTHER ACCOUNT PRIVATE CONTENT', 'other-account']) assert.equal(output.includes(privateValue), false);
});

test('health: missing credentials are flags and trigger no authenticated request', async () => {
  const fx = fixture();
  const result = await getAutomationHealth({}, fx.db, {
    ...fx.options,
    fetcher: async () => { assert.fail('must not fetch without credentials'); },
    meta: { async pageGet() { assert.fail('must not query Meta without credentials'); } },
  });
  assert.equal(result.status, 'needs_configuration');
  assert.deepEqual(result.configuration, { accessToken: false, appId: false, appSecret: false, verifyToken: false, pageId: false, instagramAccountId: false });
  assert.equal(result.meta.status, 'unverified');
});

test('health: default Meta client reads Page token using header auth, then reports only dates and counts', async () => {
  const calls = [];
  const db = metadataDb({ comments: { count: 12, date: '2026-10-08T11:30:00Z' }, messages: { count: 7, date: '2026-10-08T11:40:00Z' } });
  const result = await getAutomationHealth(env, db, {
    now: () => Date.parse(checkedAt),
    async fetcher(url, options) {
      const parsed = new URL(url);
      calls.push(parsed.pathname);
      assert.equal(options.method, 'GET');
      assert.equal(parsed.searchParams.has('access_token'), false);
      if (parsed.pathname.endsWith('/subscriptions')) return Response.json({ data: [subscription()] });
      if (parsed.pathname.endsWith('/subscribed_apps')) {
        assert.equal(options.headers.Authorization, 'Bearer private-page-token');
        return Response.json({ data: [{ id: env.META_APP_ID, subscribed_fields: ['feed', 'messages', 'private-not-a-field'] }] });
      }
      assert.equal(options.headers.Authorization, `Bearer ${env.META_ACCESS_TOKEN}`);
      return Response.json({ access_token: 'private-page-token' });
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(result.status, 'ready');
  assert.equal(result.meta.callbackMatches, null, 'callback match stays unknown when no expected URL was supplied');
  assert.equal(result.database.lastCommentEventAt, '2026-10-08T11:30:00.000Z');
  assert.equal(result.database.lastInboundMessageAt, '2026-10-08T11:40:00.000Z');
  assert.equal(result.database.commentsRecorded, 12);
  assert.equal(result.database.inboundMessagesRecorded, 7);
  assert.deepEqual(result.meta.pageSubscribedFields, ['feed', 'messages']);
  assert.equal(JSON.stringify(result).includes('private-page-token'), false);
});
