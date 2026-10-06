import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { startRun, getRunStatus, getDatasetItems, isTerminal } from '@/lib/apify';
import { normalizeInstagramItem, scorePosts, VIRAL_THRESHOLD } from '@/lib/viral';

export const dynamic = 'force-dynamic';

const ACTOR = 'apify/instagram-scraper';
/**
 * Tope de reels por cuenta. Con la ventana de fecha el actor corta antes en
 * cuentas que publican poco, así que esto solo pesa en las que suben a diario.
 * Apify cobra por resultado: subirlo encarece cada scan en proporción.
 */
const POSTS_PER_ACCOUNT = 30;

/**
 * Ventana temporal del scan. Lo que viraliza se mueve por moda: un video de
 * hace 6 meses que rompió la mediana ya no dice qué funciona HOY. Se aceptan
 * 30/60/90 días; cualquier otra cosa cae al default.
 */
const WINDOW_OPTIONS = [30, 60, 90];
const DEFAULT_WINDOW_DAYS = 90;
const windowDays = (raw: unknown) => {
  const n = Number(raw);
  return WINDOW_OPTIONS.includes(n) ? n : DEFAULT_WINDOW_DAYS;
};
const cutoffDate = (days: number) => new Date(Date.now() - days * 86_400_000);

const cleanUsername = (raw: string) =>
  String(raw || '').trim().replace(/^@/, '').replace(/\/.*$/, '').toLowerCase();

/**
 * POST { username, days? } — arranca 2 runs Apify en paralelo (posts + perfil/followers)
 * y devuelve los IDs para que el cliente haga polling con GET.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = cleanUsername(body.username);
    if (!username) return NextResponse.json({ error: 'Username requerido' }, { status: 400 });
    const days = windowDays(body.days);

    const [posts, details] = await Promise.all([
      startRun(ACTOR, {
        directUrls: [`https://www.instagram.com/${username}/reels/`],
        resultsType: 'posts',
        resultsLimit: POSTS_PER_ACCOUNT,
        // El actor deja de paginar al cruzar esta fecha: ahorra resultados (= plata).
        onlyPostsNewerThan: cutoffDate(days).toISOString().slice(0, 10),
        addParentData: false,
      }),
      startRun(ACTOR, {
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: 'details',
      }),
    ]);

    return NextResponse.json({
      username,
      postsRunId: posts.runId,
      postsDatasetId: posts.datasetId,
      detailsRunId: details.runId,
      detailsDatasetId: details.datasetId,
      // Cada run vive en la cuenta de Apify que lo lanzó: el polling usa esa key.
      postsKey: posts.tokenIdx,
      detailsKey: details.tokenIdx,
      days,
    });
  } catch (error: any) {
    console.error('Scan start error:', error);
    return NextResponse.json({ error: error.message || 'Error iniciando scan' }, { status: 500 });
  }
}

/**
 * GET ?postsRunId&postsDatasetId&detailsRunId&detailsDatasetId&postsKey&detailsKey&days&username&persist=true|false
 * Polling: mientras corre devuelve {status:'running'}. Al terminar, normaliza,
 * calcula score/multiplicador y (si persist) guarda los bangers (score>=60).
 */
