import { NextResponse } from 'next/server';
import type OpenAI from 'openai';
import { supabase } from '@/utils/supabase';
import { llm, LLM_MODEL, hasLLMKey } from '@/lib/llm';
import { TONY_BRAND, SCRIPT_STRATEGY } from '@/lib/brand';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const fmt = (n: number | null | undefined) => (n == null ? 's/d' : Number(n).toLocaleString('es'));

/** Construye un dossier compacto con todos los reels para alimentar al modelo. */
function buildContext(reels: any[]): string {
  return reels
    .map((r, i) => {
      const title = (r.title || 'Sin título').split('\n')[0];
      const transcript = r.transcript ? String(r.transcript).replace(/\s+/g, ' ').slice(0, 1200) : '(sin transcripción)';
      const analysis = Array.isArray(r.ai_analysis) && r.ai_analysis.length ? r.ai_analysis.join(' | ') : '(sin análisis)';
      const date = r.published_at ? new Date(r.published_at).toLocaleDateString('es') : 's/d';
      return [
        `### Reel ${i + 1}: ${title}  (${date})`,
        `Métricas → vistas ${fmt(r.views)} · reach ${fmt(r.reach)} · likes ${fmt(r.likes)} · comentarios ${fmt(r.comments)} · guardados ${fmt(r.saves)} · compartidos ${fmt(r.shares)} · ER ${r.engagement_rate != null ? r.engagement_rate + '%' : 's/d'}`,
        `Análisis IA → ${analysis}`,
        r.improvement ? `Mejora sugerida → ${r.improvement}` : '',
        `Transcripción → ${transcript}`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

const SYSTEM_PROMPT = `Sos el estratega de contenido personal de Tony. Trabajás para UNA sola cuenta y la conocés a fondo. Tu única misión: hacer crecer su Instagram hacia los 50.000 seguidores con contenido orgánico que además le traiga clientes a Crevy.

${TONY_BRAND}

${SCRIPT_STRATEGY}

## TUS DATOS
Tenés un dossier con TODOS sus reels reales: métricas, transcripción del audio y análisis previo de cada uno. Es tu única fuente de verdad sobre su rendimiento. No inventes datos.

## CÓMO RESPONDER
- En su voz: rioplatense (vos/tenés), directo, accionable, cero humo.
- Fundamentá SIEMPRE en el dossier: nombrá reels por título y justificá con sus números (vistas, guardados, ER). Los guardados y compartidos pesan más que los likes.
- Cuando detectes patrones, sé quirúrgico: qué hook, qué estructura, qué duración, qué tema, qué CTA — y conectalo con las variables que le funcionaron/fallaron del kit.
- Si te piden hooks, ángulos o guiones: aplicá la ESTRATEGIA DE GUIONES completa. Antes de escribir, clasificá la pieza en el embudo (TOF/MOF/BOF) y decilo. Entregá opciones LISTAS PARA GRABAR con la estructura maestra: gancho visual sugerido + hook + desarrollo (sin el "cómo" completo si es TOF) + prueba social + moraleja + CTA nativo de 4 componentes.
- Todo lo que propongas debe atacar un deseo, miedo o creencia limitante del avatar. Si no, no sirve.
- Si la pregunta no se puede responder con los datos, decilo y pedí qué falta.
- Formato: listas y negritas cuando sumen legibilidad. Respuestas concretas, no ensayos.`;

export async function POST(request: Request) {
  try {
    if (!hasLLMKey()) {
      return NextResponse.json({ error: 'No hay API key de LLM (OPENAI_API_KEY u OPENROUTER_API_KEY)' }, { status: 500 });
    }

    const { messages } = await request.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Se requiere messages[]' }, { status: 400 });
    }

    // Cargar reels (solo Meta, sin duplicados Apify de 19 dígitos) ordenados por vistas.
    const { data: reels, error } = await supabase
      .from('reels')
      .select('title, published_at, views, reach, likes, comments, saves, shares, engagement_rate, transcript, ai_analysis, improvement, instagram_id')
      .order('views', { ascending: false });
    if (error) throw new Error(error.message);

    const filtered = (reels || []).filter((r) => (r.instagram_id || '').length < 19);
    const context = buildContext(filtered);

    const transcritos = filtered.filter((r) => r.transcript && r.transcript.trim()).length;

    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: `DOSSIER DE CONTENIDO (${filtered.length} reels, ${transcritos} con transcripción):\n\n${context}`,
      },
      ...messages.map(
        (m: any): OpenAI.Chat.Completions.ChatCompletionMessageParam =>
          m.role === 'assistant'
            ? { role: 'assistant', content: String(m.content || '') }
            : { role: 'user', content: String(m.content || '') }
      ),
    ];

    const completion = await llm.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.7,
      max_tokens: 1200,
      messages: convo,
    });

    const reply = completion.choices?.[0]?.message?.content || '';
    return NextResponse.json({ reply, stats: { reels: filtered.length, transcritos } });
  } catch (error: any) {
    console.error('Chat Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
