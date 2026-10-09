import { randomBytes } from 'node:crypto';
import { createMeta, GRAPH_BASE } from './meta.mjs';

export const BAKO_WEBHOOK_CALLBACK_URL = 'https://tony-dashboard-psi.vercel.app/api/webhooks/instagram';
const INSTAGRAM_FIELDS = ['comments', 'messages'];
const PAGE_FIELDS = ['feed', 'messages'];
// Meta SDK v23 enum: facebook-python-business-sdk/23.0.0/.../page.py.
// https://github.com/facebook/facebook-python-business-sdk/blob/23.0.0/facebook_business/adobjects/page.py
const PAGE_SUBSCRIBED_FIELDS = new Set(`affiliation attire awards bio birthday call_permission_reply calls category checkins
company_overview conversations culinary_team current_location description email feature_access_list feed founded general_info
general_manager group_feed hometown hours inbox_labels invalid_topic_placeholder invoice_access_bank_slip_events invoice_access_invoice_change
invoice_access_invoice_draft_change invoice_access_onboarding_status_active leadgen leadgen_fat live_videos local_delivery location
marketing_message_delivery_failed mcom_invoice_change members mention merchant_review message_context message_deliveries message_echoes
message_edits message_mention message_reactions message_reads message_template_status_update messages messaging_account_linking
messaging_appointments messaging_checkout_updates messaging_customer_information messaging_direct_sends messaging_fblogin_account_linking
messaging_feedback messaging_game_plays messaging_handovers messaging_in_thread_lead_form_submit messaging_integrity messaging_optins
messaging_optouts messaging_payments messaging_policy_enforcement messaging_postbacks messaging_pre_checkouts messaging_referrals mission
name page_about_story page_change_proposal page_upcoming_change parking payment_options payment_request_update personal_info personal_interests
phone picture price_range product_review products public_transit publisher_subscriptions ratings registration response_feedback send_cart standby
user_action video_text_question_responses videos website`.split(/\s+/));

export function redactWebhookSetupError(value, env) {
    let message = String(value || 'No se pudo comprobar la configuración de Meta.');
    for (const secret of [env.META_ACCESS_TOKEN, env.META_APP_SECRET, env.META_WEBHOOK_VERIFY_TOKEN,
        env.META_APP_ID && env.META_APP_SECRET ? `${env.META_APP_ID}|${env.META_APP_SECRET}` : null].filter(Boolean)) {
        message = message.replaceAll(secret, '[REDACTADO]').replaceAll(encodeURIComponent(secret), '[REDACTADO]');
    }
    return message.replace(/(access_token|verify_token|hub\.verify_token|appsecret_proof)=[^&\s)]+/gi, '$1=[REDACTADO]')
        .replace(/https?:\/\/[^\s]+/g, '[URL omitida]').slice(0, 500);
}

function requiredConfiguration(env, apply) {
    const fields = ['META_APP_ID', 'META_APP_SECRET', 'META_ACCESS_TOKEN', ...(apply ? ['META_WEBHOOK_VERIFY_TOKEN'] : [])];
    const missing = fields.filter((key) => !String(env[key] || '').trim());
    if (missing.length) throw new Error(`Falta configurar ${missing.join(', ')}. Reutilizá las credenciales existentes; no se generó ni modificó ninguna.`);
    if (!/^\d+$/.test(env.META_APP_ID) || (env.META_PAGE_ID && !/^\d+$/.test(env.META_PAGE_ID)))
        throw new Error('META_APP_ID y META_PAGE_ID deben ser IDs numéricos de Meta.');
}

function callbackUrl(value) {
    if (!value) throw new Error('Indicá el callback con --callback o META_WEBHOOK_CALLBACK_URL.');
    let url;
    try { url = new URL(value); } catch { throw new Error('El callback debe ser la URL HTTPS del webhook de BAKO.'); }
    if (url.href !== BAKO_WEBHOOK_CALLBACK_URL)
        throw new Error(`El callback admitido para este proyecto es ${BAKO_WEBHOOK_CALLBACK_URL}.`);
    return url.href;
}

