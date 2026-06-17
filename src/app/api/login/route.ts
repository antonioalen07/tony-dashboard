import { NextResponse } from 'next/server';
import { COOKIE_NAME, SESSION_MAX_AGE, authenticate, authConfigured } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!authConfigured()) {
      return NextResponse.json({ error: 'Auth no configurada en el servidor (faltan AUTH_USERS/AUTH_SECRET)' }, { status: 500 });
    }

    const { user, password } = await request.json();
    if (!user || !password) {
      return NextResponse.json({ error: 'Usuario y contraseña requeridos' }, { status: 400 });
    }

    const token = await authenticate(String(user), String(password));
    if (!token) {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 });
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Error' }, { status: 500 });
  }
}
