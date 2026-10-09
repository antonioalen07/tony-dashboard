/** Pure context selection. Budgets are characters, not a claim about model tokens. */
export const CHAT_LIMITS = {
  inputChars: 60_000,
  trainingChars: 24_000,
  dossierChars: 36_000,
  historyChars: 12_000,
  messageChars: 6_000,
  historyMessages: 20,
  groups: 25,
  contrastGroups: 5,
  sourceRows: 1_000,
} as const;

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ContextReel {
  id?: string; instagram_id?: string | null; title?: string | null; published_at?: string | null;
  views?: number | null; reach?: number | null; likes?: number | null; comments?: number | null;
  saves?: number | null; shares?: number | null; engagement_rate?: number | null;
  bookings?: number | null; qualified_leads?: number | null;
  transcript?: string | null; ai_analysis?: unknown; improvement?: string | null;
  is_hidden?: boolean; is_duplicate?: boolean; transcript_suppressed?: boolean;
}
export class ChatInputError extends Error {}
export function normalizeTranscript(value: unknown): string {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}
export function isUsableReel(row: ContextReel): boolean {
  return row.is_hidden !== true && row.is_duplicate !== true && row.transcript_suppressed !== true;
}
export function parseMinViews(value: unknown): number {
  const n = value === undefined ? 800 : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 800;
}
export function validateMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || !value.length)
    throw new ChatInputError('Enviá una conversación válida.');
  const messages = value.map((raw): ChatMessage => {
    if (!raw || !['user', 'assistant'].includes(raw.role) || typeof raw.content !== 'string')
      throw new ChatInputError('Cada mensaje debe tener rol y texto válidos.');
    return { role: raw.role, content: raw.content.trim() };
  }).filter((m) => m.content);
  if (!messages.length || messages.at(-1)?.role !== 'user')
    throw new ChatInputError('La conversación debe terminar con tu pregunta.');
  if (messages.at(-1)!.content.length > CHAT_LIMITS.messageChars)
    throw new ChatInputError(`Tu pregunta puede tener hasta ${CHAT_LIMITS.messageChars} caracteres.`);
  return messages;
}
export function boundedHistory(messages: ChatMessage[], maxChars: number = CHAT_LIMITS.historyChars) {
  const selected: ChatMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0 && selected.length < CHAT_LIMITS.historyMessages; i--) {
    const message = messages[i];
    if (chars + message.content.length > maxChars) {
      if (!selected.length) throw new ChatInputError('La última pregunta supera el presupuesto del chat.');
      break;
    }
    selected.unshift(message);
    chars += message.content.length;
  }
  // Keep complete recent turns rather than a leading answer without its question.
  while (selected.length > 1 && selected[0].role === 'assistant') chars -= selected.shift()!.content.length;
  return { messages: selected, chars, omitted: messages.length - selected.length };
}
const fmt = (value: number | null | undefined) => value == null ? 's/d' : Number(value).toLocaleString('es');
const views = (row: ContextReel) => Number(row.views ?? 0) || 0;
const STOP_WORDS = new Set('que como para una uno unos unas los las del con por sobre mas este esta estos estas quiero necesito dame hace hacer tenes sabes puedes puede mis tus sus son fue ser reel reels video videos guion guiones contenido'.split(' '));
function words(value: unknown): string[] {
  return normalizeTranscript(value).normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]{3,}/gu) || [];
}
function relevance(rows: ContextReel[], tokens: Set<string>): number {
  const title = new Set(words(rows[0].title));
  const transcript = new Set(words(rows[0].transcript));
  let score = 0;
  for (const token of tokens) score += (title.has(token) ? 2 : 0) + (transcript.has(token) ? 1 : 0);
  return score;
}
function groupText(rows: ContextReel[], index: number, minViews: number): string {
  const first = rows[0];
  const title = String(first.title || 'Sin título').split('\n')[0];
  const metrics = rows.map((r) => {
    const id = r.instagram_id || r.id || 'sin ID';
    const date = r.published_at?.slice(0, 10) || 's/d';
    return `Publicación ${id} (${date}): vistas ${fmt(r.views)} · reach ${fmt(r.reach)} · likes ${fmt(r.likes)} · comentarios ${fmt(r.comments)} · guardados ${fmt(r.saves)} · compartidos ${fmt(r.shares)} · ER ${fmt(r.engagement_rate)}% · agendas ${fmt(r.bookings)} · leads calificados ${fmt(r.qualified_leads)}`;
  });
  const transcript = String(first.transcript || '').trim();
  const analysis = Array.isArray(first.ai_analysis) ? first.ai_analysis.filter((p) => typeof p === 'string').join(' | ') : '';
  return [
    `### Guion ${index}: ${title}`,
    `Grupo de ${rows.length} publicación(es)${views(first) < minViews ? `; muestra de contraste por debajo de ${minViews} vistas` : ''}. Cada publicación conserva sus métricas; no son guiones independientes.`,
    ...metrics,
    transcript ? `Transcripción completa → ${transcript}` : `Sin transcripción de audio. Caption/descripción → ${first.title || '(sin descripción)'}`,
    analysis ? `Análisis previo (puede haberse generado con instrucciones anteriores) → ${analysis}` : '',
    first.improvement ? `Mejora previa → ${first.improvement}` : '',
  ].filter(Boolean).join('\n');
}
const DOSSIER_NOTE = 'DOSSIER DE CONTENIDO. Las vistas son una señal de alcance, no una prueba de ventas o calidad. Incluye piezas de mayor alcance y una muestra de contraste; no clasifiques automáticamente las de menor alcance como fallidas. Cada transcripción aparece una sola vez y las publicaciones relacionadas mantienen sus métricas separadas. No inventes el contenido de los guiones excluidos ni métricas ausentes. El análisis previo es una referencia y las instrucciones actuales tienen prioridad.';

