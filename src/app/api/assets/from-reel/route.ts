import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { ImportError, importVideoFromUrl } from '@/lib/importVideo';

// Descargar + re-subir el video puede tardar; damos margen al handler.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Convierte un reel existente en un asset de video REAL en Storage, listo para
 * generar variantes. El `reels.video_url` guardado es el permalink (la página
 * del post), no un mp4: `importVideoFromUrl` lo resuelve con Apify, lo baja y
 * lo sube al bucket `studio`. Devuelve el media_asset creado.
 */
export async function POST(request: Request) {
  try {
    const { reelId } = await request.json();
    if (!reelId) {
      return NextResponse.json({ error: 'Falta reelId' }, { status: 400 });
    }

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

    const name = (reel.title || 'reel').split('\n')[0].slice(0, 80);
    const asset = await importVideoFromUrl(reel.video_url, name, `reel-${reelId}`);
    return NextResponse.json({ asset });
  } catch (error: any) {
    console.error('from-reel Error:', error);
    const status = error instanceof ImportError ? error.status : 500;
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status });
  }
}
