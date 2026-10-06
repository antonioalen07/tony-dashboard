import { NextResponse } from 'next/server';
import { ImportError, importVideoFromUrl, isInstagramPostUrl } from '@/lib/importVideo';

// Apify + descarga + subida: puede tardar.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * POST { url } — trae un video externo al Storage para usarlo de base:
 * un reel/post de Instagram (tuyo o de la competencia) o una URL directa a un
 * mp4. Devuelve el media_asset creado.
 */
export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
      return NextResponse.json({ error: 'Pegá una URL http(s) válida' }, { status: 400 });
    }
    const ig = isInstagramPostUrl(url);
    const name = ig
      ? `reel-${/\/(?:reel|reels|p|tv)\/([\w-]+)/i.exec(url)?.[1] ?? 'instagram'}`
      : decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'video');
    const asset = await importVideoFromUrl(url, name, ig ? 'ig' : 'link');
    return NextResponse.json({ asset });
  } catch (error) {
    console.error('from-url Error:', error);
    const status = error instanceof ImportError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'No se pudo traer el video';
    return NextResponse.json({ error: message }, { status });
  }
}
