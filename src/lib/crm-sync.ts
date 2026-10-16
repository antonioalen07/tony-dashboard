import { createMeta } from '../../worker/lib/meta.mjs';
import { supabase as db } from '@/utils/supabase';

/**
 * Sincronización con Meta de lo que el webhook no trae:
 *  - perfil (nombre, usuario, foto) de cada contacto, vía la API de perfil de mensajería;
 *  - historial de la conversación (mensajes enviados desde la app de Instagram antes de
 *    que BAKO guardara los ecos, o webhooks perdidos), vía la API de conversaciones.
 * Si falta supabase_migration_crm_inbox_v3.sql, todo esto se omite sin romper la bandeja.
 */
const PAGE_ID = () => process.env.META_PAGE_ID || '1061609440358642';
const PROFILE_TTL_MS = 3 * 24 * 3600_000; // la URL de la foto vence a los ~5 días
const HISTORY_TTL_MS = 2 * 60_000;

type Meta = ReturnType<typeof createMeta>;
let meta: Meta | null = null;
const graph = () => (meta ||= createMeta(process.env));

export type ProfileLead = { id: string; instagram_user_id: string | null; username?: string | null; profile_fetched_at?: string | null };

/** Pide perfiles vencidos (máx. `limit` por llamada) y los guarda. Nunca tira: es best-effort. */
export async function refreshProfiles(leads: ProfileLead[], limit = 12): Promise<void> {
    if (!process.env.META_ACCESS_TOKEN) return;
    const stale = leads.filter((l) => /^\d+$/.test(l.instagram_user_id || '') && 'profile_fetched_at' in l
        && (!l.profile_fetched_at || Date.now() - Date.parse(l.profile_fetched_at) > PROFILE_TTL_MS)).slice(0, limit);
    await Promise.all(stale.map(async (l) => {
        const fields: Record<string, unknown> = { profile_fetched_at: new Date().toISOString() };
        try {
            const p = await graph().pageGet(`${l.instagram_user_id}?fields=name,username,profile_pic`) as { name?: string; username?: string; profile_pic?: string };
            fields.ig_name = p.name?.trim() || null;
            fields.profile_pic_url = typeof p.profile_pic === 'string' && p.profile_pic.startsWith('https://') ? p.profile_pic : null;
            if (p.username) fields.username = p.username;
        } catch { /* perfil no disponible (cuenta privada o borrada): se reintenta en 3 días */ }
        await db.from('leads').update(fields).eq('id', l.id);
    }));
}

type GraphAttachment = { mime_type?: string; file_url?: string; image_data?: { url?: string }; video_data?: { url?: string } };
type GraphMessage = { id: string; created_time: string; from?: { id?: string }; message?: string; attachments?: { data?: GraphAttachment[] } };

function attachments(list: GraphAttachment[] = []) {
    return list.slice(0, 20).map((a) => {
        const mime = a.mime_type || '';
        const url = a.image_data?.url || a.video_data?.url || a.file_url || null;
        const type = mime.startsWith('audio') ? 'audio' : a.image_data ? 'image' : a.video_data || mime.startsWith('video') ? 'video' : 'file';
        return { type, payload: { url } };
    });
}

/**
 * Trae los últimos mensajes de la conversación con este contacto y agrega los que falten.
 * Con `force` ignora el intervalo mínimo (botón "Actualizar"). Devuelve cuántos agregó.
 */
export async function syncHistory(leadId: string, force = false): Promise<{ added: number; skipped?: string }> {
    if (!process.env.META_ACCESS_TOKEN) return { added: 0, skipped: 'sin token' };
    const { data: lead, error } = await db.from('leads').select('id,instagram_user_id,ig_account_id,history_synced_at').eq('id', leadId).maybeSingle();
    if (error) return { added: 0, skipped: error.code === '42703' ? 'falta migración v3' : error.message };
    if (!lead || !/^\d+$/.test(lead.instagram_user_id || '')) return { added: 0, skipped: 'contacto sin Instagram' };
    if (!force && lead.history_synced_at && Date.now() - Date.parse(lead.history_synced_at) < HISTORY_TTL_MS) return { added: 0, skipped: 'reciente' };
    const account = graph().accountId;
    const fields = 'messages.limit(100){id,created_time,from,message,attachments{mime_type,file_url,image_data,video_data}}';
    const res = await graph().pageGet(`${PAGE_ID()}/conversations?platform=instagram&user_id=${lead.instagram_user_id}&fields=${encodeURIComponent(fields)}`) as { data?: { messages?: { data?: GraphMessage[] } }[] };
    const messages = (res.data?.[0]?.messages?.data || []).filter((m) => m.id && m.created_time).map((m) => ({
        mid: m.id,
        at: new Date(m.created_time).toISOString(),
        text: m.message || '',
        direction: m.from?.id === account ? 'outbound' : 'inbound',
        attachments: attachments(m.attachments?.data),
    }));
    if (!messages.length) { await db.from('leads').update({ history_synced_at: new Date().toISOString() }).eq('id', leadId); return { added: 0 }; }
    const { data: added, error: rpcError } = await db.rpc('crm_import_history', { p_lead: leadId, p_messages: messages });
    if (rpcError) return { added: 0, skipped: rpcError.message };
    return { added: Number(added) || 0 };
}
