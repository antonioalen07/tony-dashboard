'use client';

import { useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import styles from './KeywordChips.module.css';

type Props = {
    value: string[];
    onChange: (value: string[]) => void;
    label?: string;
};

export default function KeywordChips({ value, onChange, label = 'Palabras clave' }: Props) {
    const id = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const composing = useRef(false);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');

    function report(message: string) {
        setError(message);
        inputRef.current?.setCustomValidity(message);
    }

    function confirm(raw = draft) {
        const candidates = raw.split(/[,\r\n]+/).map((word) => word.trim()).filter(Boolean);
        if (candidates.some((word) => word.length > 100)) {
            report('Cada palabra o frase puede tener hasta 100 caracteres.');
            return;
        }
        const next = [...value];
        for (const word of candidates) {
            if (!next.some((saved) => saved.toLocaleLowerCase() === word.toLocaleLowerCase())) next.push(word);
        }
        if (next.length > 50) {
            report('Podés agregar hasta 50 palabras o frases. Quitá alguna para agregar más.');
            return;
        }
        if (next.length !== value.length) onChange(next);
        setDraft('');
        report('');
    }

    function remove(index: number) {
        onChange(value.filter((_, position) => position !== index));
        report('');
        inputRef.current?.focus();
    }

    return <div className={styles.field}>
        <label htmlFor={id} className={styles.label}>{label}</label>
        <div className={`${styles.control} ${error ? styles.invalid : ''}`}>
            {value.map((word, index) => <span className={styles.chip} key={`${index}-${word}`}>
                <span>{word}</span>
                <button type="button" className={styles.remove} aria-label={`Quitar palabra clave ${word}`} onClick={() => remove(index)}><X size={14} aria-hidden="true" /></button>
            </span>)}
            <input
                ref={inputRef}
                id={id}
                className={styles.input}
                value={draft}
                placeholder={value.length ? 'Agregá otra…' : 'Escribí una palabra y presioná Enter'}
                aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
                aria-invalid={Boolean(error)}
                autoComplete="off"
                onChange={(event) => {
                    const text = event.target.value;
                    setDraft(text);
                    report(text.trim().length > 100 && !/[,\r\n]/.test(text) ? 'Cada palabra o frase puede tener hasta 100 caracteres.' : '');
                }}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }}
                onBlur={(event) => {
                    if (event.currentTarget.parentElement?.contains(event.relatedTarget)) return;
                    if (!composing.current && draft.trim()) confirm();
                }}
                onKeyDown={(event) => {
                    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
                    if (event.key === 'Enter' || event.key === ',') {
                        event.preventDefault();
                        confirm();
                    } else if (event.key === 'Backspace' && !draft && value.length) {
                        event.preventDefault();
                        remove(value.length - 1);
                    }
                }}
                onPaste={(event) => {
                    const pasted = event.clipboardData.getData('text');
                    if (composing.current || !/[,\r\n]/.test(pasted)) return;
                    event.preventDefault();
                    const input = event.currentTarget;
                    const combined = draft.slice(0, input.selectionStart ?? draft.length) + pasted + draft.slice(input.selectionEnd ?? draft.length);
                    setDraft(combined);
                    confirm(combined);
                }}
            />
        </div>
        <p id={`${id}-hint`} className={styles.hint}>Enter o coma agrega una palabra. También podés pegar varias, separadas por coma o por línea. <span>{value.length}/50</span></p>
        {error && <p id={`${id}-error`} className={styles.error} role="alert">{error}</p>}
    </div>;
}
