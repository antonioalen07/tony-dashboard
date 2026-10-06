import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabase } from '@/utils/supabase';
import { enqueueComment } from '../../../../../worker/lib/automation-core.mjs';
import { createMeta } from '../../../../../worker/lib/meta.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
interface Change {
    field: string;
    value: {
        id: string;
        text?: string;
        timestamp?: string;
        from?: {
            id: string;
            username?: string;
        };
        media?: {
            id: string;
        };
    };
}
interface Message {
    sender?: {
        id: string;
    };
    recipient?: {
        id: string;
    };
    timestamp?: number;
    message?: {
        mid: string;
        text?: string;
        is_echo?: boolean;
    };
}
interface Entry {
    id: string;
    time?: number;
    changes?: Change[];
    messaging?: Message[];
}
export async function GET(request: Request) {
    const q = new URL(request.url).searchParams;
    if (process.env.META_WEBHOOK_VERIFY_TOKEN && q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === process.env.META_WEBHOOK_VERIFY_TOKEN)
        return new Response(q.get('hub.challenge') || '', { headers: { 'Content-Type': 'text/plain' } });
    return new Response('No autorizado', { status: 403 });
}
export async function POST(request: Request) {
    const raw = await request.text();
    const secret = process.env.META_APP_SECRET;
    if (!secret)
        return new Response('Webhook sin configurar', { status: 503 });
    const signature = request.headers.get('x-hub-signature-256') || '';
    const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    if (!/^sha256=[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
        return new Response('Firma inválida', { status: 401 });
    let body: {
        object?: string;
        entry?: Entry[];
    };
    try {
        body = JSON.parse(raw);
    }
    catch {
        return new Response('JSON inválido', { status: 400 });
    }
    if (body.object !== 'instagram')
        return Response.json({ received: true });
    const account = process.env.META_IG_ACCOUNT_ID || '17841476480622974';
    try {
        const { data: autos, error } = await supabase.from('automations').select('*').eq('active', true);
        if (error)
            throw error;
        const meta = createMeta(process.env);
        for (const entry of body.entry || []) {
            if (entry.id !== account)
                continue;
            for (const change of entry.changes || []) {
                if (change.field !== 'comments')
                    continue;
                const c = change.value;
                if (!c?.id || !c.media?.id || c.from?.id === account)
                    continue;
                // El webhook puede omitir la fecha original; no usar la hora de recepción.
                const at = c.timestamp || (await meta.get(`${c.id}?fields=timestamp`)).timestamp;
                await enqueueComment(supabase, { id: c.id, mediaId: c.media.id, text: c.text || '', at, userId: c.from?.id, username: c.from?.username }, autos || [], account, 'webhook');
            }
            for (const event of entry.messaging || []) {
                if (!event.message?.mid || event.message.is_echo || !event.sender?.id || event.sender.id === account || event.recipient?.id !== account)
                    continue;
                if (!event.timestamp || event.timestamp > Date.now() + 60000)
                    continue;
                const { error: e } = await supabase.rpc('automation_receive_message', { p_account: account, p_user: event.sender.id, p_mid: event.message.mid, p_text: event.message.text || '', p_at: new Date(Math.min(event.timestamp, Date.now())).toISOString() });
                if (e)
                    throw e;
            }
        }
        return Response.json({ received: true });
    }
    catch {
        // Pedir reentrega cuando falla la persistencia; las inserciones son idempotentes.
        console.error('[instagram webhook] No se pudo persistir el evento');
        return new Response('Reintentá más tarde', { status: 503 });
    }
}
