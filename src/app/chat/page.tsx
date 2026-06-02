'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Loader2 } from 'lucide-react';
import styles from './chat.module.css';

type Msg = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = [
  '¿Qué tipo de contenido me está funcionando mejor y por qué?',
  '¿Qué hooks generaron más guardados? Dame patrones.',
  'Proponé 5 hooks nuevos basados en lo que ya funcionó.',
  '¿Qué reels rindieron peor y qué cambiarías?',
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
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || loading) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (data.reply) setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
      else setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${data.error || 'No pude responder.'}` }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ Error de red.' }]);
    }
    setLoading(false);
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
          <p className={styles.subtitle}>Preguntale a Claude sobre tu contenido, métricas y qué te conviene hacer.</p>
        </div>
      </header>

      <div className={styles.chatPanel}>
        <div className={styles.messages} ref={scrollRef}>
          {messages.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}><Sparkles size={22} /></div>
              <h2 className={styles.emptyTitle}>Tu estratega de contenido</h2>
              <p className={styles.emptyText}>
                Analizo todas tus transcripciones, métricas y resultados para decirte qué funciona, por qué, y qué probar.
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
                  {m.role === 'assistant' ? renderContent(m.content) : m.content}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className={`${styles.msgRow} ${styles.assistantRow}`}>
              <div className={`${styles.bubble} ${styles.assistantBubble} ${styles.thinking}`}>
                <Loader2 size={15} className={styles.spin} /> Pensando…
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
  );
}
