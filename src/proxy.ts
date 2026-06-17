import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_NAME, validTokens, safeEqual, authConfigured } from '@/lib/auth';

// Rutas que NO requieren sesión.
const PUBLIC_PATHS = ['/login', '/api/login', '/api/logout'];

export async function proxy(request: NextRequest) {
  // Sin credenciales configuradas, no bloqueamos (evita lockout en setups sin auth).
  if (!authConfigured()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  const cookie = request.cookies.get(COOKIE_NAME)?.value || '';
  const authed = Boolean(cookie) && (await validTokens()).some((t) => safeEqual(cookie, t));

  // Logueado entrando a /login → mandarlo al dashboard
  if (authed && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (authed || isPublic) return NextResponse.next();

  // No logueado: páginas → redirect a /login; APIs → 401 JSON
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Corre en todo menos assets estáticos de Next y archivos públicos.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
