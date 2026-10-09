import { supabase } from '@/utils/supabase';
import { llm, LLM_MODEL, LLM_PROVIDER, hasLLMKey } from '@/lib/llm';
import { requireRole } from '@/lib/auth';
import { loadBlocks } from '@/lib/aiSettings';
import { composeChatSystemPrompt, customizedBlockIds, disabledBlockIds } from '@/lib/promptConfig';
import { buildChatContext, CHAT_LIMITS, ChatInputError, parseMinViews, validateMessages, type ContextReel, type ChatMessage } from '@/lib/chat-context';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function prepare(messages: ChatMessage[] = []) {
  const settings = await loadBlocks();
  const rows: ContextReel[] = [];
  let total = 0;
  for (let offset = 0; offset < CHAT_LIMITS.sourceRows; offset += 200) {
    // select(*) supports optional curation/business columns on older installations.
    const result = await supabase.from('reels').select('*', { count: 'exact' })
      .order('views', { ascending: false }).order('instagram_id', { ascending: true }).range(offset, offset + 199);
    if (result.error) throw new Error('No se pudo leer la base de contenido. Revisá la conexión a la base de datos.');
    total = result.count ?? rows.length + (result.data?.length || 0);
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < 200) break;
  }
  const training = composeChatSystemPrompt(settings.blocks);
  const context = buildChatContext(rows, training, messages, parseMinViews(process.env.CHAT_MIN_VIEWS));
  return {
    training, context,
    diagnostics: {
      checkedAt: new Date().toISOString(),
      database: { status: 'available' as const, totalReels: total, inspectedReels: rows.length, scanLimited: total > rows.length },
      training: {
        source: settings.source, updatedAt: settings.updatedAt,
        customized: customizedBlockIds(settings.blocks).length, disabled: disabledBlockIds(settings.blocks).length,
        disabledBlocks: disabledBlockIds(settings.blocks),
      },
      model: LLM_MODEL, provider: LLM_PROVIDER,
      stats: context.stats,
    },
  };
}

function failure(error: unknown) {
  const input = error instanceof ChatInputError;
  // Do not return provider/DB errors containing submitted text or credentials.
  const message = input ? error.message : error instanceof Error && /^(No se pudo leer)/.test(error.message)
    ? error.message : 'No se pudo preparar o responder el chat. Volvé a intentar.';
  return Response.json({ error: message }, { status: input ? 400 : 503, headers: { 'Cache-Control': 'no-store' } });
}

/** Read-only: reports coverage/version without returning prompts or calling the model. */
export async function GET(request: Request) {
  const auth = await requireRole(request);
  if (!auth.ok) return auth.res;
  try {
    const { diagnostics } = await prepare();
    return Response.json(diagnostics, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const auth = await requireRole(request);
  if (!auth.ok) return auth.res;
  try {
    if (!hasLLMKey()) return Response.json({ error: 'El proveedor de IA no está configurado.' }, { status: 503 });
    let body: { messages?: unknown };
    try { body = await request.json(); } catch { throw new ChatInputError('Enviá una conversación válida.'); }
    const messages = validateMessages(body?.messages);
    const { training, context, diagnostics } = await prepare(messages);
    const completion = await llm.chat.completions.create({
      model: LLM_MODEL, max_completion_tokens: 1200,
      messages: [{ role: 'system', content: training }, { role: 'system', content: context.dossier }, ...context.history],
    });
    const reply = completion.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Respuesta vacía');
    return Response.json({ reply, ...diagnostics, truncatedReply: completion.choices?.[0]?.finish_reason === 'length', usage: completion.usage ? { inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens } : null });
  } catch (error) { return failure(error); }
}