function fieldNames(fields) {
    if (!Array.isArray(fields)) throw new Error('Meta devolvió una lista de campos inválida; no se modificaron suscripciones.');
    const names = fields.map((field) => typeof field === 'string' ? field : field?.name);
    if (names.some((name) => typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name)))
        throw new Error('Meta devolvió campos de suscripción inválidos; no se modificaron suscripciones.');
    return [...new Set(names)];
}

function safeCallback(value) {
    if (value === BAKO_WEBHOOK_CALLBACK_URL) return value;
    // Un callback de otra integración puede llevar credenciales en su ruta.
    try { return `${new URL(value).origin}/[ruta omitida]`; } catch { return null; }
}

export function createWebhookSetup(env, { fetcher = fetch, meta = createMeta(env, fetcher), challenge = () => randomBytes(16).toString('hex') } = {}) {
    const appId = env.META_APP_ID;
    const pageId = env.META_PAGE_ID || '1061609440358642';
    const appToken = `${appId}|${env.META_APP_SECRET}`;

    async function appRequest(path, body) {
        const url = new URL(path.startsWith('https:') ? path : `${GRAPH_BASE}/${path}`);
        if (url.origin !== 'https://graph.facebook.com') throw new Error('Meta devolvió una paginación fuera de Graph API.');
        url.searchParams.delete('access_token');
        let response;
        try {
            response = await fetcher(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${appToken}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
                ...(body ? { body: new URLSearchParams(body) } : {}), signal: AbortSignal.timeout(30_000), redirect: 'error' });
        } catch { throw new Error('No se pudo conectar con Meta. Comprobá el estado antes de volver a aplicar cambios.'); }
        let result;
        try { result = await response.json(); } catch { throw new Error('Meta devolvió una respuesta inválida. Comprobá el estado antes de volver a aplicar cambios.'); }
        if (!result || typeof result !== 'object') throw new Error('Meta devolvió una respuesta inválida. Comprobá el estado antes de volver a aplicar cambios.');
        if (!response.ok || result.error)
            throw new Error(`Meta rechazó la configuración (código ${result.error?.code || response.status}): ${redactWebhookSetupError(result.error?.message, env)}`);
        return result;
    }

    async function listPages(first, request) {
        let next = first;
        const rows = [];
        const visited = new Set();
        while (next) {
            if (visited.has(next) || visited.size >= 10) throw new Error('No se pudo completar la paginación de suscripciones. No se aplicaron nuevos cambios.');
            visited.add(next);
            const result = await request(next);
            if (!Array.isArray(result.data)) throw new Error('Meta no devolvió la lista de suscripciones.');
            rows.push(...result.data);
            next = result.paging?.next;
        }
        return rows;
    }

    async function rawStatus() {
        const results = await Promise.allSettled([
            listPages(`${appId}/subscriptions`, appRequest),
            listPages(`${pageId}/subscribed_apps?fields=id,subscribed_fields`, (path) => meta.pageGet(path)),
        ]);
        const failed = results.find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;
        const instagramRows = results[0].value.filter((row) => row.object === 'instagram');
        if (instagramRows.length > 1) throw new Error('Meta devolvió más de un callback de Instagram. Revisá la configuración antes de modificarla.');
        const instagram = instagramRows[0] || null;
        const page = results[1].value.find((row) => String(row.id) === String(appId)) || null;
        return { instagram, page, instagramFields: instagram ? fieldNames(instagram.fields) : [], pageFields: page ? fieldNames(page.subscribed_fields) : [] };
    }

    function view(raw) {
        return { checked_at: new Date().toISOString(), app_id: appId, page_id: pageId,
            verify_token_configured: !!env.META_WEBHOOK_VERIFY_TOKEN,
            instagram: { registered: !!raw.instagram, active: raw.instagram?.active === true, callback_url: safeCallback(raw.instagram?.callback_url), callback_matches_bako: raw.instagram?.callback_url === BAKO_WEBHOOK_CALLBACK_URL, fields: raw.instagramFields, missing_fields: INSTAGRAM_FIELDS.filter((field) => !raw.instagramFields.includes(field)) },
            page: { registered: !!raw.page, fields: raw.pageFields, missing_fields: PAGE_FIELDS.filter((field) => !raw.pageFields.includes(field)) } };
    }

    async function status() {
        requiredConfiguration(env, false);
        return view(await rawStatus());
    }

    async function apply({ callback: requestedCallback, replaceCallback = false } = {}) {
        // Configuración y planes completos antes de cualquier escritura externa.
        requiredConfiguration(env, true);
        const callback = callbackUrl(requestedCallback || env.META_WEBHOOK_CALLBACK_URL);
        const before = await rawStatus();
        if (before.instagram?.callback_url && before.instagram.callback_url !== callback && !replaceCallback)
            throw new Error('Ya existe un callback de Instagram distinto. Revisá la integración y usá --replace-callback sólo si querés reemplazarlo.');
        const instagramFields = [...new Set([...before.instagramFields, ...INSTAGRAM_FIELDS])];
        const pageFields = [...new Set([...before.pageFields, ...PAGE_FIELDS])];
        if (pageFields.some((field) => !PAGE_SUBSCRIBED_FIELDS.has(field)))
            throw new Error('Hay campos de página fuera del enum del SDK Meta v23. Revisalos antes de modificar la suscripción; no se descartó ningún campo.');
        // Una access token de otra app haría que /subscribed_apps modificase esa
        // otra integración. Comprobar identidad antes de solicitar el handshake.
        const token = await appRequest(`debug_token?input_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`);
        if (!token.data?.is_valid || String(token.data.app_id) !== String(appId))
            throw new Error('El access token no pertenece a META_APP_ID o ya no es válido. No se modificaron suscripciones.');
        const expected = challenge();
        const url = new URL(callback);
        url.searchParams.set('hub.mode', 'subscribe');
        url.searchParams.set('hub.verify_token', env.META_WEBHOOK_VERIFY_TOKEN);
        url.searchParams.set('hub.challenge', expected);
        let verification;
        try { verification = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
        catch { throw new Error('No se pudo verificar el callback de BAKO. No se modificaron suscripciones.'); }
        if (verification.status !== 200 || await verification.text() !== expected)
            throw new Error('BAKO no confirmó exactamente el challenge. Revisá META_WEBHOOK_VERIFY_TOKEN en el despliegue y redeployá antes de aplicar. No se modificaron suscripciones.');
        const changes = [];
        try {
            if (!before.instagram || before.instagram.active !== true || before.instagram.callback_url !== callback || INSTAGRAM_FIELDS.some((field) => !before.instagramFields.includes(field))) {
                const body = { object: 'instagram', callback_url: callback, verify_token: env.META_WEBHOOK_VERIFY_TOKEN, fields: instagramFields.join(',') };
                if (typeof before.instagram?.include_values === 'boolean') body.include_values = String(before.instagram.include_values);
                const saved = await appRequest(`${appId}/subscriptions`, body);
                if (saved.success !== true) throw new Error('Meta no confirmó el registro del callback. Ejecutá --status antes de volver a aplicar.');
                changes.push('instagram');
            }
            if (!before.page || PAGE_FIELDS.some((field) => !before.pageFields.includes(field))) {
                const saved = await meta.post(`${pageId}/subscribed_apps`, { subscribed_fields: pageFields.join(',') });
                if (saved.success !== true) throw new Error('Meta no confirmó la suscripción de la página. Ejecutá --status antes de volver a aplicar.');
                changes.push('page');
            }
            const after = await rawStatus();
            if (!after.instagram || after.instagram.active !== true || after.instagram.callback_url !== callback ||
                instagramFields.some((field) => !after.instagramFields.includes(field)) || !after.page || pageFields.some((field) => !after.pageFields.includes(field)))
                throw new Error('La verificación posterior no confirmó ambas suscripciones y todos sus campos. Ejecutá --status y revisá Meta antes de reintentar.');
            return { ...view(after), changed: changes, handshake_verified: true };
        }
        catch (error) {
            if (!changes.length) throw error;
            throw new Error(`${redactWebhookSetupError(error.message, env)} Cambios confirmados antes del error: ${changes.join(', ')}. Ejecutá --status para revisar el estado antes de volver a aplicar.`);
        }
    }

    async function safeOperation(operation) {
        try { return await operation(); }
        catch (error) { throw new Error(redactWebhookSetupError(error.message, env)); }
    }
    return { status: () => safeOperation(status), apply: (options) => safeOperation(() => apply(options)) };
}
