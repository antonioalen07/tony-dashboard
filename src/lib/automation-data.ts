import type { SupabaseClient } from '@supabase/supabase-js';
import { isActiveReel } from '@/lib/reel-curation';

type DatabaseError = { code?: string; message?: string };
type QueryResult<T> = { data: T | null; error: DatabaseError | null };

export function automationDataError(error: DatabaseError, resource = '') {
    const code = error.code || '';
    const schemaMissing = ['42P01', '42703', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code);
    const migrationFile = ['42703', 'PGRST200', 'PGRST204'].includes(code) || ['leads', 'followups'].includes(resource)
        ? 'supabase_migration_automations_crm.sql'
        : 'supabase_migration_automations.sql';
    if (schemaMissing)
        return { error: `La base de datos necesita actualizar el esquema de automatizaciones. Ejecutá ${migrationFile} en Supabase y volvé a cargar.`, migrationNeeded: true, migrationFile, status: 428 };
    if (code === '42501')
        return { error: 'Supabase rechazó el acceso. Revisá SUPABASE_SERVICE_ROLE_KEY en el servidor.', migrationNeeded: false, status: 503 };
    if (code === 'PGRST116')
        return { error: 'No se encontró ese registro. Actualizá la lista e intentá de nuevo.', migrationNeeded: false, status: 404 };
    if (code === '23505')
        return { error: 'Ya existe ese registro', migrationNeeded: false, status: 409 };
    if (code === '23503')
        return { error: 'El contacto, la etiqueta o la publicación vinculada ya no existe. Actualizá la lista e intentá de nuevo.', migrationNeeded: false, status: 409 };
    return { error: 'No se pudo consultar Supabase. Volvé a intentar y revisá la conexión del servidor si el problema continúa.', migrationNeeded: false, status: 503 };
}

/** Los datos auxiliares nunca impiden cargar las automatizaciones o los reels. */
export async function optionalAutomationData<T>(query: PromiseLike<QueryResult<T>>, fallback: T, label: string) {
    try {
        const response = await query;
        if (!response.error)
            return { data: response.data ?? fallback, warnings: [] as string[] };
        return { data: fallback, warnings: [`${label}: ${automationDataError(response.error).error}`] };
    }
    catch {
        return { data: fallback, warnings: [`${label}: no se pudo conectar con Supabase. Volvé a intentar.`] };
    }
}

export type AutomationMedia = {
    instagram_id: string;
    title: string;
    cover_url: string | null;
    published_at: string | null;
    views: number | null;
    is_hidden?: boolean;
    is_duplicate?: boolean;
};
type PendingMedia = { id: string; caption: string | null; scheduled_at: string | null };

export function isAutomationMediaId(id: unknown): id is string {
    // Los IDs de Graph API se guardan como texto. Los IDs de Apify de 19+
    // dígitos no se pueden usar para responder comentarios con Meta.
    return typeof id === 'string' && /^\d{1,18}$/.test(id);
}

export async function loadAutomationMedia(db: SupabaseClient) {
    const [reels, pending] = await Promise.all([
        optionalAutomationData<AutomationMedia[]>(db.from('reels')
            .select('*')
            // Filtrar antes del límite evita que reels de Apify oculten los propios.
            .not('instagram_id', 'like', '___________________%')
            .order('published_at', { ascending: false }), [], 'Reels'),
        optionalAutomationData<PendingMedia[]>(db.from('publish_queue')
            .select('id,caption,scheduled_at').eq('status', 'pending')
            .order('scheduled_at', { ascending: true }), [], 'Publicaciones programadas'),
    ]);
    const visible = reels.data
        .filter((reel) => isAutomationMediaId(reel.instagram_id) && isActiveReel(reel))
        .slice(0, 200)
        .map(({ instagram_id, title, cover_url, published_at, views }) => ({ instagram_id, title, cover_url, published_at, views }));
    return { reels: visible, pending: pending.data, warnings: [...reels.warnings, ...pending.warnings] };
}

/** Comillas y escapes impiden convertir el texto en operadores de PostgREST. */
export function leadSearchFilter(value: string) {
    const search = value.slice(0, 100).trim();
    if (!search)
        return '';
    const pattern = search.replace(/[\\%_]/g, '\\$&');
    const quoted = `"%${pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}%"`;
    return ['username', 'display_name', 'notes'].map((column) => `${column}.ilike.${quoted}`).join(',');
}
