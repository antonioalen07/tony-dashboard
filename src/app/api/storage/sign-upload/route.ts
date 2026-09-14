import { NextResponse } from 'next/server';
import { errorResponse, requireRole } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const BUCKET = 'studio';
/** Paths tipo `carpeta/archivo.ext`: sin `..`, sin barras dobles ni caracteres raros. */
const SAFE_PATH = /^(?!.*\.\.)(?!\/)[\w\-./]{1,400}(?<!\/)$/;

/**
 * Firma una subida directa navegador → Supabase Storage.
 *
 * El navegador ya no tiene key de Supabase, y pasar el archivo por Vercel no
 * es opción (4.5 MB máx por request). Con sesión válida se le da una URL
 * firmada (válida 2 h, para ESE path) y sube con un PUT directo. Ver
 * `uploadStudioObject` en src/lib/storage.ts.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request);
  if (!auth.ok) return auth.res;
  try {
    const body = await request.json().catch(() => null);
    const path = String(body?.path ?? '');
    const upsert = Boolean(body?.upsert);
    if (!SAFE_PATH.test(path)) return NextResponse.json({ error: 'Path inválido' }, { status: 400 });

    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path });
  } catch (e) {
    return errorResponse(e, 500);
  }
}
