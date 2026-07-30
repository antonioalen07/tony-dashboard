import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { resolveInstagramVideoUrl } from '@/lib/transcribe';

// Descargar + re-subir el video puede tardar; damos margen al handler.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BUCKET = 'studio';

/**
 * Convierte un reel existente en un asset de video REAL en Storage, listo para
 * generar variantes. El `reels.video_url` guardado es el permalink (la página
 * del post), no un mp4; acá usamos Apify para resolver el mp4, lo descargamos
 * en el server y lo subimos al bucket `studio`. Devuelve el media_asset creado.
 */
export async function POST(request: Request) {
  try {
    const { reelId } = await request.json();
    if (!reelId) {
      return NextResponse.json({ error: 'Falta reelId' }, { status: 400 });
    }

    // 1) Reel + su permalink.
    const { data: reel, error: reelErr } = await supabase
      .from('reels')
      .select('id, title, video_url')
      .eq('id', reelId)
      .single();
    if (reelErr || !reel) {
      return NextResponse.json({ error: 'Reel no encontrado' }, { status: 404 });
    }
    if (!reel.video_url?.startsWith('http')) {
      return NextResponse.json(
        { error: 'Este reel no tiene URL de Instagram. Volvé a sincronizar para poblarla.' },
        { status: 400 },
      );
    }

    // 2) Apify: permalink -> mp4 real (URL de CDN fresca).
    const videoUrl = await resolveInstagramVideoUrl(reel.video_url);

    // 3) Descargar el mp4 en el server (Instagram/CDN bloquean fetch desde el navegador).
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      return NextResponse.json(
        { error: `No se pudo descargar el video del reel (${videoRes.status})` },
        { status: 502 },
      );
    }
    const buffer = Buffer.from(await videoRes.arrayBuffer());

    // 3b) Validar que sea realmente un video (no una página HTML/error). Si no,
    //     avisamos acá en vez de dejar que el worker falle con "moov atom not found".
    const head = buffer.subarray(0, 64);
    const isMp4 = head.includes(Buffer.from('ftyp'));
    const isWebm = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    const contentType = videoRes.headers.get('content-type') || 'desconocido';
    if (buffer.length < 50_000 || (!isMp4 && !isWebm && !/video|octet-stream/i.test(contentType))) {
      return NextResponse.json(
        {
          error: `Apify no devolvió un video válido (${buffer.length} bytes, tipo "${contentType}"). Reintentá en unos segundos; si persiste, el reel puede ser privado o sin video.`,
        },
        { status: 502 },
      );
    }

    // 4) Subir al bucket `studio` como archivo real.
    const path = `sources/reel-${reelId}-${Date.now()}.mp4`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: 'video/mp4', upsert: true });
    if (upErr) {
      return NextResponse.json({ error: `No se pudo guardar el video: ${upErr.message}` }, { status: 500 });
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub?.publicUrl;
    if (!publicUrl) {
      return NextResponse.json({ error: 'No obtuve public_url del video subido' }, { status: 500 });
    }

    // 5) Registrar el media_asset (source 'reel', storage_path real).
    const { data: asset, error: assetErr } = await supabase
      .from('media_assets')
      .insert({
        kind: 'video',
        filename: `${reel.title || 'reel'}.mp4`,
        storage_path: path,
        public_url: publicUrl,
        source: 'reel',
      })
      .select('*')
      .single();
    if (assetErr || !asset) {
      return NextResponse.json(
        { error: `No se pudo registrar el asset: ${assetErr?.message || 'null'}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ asset });
  } catch (error: any) {
    console.error('from-reel Error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
