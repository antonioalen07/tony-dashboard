import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || 'placeholder',
  defaultHeaders: {
    'HTTP-Referer': 'https://crevy.content',
    'X-Title': 'Crevy Content',
  },
});

// Prompt base/genérico de growth. El usuario lo irá puliendo después para aislar
// los factores concretos que quiere optimizar en su contenido.
const SYSTEM_PROMPT = `Eres un estratega experto en crecimiento de Instagram y viralidad de Reels.
Analizas el guion/transcripción y las métricas de un Reel para explicar su rendimiento.

Debes responder ÚNICAMENTE con un objeto JSON válido (sin texto antes ni después, sin
bloques de código markdown) con esta forma exacta:
{
  "ai_analysis": [ "punto 1", "punto 2", "punto 3" ],
  "improvement": "una sugerencia accionable y concreta"
}

- "ai_analysis": exactamente 3 strings. Cada uno analiza un factor distinto de por qué el
  reel funcionó o falló (gancho/hook inicial, estructura y retención, claridad del CTA,
  relación entre el contenido y los números observados).
- "improvement": 1 string con la mejora más impactante y específica para el próximo reel.
Responde en español.`;

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

    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY no configurada' }, { status: 500 });
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

    const completion = await openai.chat.completions.create({
      model: 'anthropic/claude-3.5-haiku',
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
