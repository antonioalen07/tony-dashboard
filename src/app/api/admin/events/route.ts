import { NextResponse } from 'next/server';
import { errorResponse, listEvents, requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Auditoría de acceso, lo más nuevo primero. `?limit=` hasta 500. */
export async function GET(request: Request) {
  const auth = await requireRole(request, 'admin');
  if (!auth.ok) return auth.res;
  try {
    const limit = Number(new URL(request.url).searchParams.get('limit')) || 100;
    return NextResponse.json({ events: await listEvents(limit) });
  } catch (e) {
    return errorResponse(e, 500);
  }
}
