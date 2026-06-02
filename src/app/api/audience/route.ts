import { NextResponse } from 'next/server';

const DEFAULT_IG_ACCOUNT_ID = '17841476480622974';

// Mapa de códigos ISO de país a etiqueta corta para la gráfica.
const COUNTRY_LABEL: Record<string, string> = {
  AR: 'AR', ES: 'ES', CO: 'CO', CL: 'CL', MX: 'MX', PE: 'PE', US: 'US', UY: 'UY', EC: 'EC', VE: 'VE',
};

/**
 * Audiencia por país (demografía de seguidores) vía Meta Graph API.
 * Requiere el permiso instagram_manage_insights. Si falla, devuelve { data: [] }
 * para que el frontend muestre un estado vacío elegante (no rompe el dashboard).
 */
export async function GET() {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const igAccountId = process.env.META_IG_ACCOUNT_ID || DEFAULT_IG_ACCOUNT_ID;
    if (!token) return NextResponse.json({ data: [], reason: 'no_token' });

    const url =
      `https://graph.facebook.com/v20.0/${igAccountId}/insights` +
      `?metric=follower_demographics&period=lifetime&timeframe=last_30_days` +
      `&breakdown=country&metric_type=total_value&access_token=${token}`;

    const res = await fetch(url);
    const json = await res.json();

    if (json.error) {
      console.warn('Audience insights error:', json.error?.message);
      return NextResponse.json({ data: [], reason: 'meta_error' });
    }

    // La respuesta viene en total_value.breakdowns[0].results[] con dimension_values=[countryCode]
    const breakdowns = json.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    const rows = breakdowns
      .map((r: any) => ({
        country: COUNTRY_LABEL[r.dimension_values?.[0]] || r.dimension_values?.[0] || '—',
        users: r.value ?? 0,
      }))
      .sort((a: any, b: any) => b.users - a.users)
      .slice(0, 6);

    return NextResponse.json({ data: rows });
  } catch (error: any) {
    console.warn('Audience route error:', error?.message);
    return NextResponse.json({ data: [], reason: 'exception' });
  }
}
