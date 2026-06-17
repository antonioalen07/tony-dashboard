/**
 * Auth de la puerta de acceso (multi-usuario, credenciales en variables de entorno).
 *
 * Configurás los usuarios con UNA variable:
 *   AUTH_USERS = "email1@x.com:clave1,email2@x.com:clave2"
 *   AUTH_SECRET = <string aleatorio largo>
 *
 * (También se acepta un único usuario vía APP_USER + APP_PASSWORD, por compatibilidad.)
 *
 * Reglas de formato de AUTH_USERS: las entradas se separan por coma y cada una es
 * email:clave (se parte en el PRIMER ":"). Evitá comas en las claves.
 *
 * La cookie guarda un token opaco por usuario = SHA-256(email:clave:secret), nunca
 * la contraseña. Se computa con Web Crypto para funcionar en Node y en el edge.
 */
export const COOKIE_NAME = 'crevy_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

const enc = new TextEncoder();

export interface Credential {
  user: string;
  pass: string;
}

/** Lista de credenciales válidas, leída del entorno. */
export function getCredentials(): Credential[] {
  const creds: Credential[] = [];

  const multi = process.env.AUTH_USERS || '';
  for (const entry of multi.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const user = trimmed.slice(0, idx).trim();
    const pass = trimmed.slice(idx + 1);
    if (user && pass) creds.push({ user, pass });
  }

  // Usuario único legacy
  if (process.env.APP_USER && process.env.APP_PASSWORD) {
    creds.push({ user: process.env.APP_USER, pass: process.env.APP_PASSWORD });
  }

  return creds;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Token de sesión de un usuario concreto. */
export function tokenFor(cred: Credential): Promise<string> {
  const secret = process.env.AUTH_SECRET || '';
  return sha256Hex(`${cred.user.trim().toLowerCase()}:${cred.pass}:${secret}`);
}

/** Todos los tokens válidos (para que el proxy verifique la cookie contra cualquiera). */
export async function validTokens(): Promise<string[]> {
  return Promise.all(getCredentials().map(tokenFor));
}

/** Comparación en tiempo (casi) constante. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** ¿Hay al menos un usuario + secret? Si no, la puerta se deja abierta (sin lockout). */
export function authConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET) && getCredentials().length > 0;
}

/** Valida usuario+clave (email case-insensitive, clave exacta) y devuelve su token, o null. */
export async function authenticate(user: string, pass: string): Promise<string | null> {
  const u = user.trim().toLowerCase();
  for (const cred of getCredentials()) {
    if (safeEqual(u, cred.user.trim().toLowerCase()) && safeEqual(pass, cred.pass)) {
      return tokenFor(cred);
    }
  }
  return null;
}
