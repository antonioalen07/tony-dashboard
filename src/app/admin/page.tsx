import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AUTH_HEADER, COOKIE_NAME, resolveSession, toClaims, verifyAuthHeader, type AuthClaims } from '@/lib/auth';
import AdminPanel from './AdminPanel';

export const dynamic = 'force-dynamic';

/**
 * /admin — sólo administradores. El proxy ya filtra, pero la página vuelve a
 * verificar por su cuenta (header firmado o, si no está, la cookie contra la base).
 */
export default async function AdminPage() {
  let claims: AuthClaims | null = verifyAuthHeader((await headers()).get(AUTH_HEADER));
  if (!claims) {
    try {
      const ctx = await resolveSession((await cookies()).get(COOKIE_NAME)?.value);
      claims = ctx ? toClaims(ctx) : null;
    } catch {
      claims = null;
    }
  }
  if (!claims) redirect('/login?from=/admin');
  if (claims.role !== 'admin') redirect('/');

  return <AdminPanel me={{ id: claims.uid, email: claims.email, sessionId: claims.sid }} />;
}
