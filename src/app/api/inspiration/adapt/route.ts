import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { llm, LLM_MODEL, hasLLMKey } from '@/lib/llm';
import { transcribeInstagramPost } from '@/lib/transcribe';
import { loadBlocks } from '@/lib/aiSettings';
import { composeAdaptSystemPrompt } from '@/lib/promptConfig';

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

    // 3. Generar la adaptación. La TRANSCRIPCIÓN es el insumo central: de ahí
    //    salen el tema y la mecánica. Los reels propios son referencia de VOZ.
    const userPrompt = `=== TRANSCRIPCIÓN DEL VIRAL A ADAPTAR (tu insumo principal: de acá salen el tema y la mecánica) ===
"""${transcript.slice(0, 2800)}"""

Contexto del viral: cuenta @${video.username} · score ${video.score}/100 · ${video.multiplier}x la mediana de su cuenta · ${fmt(video.views)} vistas.
Caption: """${(video.caption || '').slice(0, 300)}"""

=== REFERENCIA DE VOZ (cómo habla Tony en sus mejores reels — copiá la VOZ y cadencia, NO el tema ni el formato) ===
${ownExamples || '(aún sin transcripciones propias; usá la voz definida arriba)'}

Tarea: identificá el TEMA y la MECÁNICA de la transcripción de arriba y hacé la versión de Tony de ESE mismo video, manteniendo tema y mecánica. Devolvé SOLO el JSON.`;

    // El prompt de adaptación también sale del entrenamiento editable: voz,
    // pilares, embudo, estructura, CTA y reglas son los MISMOS bloques que usa
    // el chat. Antes estaban duplicados acá y contradecían lo que el usuario
    // editaba desde la app.
    const { blocks } = await loadBlocks();

    const completion = await llm.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: composeAdaptSystemPrompt(blocks) },
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
