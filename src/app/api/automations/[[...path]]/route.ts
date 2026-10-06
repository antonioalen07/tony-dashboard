import { supabase as db } from '@/utils/supabase';
import { requireRole } from '@/lib/auth';
import { InputError, object, uuid, automationInput, sequenceInput, leadInput, tagName } from '@/lib/automation-validation';
export const dynamic = 'force-dynamic';
type Context = {
    params: Promise<{
        path?: string[];
    }>;
};
function result<T>(r: {
    data: T;
    error: {
        message: string;
        code?: string;
    } | null;
}): NonNullable<T> { if (r.error)
    throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.data as NonNullable<T>; }
const json = (data: unknown) => Response.json(data);
async function handle(request: Request, context: Context) {
    const auth = await requireRole(request);
    if (!auth.ok)
        return auth.res;
    const path = (await context.params).path || [];
    const [resource, id, action] = path;
    const method = request.method;
    const q = new URL(request.url).searchParams;
    const limit = Math.min(200, Math.max(1, Number(q.get('limit') || 50) || 50));
    const offset = Math.max(0, Number(q.get('offset') || 0) || 0);
    try {
        if (!resource) {
            if (method === 'GET') {
                const autos = result(await db.from('automations').select('*').order('created_at', { ascending: false }));
                const counts = result(await db.rpc('automation_stats')) as {
                    automation_id: string;
                    status: string;
                    count: number;
                }[];
                const mediaIds = autos.map((a) => a.media_id).filter(Boolean);
                const reels = mediaIds.length ? result(await db.from('reels').select('instagram_id,title,cover_url').in('instagram_id', mediaIds)) : [];
                return json(autos.map((a) => ({ ...a, stats: Object.fromEntries(counts.filter((c) => c.automation_id === a.id).map((c) => [c.status, Number(c.count)])), reel: reels.find((r) => r.instagram_id === a.media_id) })));
            }
            if (method === 'POST')
                return json(result(await db.from('automations').insert(automationInput(await request.json())).select().single()));
        }
        if (resource === 'media' && method === 'GET')
            return json({ reels: result(await db.from('reels').select('instagram_id,title,cover_url,published_at,views').order('published_at', { ascending: false }).limit(200)).filter((r) => /^\d{1,18}$/.test(r.instagram_id || '')), pending: result(await db.from('publish_queue').select('id,caption,scheduled_at').eq('status', 'pending').order('scheduled_at', { ascending: true })) });
        if (resource === 'events') {
            if (method === 'GET') {
                let query = db.from('automation_events').select('*').order('created_at', { ascending: false }).range(offset, offset + limit - 1);
                if (q.get('automationId'))
                    query = query.eq('automation_id', uuid(q.get('automationId')));
                return json(result(await query));
            }
            if (method === 'POST' && id && action === 'retry') {
                const row = result(await db.from('automation_events').update({ status: 'queued', attempts: 0, error: null, next_attempt_at: new Date().toISOString() }).eq('id', uuid(id)).eq('status', 'failed').select().maybeSingle());
                return row ? json(row) : Response.json({ error: 'Sólo podés reintentar un envío fallido confirmado' }, { status: 409 });
            }
        }
        if (resource === 'tags') {
            if (method === 'GET')
                return json(result(await db.from('lead_tags').select('*').order('name')));
            if (method === 'POST')
                return json(result(await db.from('lead_tags').insert({ name: tagName(object(await request.json()).name) }).select().single()));
            if (method === 'PATCH' && id)
                return json(result(await db.from('lead_tags').update({ name: tagName(object(await request.json()).name) }).eq('id', uuid(id)).select().single()));
            if (method === 'DELETE' && id) {
                result(await db.from('lead_tags').delete().eq('id', uuid(id)));
                return json({ success: true });
            }
        }
        if (resource === 'leads') {
            if (method === 'GET' && !id) {
                let query = db.from('leads').select('*,lead_tag_assignments(tag_id,lead_tags(id,name))').order('updated_at', { ascending: false }).range(offset, offset + limit - 1);
                const search = (q.get('search') || '').replace(/[%_]/g, '').slice(0, 100);
                if (search)
                    query = query.ilike('username', `%${search}%`);
                if (q.get('qualification'))
                    query = query.eq('qualification', q.get('qualification'));
                if (q.get('tag')) {
                    const assignments = result(await db.from('lead_tag_assignments').select('lead_id').eq('tag_id', uuid(q.get('tag'))));
                    if (!assignments.length)
                        return json([]);
                    query = query.in('id', assignments.map((a) => a.lead_id));
                }
                return json(result(await query).map((l) => ({ ...l, tags: l.lead_tag_assignments.map((a: {
                        lead_tags: unknown;
                    }) => a.lead_tags) })));
            }
            if (id && method === 'GET')
                return json({ lead: result(await db.from('leads').select('*').eq('id', uuid(id)).single()), messages: result(await db.from('lead_messages').select('*').eq('lead_id', id).order('received_at', { ascending: false }).limit(50)), events: result(await db.from('automation_events').select('*').eq('lead_id', id).order('created_at', { ascending: false }).limit(50)), enrollments: result(await db.from('followup_enrollments').select('*,followup_sequences(name),followup_jobs(*)').eq('lead_id', id).order('created_at', { ascending: false }).limit(50)) });
            if (id && action === 'tags') {
                const tag = uuid(object(await request.json()).tag_id);
                if (method === 'POST') {
                    result(await db.from('lead_tag_assignments').upsert({ lead_id: uuid(id), tag_id: tag }));
                    return json({ success: true });
                }
                if (method === 'DELETE') {
                    result(await db.from('lead_tag_assignments').delete().eq('lead_id', uuid(id)).eq('tag_id', tag));
                    return json({ success: true });
                }
            }
            if (id && method === 'PATCH')
                return json(result(await db.from('leads').update(leadInput(await request.json())).eq('id', uuid(id)).select().single()));
        }
        if (resource === 'sequences') {
            if (method === 'GET')
                return json(result(await db.from('followup_sequences').select('*').order('created_at', { ascending: false })));
            if (method === 'POST')
                return json(result(await db.from('followup_sequences').insert(sequenceInput(await request.json())).select().single()));
            if (method === 'PATCH' && id) {
                const b = object(await request.json());
                const fields = Object.keys(b).length === 1 && typeof b.active === 'boolean' ? { active: b.active, updated_at: new Date().toISOString() } : sequenceInput(b);
                return json(result(await db.from('followup_sequences').update(fields).eq('id', uuid(id)).select().single()));
            }
            if (method === 'DELETE' && id) {
                result(await db.from('followup_sequences').delete().eq('id', uuid(id)));
                return json({ success: true });
            }
        }
        if (resource === 'enrollments') {
            if (method === 'POST' && !id) {
                const b = object(await request.json());
                return json({ id: result(await db.rpc('automation_enroll', { p_lead: uuid(b.lead_id), p_sequence: uuid(b.sequence_id) })) });
            }
            if (method === 'DELETE' && id) {
                result(await db.rpc('automation_cancel_enrollment', { p_id: uuid(id) }));
                return json({ success: true });
            }
        }
        if (resource === 'followups' && method === 'GET')
            return json(result(await db.from('followup_jobs').select('*,followup_enrollments(lead_id,sequence_id,leads(username),followup_sequences(name))').order('due_at', { ascending: false }).range(offset, offset + limit - 1)));
        if (resource === 'followups' && method === 'POST' && id && action === 'retry') {
            const job = result(await db.from('followup_jobs').select('enrollment_id,status').eq('id', uuid(id)).single());
            const enrollment = result(await db.from('followup_enrollments').select('status').eq('id', job.enrollment_id).single());
            if (!['failed', 'blocked'].includes(job.status) || enrollment.status !== 'active')
                return Response.json({ error: 'Sólo podés reintentar pasos bloqueados o fallidos de una inscripción activa' }, { status: 409 });
            return json(result(await db.from('followup_jobs').update({ status: 'queued', attempts: 0, error: null, due_at: new Date().toISOString() }).eq('id', id).in('status', ['failed', 'blocked']).select().single()));
        }
        if (path.length === 1 && !['media', 'events', 'tags', 'leads', 'sequences', 'enrollments', 'followups'].includes(resource)) {
            if (method === 'PATCH') {
                const b = object(await request.json());
                const fields = Object.keys(b).length === 1 && typeof b.active === 'boolean' ? { active: b.active, updated_at: new Date().toISOString() } : automationInput(b);
                return json(result(await db.from('automations').update(fields).eq('id', uuid(resource)).select().single()));
            }
            if (method === 'DELETE') {
                result(await db.from('automations').delete().eq('id', uuid(resource)));
                return json({ success: true });
            }
        }
        return Response.json({ error: 'Ruta no encontrada' }, { status: 404 });
    }
    catch (e) {
        const error = e as Error & {
            code?: string;
        };
        const missing = ['42P01', 'PGRST205', 'PGRST202'].includes(error.code || '');
        return Response.json({ error: missing ? 'Falta ejecutar supabase_migration_automations.sql' : error instanceof InputError || error.code === 'P0001' ? error.message : error.code === '23505' ? 'Ya existe ese registro' : 'No se pudo completar la operación', migrationNeeded: missing }, { status: missing ? 428 : error instanceof InputError || error instanceof SyntaxError ? 400 : ['23505', 'P0001'].includes(error.code || '') ? 409 : 500 });
    }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
