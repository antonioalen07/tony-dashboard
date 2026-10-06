import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { walkStorage } from '@/lib/storageAdmin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/storage/usage — cuánto ocupa el Storage de Supabase, contra el
 * límite del plan. El límite (1 GB en el plan free) es por PROYECTO, así que se
 * suman todos los buckets. Se puede ajustar con STORAGE_LIMIT_MB si cambia el plan.
 *
 * Desglose por carpeta de primer nivel del bucket `studio`, que es lo útil
 * para decidir qué borrar (las variantes son lo que crece).
 */

const LABELS: Record<string, string> = {
  variants: 'Variantes',
  sources: 'Videos base (reels)',
  uploads: 'Videos subidos',
  'variant-text': 'Textos de variantes',
  covers: 'Portadas de reels',
  drive: 'Imágenes de Drive',
};

// Recorrer el bucket son decenas de llamadas: cacheamos un rato por instancia.
let cache: { at: number; body: unknown } | null = null;
const TTL_MS = 30_000;

export async function GET(request: Request) {
  try {
    const fresh = new URL(request.url).searchParams.get('fresh') === '1';
    if (!fresh && cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);

    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) throw new Error(error.message);

    const groups = new Map<string, number>();
    let total = 0;
    for (const b of buckets || []) {
      const files = await walkStorage('', 0, b.name);
      for (const f of files) {
        total += f.size;
        const top = f.path.includes('/') ? f.path.split('/')[0] : '(raíz)';
        const key = b.name === 'studio' ? top : `bucket:${b.name}`;
        groups.set(key, (groups.get(key) || 0) + f.size);
      }
    }

    const limitBytes = (Number(process.env.STORAGE_LIMIT_MB) || 1024) * 1024 * 1024;
    const body = {
      usedBytes: total,
      limitBytes,
      breakdown: [...groups.entries()]
        .map(([key, bytes]) => ({
          key,
          label: LABELS[key] ?? (key.startsWith('bucket:') ? `Bucket ${key.slice(7)}` : key),
          bytes,
        }))
        .sort((a, b) => b.bytes - a.bytes),
      measuredAt: new Date().toISOString(),
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo medir el Storage';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
