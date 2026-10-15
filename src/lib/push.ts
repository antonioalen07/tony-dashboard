import webpush from 'web-push';
import { supabase } from '@/utils/supabase';

/**
 * Notificaciones push (Web Push + VAPID). Cada dispositivo que activa los avisos
 * guarda su suscripción en `push_subscriptions`. Cada uno puede filtrar por
 * etiquetas (`tag_ids`): vacío = todos los chats; si no, sólo contactos con alguna.
 *
 * Envs: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: o https:).
 */
export const pushConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let ready = false;
function setup() {
    if (ready) return;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:automatizaciones@crevy.net', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    ready = true;
}

export interface PushPayload { title: string; body: string; url: string; tag?: string }
interface Subscription { id: string; endpoint: string; p256dh: string; auth: string; tag_ids?: string[] | null }
interface SendOptions { endpoint?: string; topic?: string; /** etiquetas del contacto: aplica el filtro de cada dispositivo */ leadTagIds?: string[] }

/** ¿Este dispositivo quiere el aviso? Sin filtro, sí; con filtro, si el contacto tiene alguna de sus etiquetas. */
export function wantsLead(filter: string[] | null | undefined, leadTagIds: string[]): boolean {
    return !filter?.length || filter.some((id) => leadTagIds.includes(id));
}

async function subscriptions(endpoint?: string): Promise<Subscription[]> {
    for (const columns of ['id,endpoint,p256dh,auth,tag_ids', 'id,endpoint,p256dh,auth']) {
        let query = supabase.from('push_subscriptions').select(columns);
        if (endpoint) query = query.eq('endpoint', endpoint);
        const { data, error } = await query;
        // Sin supabase_migration_push_tags.sql no existe tag_ids: se avisa de todo.
        if (error && error.code === '42703' && columns.includes('tag_ids')) continue;
        if (error) throw new Error(error.message);
        return data as unknown as Subscription[];
    }
    return [];
}

/** Manda a todos los dispositivos (o a uno). Borra las suscripciones que el navegador dio de baja. */
export async function sendPush(payload: PushPayload, { endpoint, topic, leadTagIds }: SendOptions = {}): Promise<{ sent: number; failed: number }> {
    if (!pushConfigured()) return { sent: 0, failed: 0 };
    setup();
    const targets = (await subscriptions(endpoint)).filter((s) => !leadTagIds || wantsLead(s.tag_ids, leadTagIds));
    let sent = 0, failed = 0;
    await Promise.all(targets.map(async (s) => {
        try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'high', ...(topic ? { topic } : {}) });
            sent++;
            await supabase.from('push_subscriptions').update({ last_success_at: new Date().toISOString() }).eq('id', s.id);
        } catch (e) {
            failed++;
            const status = (e as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) await supabase.from('push_subscriptions').delete().eq('id', s.id);
            else console.error('[push] envío fallido', status, (e as Error).message);
        }
    }));
    return { sent, failed };
}

type Claimed = { lead_id: string; text: string | null; attachments: { type?: string }[] | null; story_id: string | null };
type LeadName = { id: string; username: string | null; display_name: string | null; lead_tag_assignments?: { tag_id: string; lead_tags: { name: string } | { name: string }[] | null }[] };

function describe(m: Claimed): string {
    if (m.text?.trim()) return m.text.trim().slice(0, 180);
    const type = m.attachments?.[0]?.type;
    if (type === 'audio') return '🎤 Te mandó un audio';
    if (type === 'image') return '📷 Te mandó una foto';
    if (type === 'video') return '🎥 Te mandó un video';
    if (m.story_id || type === 'story_mention') return 'Respondió tu historia';
    return 'Te mandó un mensaje';
}

/**
 * Avisa de los DMs entrantes recién guardados. Marca `notified_at` de forma
 * atómica: si Meta reentrega el webhook, el mismo mensaje no vuelve a sonar.
 */
export async function notifyInboundMessages(mids: string[]): Promise<void> {
    if (!pushConfigured() || !mids.length) return;
    const { data, error } = await supabase.from('lead_messages')
        .update({ notified_at: new Date().toISOString() })
        .in('meta_message_id', mids).eq('direction', 'inbound').is('notified_at', null)
        .select('lead_id,text,attachments,story_id');
    if (error) throw new Error(error.message);
    const claimed = (data || []) as Claimed[];
    if (!claimed.length) return;
    const ids = [...new Set(claimed.map((m) => m.lead_id))];
    const { data: leads } = await supabase.from('leads').select('id,username,display_name,lead_tag_assignments(tag_id,lead_tags(name))').in('id', ids);
    for (const id of ids) {
        const own = claimed.filter((m) => m.lead_id === id);
        const lead = (leads as LeadName[] | null)?.find((l) => l.id === id);
        const who = lead?.display_name || (lead?.username ? `@${lead.username}` : 'Nuevo mensaje en Instagram');
        const assigned = lead?.lead_tag_assignments || [];
        const tagIds = assigned.map((a) => a.tag_id);
        const tagNames = assigned.flatMap((a) => Array.isArray(a.lead_tags) ? a.lead_tags : a.lead_tags ? [a.lead_tags] : []).map((t) => t.name);
        // Las etiquetas van en el título: es lo que se ve con la notificación colapsada.
        const title = tagNames.length ? `${who} · ${tagNames.slice(0, 3).join(', ')}${tagNames.length > 3 ? '…' : ''}` : who;
        const body = own.length > 1 ? `${describe(own[own.length - 1])} (+${own.length - 1})` : describe(own[0]);
        // tag + topic agrupan: un contacto que manda 5 mensajes deja una sola notificación.
        await sendPush({ title, body, url: `/automatizaciones?tab=inbox&lead=${id}`, tag: `lead-${id}` }, { topic: id.replace(/-/g, ''), leadTagIds: tagIds });
    }
}
