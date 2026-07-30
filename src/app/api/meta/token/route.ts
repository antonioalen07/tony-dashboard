import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GRAPH = 'https://graph.facebook.com/v20.0';

/**
 * Helper para RENOVAR el token de Meta antes de que venza.
 *
 * Uso (logueado en el dashboard, en el navegador):
 *   /api/meta/token                → renueva el token que hay en META_ACCESS_TOKEN
 *   /api/meta/token?token=EAAG...   → renueva el token que le pases (ej. uno fresco
 *                                     del Graph API Explorer)
 *
 * Devuelve:
 *  - el estado del token actual (cuándo vence),
 *  - un "long-lived user token" nuevo (~60 días),
 *  - los "page access token" (que NO expiran mientras el user token siga válido) →
 *    lo ideal es guardar ESE en META_ACCESS_TOKEN para no tener que renovar seguido.
 *
 * Requiere META_APP_ID y META_APP_SECRET en el entorno (el secret nunca se expone).
 */
export async function GET(request: Request) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || process.env.META_ACCESS_TOKEN;

  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: 'Faltan META_APP_ID / META_APP_SECRET en el entorno (Vercel).' },
      { status: 500 },
    );
  }
  if (!token) {
    return NextResponse.json(
      { error: 'No hay token para renovar. Pasá ?token=... o seteá META_ACCESS_TOKEN.' },
      { status: 400 },
    );
  }

  try {
    // 1) Estado del token actual (cuándo vence, scopes, tipo).
    const debug = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${appId}|${appSecret}`,
    ).then((r) => r.json());
    const d = debug?.data || {};
    const expiresAt = d.expires_at
      ? d.expires_at === 0
        ? 'nunca (no expira)'
        : new Date(d.expires_at * 1000).toISOString()
      : 'desconocido';

    // 2) Intercambio → long-lived user token (~60 días).
    const ll = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
        `&client_id=${appId}&client_secret=${appSecret}` +
        `&fb_exchange_token=${encodeURIComponent(token)}`,
    ).then((r) => r.json());
    if (ll.error) {
      return NextResponse.json(
        { paso: 'intercambio', error: ll.error, estado_actual: { expira: expiresAt, tipo: d.type } },
        { status: 502 },
      );
    }
    const longLived: string = ll.access_token;
    const expiresInDays = ll.expires_in ? Math.round(ll.expires_in / 86400) : null;

    // 3) Con el long-lived user token, pedir los page access token (no expiran).
    let paginas: Array<{ nombre: string; page_access_token: string; ig_account_id: string | null }> = [];
    try {
      const acc = await fetch(
        `${GRAPH}/me/accounts?fields=name,access_token,instagram_business_account&access_token=${encodeURIComponent(longLived)}`,
      ).then((r) => r.json());
      paginas = (acc?.data || []).map((p: any) => ({
        nombre: p.name,
        page_access_token: p.access_token,
        ig_account_id: p.instagram_business_account?.id || null,
      }));
    } catch {
      /* si el token no es de tipo User, /me/accounts puede no devolver páginas */
    }

    return NextResponse.json({
      ok: true,
      estado_actual: { expira: expiresAt, tipo: d.type, scopes: d.scopes },
      long_lived_user_token: longLived,
      long_lived_expira_en_dias: expiresInDays,
      page_tokens_no_expiran: paginas,
      recomendacion:
        paginas.length > 0
          ? 'Guardá el page_access_token en META_ACCESS_TOKEN (Vercel) — ese no expira mientras la sesión del usuario siga válida. Redeploy después.'
          : 'Guardá long_lived_user_token en META_ACCESS_TOKEN (Vercel) y renovalo antes de los ~60 días, o pasá a un System User token (no expira).',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Error renovando el token' }, { status: 500 });
  }
}
