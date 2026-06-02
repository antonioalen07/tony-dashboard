import { NextResponse } from 'next/server';

// ID de la cuenta de Instagram Business. El sync usa este mismo fallback con éxito,
// así que lo reutilizamos aquí para que los seguidores dejen de salir N/A sin pedir
// nada extra al usuario. Si más adelante hay una cuenta/token definitivos, basta con
// definir META_IG_ACCOUNT_ID en el entorno.
const DEFAULT_IG_ACCOUNT_ID = '17841476480622974';

export async function GET() {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const igAccountId = process.env.META_IG_ACCOUNT_ID || DEFAULT_IG_ACCOUNT_ID;

    if (!token) {
      return NextResponse.json({ followers: 'N/A' });
    }

    const url = `https://graph.facebook.com/v20.0/${igAccountId}?fields=followers_count,media_count,username&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.warn('Meta profile error:', data.error?.message);
      return NextResponse.json({ followers: 'N/A' });
    }

    return NextResponse.json({
      followers: data.followers_count ?? 'N/A',
      mediaCount: data.media_count ?? null,
      username: data.username ?? null,
    });
  } catch (error) {
    return NextResponse.json({ followers: 'N/A' });
  }
}
