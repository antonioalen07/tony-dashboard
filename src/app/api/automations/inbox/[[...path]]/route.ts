import { requireRole } from '@/lib/auth';
import { InputError, object, uuid } from '@/lib/automation-validation';
import { leadSearchFilter } from '@/lib/automation-data';
import { publicStudioUrl, uploadStudioObject } from '@/lib/storage';
import { supabase as db } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ path?: string[] }> };
type Tag = { id: string; name: string };
type RawLead = {
    id: string;
    ig_account_id: string | null;
    instagram_user_id: string | null;
    username: string | null;
    display_name: string | null;
    notes: string;
    starred: boolean;
    qualification: string;
    opted_out: boolean;
    last_inbound_at: string | null;
    lead_tag_assignments?: { lead_tags: Tag | Tag[] | null }[];
    tag_filter?: unknown;
};
type Attachment = { type: string; url?: string; payload?: { url?: string } };
type Message = {
    id: string;
    direction: 'inbound' | 'outbound';
    kind: 'text' | 'audio';
    text: string | null;
    audio_url: string | null;
    attachments: Attachment[];
    status: string;
    error: string | null;
    created_at: string;
};
const MAX_AUDIO_BYTES = 4_000_000;
const AUDIO_EXTENSIONS: Record<string, string> = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};

