import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { deleteFromStudio } from '@/lib/storage';
import { MediaAsset, MIGRATION_REQUIRED_STATUS } from '@/lib/studio-types';

export const dynamic = 'force-dynamic';

function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === '42P01' || /does not exist/i.test(e?.message || '');
}

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

/** DELETE /api/assets/:id — borra el objeto del Storage y la fila -> { success: true } */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'id requerido' }, { status: 400 });
    }

    const { data, error: findError } = await supabase
      .from('media_assets')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (findError) {
      if (isMissingTable(findError)) return migrationResponse();
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Asset no encontrado' }, { status: 404 });
    }

    const asset = data as MediaAsset;

    // Primero el objeto de Storage; luego la fila.
    await deleteFromStudio(asset.storage_path);

    const { error: deleteError } = await supabase
      .from('media_assets')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Assets Error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
