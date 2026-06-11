'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, Loader2, Plus, Trash2, Copy, Check, MessageSquare } from 'lucide-react';
import { supabase } from '@/utils/supabase';
import { useToast } from '@/components/Toast';
import styles from './chat.module.css';

type Msg = { role: 'user' | 'assistant'; content: string };

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

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  // Cargar sesiones al entrar; retomar la última automáticamente.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('chat_sessions')
        .select('id, title, updated_at')
        .order('updated_at', { ascending: false });
      if (error) {
        setSessionsEnabled(false);
        return;
      }
      setSessions(data || []);
      if (data && data.length > 0) {
        selectSession(data[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectSession = useCallback(async (id: string) => {
    setActiveSession(id);
    const { data } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', id)
      .order('created_at', { ascending: true });
    setMessages((data as Msg[]) || []);
  }, []);

  const newSession = () => {
    setActiveSession(null);
    setMessages([]);
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
    if (!content || loading) return;

    const userMsg: Msg = { role: 'user', content };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);

    // Crear sesión si es la primera pregunta
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

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      const reply: Msg = {
        role: 'assistant',
        content: data.reply || `⚠️ ${data.error || 'No pude responder.'}`,
      };
      setMessages((m) => [...m, reply]);
      if (sessionsEnabled && sessionId && data.reply) {
        await persistMessage(sessionId, reply);
        setSessions((prev) => {
          const cur = prev.find((s) => s.id === sessionId);
          if (!cur) return prev;
          return [{ ...cur, updated_at: new Date().toISOString() }, ...prev.filter((s) => s.id !== sessionId)];
        });
      }
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ Error de red.' }]);
    }
    setLoading(false);
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
        <div>
          <h1 className={styles.title}>AI Chat</h1>
          <p className={styles.subtitle}>Tu estratega personal: conoce tu kit de marca, tus reels y tus números.</p>
        </div>
      </header>

      <div className={styles.layout}>
        {/* ---- Sesiones ---- */}
        <aside className={styles.sessions}>
          <button className={styles.newChatBtn} onClick={newSession}>
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
                  Conozco tu kit de marca, tu avatar, tus pilares y todos tus reels con sus números.
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
            />
            <button className={styles.sendBtn} onClick={() => send(input)} disabled={loading || !input.trim()} aria-label="Enviar">
              {loading ? <Loader2 size={18} className={styles.spin} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