function result<T>(r: { data: T; error: { message: string; code?: string } | null }): NonNullable<T> {
    if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    return r.data as NonNullable<T>;
}
function leadWithTags(row: RawLead) {
    const { lead_tag_assignments, tag_filter, ...lead } = row;
    void tag_filter;
    return { ...lead, tags: (lead_tag_assignments || []).flatMap((a) => a.lead_tags ? Array.isArray(a.lead_tags) ? a.lead_tags : [a.lead_tags] : []) };
}
function replyBlock(lead: Pick<RawLead, 'ig_account_id' | 'instagram_user_id' | 'opted_out' | 'last_inbound_at'>): string | null {
    if (!lead.instagram_user_id || !/^\d+$/.test(lead.instagram_user_id) || lead.ig_account_id !== (process.env.META_IG_ACCOUNT_ID || '17841476480622974')) {
        return 'Este contacto todavía no está vinculado al Instagram conectado. Su próxima interacción lo vinculará para poder responderle.';
    }
    if (lead.opted_out) return 'Este contacto tiene los mensajes desactivados.';
    const received = Date.parse(lead.last_inbound_at || '');
    if (!Number.isFinite(received) || received > Date.now() + 5 * 60_000 || Date.now() - received >= 24 * 60 * 60_000) {
        return 'Para responder, el contacto tiene que escribirte por Instagram. La ventana de respuesta dura 24 horas desde su último mensaje.';
    }
    return null;
}
function audioUrl(value: unknown): string {
    if (typeof value !== 'string' || value.length > 2048) throw new InputError('Completá la URL pública del audio.');
    let parsed: URL;
    try { parsed = new URL(value.trim()); } catch { throw new InputError('Usá una URL pública https válida para el audio.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hostname === 'localhost' ||
        /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname) || parsed.hostname.startsWith('[')) {
        throw new InputError('Usá una URL pública https sin credenciales para el audio.');
    }
    return parsed.toString();
}
function isAudio(bytes: Uint8Array, mime: string) {
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
    if (mime === 'audio/wav' || mime === 'audio/x-wav') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    if (mime === 'audio/mp4' || mime === 'audio/x-m4a') return ascii(4, 8) === 'ftyp';
    if (mime === 'audio/aac') return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
    return ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

async function handle(request: Request, context: Context) {
    const auth = await requireRole(request);
    if (!auth.ok) return auth.res;
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: 'Falta configurar la conexión de servidor a Supabase.' }, { status: 503 });
    const path = (await context.params).path || [];
    const [id, action] = path;
    const q = new URL(request.url).searchParams;
    try {
        if (!id && request.method === 'GET') {
            const limit = Math.min(100, Math.max(1, Math.floor(Number(q.get('limit') || 50)) || 50));
            const offset = Math.max(0, Math.floor(Number(q.get('offset') || 0)) || 0);
            const tag = q.get('tag') ? uuid(q.get('tag')) : null;
            const selection = '*,lead_tag_assignments(tag_id,lead_tags(id,name))' + (tag ? ',tag_filter:lead_tag_assignments!inner(tag_id)' : '');
            let query = db.from('leads').select(selection, { count: 'exact' })
                .eq('ig_account_id', process.env.META_IG_ACCOUNT_ID || '17841476480622974')
                .not('instagram_user_id', 'is', null)
                .order('updated_at', { ascending: false }).range(offset, offset + limit - 1);
            const search = leadSearchFilter(q.get('search') || '');
            if (search) query = query.or(search);
            if (tag) query = query.eq('tag_filter.tag_id', tag);
            if (q.get('starred') === 'true') query = query.eq('starred', true);
            if (q.get('qualification')) {
                const qualification = q.get('qualification')!;
                if (!['new', 'qualified', 'customer', 'unqualified'].includes(qualification)) throw new InputError('Calificación inválida.');
                query = query.eq('qualification', qualification);
            }
            const rows = await query;
            const leads = (result(rows) as unknown as RawLead[]).map(leadWithTags);
            return Response.json({ leads, total: rows.count || 0, hasMore: offset + leads.length < (rows.count || 0) });
        }
        if (id === 'audio' && path.length === 1 && request.method === 'POST') {
            const length = Number(request.headers.get('content-length') || 0);
            if (length > MAX_AUDIO_BYTES + 150_000) return Response.json({ error: 'El audio debe pesar hasta 4 MB.' }, { status: 413 });
            if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) throw new InputError('Subí el audio como archivo.');
            const form = await request.formData();
            const file = form.get('file');
            if (!(file instanceof File) || !file.size) throw new InputError('Elegí un archivo de audio.');
            if (file.size > MAX_AUDIO_BYTES) return Response.json({ error: 'El audio debe pesar hasta 4 MB.' }, { status: 413 });
            const mime = file.type.split(';')[0].toLowerCase();
            if (!AUDIO_EXTENSIONS[mime]) throw new InputError('Formato de audio no admitido. Usá MP3, M4A, WAV o AAC.');
            const body = new Uint8Array(await file.arrayBuffer());
            if (!isAudio(body, mime)) throw new InputError('El archivo no coincide con el formato de audio indicado.');
            const storagePath = `crm-audio/${crypto.randomUUID()}.${AUDIO_EXTENSIONS[mime]}`;
            await uploadStudioObject(storagePath, Buffer.from(body), { contentType: mime, upsert: false });
            return Response.json({ url: publicStudioUrl(storagePath), path: storagePath }, { status: 201 });
        }
        if (id && path.length === 1 && request.method === 'GET') {
            const leadId = uuid(id);
            const limit = Math.min(500, Math.max(50, Math.floor(Number(q.get('limit') || 100)) || 100));
            const queries = await Promise.all([
                db.from('leads').select('*,lead_tag_assignments(tag_id,lead_tags(id,name))').eq('id', leadId).maybeSingle(),
                db.from('lead_messages').select('*').eq('lead_id', leadId).order('received_at', { ascending: false }).limit(limit),
                db.from('inbox_outbox').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(limit),
                db.from('automation_events').select('id,message_id,dm_sent_at,error,automations(dm_text,dm_link_url)').eq('lead_id', leadId).not('dm_sent_at', 'is', null).order('dm_sent_at', { ascending: false }).limit(limit),
                db.from('followup_jobs').select('id,message_id,sent_at,step,error,followup_enrollments!inner(lead_id)').eq('followup_enrollments.lead_id', leadId).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(limit),
                db.from('story_automation_events').select('id,message_id,sent_at,created_at,status,error,story_automations(dm_text,dm_audio_url)').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(limit),
            ]);
            // Inspect every result even if a different query failed.
            const values = queries.map((r) => ({ data: r.data, error: r.error }));
            const failed = values.find((r) => r.error);
            if (failed) result(failed);
            const [leadRaw, receivedRaw, outboxRaw, eventsRaw, followupsRaw, storiesRaw] = values.map((r) => r.data);
            if (!leadRaw) return Response.json({ error: 'No se encontró el contacto.' }, { status: 404 });
            const lead = leadWithTags(leadRaw as unknown as RawLead);
            const received = receivedRaw as unknown as { id: string; meta_message_id: string; direction: 'inbound' | 'outbound'; text: string | null; attachments: Attachment[]; received_at: string }[];
            const outbox = outboxRaw as unknown as { id: string; message_id: string | null; kind: 'text' | 'audio'; text: string | null; audio_url: string | null; status: string; error: string | null; created_at: string; sent_at: string | null }[];
            const events = eventsRaw as unknown as { id: string; message_id: string | null; dm_sent_at: string; error: string | null; automations: { dm_text: string; dm_link_url: string | null } | null }[];
            const followups = followupsRaw as unknown as { id: string; message_id: string | null; sent_at: string; step: { kind: 'text' | 'audio'; text?: string; audio_url?: string }; error: string | null }[];
            const stories = storiesRaw as unknown as { id: string; message_id: string | null; sent_at: string | null; created_at: string; status: string; error: string | null; story_automations: { dm_text: string | null; dm_audio_url: string | null } | null }[];
            const outboundIds = new Set([...outbox, ...events, ...followups, ...stories].map((row) => row.message_id).filter(Boolean));
            const messages: Message[] = received.filter((row) => !(row.direction === 'outbound' && outboundIds.has(row.meta_message_id))).map((row) => {
                const attachments = Array.isArray(row.attachments) ? row.attachments : [];
                const audio = attachments.find((a) => a.type === 'audio');
                return { id: `message:${row.id}`, direction: row.direction || 'inbound', kind: audio ? 'audio' : 'text', text: row.text, audio_url: audio?.url || audio?.payload?.url || null, attachments, status: 'sent', error: null, created_at: row.received_at };
            });
            messages.push(...outbox.map((row) => ({ id: `outbox:${row.id}`, direction: 'outbound' as const, kind: row.kind, text: row.text, audio_url: row.audio_url, attachments: [], status: row.status, error: row.error, created_at: row.sent_at || row.created_at })));
            messages.push(...events.map((row) => ({ id: `automation:${row.id}`, direction: 'outbound' as const, kind: 'text' as const, text: [row.automations?.dm_text, row.automations?.dm_link_url].filter(Boolean).join('\n'), audio_url: null, attachments: [], status: 'sent', error: null, created_at: row.dm_sent_at })));
            messages.push(...followups.map((row) => ({ id: `followup:${row.id}`, direction: 'outbound' as const, kind: row.step.kind, text: row.step.text || null, audio_url: row.step.audio_url || null, attachments: [], status: 'sent', error: null, created_at: row.sent_at })));
            messages.push(...stories.map((row) => ({ id: `story:${row.id}`, direction: 'outbound' as const, kind: row.story_automations?.dm_audio_url ? 'audio' as const : 'text' as const, text: row.story_automations?.dm_text || null, audio_url: row.story_automations?.dm_audio_url || null, attachments: [], status: row.status, error: row.error, created_at: row.sent_at || row.created_at })));
            messages.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
            const blocked = replyBlock(lead);
            return Response.json({ lead, messages, canReply: !blocked, replyBlockedReason: blocked, truncated: [received, outbox, events, followups, stories].some((rows) => rows.length === limit) });
        }
        if (id && action === 'messages' && path.length === 2 && request.method === 'POST') {
            const leadId = uuid(id);
            const lead = result(await db.from('leads').select('id,ig_account_id,instagram_user_id,opted_out,last_inbound_at').eq('id', leadId).maybeSingle());
            if (!lead) return Response.json({ error: 'No se encontró el contacto.' }, { status: 404 });
            const blocked = replyBlock(lead as unknown as RawLead);
            if (blocked) return Response.json({ error: blocked }, { status: 409 });
            const body = object(await request.json());
            if (!['text', 'audio'].includes(String(body.kind))) throw new InputError('Elegí texto o audio.');
            const text = body.kind === 'text' && typeof body.text === 'string' ? body.text.trim() : null;
            if (body.kind === 'text' && (!text || text.length > 1000)) throw new InputError('Escribí un mensaje de entre 1 y 1000 caracteres.');
            const row = { client_id: body.client_id ? uuid(body.client_id) : crypto.randomUUID(), lead_id: leadId, kind: body.kind, text, audio_url: body.kind === 'audio' ? audioUrl(body.audio_url) : null, status: 'queued', next_attempt_at: new Date().toISOString() };
            const inserted = await db.from('inbox_outbox').insert(row).select().single();
            if (inserted.error?.code === '23505') {
                const previous = result(await db.from('inbox_outbox').select('*').eq('client_id', row.client_id).eq('lead_id', leadId).maybeSingle());
                if (previous && previous.kind === row.kind && previous.text === row.text && previous.audio_url === row.audio_url) return Response.json(previous, { status: 202 });
            }
            return Response.json(result(inserted), { status: 202 });
        }
        return Response.json({ error: 'Ruta no encontrada.' }, { status: 404 });
    } catch (e) {
        const error = e as Error & { code?: string };
        const missing = ['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST202'].includes(error.code || '');
        return Response.json({ error: missing ? 'Falta actualizar las tablas del CRM. Ejecutá supabase_migration_automations_crm.sql.' : error instanceof InputError || error instanceof SyntaxError ? error.message : 'No se pudo completar la operación de la bandeja.', migrationNeeded: missing }, { status: missing ? 428 : error instanceof InputError || error instanceof SyntaxError ? 400 : 500 });
    }
}

export { handle as GET, handle as POST };
