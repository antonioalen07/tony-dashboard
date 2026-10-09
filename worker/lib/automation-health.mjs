import { createMeta, GRAPH_BASE } from './meta.mjs';

const DEFAULT_PAGE = '1061609440358642';
const DEFAULT_ACCOUNT = '17841476480622974';
const MISSING_SCHEMA = new Set(['42P01', '42703', 'PGRST200', 'PGRST204', 'PGRST205']);
const DATABASE_CODES = new Set([...MISSING_SCHEMA, '08006', '42501', 'PGRST301', 'PGRST302', 'XX000', '57014', '53300']);
const present = (value) => typeof value === 'string' && value.trim().length > 0;

function safeCode(error) {
  const code = error?.code;
  return typeof code === 'number' && Number.isSafeInteger(code) ? code
    : DATABASE_CODES.has(code) ? code : null;
}

function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function subscriptionList(result) {
  if (!Array.isArray(result?.data)) throw new Error('Invalid subscription response');
  return result.data;
}

function databaseFailure(error, table) {
  const code = safeCode(error);
  const missing = MISSING_SCHEMA.has(code);
  return {
    status: missing ? 'migration_required' : 'unverified',
    error: { check: table, code, message: missing ? 'Falta la migración de esta sección en la base de datos.' : 'No se pudo consultar la actividad de esta sección.' },
  };
}

async function checkTable(db, table) {
  try {
    // The zero-row limit verifies the schema without retrieving any record ID.
    const result = await db.from(table).select('id').limit(0);
    if (result.error) throw result.error;
    return { status: 'available', error: null };
  } catch (error) {
    return databaseFailure(error, table);
  }
}

async function latestMetadata(db, table, column, account) {
  try {
    // Only counts and dates: never retrieve message text, recipients or payloads.
    let query = db.from(table).select(account ? `${column},leads!inner()` : column, { count: 'exact' });
    if (account) query = query.eq('direction', 'inbound').eq('leads.ig_account_id', account);
    const result = await query.order(column, { ascending: false }).limit(1);
    if (result.error) throw result.error;
    return {
      status: 'available',
      latestAt: timestamp(result.data?.[0]?.[column]),
      count: typeof result.count === 'number' && Number.isSafeInteger(result.count) && result.count >= 0 ? result.count : null,
      error: null,
    };
  } catch (error) {
    return { ...databaseFailure(error, table), latestAt: null, count: null };
  }
}

function combinedDatabaseStatus(checks) {
  return checks.some((check) => check.status === 'migration_required') ? 'migration_required'
    : checks.some((check) => check.status === 'unverified') ? 'unverified' : 'available';
}

/**
 * Read-only diagnostic. Empty subscriptions mean disconnected, while a failed
 * check means unverified. Page fields and Instagram fields are separate: do not
 * infer that Page messages is necessary for an Instagram messages subscription.
 * There is no worker heartbeat, so recent activity cannot prove it is running.
 */
