/**
 * Auth mínima de un solo usuario para el dashboard (puerta de acceso).
 * Credenciales en variables de entorno (nunca en el repo):
 *   APP_USER, APP_PASSWORD, AUTH_SECRET
 *
 * La cookie guarda un token opaco (hash), no la contraseña. El mismo token se
 * computa en el route handler (login) y en proxy.ts (verificación), usando
 * Web Crypto para que funcione tanto en Node como en el edge.
 */
export const COOKIE_NAME = 'crevy_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

const enc = new TextEncoder();

/** Token de sesión = SHA-256(user:password:secret) en hex. Cambiar cualquier credencial invalida sesiones. */
export async function sessionToken(): Promise<string> {
  const user = process.env.APP_USER || '';
  const pass = process.env.APP_PASSWORD || '';
  const secret = process.env.AUTH_SECRET || '';
  const data = enc.encode(`${user}:${pass}:${secret}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Comparación en tiempo (casi) constante para no filtrar longitud/contenido. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** ¿Hay credenciales configuradas? Si no, la puerta se deja abierta (no bloquea en dev sin setup). */
export function authConfigured(): boolean {
  return Boolean(process.env.APP_USER && process.env.APP_PASSWORD && process.env.AUTH_SECRET);
}

export function verifyCredentials(user: string, pass: string): boolean {
  const u = process.env.APP_USER || '';
  const p = process.env.APP_PASSWORD || '';
  // usuario case-insensitive (es un email), contraseña exacta
  return safeEqual(user.trim().toLowerCase(), u.trim().toLowerCase()) && safeEqual(pass, p);
}
