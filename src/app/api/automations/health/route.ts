import { requireRole } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { getAutomationHealth } from '../../../../../worker/lib/automation-health.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Health = Awaited<ReturnType<typeof getAutomationHealth>>;
let cached: { at: number; data: Health } | null = null;
let pending: Promise<Health> | null = null;

/** Lectura real de Meta y Supabase; nunca suscribe ni envía mensajes. */
export async function GET(request: Request) {
    const auth = await requireRole(request);
    if (!auth.ok) return auth.res;
    try {
        if (!cached || Date.now() - cached.at >= 30_000) {
            pending ||= getAutomationHealth(process.env, supabase, {
                expectedCallbackUrl: process.env.META_WEBHOOK_CALLBACK_URL || 'https://tony-dashboard-psi.vercel.app/api/webhooks/instagram',
            });
            try { cached = { at: Date.now(), data: await pending }; }
            finally { pending = null; }
        }
        return Response.json(cached.data, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
        return Response.json({ error: 'No se pudo comprobar la recepción de Instagram. Volvé a intentar.' }, { status: 503 });
    }
}
