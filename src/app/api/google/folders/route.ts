import { NextResponse } from 'next/server';
import {
  getValidAccessToken,
  listFolders,
  MigrationRequiredError,
  NotConnectedError,
} from '@/lib/google';
import { MIGRATION_REQUIRED_STATUS } from '@/lib/studio-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/google/folders — lista las carpetas del Drive conectado.
 * 428 si falta la tabla (migración), 401 si no hay conexión activa.
 */
export async function GET() {
  try {
    const accessToken = await getValidAccessToken();
    const folders = await listFolders(accessToken);
    return NextResponse.json({ folders });
  } catch (error) {
    if (error instanceof MigrationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: MIGRATION_REQUIRED_STATUS });
    }
    if (error instanceof NotConnectedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Error listando carpetas';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
