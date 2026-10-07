'use client';

import { useId } from 'react';
import { Plus, X } from 'lucide-react';
import styles from './ReplyPhrases.module.css';

type Props = {
    value: string[];
    onChange: (value: string[]) => void;
};

export default function ReplyPhrases({ value, onChange }: Props) {
    const id = useId();
    return <div className={styles.field}>
        <div className={styles.heading}><span id={`${id}-label`}>Frases de respuesta pública</span><span className={styles.count}>{value.length}/50</span></div>
        <p id={`${id}-hint`} className={styles.hint}>En cada comentario se elige una de estas frases al azar.</p>
        <div className={styles.list} aria-labelledby={`${id}-label`}>
            {value.map((phrase, index) => <div className={styles.row} key={index}>
                <div className={styles.inputWrap}>
                    <label htmlFor={`${id}-${index}`} className={styles.srOnly}>Frase {index + 1}</label>
                    <input
                        id={`${id}-${index}`}
                        className={styles.input}
                        value={phrase}
                        placeholder="¡Listo! Revisá tus mensajes 📩"
                        maxLength={100}
                        required
                        aria-describedby={`${id}-hint`}
                        onChange={(event) => onChange(value.map((saved, position) => position === index ? event.target.value : saved))}
                    />
                    <span className={styles.characters}>{phrase.length}/100</span>
                </div>
                <button type="button" className={styles.remove} aria-label={`Quitar frase ${index + 1}`} onClick={() => onChange(value.filter((_, position) => position !== index))}><X size={17} aria-hidden="true" /></button>
            </div>)}
        </div>
        <button type="button" className={styles.add} disabled={value.length >= 50} onClick={() => onChange([...value, ''])}><Plus size={16} aria-hidden="true" /> Agregar frase</button>
        {!value.length && <p className={styles.hint}>Agregá una frase para responder al comentario públicamente.</p>}
        {value.length >= 50 && <p className={styles.hint}>Llegaste al límite de 50 frases.</p>}
    </div>;
}
