import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getValidAccessToken,
  listImageFiles,
  MigrationRequiredError,
  NotConnectedError,
} from '@/lib/google';
import { MIGRATION_REQUIRED_STATUS } from '@/lib/studio-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/google/files[?pageToken=] — lista imágenes del Drive conectado.
 * 428 si falta la tabla (migración), 401 si no hay conexión activa.
 */
export async function GET(request: NextRequest) {
  try {
    const pageToken = request.nextUrl.searchParams.get('pageToken') ?? undefined;
    const accessToken = await getValidAccessToken();
    const { files, nextPageToken } = await listImageFiles(accessToken, pageToken);
    return NextResponse.json({ files, nextPageToken });
  } catch (error) {
    if (error instanceof MigrationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: MIGRATION_REQUIRED_STATUS });
    }
    if (error instanceof NotConnectedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Error listando archivos';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
