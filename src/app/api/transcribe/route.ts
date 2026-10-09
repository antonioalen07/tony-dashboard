import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { transcribeInstagramPost } from '@/lib/transcribe';
import { requireRole } from '@/lib/auth';
import { canEnrichReel, hasCurationColumns, isReelId, ENRICHMENT_BLOCKED_MESSAGE } from '@/lib/reel-curation';

// Reels pueden tardar en scrapear/transcribir; damos margen al handler.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Transcribe el reel propio indicado y guarda `transcript` en Supabase. */
export async function POST(request: Request) {
  const auth = await requireRole(request);
  if (!auth.ok) return auth.res;
  try {
    const { id } = await request.json();
    if (!isReelId(id)) {
      return NextResponse.json({ error: 'Reel ID is required' }, { status: 400 });
    }

    const { data: reel, error: fetchError } = await supabase
      .from('reels')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !reel) {
      return NextResponse.json({ error: 'Reel not found' }, { status: 404 });
    }
    if (!canEnrichReel(reel)) {
      return NextResponse.json({ error: ENRICHMENT_BLOCKED_MESSAGE }, { status: 409 });
    }

    if (!reel.video_url?.startsWith('http')) {
      return NextResponse.json(
        { error: 'Este reel no tiene URL de Instagram (video_url). Vuelve a sincronizar para poblarla.' },
        { status: 400 }
      );
    }

    const transcript = await transcribeInstagramPost(reel.video_url);

    let update = supabase
      .from('reels')
      .update({ transcript, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (hasCurationColumns(reel)) {
      update = update.eq('is_hidden', false).eq('is_duplicate', false).eq('transcript_suppressed', false);
    }
    const { data: saved, error: updateError } = await update.select('id,transcript').maybeSingle();

    if (updateError) {
      console.error('Update Error:', updateError);
      throw new Error('No se pudo guardar la transcripción en Supabase');
    }
    if (!saved || saved.transcript !== transcript) {
      return NextResponse.json({ error: ENRICHMENT_BLOCKED_MESSAGE }, { status: 409 });
    }

    return NextResponse.json({ success: true, transcript });
  } catch (error) {
    console.error('Transcribe Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
