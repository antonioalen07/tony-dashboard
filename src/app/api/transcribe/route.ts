import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { transcribeInstagramPost } from '@/lib/transcribe';

// Reels pueden tardar en scrapear/transcribir; damos margen al handler.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Transcribe el reel propio indicado y guarda `transcript` en Supabase. */
export async function POST(request: Request) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'Reel ID is required' }, { status: 400 });
    }

    const { data: reel, error: fetchError } = await supabase
      .from('reels')
      .select('id, video_url')
      .eq('id', id)
      .single();

    if (fetchError || !reel) {
      return NextResponse.json({ error: 'Reel not found' }, { status: 404 });
    }

    if (!reel.video_url?.startsWith('http')) {
      return NextResponse.json(
        { error: 'Este reel no tiene URL de Instagram (video_url). Vuelve a sincronizar para poblarla.' },
        { status: 400 }
      );
    }

    const transcript = await transcribeInstagramPost(reel.video_url);

    const { error: updateError } = await supabase
      .from('reels')
      .update({ transcript, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      console.error('Update Error:', updateError);
      throw new Error('No se pudo guardar la transcripción en Supabase');
    }

    return NextResponse.json({ success: true, transcript });
  } catch (error: any) {
    console.error('Transcribe Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
