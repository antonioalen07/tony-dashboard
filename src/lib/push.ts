import webpush from 'web-push';
import { supabase } from '@/utils/supabase';

/**
 * Notificaciones push (Web Push + VAPID). Cada dispositivo que activa los avisos
 * guarda su suscripción en `push_subscriptions`; todos reciben cada DM nuevo.
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
interface Subscription { id: string; endpoint: string; p256dh: string; auth: string }

/** Manda a todos los dispositivos (o a uno). Borra las suscripciones que el navegador dio de baja. */
export async function sendPush(payload: PushPayload, endpoint?: string, topic?: string): Promise<{ sent: number; failed: number }> {
    if (!pushConfigured()) return { sent: 0, failed: 0 };
    setup();
    let query = supabase.from('push_subscriptions').select('id,endpoint,p256dh,auth');
    if (endpoint) query = query.eq('endpoint', endpoint);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    let sent = 0, failed = 0;
    await Promise.all((data as Subscription[]).map(async (s) => {
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
type LeadName = { id: string; username: string | null; display_name: string | null };

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
    const { data: leads } = await supabase.from('leads').select('id,username,display_name').in('id', ids);
    for (const id of ids) {
        const own = claimed.filter((m) => m.lead_id === id);
        const lead = (leads as LeadName[] | null)?.find((l) => l.id === id);
        const who = lead?.display_name || (lead?.username ? `@${lead.username}` : 'Nuevo mensaje en Instagram');
        const body = own.length > 1 ? `${describe(own[own.length - 1])} (+${own.length - 1})` : describe(own[0]);
        // tag + topic agrupan: un contacto que manda 5 mensajes deja una sola notificación.
        await sendPush({ title: who, body, url: `/automatizaciones?tab=inbox&lead=${id}`, tag: `lead-${id}` }, undefined, id.replace(/-/g, ''));
    }
}
