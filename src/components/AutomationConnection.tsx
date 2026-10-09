'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import styles from './AutomationConnection.module.css';

type Health = {
    preview?: boolean;
    checkedAt: string;
    status: string;
    configuration: { verifyToken: boolean; appSecret: boolean };
    meta: { status: string; commentsSubscribed: boolean; messagesSubscribed: boolean; appSubscribed: boolean; pageSubscribed: boolean; callbackMatches: boolean };
    database: { lastCommentEventAt: string | null; lastInboundMessageAt: string | null; automations: string; inbox: string };
};
const date = (value: string | null) => value ? new Date(value).toLocaleString('es-AR') : 'Todavía no se recibió ninguno';

/** La conexión de métricas no demuestra que Meta entregue comentarios o DMs. */
export default function AutomationConnection() {
    const [health, setHealth] = useState<Health | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const active = useRef<Promise<void> | null>(null);
    const refresh = useCallback(() => {
        if (active.current) return active.current;
        const request = (async () => {
            setLoading(true);
            try {
                const response = await fetch('/api/automations/health', { cache: 'no-store' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'No se pudo revisar la conexión.');
                setHealth(result); setError('');
            } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo revisar la conexión.'); }
            finally { setLoading(false); active.current = null; }
        })();
        active.current = request;
        return request;
    }, []);
    useEffect(() => {
        const check = () => { if (document.visibilityState === 'visible') void refresh(); };
        const first = setTimeout(check, 0);
        const timer = setInterval(check, 60_000);
        window.addEventListener('focus', check);
        return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener('focus', check); };
    }, [refresh]);
    if (!health && loading) return <p className={styles.checking} role="status">Comprobando recepción de Instagram…</p>;
    const configured = health?.status === 'ready' && !error;
    return <section className={styles.connection} data-state={configured ? 'ready' : 'pending'} aria-label="Estado de recepción de Instagram">
        <div className={styles.heading}><strong><AlertCircle size={17}/>{health?.preview ? 'Vista de prueba con datos ficticios' : configured ? 'Recepción de Instagram configurada' : 'La recepción de Instagram necesita atención'}</strong><button type="button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14}/> {loading ? 'Revisando…' : 'Revisar conexión'}</button></div>
        {error && <p role="alert">{error}</p>}
        {health?.preview ? <p>Esta vista muestra ejemplos. Los comentarios y mensajes reales llegan a la versión de producción de BAKO.</p> : health && <>
            {health.meta.status === 'disconnected' && <p>Meta todavía no entrega los comentarios y mensajes a BAKO. Tener el token de Instagram conectado permite leer métricas, pero falta activar la entrega de eventos.</p>}
            {health.meta.status === 'unverified' && <p>No se pudo comprobar la suscripción en Meta. La conexión todavía no está confirmada.</p>}
            {!health.configuration.verifyToken && <p>Falta configurar la verificación del webhook en el servidor.</p>}
            {(health.database.automations !== 'available' || health.database.inbox !== 'available') && <p>No se pudo comprobar la base de automatizaciones y conversaciones.</p>}
            <div className={styles.facts}><span>Comentarios: {health.meta.commentsSubscribed ? 'suscripción registrada' : 'sin suscripción confirmada'}</span><span>Mensajes: {health.meta.messagesSubscribed ? 'suscripción registrada' : 'sin suscripción confirmada'}</span></div>
            <details><summary>Ver recepción y envíos</summary><p>Último comentario registrado en BAKO: {date(health.database.lastCommentEventAt)}</p><p>Último DM entrante de Instagram: {date(health.database.lastInboundMessageAt)}</p><p>Los envíos automáticos requieren el worker actualizado en Easypanel. Esta pantalla no comprueba que esté ejecutándose. El respaldo de comentarios consulta cada 5 minutos; la bandeja recibe los DMs por webhook.</p></details>
        </>}
    </section>;
}
