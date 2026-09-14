import { NextResponse } from 'next/server';
import { COOKIE_NAME, errorResponse, login, requestMeta, sessionCookieOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const user = String(body?.user ?? body?.email ?? '').trim();
    const password = String(body?.password ?? '');
    if (!user || !password) {
      return NextResponse.json({ error: 'Usuario y contraseña requeridos' }, { status: 400 });
    }
    if (password.length > 200) {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 });
    }

    const result = await login(user, password, requestMeta(request));
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const res = NextResponse.json({
      success: true,
      mustChangePassword: result.user.must_change_password,
      role: result.user.role,
    });
    res.cookies.set(COOKIE_NAME, result.token, sessionCookieOptions());
    return res;
  } catch (error) {
    console.error('[login]', error);
    return errorResponse(error, 500);
  }
}
