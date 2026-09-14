import { NextResponse } from 'next/server';
import { clearSessionCookie, errorResponse, logEvent, requestMeta, requireRole, revokeSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cierra una sesión puntual (un dispositivo). Si es la propia, también borra la cookie. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, 'admin');
  if (!auth.ok) return auth.res;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: 'Id inválido' }, { status: 400 });

    const { data: target } = await supabase
      .from('app_sessions')
      .select('id, user_id, user:app_users(email)')
      .eq('id', id)
      .maybeSingle();
    if (!target) return NextResponse.json({ error: 'Sesión no encontrada' }, { status: 404 });

    await revokeSession(id);
    const u = target.user as unknown as { email: string } | { email: string }[] | null;
    const email = Array.isArray(u) ? u[0]?.email : u?.email;
    await logEvent('session_revoked', {
      email: email ?? null,
      userId: target.user_id,
      actorId: auth.claims.uid,
      meta: requestMeta(request),
      detail: { session: id, by: auth.claims.email },
    });

    const res = NextResponse.json({ success: true, wasCurrent: id === auth.claims.sid });
    if (id === auth.claims.sid) clearSessionCookie(res);
    return res;
  } catch (e) {
    return errorResponse(e, 500);
  }
}
