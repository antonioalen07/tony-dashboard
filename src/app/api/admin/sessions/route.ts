import { NextResponse } from 'next/server';
import { clearSessionCookie, errorResponse, listActiveSessions, logEvent, requestMeta, requireRole, revokeAllSessions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Sesiones vivas de todos los usuarios; marca cuál es la del que consulta. */
export async function GET(request: Request) {
  const auth = await requireRole(request, 'admin');
  if (!auth.ok) return auth.res;
  try {
    const sessions = await listActiveSessions();
    return NextResponse.json({
      sessions: sessions.map((s) => ({ ...s, current: s.id === auth.claims.sid })),
    });
  } catch (e) {
    return errorResponse(e, 500);
  }
}

/**
 * Expulsar a todos. `?scope=others` (default) conserva la sesión del admin
 * que lo pide; `?scope=all` la cierra también (y borra su cookie).
 */
export async function DELETE(request: Request) {
  const auth = await requireRole(request, 'admin');
  if (!auth.ok) return auth.res;
  try {
    const scope = new URL(request.url).searchParams.get('scope') === 'all' ? 'all' : 'others';
    const revoked = await revokeAllSessions(scope === 'all' ? undefined : auth.claims.sid);
    await logEvent('sessions_revoked_all', {
      email: auth.claims.email,
      userId: auth.claims.uid,
      actorId: auth.claims.uid,
      meta: requestMeta(request),
      detail: { scope, revoked },
    });
    const res = NextResponse.json({ success: true, revoked, scope });
    if (scope === 'all') clearSessionCookie(res);
    return res;
  } catch (e) {
    return errorResponse(e, 500);
  }
}
