import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import { supabase } from '@/utils/supabase';

// Reels pueden tardar en scrapear/transcribir; damos margen al handler.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Pipeline de transcripción:
 *   reel.video_url (permalink IG) -> Apify (obtiene el mp4) -> descarga -> ElevenLabs STT
 *   -> guarda `transcript` en Supabase.
 */
export async function POST(request: Request) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'Reel ID is required' }, { status: 400 });
    }

    const apifyToken = process.env.APIFY_API_TOKEN;
    const elevenKey = process.env.ELEVENLABS_API_KEY;
    if (!apifyToken) return NextResponse.json({ error: 'APIFY_API_TOKEN no configurada' }, { status: 500 });
    if (!elevenKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY no configurada' }, { status: 500 });

    // 1. Cargar el reel
    const { data: reel, error: fetchError } = await supabase
      .from('reels')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !reel) {
      return NextResponse.json({ error: 'Reel not found' }, { status: 404 });
    }

    const permalink: string = reel.video_url || '';
    if (!permalink.startsWith('http')) {
      return NextResponse.json(
        { error: 'Este reel no tiene URL de Instagram (video_url). Vuelve a sincronizar para poblarla.' },
        { status: 400 }
      );
    }

    // 2. Apify -> obtener el mp4 del reel
    const apify = new ApifyClient({ token: apifyToken });
    const run = await apify.actor('apify/instagram-scraper').call({
      directUrls: [permalink],
      resultsType: 'posts',
      resultsLimit: 1,
      addParentData: false,
    });

    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    const item: any = items[0];
    const videoUrl: string | undefined =
      item?.videoUrl || item?.videoUrlBackup || item?.video_url;

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Apify no devolvió la URL del video (¿el reel es público y tiene video?).' },
        { status: 502 }
      );
    }

    // 3. Descargar el mp4
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      return NextResponse.json({ error: `No se pudo descargar el video (${videoRes.status})` }, { status: 502 });
    }
    const videoBuffer = await videoRes.arrayBuffer();
    const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' });

    // 4. ElevenLabs Speech-to-Text (Scribe)
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('file', videoBlob, `reel-${id}.mp4`);

    const sttRes = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': elevenKey },
      body: form,
    });

    if (!sttRes.ok) {
      const errText = await sttRes.text();
      console.error('ElevenLabs STT error:', errText);
      return NextResponse.json(
        { error: `ElevenLabs falló (${sttRes.status})` },
        { status: 502 }
      );
    }

    const sttData = await sttRes.json();
    const transcript: string = (sttData.text || '').trim();

    if (!transcript) {
      return NextResponse.json({ error: 'La transcripción salió vacía.' }, { status: 502 });
    }

    // 5. Guardar en Supabase
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
