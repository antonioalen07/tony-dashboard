import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabase } from '@/utils/supabase';

export const maxDuration = 60;

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://crevy.content',
    'X-Title': 'Crevy Content',
  },
});

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

const SYSTEM_PROMPT = `Eres el estratega de contenido personal de "tony.ia_" (marca Crevy), experto en crecimiento de Instagram y Reels sobre IA, Claude y automatización.

Tienes acceso a un dossier con TODOS sus reels: métricas reales, transcripción del audio y un análisis IA previo de cada uno. Úsalo como única fuente de verdad.

Cómo responder:
- En español rioplatense neutro, directo y accionable. Nada de relleno ni buzzwords.
- Fundamenta SIEMPRE en los datos: cita reels por su título y usa sus números (vistas, guardados, ER) para justificar.
- Cuando detectes patrones de lo que funciona vs. lo que no, sé específico (hooks, estructura, duración, tema, CTA).
- Si te piden hooks, ángulos o guiones, propón opciones concretas inspiradas en lo que ya le funcionó a esta cuenta.
- Si la pregunta no se puede responder con los datos, dilo y pide qué falta.
- Formatea con listas y negritas cuando ayude a la legibilidad.`;

export async function POST(request: Request) {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY no configurada' }, { status: 500 });
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

    const completion = await openai.chat.completions.create({
      model: 'anthropic/claude-3.5-haiku',
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
