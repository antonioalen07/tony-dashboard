/**
 * Autenticación propia de BAKO (sólo servidor).
 *
 * Modelo:
 *   - `app_users`     usuarios con clave hasheada (scrypt), rol admin|member,
 *                     activo/inactivo y bandera de "clave provisoria".
 *   - `app_sessions`  una fila por login. La cookie lleva un token aleatorio de
 *                     32 bytes; acá se guarda SOLO su SHA-256. Revocar la fila
 *                     expulsa a ese dispositivo al instante.
 *   - `auth_events`   auditoría (logins ok/fallidos, bloqueos, revocaciones,
 *                     altas/bajas). También alimenta el bloqueo por intentos.
 *
 * Las tres tablas tienen RLS sin políticas: sólo se alcanzan con la
 * service-role key, que es la que usa el cliente de servidor de
 * `@/utils/supabase`. Este módulo no debe importarse desde código de cliente.
 *
 * Flujo por request: el proxy resuelve la cookie contra la base UNA vez y le
 * pasa al handler un header firmado (HMAC con AUTH_SECRET) con los claims. Los
 * handlers verifican la firma sin volver a la base; si el header no está
 * (AUTH_SECRET ausente, ruta fuera del matcher) caen a la cookie.
 */
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

export const COOKIE_NAME = 'bako_session';
export const AUTH_HEADER = 'x-bako-auth';
/** Vida máxima de una sesión desde el login. */
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 días
/** Sin actividad durante este tiempo, la sesión muere aunque no haya vencido. */
export const SESSION_IDLE_MAX_S = 60 * 60 * 24 * 7; // 7 días
/** `last_seen_at` se escribe como mucho cada tanto: no vale un UPDATE por request. */
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

/** Bloqueo de login: N fallos en la ventana → 429 hasta que pase la ventana. */
const LOGIN_WINDOW_MIN = 15;
const MAX_FAILS_PER_EMAIL = 5;
const MAX_FAILS_PER_IP = 20;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

export type Role = 'admin' | 'member';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface SessionInfo {
  id: string;
  user_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  ip: string | null;
  user_agent: string | null;
}

export interface AuthContext {
  user: AppUser;
  session: SessionInfo;
}

/** Lo mínimo que un handler necesita saber de quién llama. */
export interface AuthClaims {
  uid: string;
  sid: string;
  email: string;
  role: Role;
  /** must_change_password */
  mcp: boolean;
}

export type AuthEventType =
  | 'login_ok'
  | 'login_fail'
  | 'login_locked'
  | 'logout'
  | 'session_revoked'
  | 'sessions_revoked_all'
  | 'user_created'
  | 'user_updated'
  | 'user_deleted'
  | 'password_changed'
  | 'password_reset';

export interface RequestMeta {
  ip: string | null;
  ua: string | null;
}

const USER_COLUMNS =
  'id, email, name, role, is_active, must_change_password, created_at, updated_at, last_login_at';