export async function getAutomationHealth(env, db, { fetcher = fetch, meta, expectedCallbackUrl, now = () => Date.now() } = {}) {
  const configuration = {
    accessToken: present(env.META_ACCESS_TOKEN), appId: present(env.META_APP_ID),
    appSecret: present(env.META_APP_SECRET), verifyToken: present(env.META_WEBHOOK_VERIFY_TOKEN),
    pageId: present(env.META_PAGE_ID), instagramAccountId: present(env.META_IG_ACCOUNT_ID),
  };
  const state = {
    status: 'unverified', appSubscribed: null, pageSubscribed: null,
    commentsSubscribed: null, messagesSubscribed: null, callbackMatches: null,
    pageSubscribedFields: [], errors: [],
  };
  // Bound all fetches, including the Page token lookup performed by createMeta.
  const boundedFetch = (url, options) => fetcher(url, { ...options, signal: AbortSignal.timeout(8000) });
  const pageMeta = meta || createMeta(env, boundedFetch);
  const checks = [];
  if (configuration.appId && configuration.appSecret) {
    checks.push((async () => {
      try {
        const response = await boundedFetch(`${GRAPH_BASE}/${encodeURIComponent(env.META_APP_ID)}/subscriptions`, {
          method: 'GET', headers: { Authorization: `Bearer ${env.META_APP_ID}|${env.META_APP_SECRET}` },
        });
        const result = await response.json();
        if (!response.ok || result.error) throw { code: result.error?.code };
        const subscription = subscriptionList(result).find((item) => item?.object === 'instagram');
        state.appSubscribed = Boolean(subscription && subscription.active !== false);
        const fields = Array.isArray(subscription?.fields) ? subscription.fields : [];
        state.commentsSubscribed = state.appSubscribed && fields.some((field) => field?.name === 'comments');
        state.messagesSubscribed = state.appSubscribed && fields.some((field) => field?.name === 'messages');
        if (expectedCallbackUrl) state.callbackMatches = Boolean(subscription?.callback_url === expectedCallbackUrl);
      } catch (error) {
        state.errors.push({ check: 'appSubscriptions', code: safeCode(error), message: 'No se pudo verificar la suscripción de la app en Meta.' });
      }
    })());
  }
  if (configuration.accessToken && configuration.appId) {
    checks.push((async () => {
      try {
        const result = await pageMeta.pageGet(`${env.META_PAGE_ID || DEFAULT_PAGE}/subscribed_apps?fields=id,subscribed_fields`);
        const subscription = subscriptionList(result).find((item) => item?.id === env.META_APP_ID);
        state.pageSubscribed = Boolean(subscription);
        // Only expose relevant, documented field names, not arbitrary API data.
        state.pageSubscribedFields = ['feed', 'messages'].filter((field) => Array.isArray(subscription?.subscribed_fields) && subscription.subscribed_fields.includes(field));
      } catch (error) {
        state.errors.push({ check: 'pageSubscriptions', code: safeCode(error), message: 'No se pudo verificar la suscripción de la página en Meta.' });
      }
    })());
  }
  const [comments, messages, stories, outbox] = await Promise.all([
    latestMetadata(db, 'automation_events', 'created_at'),
    latestMetadata(db, 'lead_messages', 'received_at', env.META_IG_ACCOUNT_ID || DEFAULT_ACCOUNT),
    checkTable(db, 'story_automations'),
    checkTable(db, 'inbox_outbox'),
    Promise.all(checks),
  ]);
  const disconnected = [state.appSubscribed, state.pageSubscribed, state.commentsSubscribed, state.messagesSubscribed, state.callbackMatches].includes(false);
  if (disconnected) state.status = 'disconnected';
  else if (state.appSubscribed && state.pageSubscribed && state.commentsSubscribed && state.messagesSubscribed) state.status = 'connected';
  const database = {
    automations: comments.status, inbox: combinedDatabaseStatus([messages, stories, outbox]),
    lastCommentEventAt: comments.latestAt, lastInboundMessageAt: messages.latestAt,
    commentsRecorded: comments.count, inboundMessagesRecorded: messages.count,
    errors: [comments.error, messages.error, stories.error, outbox.error].filter(Boolean),
  };
  const missingConfig = !configuration.accessToken || !configuration.appId || !configuration.appSecret || !configuration.verifyToken;
  const status = missingConfig || state.status === 'disconnected' ? 'needs_configuration'
    : [database.automations, database.inbox].includes('migration_required') ? 'migration_required'
      : state.status !== 'connected' || [database.automations, database.inbox].includes('unverified') ? 'unverified' : 'ready';
  return {
    checkedAt: new Date(now()).toISOString(), status, configuration, meta: state, database,
    worker: { status: 'unknown', detail: 'El worker no tiene heartbeat; este diagnóstico no puede confirmar si está ejecutándose.' },
  };
}
