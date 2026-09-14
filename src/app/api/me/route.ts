import { NextResponse } from 'next/server';
import { errorResponse, getUserById, requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Quién soy: lo usa el Sidebar (para mostrar Admin / Mi cuenta) y la pantalla de cuenta. */
export async function GET(request: Request) {
  const auth = await requireRole(request);
  if (!auth.ok) return auth.res;
  try {
    const user = await getUserById(auth.claims.uid);
    if (!user || !user.is_active) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.must_change_password,
      lastLoginAt: user.last_login_at,
      sessionId: auth.claims.sid,
    });
  } catch (e) {
    return errorResponse(e, 500);
  }
}
