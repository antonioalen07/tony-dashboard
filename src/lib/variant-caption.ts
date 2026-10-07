import type { SupabaseClient } from '@supabase/supabase-js';

type DbError = { code?: string; message?: string };
function raise(error: DbError): never {
    const missing = ['42P01', '42703', 'PGRST200', 'PGRST204', 'PGRST205'].includes(error.code || '');
    throw Object.assign(new Error(missing ? 'Falta actualizar la columna caption de publicación. Ejecutá supabase_migration_ai_config.sql; la variante no se encoló.' : error.message || 'No se pudo guardar la descripción.'), { status: missing ? 428 : 500, migrationNeeded: missing, migrationFile: missing ? 'supabase_migration_ai_config.sql' : undefined });
}
export function parseVariantCaption(value: unknown): string {
    if (typeof value !== 'string' || value.length > 2200) throw Object.assign(new Error('La descripción debe ser texto de hasta 2200 caracteres.'), { status: 400 });
    return value.trim();
}
export function storedVariantCaption(params: unknown): string | null {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
    const value = (params as Record<string, unknown>).caption;
    return typeof value === 'string' ? value : null;
}
async function variant(db: SupabaseClient, id: string) {
    const response = await db.from('video_variants').select('id,params').eq('id', id).maybeSingle();
    if (response.error) raise(response.error);
    if (!response.data) throw Object.assign(new Error('La variante ya no existe.'), { status: 404 });
    return response.data as { id: string; params: Record<string, unknown> | null };
}
async function captionSchema(db: SupabaseClient) {
    const response = await db.from('publish_queue').select('caption').limit(0);
    if (response.error) raise(response.error);
}
async function writeVariant(db: SupabaseClient, row: { id: string; params: Record<string, unknown> | null }, caption: string) {
    const response = await db.from('video_variants').update({ params: { ...(row.params || {}), caption } }).eq('id', row.id);
    if (response.error) raise(response.error);
}
/** Guarda el borrador y actualiza sólo publicaciones que siguen pendientes. */
export async function persistVariantCaption(db: SupabaseClient, id: string, value: unknown) {
    const caption = parseVariantCaption(value);
    const row = await variant(db, id);
    await captionSchema(db);
    const pending = await db.from('publish_queue').update({ caption }).eq('variant_id', id).eq('status', 'pending');
    if (pending.error) raise(pending.error);
    await writeVariant(db, row, caption);
    return { caption };
}
/** La cola recibe un snapshot explícito de la descripción, incluso si está vacía. */
export async function enqueueVariantWithCaption(db: SupabaseClient, id: string, value: unknown) {
    const caption = parseVariantCaption(value);
    // Nunca degradar un error de esquema a una publicación sin descripción.
    await captionSchema(db);
    const row = await variant(db, id);
    const existing = await db.from('publish_queue').select('id,status,caption').eq('variant_id', id).limit(1).maybeSingle();
    if (existing.error) raise(existing.error);
    if (existing.data) {
        if (existing.data.status !== 'pending') return { queued: existing.data, alreadyQueued: true };
        const changed = await db.from('publish_queue').update({ caption }).eq('id', existing.data.id).eq('status', 'pending').select('id,status,caption').maybeSingle();
        if (changed.error) raise(changed.error);
        if (!changed.data) throw Object.assign(new Error('La publicación ya empezó. Su descripción no se modificó.'), { status: 409 });
        await writeVariant(db, row, caption);
        return { queued: changed.data, alreadyQueued: true };
    }
    await writeVariant(db, row, caption);
    const queued = await db.from('publish_queue').insert({ variant_id: id, kind: 'trial_reel', status: 'pending', scheduled_at: null, caption }).select('id,status,caption').single();
    if (queued.error) raise(queued.error);
    return { queued: queued.data, alreadyQueued: false };
}
