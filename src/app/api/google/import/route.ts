import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import {
  getValidAccessToken,
  downloadFile,
  MigrationRequiredError,
  NotConnectedError,
} from '@/lib/google';
import { MIGRATION_REQUIRED_STATUS } from '@/lib/studio-types';
import type { MediaAsset } from '@/lib/studio-types';

export const dynamic = 'force-dynamic';

const BUCKET = 'studio';

/** Nombre de archivo apto para un storage_path (sin espacios ni caracteres raros). */
function safeName(name: string): string {
  const cleaned = (name || 'imagen')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'imagen';
}

/**
 * POST /api/google/import { fileId } — baja el archivo de Drive, lo sube al bucket
 * 'studio' e inserta un `media_assets` (source 'drive'). Devuelve el asset creado.
 * 428 si falta la tabla, 401 si no hay conexión activa.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { fileId?: string };
    const fileId = body.fileId?.trim();
    if (!fileId) {
      return NextResponse.json({ error: 'fileId requerido' }, { status: 400 });
    }

    const accessToken = await getValidAccessToken();
    const { bytes, meta } = await downloadFile(accessToken, fileId);

    const contentType = meta.mimeType || 'image/jpeg';
    const storagePath = `drive/${Date.now()}-${safeName(meta.name)}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType, upsert: false });
    if (uploadError) {
      return NextResponse.json(
        { error: `No se pudo subir al Storage: ${uploadError.message}` },
        { status: 500 },
      );
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = pub.publicUrl;

    const { data: asset, error: insertError } = await supabase
      .from('media_assets')
      .insert({
        kind: 'image',
        filename: meta.name ?? null,
        storage_path: storagePath,
        public_url: publicUrl,
        source: 'drive',
      })
      .select('*')
      .single();

    if (insertError) {
      if (insertError.code === '42P01') {
        return NextResponse.json(
          { error: 'Falta correr la migración del Studio' },
          { status: MIGRATION_REQUIRED_STATUS },
        );
      }
      // Rollback del objeto subido para no dejar huérfanos.
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ asset: asset as MediaAsset });
  } catch (error) {
    if (error instanceof MigrationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: MIGRATION_REQUIRED_STATUS });
    }
    if (error instanceof NotConnectedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Error importando el archivo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