// ── Claves (scrypt) ─────────────────────────────────────────────────────────

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Formato: `scrypt$N$r$p$salt_b64$hash_b64`. Mismo formato en scripts/auth-cli.mjs. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!N || !r || !p || !salt.length || !expected.length) return false;
  try {
    const actual = await scrypt(password, salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Devuelve el motivo por el que la clave no sirve, o null si está bien. */
export function passwordPolicyError(password: string): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres`;
  }
  if (password.length > PASSWORD_MAX) return 'La contraseña es demasiado larga';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'La contraseña tiene que combinar letras y números';
  }
  return null;
}

/** Clave provisoria legible (para altas y reseteos desde el panel): 16 chars sin ambiguos. */
export function generateTempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export const normalizeEmail = (email: unknown): string => String(email ?? '').trim().toLowerCase();
export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

// ── Tokens / request ────────────────────────────────────────────────────────

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

/** IP y user-agent del request (Vercel pone la IP real en x-forwarded-for). */
export function requestMeta(req: Request): RequestMeta {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip') || '').trim() || null;
  const ua = (req.headers.get('user-agent') || '').slice(0, 300) || null;
  return { ip, ua };
}

export function readSessionCookie(req: Request): string | undefined {
  const raw = req.headers.get('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === COOKIE_NAME) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  };
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, '', { ...sessionCookieOptions(), maxAge: 0 });
}

// ── Errores ─────────────────────────────────────────────────────────────────

/** La base no responde como se espera (migración sin correr, key mala). Se propaga como 503. */
export class AuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthUnavailableError';
  }
}

const AUTH_UNAVAILABLE_MSG =
  'Autenticación no disponible: falta correr supabase_migration_auth.sql o configurar SUPABASE_SERVICE_ROLE_KEY.';

function raise(context: string, error: { message?: string; code?: string } | null): never {
  const msg = `${context}: ${error?.message || 'error desconocido'}`;
  // 42P01 = tabla inexistente; 42501 = sin permisos (anon key contra tabla cerrada)
  if (error?.code === '42P01' || error?.code === '42501' || /relation .* does not exist|permission denied|schema cache/i.test(error?.message || '')) {
    throw new AuthUnavailableError(`${AUTH_UNAVAILABLE_MSG} (${msg})`);
  }
  throw new Error(msg);
}

// ── Auditoría ───────────────────────────────────────────────────────────────

export async function logEvent(
  type: AuthEventType,
  data: { email?: string | null; userId?: string | null; actorId?: string | null; meta?: RequestMeta; detail?: Record<string, unknown> } = {},
): Promise<void> {
  const { error } = await supabase.from('auth_events').insert({
    type,
    email: data.email ?? null,
    user_id: data.userId ?? null,
    actor_id: data.actorId ?? null,
    ip: data.meta?.ip ?? null,
    user_agent: data.meta?.ua ?? null,
    detail: data.detail ?? null,
  });
  // La auditoría no tiene que tumbar la operación principal.
  if (error) console.error('[auth] no se pudo registrar el evento', type, error.message);
}

export async function listEvents(limit = 100) {
  const { data, error } = await supabase
    .from('auth_events')
    .select('id, at, type, email, user_id, actor_id, ip, user_agent, detail')
    .order('at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) raise('listar eventos', error);
  return data ?? [];
}

async function countFails(column: 'email' | 'ip', value: string, sinceIso: string): Promise<number> {
  const { count, error } = await supabase
    .from('auth_events')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'login_fail')
    .eq(column, value)
    .gte('at', sinceIso);
  if (error) raise('contar intentos', error);
  return count ?? 0;
}

/** ¿Está bloqueado el login para este email o esta IP? */
export async function loginLocked(email: string, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MIN * 60 * 1000).toISOString();
  const [byEmail, byIp] = await Promise.all([
    countFails('email', email, since),
    ip ? countFails('ip', ip, since) : Promise.resolve(0),
  ]);
  return byEmail >= MAX_FAILS_PER_EMAIL || byIp >= MAX_FAILS_PER_IP;
}

// ── Usuarios ────────────────────────────────────────────────────────────────

export async function listUsers(): Promise<AppUser[]> {
  const { data, error } = await supabase.from('app_users').select(USER_COLUMNS).order('created_at', { ascending: true });
  if (error) raise('listar usuarios', error);
  return (data ?? []) as AppUser[];
}

export async function getUserById(id: string): Promise<AppUser | null> {
  const { data, error } = await supabase.from('app_users').select(USER_COLUMNS).eq('id', id).maybeSingle();
  if (error) raise('buscar usuario', error);
  return (data as AppUser | null) ?? null;
}

async function getUserWithHash(email: string): Promise<(AppUser & { password_hash: string }) | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select(`${USER_COLUMNS}, password_hash`)
    .eq('email', email)
    .maybeSingle();
  if (error) raise('buscar usuario', error);
  return (data as (AppUser & { password_hash: string }) | null) ?? null;
}

export async function createUser(input: {
  email: string;
  name: string;
  role: Role;
  password: string;
  mustChangePassword: boolean;
}): Promise<AppUser> {
  const password_hash = await hashPassword(input.password);
  const { data, error } = await supabase
    .from('app_users')
    .insert({
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      role: input.role,
      password_hash,
      must_change_password: input.mustChangePassword,
    })
    .select(USER_COLUMNS)
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('Ya existe un usuario con ese email');
    raise('crear usuario', error);
  }
  return data as AppUser;
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<AppUser, 'name' | 'role' | 'is_active' | 'must_change_password'>>,
): Promise<AppUser> {
  const { data, error } = await supabase.from('app_users').update(patch).eq('id', id).select(USER_COLUMNS).single();
  if (error) raise('actualizar usuario', error);
  return data as AppUser;
}

export async function deleteUser(id: string): Promise<void> {
  const { error } = await supabase.from('app_users').delete().eq('id', id);
  if (error) raise('borrar usuario', error);
}

/** Cambia la clave. Con `mustChange` la nueva es provisoria (reseteo desde el panel). */
export async function setPassword(id: string, password: string, mustChange: boolean): Promise<void> {
  const password_hash = await hashPassword(password);
  const { error } = await supabase
    .from('app_users')
    .update({ password_hash, must_change_password: mustChange })
    .eq('id', id);
  if (error) raise('cambiar contraseña', error);
}

export async function countActiveAdmins(excludeId?: string): Promise<number> {
  let q = supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('is_active', true);
  if (excludeId) q = q.neq('id', excludeId);
  const { count, error } = await q;
  if (error) raise('contar admins', error);
  return count ?? 0;
}

// ── Sesiones ────────────────────────────────────────────────────────────────

export async function createSession(userId: string, meta: RequestMeta): Promise<{ token: string; id: string }> {
  const token = newToken();
  const expires_at = new Date(Date.now() + SESSION_MAX_AGE_S * 1000).toISOString();
  const { data, error } = await supabase
    .from('app_sessions')
    .insert({ user_id: userId, token_hash: sha256Hex(token), expires_at, ip: meta.ip, user_agent: meta.ua })
    .select('id')
    .single();
  if (error) raise('crear sesión', error);
  return { token, id: data.id as string };
}

/**
 * Resuelve la cookie contra la base. Devuelve null si no hay sesión, está
 * revocada, vencida, inactiva o el usuario fue desactivado. Tira
 * AuthUnavailableError si la base no responde (nunca "deja pasar").
 */
export async function resolveSession(token: string | undefined | null): Promise<AuthContext | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const { data, error } = await supabase
    .from('app_sessions')
    .select(`id, user_id, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent, user:app_users(${USER_COLUMNS})`)
    .eq('token_hash', sha256Hex(token))
    .maybeSingle();
  if (error) raise('resolver sesión', error);
  if (!data) return null;

  const row = data as unknown as SessionInfo & { user: AppUser | AppUser[] | null };
  const user = Array.isArray(row.user) ? row.user[0] : row.user;
  if (!user || !user.is_active || row.revoked_at) return null;

  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) return null;
  if (new Date(row.last_seen_at).getTime() + SESSION_IDLE_MAX_S * 1000 <= now) return null;

  if (now - new Date(row.last_seen_at).getTime() > LAST_SEEN_THROTTLE_MS) {
    const last_seen_at = new Date(now).toISOString();
    await supabase.from('app_sessions').update({ last_seen_at }).eq('id', row.id);
    row.last_seen_at = last_seen_at;
  }

  const { user: _u, ...session } = row;
  void _u;
  return { user, session };
}

export async function revokeSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('app_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null);
  if (error) raise('revocar sesión', error);
}

/** Revoca las sesiones vivas de un usuario (opcionalmente salvo una). Devuelve cuántas. */
export async function revokeUserSessions(userId: string, exceptId?: string): Promise<number> {
  let q = supabase
    .from('app_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (exceptId) q = q.neq('id', exceptId);
  const { data, error } = await q.select('id');
  if (error) raise('revocar sesiones del usuario', error);
  return data?.length ?? 0;
}

/** Expulsa a TODOS (opcionalmente salvo la sesión actual). Devuelve cuántas. */
export async function revokeAllSessions(exceptId?: string): Promise<number> {
  let q = supabase.from('app_sessions').update({ revoked_at: new Date().toISOString() }).is('revoked_at', null);
  if (exceptId) q = q.neq('id', exceptId);
  const { data, error } = await q.select('id');
  if (error) raise('revocar todas las sesiones', error);
  return data?.length ?? 0;
}

export interface ActiveSession extends SessionInfo {
  user: Pick<AppUser, 'id' | 'email' | 'name' | 'role'> | null;
}

/** Sesiones vivas (no revocadas, no vencidas, con actividad reciente), la más reciente primero. */
export async function listActiveSessions(): Promise<ActiveSession[]> {
  const now = Date.now();
  const { data, error } = await supabase
    .from('app_sessions')
    .select('id, user_id, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent, user:app_users(id, email, name, role)')
    .is('revoked_at', null)
    .gt('expires_at', new Date(now).toISOString())
    .gt('last_seen_at', new Date(now - SESSION_IDLE_MAX_S * 1000).toISOString())
    .order('last_seen_at', { ascending: false });
  if (error) raise('listar sesiones', error);
  return ((data ?? []) as unknown as (SessionInfo & { user: ActiveSession['user'] | ActiveSession['user'][] })[]).map((r) => ({
    ...r,
    user: Array.isArray(r.user) ? r.user[0] ?? null : r.user,
  }));
}

// ── Login ───────────────────────────────────────────────────────────────────

export type LoginResult =
  | { ok: true; token: string; sessionId: string; user: AppUser }
  | { ok: false; status: 401 | 429; error: string };

/** Hash real de una clave cualquiera: se verifica contra él cuando el usuario no existe, para que el tiempo de respuesta no delate emails válidos. */
let dummyHashPromise: Promise<string> | null = null;
const dummyHash = () => (dummyHashPromise ??= hashPassword(randomBytes(12).toString('hex')));

export async function login(emailRaw: string, password: string, meta: RequestMeta): Promise<LoginResult> {
  const email = normalizeEmail(emailRaw);

  if (await loginLocked(email, meta.ip)) {
    await logEvent('login_locked', { email, meta });
    return { ok: false, status: 429, error: `Demasiados intentos. Esperá ${LOGIN_WINDOW_MIN} minutos y probá de nuevo.` };
  }

  const user = await getUserWithHash(email);
  let valid = false;
  if (user && user.is_active) {
    valid = await verifyPassword(password, user.password_hash);
  } else {
    await verifyPassword(password, await dummyHash()); // mismo costo → el tiempo no delata emails válidos
  }

  if (!user || !valid) {
    await logEvent('login_fail', { email, userId: user?.id ?? null, meta, detail: user && !user.is_active ? { reason: 'inactive' } : undefined });
    return { ok: false, status: 401, error: 'Usuario o contraseña incorrectos' };
  }

  const { token, id } = await createSession(user.id, meta);
  await supabase.from('app_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
  await logEvent('login_ok', { email, userId: user.id, meta, detail: { session: id } });

  const { password_hash: _h, ...safeUser } = user;
  void _h;
  return { ok: true, token, sessionId: id, user: safeUser };
}

// ── Header firmado proxy → handlers ─────────────────────────────────────────

const HEADER_TTL_S = 60;

const secret = () => process.env.AUTH_SECRET || '';
const b64url = (buf: Buffer) => buf.toString('base64url');

export function toClaims(ctx: AuthContext): AuthClaims {
  return { uid: ctx.user.id, sid: ctx.session.id, email: ctx.user.email, role: ctx.user.role, mcp: ctx.user.must_change_password };
}

/** Firma los claims para el salto proxy → handler. Sin AUTH_SECRET devuelve null (los handlers caen a la cookie). */
export function signAuthHeader(ctx: AuthContext): string | null {
  const s = secret();
  if (!s) return null;
  const payload = b64url(Buffer.from(JSON.stringify({ ...toClaims(ctx), exp: Math.floor(Date.now() / 1000) + HEADER_TTL_S })));
  const sig = b64url(createHmac('sha256', s).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyAuthHeader(value: string | null | undefined): AuthClaims | null {
  const s = secret();
  if (!s || !value) return null;
  const dot = value.indexOf('.');
  if (dot === -1) return null;
  const payload = value.slice(0, dot);
  const sig = Buffer.from(value.slice(dot + 1), 'base64url');
  const expected = createHmac('sha256', s).update(payload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof c.exp !== 'number' || c.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof c.uid !== 'string' || typeof c.sid !== 'string' || (c.role !== 'admin' && c.role !== 'member')) return null;
    return { uid: c.uid, sid: c.sid, email: String(c.email ?? ''), role: c.role, mcp: Boolean(c.mcp) };
  } catch {
    return null;
  }
}

// ── Helpers para handlers ───────────────────────────────────────────────────

/** Claims del que llama: header firmado por el proxy, o la cookie contra la base. */
export async function getClaims(req: Request): Promise<AuthClaims | null> {
  const fromHeader = verifyAuthHeader(req.headers.get(AUTH_HEADER));
  if (fromHeader) return fromHeader;
  const ctx = await resolveSession(readSessionCookie(req));
  return ctx ? toClaims(ctx) : null;
}

export type Guard = { ok: true; claims: AuthClaims } | { ok: false; res: NextResponse };

/**
 * Exige sesión (y rol, si se pide). Uso:
 *   const auth = await requireRole(request, 'admin'); if (!auth.ok) return auth.res;
 */
export async function requireRole(req: Request, role?: Role): Promise<Guard> {
  try {
    const claims = await getClaims(req);
    if (!claims) return { ok: false, res: NextResponse.json({ error: 'No autorizado' }, { status: 401 }) };
    if (role && claims.role !== role) {
      return { ok: false, res: NextResponse.json({ error: 'Sólo para administradores' }, { status: 403 }) };
    }
    return { ok: true, claims };
  } catch (e) {
    return { ok: false, res: errorResponse(e) };
  }
}

/** Respuesta JSON para un error de este módulo: 503 si la base no está lista, 400 si es de negocio. */
export function errorResponse(e: unknown, fallbackStatus = 400): NextResponse {
  if (e instanceof AuthUnavailableError) {
    return NextResponse.json({ error: e.message, code: 'AUTH_UNAVAILABLE' }, { status: 503 });
  }
  const message = e instanceof Error ? e.message : 'Error';
  return NextResponse.json({ error: message }, { status: fallbackStatus });
}
