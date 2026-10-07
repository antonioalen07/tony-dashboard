import { supabase } from '@/utils/supabase';
import { requireRole } from '@/lib/auth';
import { InputError, object, storyInput, uuid } from '@/lib/automation-validation';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path?: string[] }> };
function checked<T>({ data, error }: { data: T; error: { code?: string; message: string } | null }): T {
    if (error) throw error;
    return data;
}
async function handle(request: Request, context: Context) {
    const auth = await requireRole(request);
    if (!auth.ok) return auth.res;
    try {
        const path = (await context.params).path || [];
        if (path.length > 1) return Response.json({ error: 'Ruta no encontrada' }, { status: 404 });
        const id = path[0] ? uuid(path[0]) : null;
        if (request.method === 'GET' && !id) return Response.json(checked(await supabase.from('story_automations').select('*').order('created_at', { ascending: false })));
        if (request.method === 'POST' && !id) return Response.json(checked(await supabase.from('story_automations').insert(storyInput(await request.json())).select().single()), { status: 201 });
        if (request.method === 'PATCH' && id) {
            const b = object(await request.json());
            const data = Object.keys(b).length === 1 && typeof b.active === 'boolean' ? { active: b.active, updated_at: new Date().toISOString() } : storyInput(b);
            return Response.json(checked(await supabase.from('story_automations').update(data).eq('id', id).select().single()));
        }
        if (request.method === 'DELETE' && id) { checked(await supabase.from('story_automations').delete().eq('id', id)); return Response.json({ deleted: true }); }
        return Response.json({ error: 'Ruta no encontrada' }, { status: 404 });
    } catch (error) {
        const e = error as Error & { code?: string };
        if (e instanceof InputError || e instanceof SyntaxError) return Response.json({ error: e.message }, { status: 400 });
        if (['42P01', '42703', 'PGRST205', 'PGRST204'].includes(e.code || '')) return Response.json({ error: 'Falta actualizar la base de datos para historias y bandeja.', migrationFile: 'supabase_migration_automations_crm.sql' }, { status: 428 });
        console.error('[story automations]', e.code || 'error');
        return Response.json({ error: 'No se pudieron guardar o cargar las historias' }, { status: 500 });
    }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
