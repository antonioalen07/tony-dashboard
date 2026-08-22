import { NextResponse } from 'next/server';
import type OpenAI from 'openai';
import { supabase } from '@/utils/supabase';
import { llm, LLM_MODEL, hasLLMKey } from '@/lib/llm';
import { loadBlocks } from '@/lib/aiSettings';
import { composeChatSystemPrompt } from '@/lib/promptConfig';

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

    const metaReels = (reels || []).filter((r) => (r.instagram_id || '').length < 19);

    // Umbral de rendimiento: por debajo de esto un reel no aporta señal y solo gasta
    // tokens. NO se manda al modelo (pero se sigue transcribiendo/analizando igual en
    // /sync y /analyze). Configurable con CHAT_MIN_VIEWS en .env.local.
    const MIN_VIEWS = Number(process.env.CHAT_MIN_VIEWS ?? 800);

    let filtered = metaReels.filter((r) => Number(r.views ?? 0) >= MIN_VIEWS);
    let excluidos = metaReels.length - filtered.length;

    // Salvavidas: si el umbral deja el dossier vacío (cuenta nueva o umbral muy alto),
    // mandamos igual el top por vistas para no dejar a la IA a ciegas.
    if (filtered.length === 0 && metaReels.length > 0) {
      filtered = metaReels.slice(0, 10); // ya vienen ordenados por vistas desc
      excluidos = metaReels.length - filtered.length;
    }

    // El entrenamiento (pilares, ángulos, reglas, variables) es editable desde
    // la app; si falta la migración, loadBlocks devuelve los defaults de siempre.
    const { blocks } = await loadBlocks();

    const context = buildContext(filtered);

    const transcritos = filtered.filter((r) => r.transcript && r.transcript.trim()).length;

    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: composeChatSystemPrompt(blocks) },
      {
        role: 'system',
        content: `DOSSIER DE CONTENIDO (${filtered.length} reels con ≥${MIN_VIEWS} vistas${excluidos ? `; ${excluidos} de bajo rendimiento excluidos por no superar el umbral` : ''}; ${transcritos} con transcripción).\nEl umbral de ${MIN_VIEWS} vistas es el piso de "esto funcionó": todo lo que aparece acá ya pasó esa barra. Los reels por debajo se consideran fallidos y no se incluyen.\n\n${context}`,
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
      max_completion_tokens: 1200,
      messages: convo,
    });

    const reply = completion.choices?.[0]?.message?.content || '';
    return NextResponse.json({ reply, stats: { reels: filtered.length, transcritos, excluidos, minViews: MIN_VIEWS } });
  } catch (error: any) {
    console.error('Chat Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
