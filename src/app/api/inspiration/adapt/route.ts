import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { llm, LLM_MODEL, hasLLMKey } from '@/lib/llm';
import { transcribeInstagramPost } from '@/lib/transcribe';
import { TONY_BRAND } from '@/lib/brand';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const fmt = (n: number | null | undefined) => (n == null ? 's/d' : Number(n).toLocaleString('es'));

/** Extrae el primer objeto JSON tolerando fences y ruido (mismo patrón que analyze). */
function parseModelJSON(raw: string): any {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) text = text.slice(first, last + 1);
  return JSON.parse(text);
}

const SYSTEM_PROMPT = `Sos el guionista personal de Tony. Tu trabajo: tomar un video viral de OTRA cuenta y convertirlo en un guion ORIGINAL para Tony, con su voz, su avatar y sus formatos ganadores. Nunca copiar: extraer la mecánica de por qué funcionó y reconstruirla para su marca.

${TONY_BRAND}

Respondé ÚNICAMENTE con un objeto JSON válido (sin texto antes/después, sin markdown) con esta forma exacta:
{
  "por_que_viralizo": "2-3 oraciones: la mecánica real del viral (gancho, estructura, tema, emoción)",
  "aplicabilidad": "Alta" | "Media" | "Baja",
  "hook": "El hook adaptado para Tony, 1-2 frases LITERALES listas para grabar",
  "angulo": "El ángulo diferenciador respecto al original, aterrizado a pymes/IA (1-2 oraciones)",
  "formato": "Formato recomendado (Reel hablado a cámara, Tutorial con pantalla, Caso real, POV, etc.) y duración sugerida",
  "guion": "GUION COMPLETO listo para grabar, en la voz de Tony (rioplatense, directo). Estructura: HOOK (0-3s) / DESARROLLO (con texto en pantalla sugerido entre [corchetes]) / CTA directo tipo 'Comentá X y te lo paso'. 80-150 palabras."
}`;

export async function POST(request: Request) {
  try {
    if (!hasLLMKey()) {
      return NextResponse.json({ error: 'No hay API key de LLM configurada' }, { status: 500 });
    }

    const body = await request.json();
    let video: any = body.video || null;
    const id: string | null = body.id || null;

    // Cargar el video persistido si vino por id
    if (id) {
      const { data, error } = await supabase.from('inspiration_videos').select('*').eq('id', id).single();
      if (error || !data) return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
      video = data;
    }
    if (!video?.post_url) {
      return NextResponse.json({ error: 'Falta el video o su post_url' }, { status: 400 });
    }

    // 1. Transcribir si hace falta (Apify + ElevenLabs — se paga solo al adaptar)
    let transcript: string = video.transcript || '';
    if (!transcript.trim()) {
      transcript = await transcribeInstagramPost(video.post_url);
      if (id) {
        await supabase.from('inspiration_videos').update({ transcript }).eq('id', id);
      }
    }

    // 2. Top 5 reels propios con transcripción como ejemplos de estilo
    const { data: ownReels } = await supabase
      .from('reels')
      .select('title, views, saves, engagement_rate, transcript')
      .not('transcript', 'is', null)
      .order('views', { ascending: false })
      .limit(5);

    const ownExamples = (ownReels || [])
      .map(
        (r, i) =>
          `EJEMPLO ${i + 1} (${fmt(r.views)} vistas, ${fmt(r.saves)} guardados, ER ${r.engagement_rate ?? 's/d'}%):\n"${String(r.transcript || '').replace(/\s+/g, ' ').slice(0, 600)}"`
      )
      .join('\n\n');

    // 3. Generar la adaptación
    const userPrompt = `VIDEO VIRAL DE REFERENCIA
Cuenta: @${video.username}
Score de viralidad: ${video.score}/100 (hizo ${video.multiplier}x la mediana de su cuenta)
Métricas: ${fmt(video.views)} vistas · ${fmt(video.likes)} likes · ${fmt(video.comments)} comentarios
Caption: """${(video.caption || '').slice(0, 400)}"""
TRANSCRIPCIÓN DEL VIRAL: """${transcript.slice(0, 2500)}"""

ASÍ HABLA TONY EN SUS PROPIOS REELS QUE MEJOR FUNCIONARON (imitar esta voz y cadencia):
${ownExamples || '(aún sin transcripciones propias; usá la voz definida en el kit)'}

Adaptá este viral a la marca de Tony. Devolvé SOLO el JSON.`;

    const completion = await llm.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.7,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Respuesta vacía del modelo');
    const adaptation = parseModelJSON(raw);
    if (!adaptation.guion || !adaptation.hook) {
      throw new Error('El modelo no devolvió una adaptación válida');
    }

    // 4. Persistir si corresponde
    if (id) {
      await supabase.from('inspiration_videos').update({ adaptation }).eq('id', id);
    }

    return NextResponse.json({ success: true, adaptation, transcript });
  } catch (error: any) {
    console.error('Adapt Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
