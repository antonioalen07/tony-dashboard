import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { isPersistedCover, persistCovers } from '@/lib/covers';

export const dynamic = 'force-dynamic';
// Bajar y subir las portadas suma segundos al sync; sin esto Hobby lo corta.
export const maxDuration = 60;

const GRAPH = 'https://graph.facebook.com/v20.0';

/**
 * Tope de media a recorrer. Antes eran los últimos 20 y todo lo que quedaba
 * más atrás se CONGELABA con los números del día en que salió del top 20: un
 * reel que siguió creciendo hasta 500k figuraba con una fracción. Ahora se
 * pagina el historial completo (hasta este tope) en cada sync.
 */
const MAX_MEDIA = 500;
/** Pedidos de insights en paralelo: rápido sin pegarle de más a la API. */
const INSIGHTS_CONCURRENCY = 8;

/**
 * `views` es la métrica de reproducciones desde abril de 2025 (reemplazó a
 * `plays`/`impressions`). `reach` son cuentas ÚNICAS: en un viral es varias
 * veces menor que las vistas, y era lo que se guardaba como "vistas".
 * Si la API rechaza `views` se reintenta sin ella: una métrica inválida hace
 * fallar el pedido entero y se perderían también reach/saved/shares.
 */
const METRICS_FULL = 'views,reach,saved,shares,total_interactions';
const METRICS_FALLBACK = 'reach,saved,shares,total_interactions';

/** Lo que usamos del media de la Graph API. */
interface MediaItem {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  permalink?: string;
}

interface KnownCover {
  instagram_id: string;
  cover_url: string;
}

/** Fila de /insights: v20 trae `values[0].value`; algunas métricas, `total_value`. */
interface InsightRow {
  name: string;
  values?: { value?: number }[];
  total_value?: { value?: number };
}

interface Insights {
  views: number;
  reach: number;
  saves: number;
  shares: number;
}

async function fetchAllMedia(igAccountId: string, token: string): Promise<MediaItem[]> {
  const fields = 'id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink';
  let url: string | undefined =
    `${GRAPH}/${igAccountId}/media?fields=${fields}&limit=100&access_token=${token}`;
  const all: MediaItem[] = [];
  while (url && all.length < MAX_MEDIA) {
    const res: Response = await fetch(url);
    const json: { data?: MediaItem[]; paging?: { next?: string }; error?: { message: string } } = await res.json();
    if (json.error) {
      // Sin la primera página no hay nada que sincronizar; con alguna ya leída, seguimos con eso.
      if (all.length === 0) throw new Error(json.error.message);
      console.warn('Paginado de media cortado:', json.error.message);
      break;
    }
    all.push(...(json.data || []));
    url = json.paging?.next;
  }
  return all.slice(0, MAX_MEDIA);
}

async function fetchInsights(mediaId: string, token: string): Promise<Insights | null> {
  for (const metrics of [METRICS_FULL, METRICS_FALLBACK]) {
    try {
      const res = await fetch(`${GRAPH}/${mediaId}/insights?metric=${metrics}&access_token=${token}`);
      const json = await res.json();
      if (json.error || !json.data) continue;
      const get = (name: string): number => {
        const m = (json.data as InsightRow[]).find((x) => x.name === name);
        return Number(m?.values?.[0]?.value ?? m?.total_value?.value ?? 0) || 0;
      };
      return { views: get('views'), reach: get('reach'), saves: get('saved'), shares: get('shares') };
    } catch (e) {
      console.warn(`Insights fallaron para ${mediaId}`, e);
    }
  }
  return null;
}

/** map con concurrencia acotada. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function POST() {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const igAccountId = process.env.META_IG_ACCOUNT_ID || '17841476480622974'; // Fallback a tu ID

    if (!token) {
      return NextResponse.json({ error: 'Meta Access Token no configurado' }, { status: 500 });
    }

    console.log(`Starting Meta API sync for IG Account: ${igAccountId}...`);

    // 1. Todo el historial de media (paginado). Meta no expone "shortcode";
    // usamos "permalink", que además sirve para bajar el video vía Apify.
    const items = await fetchAllMedia(igAccountId, token);
    const videos = items.filter((it) => it.media_type === 'VIDEO');

    // 1.b Portadas estables. La URL del CDN de Instagram viene firmada y caduca
    // en días, así que la copiamos al Storage una sola vez por reel.
    const { data: known } = await supabase
      .from('reels')
      .select('instagram_id,cover_url')
      .in('instagram_id', videos.map((it) => it.id));

    const alreadyStored = new Map<string, string>(
      ((known || []) as KnownCover[])
        .filter((r) => isPersistedCover(r.cover_url))
        .map((r) => [r.instagram_id, r.cover_url]),
    );

    const fresh = await persistCovers(
      videos
        .filter((it) => !alreadyStored.has(it.id))
        .map((it) => ({ key: it.id, sourceUrl: it.thumbnail_url || it.media_url || '' })),
    );

    // 2. Insights de cada reel, en paralelo acotado.
    const insights = await mapLimit(videos, INSIGHTS_CONCURRENCY, (v) => fetchInsights(v.id, token));

    const rows = videos.map((item, i) => {
      const ins = insights[i];
      const reach = ins?.reach ?? 0;
      const saves = ins?.saves ?? 0;
      const shares = ins?.shares ?? 0;
      // Reproducciones reales; el alcance solo como último recurso.
      const views = ins?.views || reach;

      // Engagement Rate = (likes + comentarios + guardados + compartidos) / alcance * 100
      let engagementRate: number | null = null;
      if (reach > 0) {
        const totalInteractions = (item.like_count || 0) + (item.comments_count || 0) + saves + shares;
        engagementRate = parseFloat(((totalInteractions / reach) * 100).toFixed(2));
      }

      return {
        instagram_id: item.id,
        title: item.caption || '',
        // Preferimos SIEMPRE la copia del Storage; la del CDN es el último recurso.
        cover_url:
          alreadyStored.get(item.id) || fresh.get(item.id) ||
          item.thumbnail_url || item.media_url || '',
        video_url: item.permalink || '',
        published_at: item.timestamp,
        views,
        likes: item.like_count || 0,
        comments: item.comments_count || 0,
        reach,
        saves,
        shares,
        engagement_rate: engagementRate,
      };
    });

    // 3. Upsert en lote (antes era uno por reel: N viajes a la base).
    const synced: unknown[] = [];
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { data, error } = await supabase
        .from('reels')
        .upsert(chunk, { onConflict: 'instagram_id' })
        .select();
      if (error) console.error('Error guardando reels en Supabase:', error);
      else synced.push(...(data || []));
    }

    return NextResponse.json({
      success: true,
      syncedCount: synced.length,
      scanned: videos.length,
      withoutInsights: insights.filter((x) => x === null).length,
      data: synced,
    });
  } catch (error: any) {
    console.error('Sync Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
