import { NextResponse } from 'next/server';
import { clearSessionCookie, logEvent, readSessionCookie, requestMeta, resolveSession, revokeSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Revoca la sesión actual en la base (si existe) y borra la cookie. Nunca falla hacia el cliente. */
export async function POST(request: Request) {
  const res = NextResponse.json({ success: true });
  clearSessionCookie(res);
  try {
    const ctx = await resolveSession(readSessionCookie(request));
    if (ctx) {
      await revokeSession(ctx.session.id);
      await logEvent('logout', { email: ctx.user.email, userId: ctx.user.id, meta: requestMeta(request), detail: { session: ctx.session.id } });
    }
  } catch (e) {
    console.error('[logout]', e);
  }
  return res;
}
