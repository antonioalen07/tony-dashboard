'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, Loader2, Plus, Trash2, Copy, Check, MessageSquare, SlidersHorizontal } from 'lucide-react';
import { supabase } from '@/utils/supabase';
import { useToast } from '@/components/Toast';
import { loadWork, saveWork } from '@/lib/workSession';
import PromptSettingsPanel from '@/components/PromptSettingsPanel';
import { BLOCK_DEFS, type BlockId } from '@/lib/promptConfig';
import type { ChatContextStats } from '@/lib/chat-context';
import styles from './chat.module.css';

type Msg = { role: 'user' | 'assistant'; content: string; error?: boolean };
type ContextStatus = {
  database: { status: 'available'; totalReels: number; inspectedReels: number; scanLimited: boolean };
  training: { source: 'saved' | 'defaults' | 'missing_table'; updatedAt: string | null; customized: number; disabled: number; disabledBlocks: BlockId[] };
  stats: ChatContextStats;
};

interface Session {
  id: string;
  title: string;
  updated_at: string;
}

const SUGGESTIONS = [
  '¿Qué tipo de contenido me está funcionando mejor y por qué?',
  '¿Qué hooks generaron más guardados? Dame patrones.',
  'Proponé 5 hooks nuevos basados en lo que ya funcionó.',
  'Armame el guion de un reel del pilar Negocio y Ventas.',
];

/** Render ligero de markdown: **negritas**, viñetas y saltos de línea. */
function renderContent(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const bullet = /^\s*[-*•]\s+/.test(line);
    const clean = line.replace(/^\s*[-*•]\s+/, '');
    const parts = clean.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>
    );
    if (bullet) return <li key={i} className={styles.bullet}>{parts}</li>;
    if (line.trim() === '') return <div key={i} className={styles.spacer} />;
    return <p key={i} className={styles.line}>{parts}</p>;
  });
}

