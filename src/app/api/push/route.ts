import { getClaims } from '@/lib/auth';
import { pushConfigured, sendPush } from '@/lib/push';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET    /api/push                 → { configured, publicKey }
 * POST   /api/push  {subscription} → guarda este dispositivo
 * POST   /api/push  {test, endpoint} → manda una notificación de prueba a este dispositivo
 * DELETE /api/push  {endpoint}     → da de baja este dispositivo
 */
type Body = { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; endpoint?: unknown; test?: unknown };
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const isEndpoint = (v: unknown): v is string => typeof v === 'string' && v.length < 2000 && /^https:\/\//.test(v);

export async function GET() {
    return Response.json({ configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY || null });
}

export async function POST(request: Request) {
    if (!pushConfigured()) return bad('Las notificaciones todavía no están configuradas en el servidor (faltan las claves VAPID).', 503);
    const claims = await getClaims(request);
    let body: Body;
    try { body = await request.json(); } catch { return bad('El cuerpo de la solicitud no es un JSON válido'); }
    if (body.test) {
        if (!isEndpoint(body.endpoint)) return bad('Falta el dispositivo');
        const result = await sendPush({ title: 'BAKO', body: 'Listo: las notificaciones llegan a este dispositivo.', url: '/automatizaciones?tab=inbox', tag: 'test' }, body.endpoint);
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
