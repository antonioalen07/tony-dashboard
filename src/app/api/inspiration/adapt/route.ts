import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { llm, LLM_MODEL, hasLLMKey } from '@/lib/llm';
import { transcribeInstagramPost } from '@/lib/transcribe';
import { TONY_VOICE, TONY_PILLARS, SCRIPT_STRATEGY } from '@/lib/brand';

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

const SYSTEM_PROMPT = `Estás en MODO ADAPTACIÓN. Te paso un reel viral de OTRO creador y hacés "la versión de Tony" de ESE MISMO video. NO estás escribiendo un anuncio de los servicios de Tony: estás recreando el video que funcionó, con su voz.

## CÓMO PENSARLO (en este orden, obligatorio)
1. Leé la TRANSCRIPCIÓN del viral e identificá:
   (a) el TEMA CONCRETO del video (ej: "automatizar la carga/envío de PDFs con Claude Code", "construir un agente de voz con n8n"),
   (b) la MECÁNICA: demo en pantalla / tutorial / caso real / reacción / opinión-contraste / POV / storytelling.
   Esa mecánica + ese tema SON la razón por la que viralizó.
2. ¿El tema ya encaja en un pilar de Tony?
   - SÍ (lo más común en virales de IA, Claude, n8n, automatización, herramientas, demos): MANTENÉ EL MISMO TEMA y la MISMA MECÁNICA. Solo lo pasás a la voz de Tony y le ponés su CTA. Ejemplo: viral de "optimizar PDFs con Claude Code" → tu guion es una DEMO mostrando en pantalla cómo automatizar/optimizar PDFs con Claude Code o n8n, NO un pitch de ventas.
   - NO encaja (ej: un viral de fitness o cocina): trasladá SOLO la mecánica a un tema de los pilares de Tony, manteniendo el tipo de contenido (demo→demo).
3. Escribí el guion con esa mecánica y ese tema, en la voz de Tony, con la estructura de abajo.

## PROHIBIDO (este es el error que NO podés cometer)
- Convertir un viral técnico/demo/tutorial en un discurso de ventas genérico tipo "estás dejando plata sobre la mesa por no responder rápido" / "tus competidores ya están vendiendo". Esas frases son para contenido de VENTA de servicios, jamás para adaptar un tutorial o una demo.
- El HOOK sale del TEMA del viral, no de los dolores comerciales del avatar (salvo que el viral hablara literalmente de eso).
- Cambiar el tipo de contenido (demo → hablado a cámara). Respetá la mecánica y el ritmo del original.
- La venta solo puede aparecer como CTA nativo al final; el cuerpo entrega el mismo tipo de valor que el original.

${TONY_VOICE}

${TONY_PILLARS}

${SCRIPT_STRATEGY}

Respondé ÚNICAMENTE con un objeto JSON válido (sin texto antes/después, sin markdown) con esta forma exacta:
{
  "tema_del_viral": "El tema concreto detectado en la transcripción, en pocas palabras (ej: 'automatizar envío de PDFs con Claude Code')",
  "mecanica": "El tipo de contenido y por qué funcionó (ej: 'demo en pantalla mostrando la herramienta resolviendo un problema real, paso a paso')",
  "mantiene_tema": true,
  "por_que_viralizo": "2-3 oraciones sobre la mecánica real del viral",
  "aplicabilidad": "Alta" | "Media" | "Baja",
  "etapa_funnel": "TOF" | "MOF" | "BOF",
  "gancho_visual": "Qué se ve en el primer frame (texto en pantalla, qué se muestra, acción) — coherente con la mecánica",
  "hook": "Hook LITERAL listo para grabar, que nace del TEMA del viral (sin presentarse)",
  "angulo": "El giro propio de Tony sobre el MISMO tema/mecánica (1-2 oraciones)",
  "formato": "El MISMO tipo de formato que el original (ej: 'Demo de pantalla, 45-60s') y duración",
  "guion": "GUION COMPLETO listo para grabar, en la voz de Tony, con la MISMA mecánica y tema del viral. HOOK (0-3s) / DESARROLLO con esa mecánica (texto en pantalla entre [corchetes], pasos o ejemplo concreto reales del tema) / MORALEJA breve / CTA NATIVO (entregable + resultado + tiempo + esfuerzo). 100-180 palabras."
}

"mantiene_tema" debe ser true salvo que el tema del viral realmente no tenga nada que ver con IA/automatización/negocio; en ese caso ponelo en false y explicá el traslado en "angulo".`;

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

    const completion = await llm.chat.completions.create({
      model: LLM_MODEL,
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
