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
 * Con `?preview=1` devuelve además el prompt FINAL de cada modo, exactamente
 * como lo recibe el modelo. Es la única forma de comprobar que un cambio en el
 * entrenamiento llegó de verdad: si borraste algo y sigue apareciendo en el
 * preview, está entrando por otro bloque.
 */
export async function GET(request: Request) {
  try {
    const { blocks, tableMissing, updatedAt } = await loadBlocks();
    const wantsPreview = new URL(request.url).searchParams.get('preview') === '1';

    return NextResponse.json({
      blocks,
      customized: customizedBlockIds(blocks),
      disabled: disabledBlockIds(blocks),
      tableMissing,
      updatedAt,
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
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
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
  } catch (error: any) {
    const message = String(error?.message || '');
    // Sin migración corrida no hay dónde guardar: decirlo con nombre y apellido.
    if (/ai_settings/i.test(message) || /schema cache/i.test(message)) {
      return NextResponse.json(
        { error: 'Falta la tabla `ai_settings`: corré supabase_migration_ai_config.sql en el SQL Editor de Supabase.' },
        { status: 428 },
      );
    }
    return NextResponse.json({ error: message || 'Internal Server Error' }, { status: 500 });
  }
}
