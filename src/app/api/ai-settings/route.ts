import { NextResponse } from 'next/server';
import { loadBlocks, saveBlocks } from '@/lib/aiSettings';
import {
  customizedBlockIds,
  disabledBlockIds,
  composeChatSystemPrompt,
  composeAnalyzeSystemPrompt,
  composeAdaptSystemPrompt,
} from '@/lib/promptConfig';

export const dynamic = 'force-dynamic';

/**
 * Bloques efectivos (guardados + defaults) para el editor.
 *
 * Con `?preview=1` devuelve las instrucciones del sistema de cada modo; el
 * dossier y la conversación se añaden por separado. Permite comprobar que un cambio en el
 * entrenamiento llegó de verdad: si borraste algo y sigue apareciendo en el
 * preview, está entrando por otro bloque.
 */
export async function GET(request: Request) {
  try {
    const { blocks, tableMissing, updatedAt, source } = await loadBlocks();
    const wantsPreview = new URL(request.url).searchParams.get('preview') === '1';

    return NextResponse.json({
      blocks,
      customized: customizedBlockIds(blocks),
      disabled: disabledBlockIds(blocks),
      tableMissing,
      updatedAt,
      source,
      ...(wantsPreview
        ? {
            preview: {
              chat: composeChatSystemPrompt(blocks),
              analisis: composeAnalyzeSystemPrompt(blocks),
              adaptar: composeAdaptSystemPrompt(blocks),
            },
          }
        : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo leer el entrenamiento.' }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const { blocks } = await request.json();
    if (!blocks || typeof blocks !== 'object') {
      return NextResponse.json({ error: 'Se requiere blocks{}' }, { status: 400 });
    }

    await saveBlocks(blocks);

    const saved = await loadBlocks();
    return NextResponse.json({
      success: true,
      blocks: saved.blocks,
      customized: customizedBlockIds(saved.blocks),
      disabled: disabledBlockIds(saved.blocks),
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo guardar el entrenamiento.';
    const code = (error as { code?: string })?.code;
    // Sin migración corrida no hay dónde guardar: decirlo con nombre y apellido.
    if (code && ['42P01', 'PGRST205'].includes(code)) {
      return NextResponse.json(
        { error: 'Falta la tabla `ai_settings`: corré supabase_migration_ai_config.sql en el SQL Editor de Supabase.' },
        { status: 428 },
      );
    }
    return NextResponse.json({ error: message || 'Internal Server Error' }, { status: 500 });
  }
}
