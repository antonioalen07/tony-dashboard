import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_HEADER, COOKIE_NAME, AuthUnavailableError, resolveSession, signAuthHeader, clearSessionCookie } from '@/lib/auth';

/**
 * Puerta de acceso. Corre en Node antes de cada página / API.
 *
 * Reglas:
 *  - Sin sesión válida no pasa nada salvo /login y /api/login (y /api/logout,
 *    para poder borrar una cookie muerta). Si la base de auth no responde, se
 *    CIERRA (503 / login con aviso): nunca "dejar pasar por las dudas".
 *  - Peticiones que mutan (/api POST/PUT/PATCH/DELETE) tienen que venir del
 *    mismo origen: corta CSRF aun si algún navegador ignora SameSite.
 *  - /admin y /api/admin sólo para rol admin.
 *  - Con clave provisoria, sólo se puede ir a /cuenta a cambiarla.
 *  - Al handler le llega un header firmado con los claims; el que traiga el
 *    cliente se descarta siempre.
 */
const PUBLIC_PATHS = ['/login', '/api/login', '/api/logout', '/api/webhooks/instagram'];
const PUBLIC_LEGAL_PAGES = new Set(['/privacidad', '/eliminacion-datos']);
const PASSWORD_CHANGE_PATHS = ['/cuenta', '/api/account/password', '/api/me', '/api/logout'];
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const startsWithAny = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));

const json = (error: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // Sólo documentos legales públicos de lectura. No incluye descendientes,
  // APIs ni acciones de servidor POST, y no depende de la base de sesiones.
  if ((request.method === 'GET' || request.method === 'HEAD') && PUBLIC_LEGAL_PAGES.has(pathname)) {
    const headers = new Headers(request.headers);
    headers.delete(AUTH_HEADER);
    return NextResponse.next({ request: { headers } });
  }

  // Meta se autentica con HMAC; no necesita sesión ni Origin de navegador.
  if (pathname === '/api/webhooks/instagram') {
    const headers = new Headers(request.headers);
    headers.delete(AUTH_HEADER);
    return NextResponse.next({ request: { headers } });
  }

  // CSRF: una petición que muta tiene que ser same-origin.
  if (isApi && MUTATING.has(request.method)) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const site = request.headers.get('sec-fetch-site');
    let crossOrigin = site === 'cross-site';
    if (origin) {
      try {
        crossOrigin ||= new URL(origin).host !== host;
      } catch {
        crossOrigin = true;
      }
    }
    if (crossOrigin) return json('Origen no permitido', 403);
  }

  // El header interno lo pone SOLO el proxy: lo que venga de afuera se tira.
  const headers = new Headers(request.headers);
  headers.delete(AUTH_HEADER);

  const token = request.cookies.get(COOKIE_NAME)?.value;
  let ctx = null;
  let unavailable: string | null = null;
  try {
    ctx = await resolveSession(token);
  } catch (e) {
    unavailable = e instanceof AuthUnavailableError ? e.message : `Error de autenticación: ${(e as Error).message}`;
    console.error('[proxy]', unavailable);
  }

  if (ctx) {
    if (pathname === '/login') return NextResponse.redirect(new URL('/', request.url));

    if (ctx.user.must_change_password && !startsWithAny(pathname, PASSWORD_CHANGE_PATHS)) {
      if (isApi) return json('Tenés que cambiar tu contraseña provisoria', 403, { code: 'PASSWORD_CHANGE_REQUIRED' });
      return NextResponse.redirect(new URL('/cuenta?forzar=1', request.url));
    }

    if (startsWithAny(pathname, ['/admin', '/api/admin']) && ctx.user.role !== 'admin') {
      return isApi ? json('Sólo para administradores', 403) : NextResponse.redirect(new URL('/', request.url));
    }

    const signed = signAuthHeader(ctx);
    if (signed) headers.set(AUTH_HEADER, signed);
    return NextResponse.next({ request: { headers } });
  }

  if (startsWithAny(pathname, PUBLIC_PATHS)) return NextResponse.next({ request: { headers } });

  if (isApi) {
    return unavailable ? json(unavailable, 503, { code: 'AUTH_UNAVAILABLE' }) : json('No autorizado', 401);
  }

  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') loginUrl.searchParams.set('from', pathname);
  if (unavailable) loginUrl.searchParams.set('error', 'unavailable');
  const res = NextResponse.redirect(loginUrl);
  // Cookie inválida (p. ej. de la auth anterior): se borra al mandarlo al login.
  if (token && !unavailable) clearSessionCookie(res);
  return res;
}

export const config = {
  // Corre en todo menos assets estáticos de Next y archivos públicos.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
