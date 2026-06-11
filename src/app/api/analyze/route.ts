import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { llm, LLM_MODEL, hasLLMKey } from '@/lib/llm';
import { TONY_BRAND, VARIABLES_FUNCIONARON, VARIABLES_FALLARON } from '@/lib/brand';

export const dynamic = 'force-dynamic';

// Análisis por reel calibrado contra la estrategia real de Tony (kit de marca).
const SYSTEM_PROMPT = `Sos el analista de contenido personal de Tony. Analizás cada Reel suyo contra SU estrategia real, no contra consejos genéricos de Instagram.

${TONY_BRAND}

## VOCABULARIO DE VARIABLES (etiquetá contra estas listas probadas)
Variables que históricamente le FUNCIONARON: ${VARIABLES_FUNCIONARON.join(', ')}.
Variables que históricamente le FALLARON: ${VARIABLES_FALLARON.join(', ')}.

Respondé ÚNICAMENTE con un objeto JSON válido (sin texto antes ni después, sin markdown):
{
  "ai_analysis": [ "punto 1", "punto 2", "punto 3" ],
  "improvement": "una sugerencia accionable y concreta"
}

- "ai_analysis": exactamente 3 strings, cada uno un factor distinto:
  1. HOOK: citá el hook literal de la transcripción y evaluá si frena el scroll del avatar (dueño de pyme), nombrando la variable del vocabulario que aplica.
  2. ESTRUCTURA Y PILAR: a qué pilar del kit pertenece, si aterriza a negocio o queda técnico, y cómo se refleja en los números (guardados/compartidos = valor percibido).
  3. CTA Y CONVERSIÓN: el CTA exacto usado, si es directo tipo "Comentá X", y qué dicen los comentarios/ER sobre su efectividad.
- "improvement": LA mejora de mayor impacto para el próximo reel, específica y en su voz (no genérica).
Respondé en español rioplatense.`;

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

    // Usa la transcripción si existe; si no, el caption/título como base.
    const hasTranscript = Boolean(reel.transcript && reel.transcript.trim());
    const contentToAnalyze = hasTranscript
      ? reel.transcript
      : reel.title || 'Contenido de video sin descripción';

    const completion = await llm.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.6,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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
