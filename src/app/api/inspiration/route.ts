import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await supabase
    .from('inspiration_videos')
    .select('*')
    .order('score', { ascending: false });

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ error: 'migration_required' }, { status: 428 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

/** Guarda manualmente un video efímero (botón "Guardar" en búsqueda puntual). */
export async function POST(request: Request) {
  try {
    const video = await request.json();
    if (!video?.instagram_id) {
      return NextResponse.json({ error: 'instagram_id requerido' }, { status: 400 });
    }
    const row = {
      instagram_id: video.instagram_id,
      username: video.username,
      caption: video.caption || '',
      cover_url: video.cover_url || '',
      post_url: video.post_url || '',
      posted_at: video.posted_at,
      views: video.views || 0,
      likes: video.likes || 0,
      comments: video.comments || 0,
      duration_s: video.duration_s,
      followers: video.followers,
      account_median: video.account_median,
      multiplier: video.multiplier,
      score: video.score,
    };
    const { data, error } = await supabase
      .from('inspiration_videos')
      .upsert(row, { onConflict: 'instagram_id' })
      .select()
      .single();

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ error: 'migration_required' }, { status: 428 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  const { error } = await supabase.from('inspiration_videos').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
