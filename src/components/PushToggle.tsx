'use client';
import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import styles from './PushToggle.module.css';

type State = 'loading' | 'unsupported' | 'ios-install' | 'unconfigured' | 'denied' | 'off' | 'on';

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

async function detect(): Promise<{ state: State; key: string | null }> {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) return { state: isIos() && !isStandalone() ? 'ios-install' : 'unsupported', key: null };
    const config = await fetch('/api/push').then((r) => r.json()).catch(() => ({ configured: false }));
    if (!config.configured || !config.publicKey) return { state: 'unconfigured', key: null };
    if (Notification.permission === 'denied') return { state: 'denied', key: config.publicKey };
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    const subscription = await registration.pushManager.getSubscription();
    return { state: subscription ? 'on' : 'off', key: config.publicKey };
}

/** Avisos de DMs nuevos en este dispositivo (cada teléfono o compu se activa por separado). */
export default function PushToggle() {
    const [state, setState] = useState<State>('loading');
    const [key, setKey] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const apply = useCallback((p: Promise<{ state: State; key: string | null }>) => {
        p.then((r) => { setState(r.state); setKey(r.key); }).catch(() => setState('unsupported'));
    }, []);
    useEffect(() => { apply(detect()); }, [apply]);

    async function enable() {
        if (!key) return;
        setBusy(true); setMessage('');
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'off'); return; }
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription()
                || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
            const response = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON() }) });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) { await subscription.unsubscribe(); throw new Error(data.error || 'No se pudo activar.'); }
            setState('on'); setMessage('Listo. Vas a recibir un aviso por cada DM nuevo.');
        } catch (e) { setMessage(e instanceof Error ? e.message : 'No se pudieron activar las notificaciones.'); }
        finally { setBusy(false); }
    }
    async function disable() {
        setBusy(true); setMessage('');
        try {
            const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
            if (subscription) {
                await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
                await subscription.unsubscribe();
            }
            setState('off');
        } catch { setMessage('No se pudieron desactivar. Probá de nuevo.'); }
        finally { setBusy(false); }
    }
    async function test() {
        setBusy(true); setMessage('');
        try {
            const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
            const response = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true, endpoint: subscription?.endpoint }) });
            const data = await response.json().catch(() => ({}));
            setMessage(response.ok ? 'Prueba enviada: debería aparecer en unos segundos.' : data.error || 'No se pudo enviar la prueba.');
        } finally { setBusy(false); }
    }

    if (state === 'loading' || state === 'unsupported') return null;
    return <div className={styles.bar} data-state={state}>
        {state === 'on' ? <BellRing size={16} /> : state === 'denied' ? <BellOff size={16} /> : <Bell size={16} />}
        <div className={styles.copy}>
            {state === 'on' && <><strong>Notificaciones activas</strong><span>Te avisamos en este dispositivo cuando entra un DM.</span></>}
            {state === 'off' && <><strong>Recibí un aviso por cada DM nuevo</strong><span>Se activa por dispositivo: hacelo en el teléfono y en la compu.</span></>}
            {state === 'denied' && <><strong>Las notificaciones están bloqueadas</strong><span>Habilitalas para este sitio en la configuración del navegador y volvé a cargar.</span></>}
            {state === 'unconfigured' && <><strong>Notificaciones sin configurar</strong><span>Faltan las claves VAPID en el servidor.</span></>}
            {state === 'ios-install' && <><strong>Avisos en iPhone</strong><span>Tocá Compartir → «Agregar a inicio» y abrí BAKO desde ese ícono para poder activarlos.</span></>}
            {message && <span className={styles.message} role="status">{message}</span>}
        </div>
        <div className={styles.actions}>
            {state === 'off' && <button type="button" className={styles.primary} disabled={busy} onClick={() => void enable()}>{busy ? 'Activando…' : 'Activar'}</button>}
            {state === 'on' && <><button type="button" disabled={busy} onClick={() => void test()}>Probar</button><button type="button" disabled={busy} onClick={() => void disable()}>Desactivar</button></>}
        </div>
    </div>;
}
