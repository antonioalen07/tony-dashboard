import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exchangeCode } from '@/lib/google';

export const dynamic = 'force-dynamic';

/**
 * GET /api/google/callback?code=... — intercambia el código, persiste tokens y
 * vuelve a /historias. `?drive=connected` en éxito, `?drive=error` si algo falla.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const code = sp.get('code');
  const oauthError = sp.get('error');

  const back = (status: string) =>
    NextResponse.redirect(new URL(`/historias?drive=${status}`, request.url));

  if (oauthError || !code) {
    return back('error');
  }

  try {
    await exchangeCode(code);
    return back('connected');
  } catch (error) {
    console.error('Google callback error:', error);
    return back('error');
  }
}
