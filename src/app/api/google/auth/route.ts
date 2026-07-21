import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/google';

export const dynamic = 'force-dynamic';

/** GET /api/google/auth — redirige al consentimiento de Google (Drive readonly). */
export async function GET() {
  try {
    return NextResponse.redirect(buildAuthUrl());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo iniciar OAuth';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
