import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { llm, LLM_MODEL, hasLLMKey } from '@/lib/llm';
import { loadBlocks } from '@/lib/aiSettings';
import { composeAnalyzeSystemPrompt } from '@/lib/promptConfig';

export const dynamic = 'force-dynamic';



/** Extrae el primer objeto JSON de un texto, tolerando fences ```json y ruido. */
function parseModelJSON(raw: string): { ai_analysis: string[]; improvement: string } {
  let text = raw.trim();
  // Quitar fences ```json ... ``` o ``` ... ```
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Si aún hay ruido, recortar al primer { ... último }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }
  const parsed = JSON.parse(text);
  return {
    ai_analysis: Array.isArray(parsed.ai_analysis)
      ? parsed.ai_analysis.map((p: unknown) => String(p))
      : [],
    improvement: typeof parsed.improvement === 'string' ? parsed.improvement : '',
  };
}

export async function POST(request: Request) {
  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Reel ID is required' }, { status: 400 });
    }

    if (!hasLLMKey()) {
      return NextResponse.json({ error: 'No hay API key de LLM (OPENAI_API_KEY u OPENROUTER_API_KEY)' }, { status: 500 });
    }

    // Obtener datos del Reel desde Supabase
    const { data: reel, error: fetchError } = await supabase
      .from('reels')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !reel) {
      return NextResponse.json({ error: 'Reel not found' }, { status: 404 });
    }

    // Los ejes de análisis y el vocabulario de variables son editables desde
    // la app (Chat → Entrenamiento de la IA); sin migración caen al default.
    const { blocks } = await loadBlocks();

    // Usa la transcripción si existe; si no, el caption/título como base.
    const hasTranscript = Boolean(reel.transcript && reel.transcript.trim());
    const contentToAnalyze = hasTranscript
      ? reel.transcript
      : reel.title || 'Contenido de video sin descripción';

    const completion = await llm.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: composeAnalyzeSystemPrompt(blocks) },
        {
          role: 'user',
          content: `Analiza este Reel.

Fuente del contenido: ${hasTranscript ? 'TRANSCRIPCIÓN del audio' : 'caption/descripción (aún sin transcripción)'}
Contenido: """${contentToAnalyze}"""

Métricas:
- Vistas: ${reel.views ?? 0}
- Reach: ${reel.reach ?? 'N/A'}
- Likes: ${reel.likes ?? 0}
- Comentarios: ${reel.comments ?? 0}
- Guardados: ${reel.saves ?? 'N/A'}
- Compartidos: ${reel.shares ?? 'N/A'}
- Engagement rate: ${reel.engagement_rate != null ? reel.engagement_rate + '%' : 'N/A'}

Devuelve SOLO el JSON.`,
        },
      ],
    });

    const responseText = completion.choices?.[0]?.message?.content;
    if (!responseText) throw new Error('Respuesta vacía del modelo');

    const analysisResult = parseModelJSON(responseText);

    if (analysisResult.ai_analysis.length === 0) {
      throw new Error('El modelo no devolvió un análisis válido');
    }

    // Persistir en Supabase
    const { error: updateError } = await supabase
      .from('reels')
      .update({
        ai_analysis: analysisResult.ai_analysis,
        improvement: analysisResult.improvement,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('Update Error:', updateError);
      throw new Error('No se pudo guardar el análisis en Supabase');
    }

    return NextResponse.json({ success: true, data: analysisResult });
  } catch (error: any) {
    console.error('Analyze Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