export async function GET(request: Request) {
  try {
    const sp = new URL(request.url).searchParams;
    const username = cleanUsername(sp.get('username') || '');
    const postsRunId = sp.get('postsRunId') || '';
    const postsDatasetId = sp.get('postsDatasetId') || '';
    const detailsRunId = sp.get('detailsRunId') || '';
    const detailsDatasetId = sp.get('detailsDatasetId') || '';
    const persist = sp.get('persist') === 'true';
    const postsKey = Number(sp.get('postsKey') || 0);
    const detailsKey = Number(sp.get('detailsKey') || 0);
    const days = windowDays(sp.get('days'));

    if (!postsRunId || !detailsRunId || !username) {
      return NextResponse.json({ error: 'Parámetros incompletos' }, { status: 400 });
    }

    const [postsStatus, detailsStatus] = await Promise.all([
      getRunStatus(postsRunId, postsKey),
      getRunStatus(detailsRunId, detailsKey),
    ]);

    if (postsStatus === 'FAILED' || postsStatus === 'ABORTED' || postsStatus === 'TIMED-OUT') {
      return NextResponse.json({ status: 'failed', error: `Scrape de posts falló (${postsStatus})` });
    }
    if (!isTerminal(postsStatus) || !isTerminal(detailsStatus)) {
      return NextResponse.json({ status: 'running', postsStatus, detailsStatus });
    }

    // Ambos terminaron: traer datos
    const [postItems, detailItems] = await Promise.all([
      getDatasetItems(postsDatasetId, postsKey),
      detailsStatus === 'SUCCEEDED' ? getDatasetItems(detailsDatasetId, detailsKey) : Promise.resolve([]),
    ]);

    const followers: number | null = detailItems[0]?.followersCount ?? null;

    // El actor devuelve items {error: 'not_found'|...} cuando la cuenta no existe o es privada.
    const errorItem = postItems.find((it: any) => it?.error);
    const all = postItems
      .map((it) => normalizeInstagramItem(it, username))
      .filter((p): p is NonNullable<typeof p> => p !== null && p.views >= 0 && !!p.posted_at);

    // Filtro de ventana ANTES de puntuar: la mediana contra la que se compara
    // cada video es la del creador en el período, no la de toda su historia.
    // Se repite acá aunque el actor ya filtre, porque los reels FIJADOS del
    // perfil vienen igual y suelen ser los más viejos.
    const cutoff = cutoffDate(days).getTime();
    const normalized = all.filter((p) => new Date(p.posted_at as string).getTime() >= cutoff);

    if (normalized.length === 0 && all.length > 0) {
      return NextResponse.json({
        status: 'done', username, followers, posts: [], bangers: 0, savedCount: 0, days,
        error: `@${username} no publicó reels en los últimos ${days} días`,
      });
    }

    if (normalized.length === 0) {
      const reason = errorItem?.error === 'not_found'
        ? `La cuenta @${username} no existe (¿está bien escrita?)`
        : errorItem?.errorDescription || 'Apify no devolvió posts (¿la cuenta es pública y tiene reels?)';
      return NextResponse.json({
        status: 'done', username, followers, posts: [], bangers: 0, savedCount: 0,
        error: reason,
      });
    }

    const scored = scorePosts(normalized, followers);
    const bangers = scored.filter((p) => p.score >= VIRAL_THRESHOLD);

    let savedCount = 0;
    if (persist && bangers.length > 0) {
      const rows = bangers.map((p) => ({
        instagram_id: p.instagram_id,
        username: p.username,
        caption: p.caption,
        cover_url: p.cover_url,
        post_url: p.post_url,
        posted_at: p.posted_at,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        duration_s: p.duration_s,
        followers: p.followers,
        account_median: p.account_median,
        multiplier: p.multiplier,
        score: p.score,
      }));
      const { error } = await supabase
        .from('inspiration_videos')
        .upsert(rows, { onConflict: 'instagram_id', ignoreDuplicates: false });
      if (error) {
        if (error.code === '42P01') {
          return NextResponse.json({ status: 'done', username, followers, posts: scored, bangers: bangers.length, savedCount: 0, warning: 'migration_required' });
        }
        console.warn('Persist error:', error.message);
      } else {
        savedCount = rows.length;
      }
      await supabase
        .from('referents')
        .update({ last_scanned_at: new Date().toISOString() })
        .eq('username', username);
    }

    return NextResponse.json({
      status: 'done',
      username,
      followers,
      posts: scored,
      bangers: bangers.length,
      savedCount,
      threshold: VIRAL_THRESHOLD,
      days,
    });
  } catch (error: any) {
    console.error('Scan poll error:', error);
    return NextResponse.json({ error: error.message || 'Error en polling' }, { status: 500 });
  }
}
