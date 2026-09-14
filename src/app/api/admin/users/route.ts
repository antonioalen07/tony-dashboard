import { NextResponse } from 'next/server';
import {
  createUser,
  errorResponse,
  generateTempPassword,
  isValidEmail,
  listActiveSessions,
  listUsers,
  logEvent,
  normalizeEmail,
  passwordPolicyError,
  requestMeta,
  requireRole,
  type Role,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Lista de usuarios con cuántas sesiones vivas tiene cada uno. */
export async function GET(request: Request) {
  const auth = await requireRole(request, 'admin');
  if (!auth.ok) return auth.res;
  try {
    const [users, sessions] = await Promise.all([listUsers(), listActiveSessions()]);
    const counts = new Map<string, number>();
    for (const s of sessions) counts.set(s.user_id, (counts.get(s.user_id) ?? 0) + 1);
    return NextResponse.json({
      users: users.map((u) => ({ ...u, active_sessions: counts.get(u.id) ?? 0 })),
    });
  } catch (e) {
    return errorResponse(e, 500);
  }
}

/**
 * Alta de usuario. Si no viene `password`, se genera una provisoria y se
 * devuelve UNA sola vez en la respuesta para que el admin se la pase.
 * El usuario nuevo entra con `must_change_password` y tiene que elegir la suya.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, 'admin');
  if (!auth.ok) return auth.res;
  try {
    const body = await request.json().catch(() => null);
    const email = normalizeEmail(body?.email);
    const name = String(body?.name ?? '').trim().slice(0, 80);
    const role: Role = body?.role === 'admin' ? 'admin' : 'member';
    const provided = typeof body?.password === 'string' && body.password.length > 0;
    const password: string = provided ? body.password : generateTempPassword();

    if (!isValidEmail(email)) return NextResponse.json({ error: 'Email inválido' }, { status: 400 });
    if (provided) {
      const policy = passwordPolicyError(password);
      if (policy) return NextResponse.json({ error: policy }, { status: 400 });
    }

    const user = await createUser({ email, name, role, password, mustChangePassword: true });
    await logEvent('user_created', {
      email,
      userId: user.id,
      actorId: auth.claims.uid,
      meta: requestMeta(request),
      detail: { role, by: auth.claims.email },
    });

    return NextResponse.json({ user: { ...user, active_sessions: 0 }, tempPassword: provided ? null : password }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
