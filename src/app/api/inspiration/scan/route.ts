import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { startRun, getRunStatus, getDatasetItems, isTerminal } from '@/lib/apify';
import { normalizeInstagramItem, scorePosts, VIRAL_THRESHOLD } from '@/lib/viral';

export const dynamic = 'force-dynamic';

const ACTOR = 'apify/instagram-scraper';
const POSTS_PER_ACCOUNT = 15;

const cleanUsername = (raw: string) =>
  String(raw || '').trim().replace(/^@/, '').replace(/\/.*$/, '').toLowerCase();

/**
 * POST { username } — arranca 2 runs Apify en paralelo (posts + perfil/followers)
 * y devuelve los IDs para que el cliente haga polling con GET.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = cleanUsername(body.username);
    if (!username) return NextResponse.json({ error: 'Username requerido' }, { status: 400 });

    const [posts, details] = await Promise.all([
      startRun(ACTOR, {
        directUrls: [`https://www.instagram.com/${username}/reels/`],
        resultsType: 'posts',
        resultsLimit: POSTS_PER_ACCOUNT,
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
    });
  } catch (error: any) {
    console.error('Scan start error:', error);
    return NextResponse.json({ error: error.message || 'Error iniciando scan' }, { status: 500 });
  }
}

/**
 * GET ?postsRunId&postsDatasetId&detailsRunId&detailsDatasetId&username&persist=true|false
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

    if (!postsRunId || !detailsRunId || !username) {
      return NextResponse.json({ error: 'Parámetros incompletos' }, { status: 400 });
    }

    const [postsStatus, detailsStatus] = await Promise.all([
      getRunStatus(postsRunId),
      getRunStatus(detailsRunId),
    ]);

    if (postsStatus === 'FAILED' || postsStatus === 'ABORTED' || postsStatus === 'TIMED-OUT') {
      return NextResponse.json({ status: 'failed', error: `Scrape de posts falló (${postsStatus})` });
    }
    if (!isTerminal(postsStatus) || !isTerminal(detailsStatus)) {
      return NextResponse.json({ status: 'running', postsStatus, detailsStatus });
    }

    // Ambos terminaron: traer datos
    const [postItems, detailItems] = await Promise.all([
      getDatasetItems(postsDatasetId),
      detailsStatus === 'SUCCEEDED' ? getDatasetItems(detailsDatasetId) : Promise.resolve([]),
    ]);

    const followers: number | null = detailItems[0]?.followersCount ?? null;

    // El actor devuelve items {error: 'not_found'|...} cuando la cuenta no existe o es privada.
    const errorItem = postItems.find((it: any) => it?.error);
    const normalized = postItems
      .map((it) => normalizeInstagramItem(it, username))
      .filter((p): p is NonNullable<typeof p> => p !== null && p.views >= 0 && !!p.posted_at);

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
    });
  } catch (error: any) {
    console.error('Scan poll error:', error);
    return NextResponse.json({ error: error.message || 'Error en polling' }, { status: 500 });
  }
}