export default function ChatPage() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [sessionsEnabled, setSessionsEnabled] = useState(true);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionRequest = useRef(0);
  const contextRevision = useRef(0);
  const refreshContext = useCallback(async () => {
    const revision = ++contextRevision.current;
    try {
      const res = await fetch('/api/chat/context', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo comprobar la base de contenido.');
      if (revision !== contextRevision.current) return;
      setContextStatus(data);
      setContextError(null);
    } catch (error) {
      if (revision !== contextRevision.current) return;
      setContextStatus(null);
      setContextError(error instanceof Error ? error.message : 'No se pudo comprobar el contexto.');
    }
  }, []);
  useEffect(() => { queueMicrotask(() => void refreshContext()); }, [refreshContext]);

  const selectSession = useCallback(async (id: string) => {
    const sequence = ++sessionRequest.current;
    setSessionLoading(true);
    setActiveSession(id);
    const { data } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', id)
      .order('created_at', { ascending: true });
    if (sequence === sessionRequest.current) {
      setMessages((data as Msg[]) || []);
      setSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  // Cargar sesiones al entrar; retomar la última automáticamente.
  useEffect(() => {
    const initialSequence = sessionRequest.current;
    (async () => {
      const { data, error } = await supabase
        .from('chat_sessions')
        .select('id, title, updated_at')
        .order('updated_at', { ascending: false });
      if (error) {
        // Sin migración: modo temporal con caché de sesión de trabajo
        setSessionsEnabled(false);
        const cached = loadWork<Msg[]>('chat-temp', []);
        if (initialSequence === sessionRequest.current && cached.length > 0) setMessages(cached);
        return;
      }
      setSessions((previous) => [...previous, ...(data || []).filter((session) => !previous.some((current) => current.id === session.id))]);
      if (initialSequence === sessionRequest.current && data && data.length > 0) {
        selectSession(data[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // En modo temporal, los mensajes sobreviven a la navegación entre secciones.
  useEffect(() => {
    if (!sessionsEnabled) saveWork('chat-temp', messages);
  }, [sessionsEnabled, messages]);

  const newSession = () => {
    if (loading) return;
    sessionRequest.current++;
    setSessionLoading(false);
    setActiveSession(null);
    setMessages([]);
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading || sessionLoading) return;
    await supabase.from('chat_sessions').delete().eq('id', id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSession === id) newSession();
    toast('Conversación eliminada', 'info');
  };

  const persistMessage = async (sessionId: string, msg: Msg) => {
    await supabase.from('chat_messages').insert({ session_id: sessionId, role: msg.role, content: msg.content });
    await supabase.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId);
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || loading || sessionLoading) return;
    sessionRequest.current++;

    const userMsg: Msg = { role: 'user', content };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      // Crear sesión si es la primera pregunta.
      let sessionId = activeSession;
      if (sessionsEnabled && !sessionId) {
        const title = content.length > 42 ? content.slice(0, 42) + '…' : content;
        const { data } = await supabase.from('chat_sessions').insert({ title }).select('id, title, updated_at').single();
        if (data) {
          sessionId = data.id;
          setActiveSession(data.id);
          setSessions((prev) => [data, ...prev]);
        }
      }
      if (sessionsEnabled && sessionId) await persistMessage(sessionId, userMsg);

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.filter((message) => !message.error) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${data.error || 'No pude responder.'}`, error: true }]);
        void refreshContext();
        return;
      }
      contextRevision.current++;
      setContextStatus(data);
      setContextError(null);
      const reply: Msg = {
        role: 'assistant',
        content: data.reply || '⚠️ No pude responder.',
        error: !data.reply,
      };
      setMessages((m) => [...m, reply]);
      if (data.truncatedReply) toast('La respuesta llegó al límite de extensión. Podés pedir que continúe.', 'info');
      if (sessionsEnabled && sessionId && data.reply) {
        await persistMessage(sessionId, reply);
        setSessions((prev) => {
          const cur = prev.find((s) => s.id === sessionId);
          if (!cur) return prev;
          return [{ ...cur, updated_at: new Date().toISOString() }, ...prev.filter((s) => s.id !== sessionId)];
        });
      }
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ Error de red.', error: true }]);
    } finally {
      setLoading(false);
    }
  };

  const copyMessage = async (idx: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1600);
    } catch {
      toast('No se pudo copiar', 'error');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headTexts}>
          <h1 className={styles.title}>AI Chat</h1>
          <p className={styles.subtitle}>Tu estratega personal: conoce tu kit de marca, tus reels y tus números.</p>
        </div>
        <button
          className={styles.trainBtn}
          onClick={() => setSettingsOpen(true)}
          title="Editar los pilares, ángulos y reglas con los que piensa la IA"
        >
          <SlidersHorizontal size={15} /> Entrenamiento
        </button>
      </header>

      <section className={styles.sessionsNotice} aria-live="polite" aria-label="Base de conocimiento del chat">
        {contextError ? <p role="alert">{contextError} <button type="button" onClick={() => void refreshContext()}>Volver a comprobar</button></p>
          : !contextStatus ? <p>Comprobando contenido y entrenamiento…</p> : <>
            <p>Base disponible: {contextStatus.stats.selectedScripts} guiones en contexto de {contextStatus.stats.uniqueScripts} únicos, correspondientes a {contextStatus.stats.publications} publicaciones. {contextStatus.stats.transcribedScripts} con transcripción completa.</p>
            <p>{contextStatus.training.source === 'saved' ? `Entrenamiento guardado${contextStatus.training.updatedAt ? ` el ${new Date(contextStatus.training.updatedAt).toLocaleString('es-AR')}` : ''}` : contextStatus.training.source === 'missing_table' ? 'Entrenamiento por defecto: falta la tabla para guardar tus cambios.' : 'Entrenamiento por defecto: todavía no hay cambios guardados.'} · {contextStatus.training.customized} bloques personalizados · {contextStatus.training.disabled} apagados.</p>
            <details><summary>Ver cobertura</summary>
              <p>La selección se ajusta a tu pregunta y combina contenido de mayor alcance con muestras de contraste. Las publicaciones con la misma transcripción se agrupan sin repetir el guion.</p>
              <p>{contextStatus.stats.excludedFlags} publicaciones apartadas por tu selección, {contextStatus.stats.excludedLegacy} registros antiguos de importación excluidos y {contextStatus.stats.omittedScripts} guiones fuera de la muestra actual. {contextStatus.stats.contrastScripts} muestras de menor alcance.</p>
              {!!contextStatus.training.disabledBlocks.length && <p>Bloques apagados: {contextStatus.training.disabledBlocks.map((id) => BLOCK_DEFS.find((block) => block.id === id)?.label || id).join(', ')}.</p>}
              {!!contextStatus.stats.omittedHistoryMessages && <p>Se usaron los últimos {contextStatus.stats.historyMessages} mensajes; {contextStatus.stats.omittedHistoryMessages} anteriores quedaron fuera de este turno.</p>}
              {contextStatus.database.scanLimited && <p>La base supera el límite de consulta de este turno; se revisaron {contextStatus.database.inspectedReels} de {contextStatus.database.totalReels} publicaciones.</p>}
              <p>Los análisis históricos pueden haber usado instrucciones anteriores. El chat usa las instrucciones guardadas actuales.</p>
            </details>
          </>}
      </section>

      <div className={styles.layout}>
        {/* ---- Sesiones ---- */}
        <aside className={styles.sessions}>
          <button className={styles.newChatBtn} onClick={newSession} disabled={loading}>
            <Plus size={15} /> Nueva conversación
          </button>
          {!sessionsEnabled && (
            <p className={styles.sessionsNotice}>
              Corré la migración SQL para guardar conversaciones. Por ahora el chat es temporal.
            </p>
          )}
          <div className={styles.sessionList}>
            {sessions.map((s) => (
              <button
                key={s.id}
                className={`${styles.sessionItem} ${s.id === activeSession ? styles.sessionActive : ''}`}
                onClick={() => selectSession(s.id)}
                disabled={loading}
              >
                <MessageSquare size={13} className={styles.sessionIcon} />
                <span className={styles.sessionTitle}>{s.title}</span>
                <span
                  className={styles.sessionDelete}
                  onClick={(e) => deleteSession(s.id, e)}
                  role="button"
                  aria-label="Eliminar conversación"
                >
                  <Trash2 size={13} />
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* ---- Chat ---- */}
        <div className={styles.chatPanel}>
          <div className={styles.messages} ref={scrollRef}>
            {messages.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}><Sparkles size={22} /></div>
                <h2 className={styles.emptyTitle}>Tu estratega de contenido</h2>
                <p className={styles.emptyText}>
                  Uso tus instrucciones guardadas y una selección de tus guiones con sus números.
                  Preguntame qué funciona, pedime hooks o guiones listos para grabar.
                </p>
                <div className={styles.suggestions}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className={styles.suggestion} onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`${styles.msgRow} ${m.role === 'user' ? styles.userRow : styles.assistantRow}`}>
                  <div className={`${styles.bubble} ${m.role === 'user' ? styles.userBubble : styles.assistantBubble}`}>
                    {m.role === 'assistant' ? (
                      <>
                        {renderContent(m.content)}
                        <button
                          className={styles.msgCopy}
                          onClick={() => copyMessage(i, m.content)}
                          aria-label="Copiar respuesta"
                        >
                          {copiedIdx === i ? <Check size={13} /> : <Copy size={13} />}
                          {copiedIdx === i ? 'Copiado' : 'Copiar'}
                        </button>
                      </>
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className={`${styles.msgRow} ${styles.assistantRow}`}>
                <div className={`${styles.bubble} ${styles.assistantBubble} ${styles.thinking}`}>
                  <Loader2 size={15} className={styles.spin} /> Analizando tus datos…
                </div>
              </div>
            )}
          </div>

          <div className={styles.inputBar}>
            <textarea
              className={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Escribí tu pregunta…  (Enter para enviar, Shift+Enter para salto de línea)"
              rows={1}
              maxLength={6000}
            />
            <button className={styles.sendBtn} onClick={() => send(input)} disabled={loading || sessionLoading || !input.trim()} aria-label="Enviar">
              {loading ? <Loader2 size={18} className={styles.spin} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      {settingsOpen && <PromptSettingsPanel onClose={() => setSettingsOpen(false)} onSaved={() => void refreshContext()} />}
    </div>
  );
}
