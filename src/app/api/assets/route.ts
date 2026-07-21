import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { uploadToStudio } from '@/lib/storage';
import {
  AssetKind,
  MediaAsset,
  MIGRATION_REQUIRED_STATUS,
} from '@/lib/studio-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Límites de tamaño por tipo (400 si se exceden).
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300 MB

/** true cuando el error de supabase indica que falta la tabla (migración pendiente). */
function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === '42P01' || /does not exist/i.test(e?.message || '');
}

/** Mensaje legible de un error desconocido. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const e = error as { message?: string } | null;
  return e?.message || 'Internal Server Error';
}

function migrationResponse() {
  return NextResponse.json(
    { error: 'Falta correr la migración del Studio' },
    { status: MIGRATION_REQUIRED_STATUS }
  );
}

/** POST /api/assets — multipart form-data { file, kind } -> { id, public_url, storage_path } */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    const kind = form.get('kind');

    if (!file || typeof (file as Blob).arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'file requerido' }, { status: 400 });
    }
    if (kind !== 'image' && kind !== 'video') {
      return NextResponse.json(
        { error: "kind inválido (esperado 'image' o 'video')" },
        { status: 400 }
      );
    }

    const blob = file as Blob;
    const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (blob.size > limit) {
      const mb = Math.round(limit / (1024 * 1024));
      return NextResponse.json(
        { error: `El ${kind} excede el límite de ${mb}MB` },
        { status: 400 }
      );
    }

    // Nombre y content-type derivados del Blob (File trae .name; Blob no siempre).
    const filename = (file as File).name || `${kind}-${Date.now()}`;
    const contentType =
      blob.type || (kind === 'image' ? 'image/png' : 'video/mp4');

    const buffer = Buffer.from(await blob.arrayBuffer());
    const { storage_path, public_url } = await uploadToStudio(buffer, {
      filename,
      contentType,
    });

    const { data, error } = await supabase
      .from('media_assets')
      .insert({
        kind: kind as AssetKind,
        filename,
        storage_path,
        public_url,
        source: 'upload',
      })
      .select()
      .single();

    if (error) {
      if (isMissingTable(error)) return migrationResponse();
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const asset = data as MediaAsset;
    return NextResponse.json({
      id: asset.id,
      public_url: asset.public_url,
      storage_path: asset.storage_path,
    });
  } catch (error) {
    console.error('Assets Error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** GET /api/assets?kind=image|video -> MediaAsset[] (created_at desc) */
export async function GET(request: Request) {
  try {
    const kind = new URL(request.url).searchParams.get('kind');

    let query = supabase
      .from('media_assets')
      .select('*')
      .order('created_at', { ascending: false });

    if (kind === 'image' || kind === 'video') {
      query = query.eq('kind', kind);
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingTable(error)) return migrationResponse();
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json((data ?? []) as MediaAsset[]);
  } catch (error) {
    console.error('Assets Error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
