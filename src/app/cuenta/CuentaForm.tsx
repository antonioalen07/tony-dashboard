'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, ShieldAlert, UserRound } from 'lucide-react';
import { useToast } from '@/components/Toast';
import styles from './page.module.css';

interface Me {
  email: string;
  name: string;
  role: 'admin' | 'member';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

/** `forced`: llegó con ?forzar=1 (el proxy lo mandó acá porque su clave es provisoria). */
export default function CuentaForm({ forced = false }: { forced?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();

  const [me, setMe] = useState<Me | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (next !== repeat) {
      setError('Las contraseñas nuevas no coinciden');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo cambiar la contraseña');
        return;
      }
      toast(
        data.otherSessionsClosed
          ? `Contraseña actualizada. Se cerraron ${data.otherSessionsClosed} sesiones en otros dispositivos.`
          : 'Contraseña actualizada',
        'success',
      );
      setCurrent('');
      setNext('');
      setRepeat('');
      if (forced || me?.mustChangePassword) {
        router.replace('/');
        router.refresh();
      } else {
        setMe((m) => (m ? { ...m, mustChangePassword: false } : m));
      }
    } catch {
      setError('Error de red');
    } finally {
      setSaving(false);
    }
  };

  const mustChange = forced || Boolean(me?.mustChangePassword);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <UserRound size={22} className={styles.titleIcon} /> Mi cuenta
        </h1>
        {me && (
          <p className={styles.subtitle}>
            {me.name ? `${me.name} · ` : ''}
            {me.email} · {me.role === 'admin' ? 'Administrador' : 'Usuario'}
          </p>
        )}
      </header>

      {mustChange && (
        <div className={`glass-panel ${styles.notice}`} role="alert">
          <ShieldAlert size={20} />
          <div>
            <strong>Tu contraseña es provisoria.</strong> Elegí una propia para seguir usando el
            dashboard: hasta que lo hagas, el resto de las secciones quedan bloqueadas.
          </div>
        </div>
      )}

      <form className={`glass-panel ${styles.card}`} onSubmit={submit}>
        <h2 className={styles.cardTitle}>
          <KeyRound size={18} /> Cambiar contraseña
        </h2>
        <p className={styles.hint}>
          Mínimo 10 caracteres, con letras y números. Al cambiarla se cierran tus sesiones en otros
          dispositivos.
        </p>

        <label className={styles.field}>
          <span>Contraseña actual</span>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label className={styles.field}>
          <span>Contraseña nueva</span>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Repetir contraseña nueva</span>
          <input
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>

        {error && <div className={styles.error}>{error}</div>}

        <button type="submit" className={styles.submit} disabled={saving}>
          {saving ? <Loader2 size={16} className={styles.spin} /> : <KeyRound size={16} />}
          {saving ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </div>
  );
}
