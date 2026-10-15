import { getClaims } from '@/lib/auth';
import { pushConfigured, sendPush } from '@/lib/push';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET    /api/push[?endpoint=]     → { configured, publicKey, tag_ids? (filtro de ese dispositivo) }
 * PATCH  /api/push  {endpoint, tag_ids} → filtro de etiquetas de este dispositivo ([] = todos)
 * POST   /api/push  {subscription} → guarda este dispositivo
 * POST   /api/push  {test, endpoint} → manda una notificación de prueba a este dispositivo
 * DELETE /api/push  {endpoint}     → da de baja este dispositivo
 */
type Body = { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; endpoint?: unknown; test?: unknown; tag_ids?: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const isEndpoint = (v: unknown): v is string => typeof v === 'string' && v.length < 2000 && /^https:\/\//.test(v);

export async function GET(request: Request) {
    const endpoint = new URL(request.url).searchParams.get('endpoint');
    let tag_ids: string[] | null = null;
    let filtersAvailable = true;
    if (isEndpoint(endpoint)) {
        const { data, error } = await supabase.from('push_subscriptions').select('tag_ids').eq('endpoint', endpoint).maybeSingle();
        if (error) filtersAvailable = false; // falta supabase_migration_push_tags.sql
        else tag_ids = (data?.tag_ids as string[] | undefined) ?? null;
    }
    return Response.json({ configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY || null, tag_ids, filtersAvailable });
}

export async function PATCH(request: Request) {
    let body: Body;
    try { body = await request.json(); } catch { return bad('El cuerpo de la solicitud no es un JSON válido'); }
    if (!isEndpoint(body.endpoint)) return bad('Falta el dispositivo');
    if (!Array.isArray(body.tag_ids) || body.tag_ids.length > 50 || !body.tag_ids.every((t) => typeof t === 'string' && UUID.test(t))) return bad('Etiquetas inválidas');
    const { data, error } = await supabase.from('push_subscriptions').update({ tag_ids: [...new Set(body.tag_ids as string[])] }).eq('endpoint', body.endpoint).select('tag_ids').maybeSingle();
    if (error) return bad(error.code === '42703' ? 'Falta correr supabase_migration_push_tags.sql en Supabase.' : error.message, 500);
    if (!data) return bad('Este dispositivo no tiene las notificaciones activas.', 404);
    return Response.json(data);
}

export async function POST(request: Request) {
    if (!pushConfigured()) return bad('Las notificaciones todavía no están configuradas en el servidor (faltan las claves VAPID).', 503);
    const claims = await getClaims(request);
    let body: Body;
    try { body = await request.json(); } catch { return bad('El cuerpo de la solicitud no es un JSON válido'); }
    if (body.test) {
        if (!isEndpoint(body.endpoint)) return bad('Falta el dispositivo');
        const result = await sendPush({ title: 'BAKO', body: 'Listo: las notificaciones llegan a este dispositivo.', url: '/automatizaciones?tab=inbox', tag: 'test' }, { endpoint: body.endpoint });
        return result.sent ? Response.json(result) : bad('No se pudo enviar la prueba. Desactivá y volvé a activar las notificaciones.', 502);
    }
    const s = body.subscription;
    if (!isEndpoint(s?.endpoint) || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') return bad('Suscripción inválida');
    const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth,
        user_id: claims?.uid || null, user_agent: request.headers.get('user-agent')?.slice(0, 300) || null,
    }, { onConflict: 'endpoint' });
    if (error) return bad(['42P01', 'PGRST205'].includes(error.code || '') ? 'Falta correr supabase_migration_crm_inbox_v2.sql en Supabase.' : error.message, 500);
    return Response.json({ success: true }, { status: 201 });
}

export async function DELETE(request: Request) {
    let body: Body;
    try { body = await request.json(); } catch { return bad('El cuerpo de la solicitud no es un JSON válido'); }
    if (!isEndpoint(body.endpoint)) return bad('Falta el dispositivo');
    await supabase.from('push_subscriptions').delete().eq('endpoint', body.endpoint);
    return Response.json({ success: true });
}
