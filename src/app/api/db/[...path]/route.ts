import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Gateway same-origin hacia Supabase.
 *
 * El navegador ya no tiene ninguna key: su cliente de supabase-js apunta acá
 * (`/api/db`) y este handler reenvía a `${SUPABASE_URL}/rest/v1/...` y
 * `/storage/v1/object/...` con la service-role key, SÓLO si hay sesión válida.
 * Con eso la base queda cerrada a la anon key (supabase_migration_lock_anon.sql)
 * y expulsar a alguien de la app lo expulsa también de la base.
 *
 * Límites a propósito:
 *  - Las tablas de auth (app_users, app_sessions, auth_events) y `rpc` no se
 *    reenvían nunca: sólo las toca src/lib/auth.ts.
 *  - El esquema es siempre `public` (se descartan Accept-/Content-Profile).
 *  - Los objetos públicos del bucket se redirigen a Supabase en vez de
 *    servirse a través de acá (videos de 30 MB no tienen por qué pasar por una
 *    función).
 *  - Las SUBIDAS grandes tampoco pasan por acá (Vercel corta en 4.5 MB): van
 *    directo a Supabase con una URL firmada, ver /api/storage/sign-upload.
 */
const UPSTREAM = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const DENIED_TABLES = new Set(['app_users', 'app_sessions', 'auth_events', 'rpc', '',
  'automations', 'automation_events', 'leads', 'lead_messages', 'lead_tags',
  'lead_tag_assignments', 'followup_sequences', 'followup_enrollments', 'followup_jobs']);

/** Headers del cliente que sí tienen sentido reenviar. Nada de auth, cookies ni perfiles de esquema. */
const FORWARD_REQUEST_HEADERS = [
  'accept',
  'content-type',
  'prefer',
  'range',
  'if-match',
  'if-none-match',
  'x-upsert',
  'cache-control',
  'x-metadata',
  'x-client-info',
];

/** Headers de la respuesta que NO se copian: hop-by-hop, compresión (fetch ya descomprimió), cookies, CORS, etc. */
const DROP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'set-cookie',
  'strict-transport-security',
  'alt-svc',
  'server',
]);

function serviceKey(): string {
  const env = process.env as Record<string, string | undefined>;
  return env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [service, version, resource, ...rest] = path;
  const target = `${service}/${version}`;

  // Objetos públicos: al bucket directo, sin cargar la función con bytes de video.
  if (target === 'storage/v1' && resource === 'object' && rest[0] === 'public' && (request.method === 'GET' || request.method === 'HEAD')) {
    return NextResponse.redirect(`${UPSTREAM}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`, 307);
  }

  const auth = await requireRole(request);
  if (!auth.ok) return auth.res;

  if (target === 'rest/v1') {
    if (DENIED_TABLES.has(resource ?? '')) return NextResponse.json({ error: 'Recurso no permitido' }, { status: 403 });
  } else if (target === 'storage/v1') {
    if (resource !== 'object') return NextResponse.json({ error: 'Recurso no permitido' }, { status: 403 });
  } else {
    return NextResponse.json({ error: 'Recurso no permitido' }, { status: 403 });
  }

  const key = serviceKey();
  if (!UPSTREAM || !key) {
    return NextResponse.json({ error: 'Supabase no configurado en el servidor' }, { status: 503 });
  }

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  headers.set('apikey', key);
  headers.set('authorization', `Bearer ${key}`);

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const body = hasBody ? await request.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    });
  } catch (e) {
    return NextResponse.json({ error: `Supabase no responde: ${(e as Error).message}` }, { status: 502 });
  }

  const out = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROP_RESPONSE_HEADERS.has(name.toLowerCase())) out.set(name, value);
  });
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
