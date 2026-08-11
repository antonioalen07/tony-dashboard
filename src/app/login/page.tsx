'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Loader2 } from 'lucide-react';
import Logo from '@/components/Logo';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const from = new URLSearchParams(window.location.search).get('from') || '/';
        router.replace(from);
        router.refresh();
      } else {
        setError(data.error || 'No se pudo iniciar sesión');
        setLoading(false);
      }
    } catch {
      setError('Error de red');
      setLoading(false);
    }
  };

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.brand}>
          <Logo size={48} />
          <div className={styles.brandText}>
            <span className={styles.brandName}>Dashboard</span>
            <span className={styles.brandProduct}>Content</span>
          </div>
        </div>

        <h1 className={styles.title}>Iniciar sesión</h1>
        <p className={styles.subtitle}>Acceso privado a tu centro de mando.</p>

        <label className={styles.field}>
          <span>Usuario</span>
          <input
            type="email"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="tu@email.com"
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className={styles.field}>
          <span>Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </label>

        {error && <div className={styles.error}>{error}</div>}

        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? <Loader2 size={16} className={styles.spin} /> : <Lock size={16} />}
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
