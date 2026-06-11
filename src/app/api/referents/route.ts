import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/** Devuelve 428 con flag cuando la tabla aún no existe (falta correr la migración). */
const migrationRequired = (error: any) =>
  error?.code === '42P01' || /does not exist/i.test(error?.message || '');

const cleanUsername = (raw: string) =>
  String(raw || '')
    .trim()
    .replace(/^@/, '')
    .replace(/https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();

export async function GET() {
  const { data, error } = await supabase
    .from('referents')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    if (migrationRequired(error)) {
      return NextResponse.json({ error: 'migration_required' }, { status: 428 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = cleanUsername(body.username);
    if (!username) {
      return NextResponse.json({ error: 'Username requerido' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('referents')
      .upsert({ username, active: true }, { onConflict: 'username' })
      .select()
      .single();

    if (error) {
      if (migrationRequired(error)) {
        return NextResponse.json({ error: 'migration_required' }, { status: 428 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  const { error } = await supabase.from('referents').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