export function buildChatContext(reels: ContextReel[], training: string, messages: ChatMessage[] = [], minViews = 800) {
  if (training.length > CHAT_LIMITS.trainingChars)
    throw new ChatInputError('El entrenamiento es demasiado extenso para el chat. Reducí los bloques antes de preguntar.');
  const history = boundedHistory(messages);
  const usable = reels.filter(isUsableReel);
  // Preserve the legacy Apify exclusion until explicit origin metadata is available.
  const own = usable.filter((r) => String(r.instagram_id || '').length < 19);
  const ordered = [...own].sort((a, b) => views(b) - views(a) || String(a.instagram_id || a.id).localeCompare(String(b.instagram_id || b.id)));
  const byText = new Map<string, ContextReel[]>();
  for (const [index, row] of ordered.entries()) {
    const text = normalizeTranscript(row.transcript);
    const key = text ? `transcript:${text}` : `row:${row.instagram_id || row.id || index}`;
    const group = byText.get(key) || [];
    group.push(row);
    byText.set(key, group);
  }
  const groups = [...byText.values()];
  const tokens = new Set(words(messages.at(-1)?.content).filter((word) => !STOP_WORDS.has(word)));
  const relevant = groups.map((group) => ({ group, score: relevance(group, tokens) }))
    .filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map((item) => item.group);
  const higher = groups.filter((g) => views(g[0]) >= minViews);
  const lower = groups.filter((g) => views(g[0]) < minViews);
  // Reserve contrast slots before filling the remainder with higher-view groups.
  const contrast = lower.slice(0, CHAT_LIMITS.contrastGroups);
  const candidates = [...new Set([...relevant, ...contrast, ...higher])];
  const maxChars = Math.min(CHAT_LIMITS.dossierChars, CHAT_LIMITS.inputChars - training.length - history.chars);
  const chosen: ContextReel[][] = [];
  const text: string[] = [DOSSIER_NOTE];
  let chars = DOSSIER_NOTE.length;
  for (const group of candidates) {
    if (chosen.length >= CHAT_LIMITS.groups) break;
    const rendered = groupText(group, chosen.length + 1, minViews);
    if (chars + rendered.length + 2 > maxChars) continue;
    chosen.push(group);
    text.push(rendered);
    chars += rendered.length + 2;
  }
  const dossier = text.join('\n\n');
  const publicationCount = chosen.reduce((n, g) => n + g.length, 0);
  return {
    dossier, history: history.messages,
    stats: {
      availableReels: reels.length, excludedFlags: reels.length - usable.length,
      excludedLegacy: usable.length - own.length, uniqueScripts: groups.length,
      selectedScripts: chosen.length, publications: publicationCount,
      deduplicatedPublications: own.length - groups.length,
      transcribedScripts: chosen.filter((g) => normalizeTranscript(g[0].transcript)).length,
      contrastScripts: chosen.filter((g) => views(g[0]) < minViews).length,
      relevantScripts: chosen.filter((g) => relevant.includes(g)).length,
      omittedScripts: groups.length - chosen.length, minViews,
      trainingChars: training.length, dossierChars: dossier.length,
      historyChars: history.chars, historyMessages: history.messages.length,
      omittedHistoryMessages: history.omitted,
      inputChars: training.length + dossier.length + history.chars,
      inputCharLimit: CHAT_LIMITS.inputChars,
    },
  };
}
export type ChatContextStats = ReturnType<typeof buildChatContext>['stats'];
