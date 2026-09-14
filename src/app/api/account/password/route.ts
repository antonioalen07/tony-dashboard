import { NextResponse } from 'next/server';
import {
  errorResponse,
  logEvent,
  passwordPolicyError,
  requestMeta,
  requireRole,
  revokeUserSessions,
  setPassword,
  verifyPassword,
} from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/**
 * Cambio de contraseña del propio usuario. Pide la actual, aplica la política y
 * cierra las demás sesiones de ese usuario (si alguien tenía su clave, afuera).
 */
export async function POST(request: Request) {
  const auth = await requireRole(request);
  if (!auth.ok) return auth.res;

  try {
    const body = await request.json().catch(() => null);
    const current = String(body?.current ?? '');
    const next = String(body?.next ?? '');

    const policy = passwordPolicyError(next);
    if (policy) return NextResponse.json({ error: policy }, { status: 400 });
    if (next === current) return NextResponse.json({ error: 'La contraseña nueva tiene que ser distinta de la actual' }, { status: 400 });

    const { data, error } = await supabase
      .from('app_users')
      .select('password_hash, email')
      .eq('id', auth.claims.uid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || !(await verifyPassword(current, data.password_hash))) {
      return NextResponse.json({ error: 'La contraseña actual no es correcta' }, { status: 400 });
    }

    await setPassword(auth.claims.uid, next, false);
    const closed = await revokeUserSessions(auth.claims.uid, auth.claims.sid);
    await logEvent('password_changed', {
      email: data.email,
      userId: auth.claims.uid,
      actorId: auth.claims.uid,
      meta: requestMeta(request),
      detail: { otherSessionsClosed: closed },
    });

    return NextResponse.json({ success: true, otherSessionsClosed: closed });
  } catch (e) {
    return errorResponse(e, 500);
  }
}
