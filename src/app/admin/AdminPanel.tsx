'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import styles from './admin.module.css';

// ── Tipos (espejo de las respuestas de /api/admin/*) ─────────────────────────

type Role = 'admin' | 'member';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login_at: string | null;
  active_sessions: number;
}

interface AdminSession {
  id: string;
  user_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
  user: { id: string; email: string; name: string; role: Role } | null;
}

interface AuthEvent {
  id: number;
  at: string;
  type: string;
  email: string | null;
  ip: string | null;
  user_agent: string | null;
  detail: Record<string, unknown> | null;
}

type Tab = 'users' | 'sessions' | 'events';

const EVENT_LABEL: Record<string, string> = {
  login_ok: 'Inicio de sesión',
  login_fail: 'Login fallido',
  login_locked: 'Login bloqueado (intentos)',
  logout: 'Cierre de sesión',
  session_revoked: 'Sesión cerrada por admin',
  sessions_revoked_all: 'Expulsión general',
  user_created: 'Usuario creado',
  user_updated: 'Usuario modificado',
  user_deleted: 'Usuario borrado',
  password_changed: 'Cambio de contraseña',
  password_reset: 'Contraseña reseteada por admin',
};
const EVENT_BAD = new Set(['login_fail', 'login_locked']);

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
};

/** "Chrome · Windows" a partir del user-agent, sin librerías. */
const device = (ua: string | null) => {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data as T;
}

// ── Componente ──────────────────────────────────────────────────────────────

export default function AdminPanel({ me }: { me: { id: string; email: string; sessionId: string } }) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('users');

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [sessions, setSessions] = useState<AdminSession[] | null>(null);
  const [events, setEvents] = useState<AuthEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'member' as Role, password: '' });
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(
    () =>
      Promise.all([
        api<{ users: AdminUser[] }>('/api/admin/users'),
        api<{ sessions: AdminSession[] }>('/api/admin/sessions'),
        api<{ events: AuthEvent[] }>('/api/admin/events?limit=150'),
      ])
        .then(([u, s, e]) => {
          setUsers(u.users);
          setSessions(s.sessions);
          setEvents(e.events);
          setLoadError(null);
        })
        .catch((err: Error) => setLoadError(err.message)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  // ── Usuarios ──
  const createUser = (e: React.FormEvent) => {
    e.preventDefault();
    run('create', async () => {
      const body: Record<string, unknown> = { email: form.email, name: form.name, role: form.role };
      if (form.password) body.password = form.password;
      const r = await api<{ user: AdminUser; tempPassword: string | null }>('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
      if (r.tempPassword) setReveal({ email: r.user.email, password: r.tempPassword });
      setForm({ email: '', name: '', role: 'member', password: '' });
      setShowCreate(false);
      toast(`Usuario ${r.user.email} creado`, 'success');
    });
  };

  const patchUser = (u: AdminUser, patch: Record<string, unknown>, okMsg: string) =>
    run(`user-${u.id}`, async () => {
      const r = await api<{ user: AdminUser; tempPassword: string | null; sessionsClosed: number }>(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (r.tempPassword) setReveal({ email: u.email, password: r.tempPassword });
      toast(r.sessionsClosed ? `${okMsg} · ${r.sessionsClosed} sesiones cerradas` : okMsg, 'success');
    });

  const removeUser = (u: AdminUser) => {
    if (!window.confirm(`¿Borrar definitivamente a ${u.email}? Se cierran todas sus sesiones.`)) return;
    run(`user-${u.id}`, async () => {
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      toast(`${u.email} borrado`, 'success');
    });
  };

  // ── Sesiones ──
  const revokeSession = (s: AdminSession) =>
    run(`session-${s.id}`, async () => {
      const r = await api<{ wasCurrent: boolean }>(`/api/admin/sessions/${s.id}`, { method: 'DELETE' });
      if (r.wasCurrent) {
        router.replace('/login');
        router.refresh();
        return;
      }
      toast('Sesión cerrada', 'success');
    });

  const revokeAll = (scope: 'others' | 'all') => {
    const msg =
      scope === 'all'
        ? '¿Expulsar a TODOS, incluida tu sesión actual? Vas a tener que volver a entrar.'
        : '¿Cerrar todas las sesiones salvo la tuya? Todos los demás dispositivos tendrán que volver a loguearse.';
    if (!window.confirm(msg)) return;
    run('revoke-all', async () => {
      const r = await api<{ revoked: number }>(`/api/admin/sessions?scope=${scope}`, { method: 'DELETE' });
      if (scope === 'all') {
        router.replace('/login');
        router.refresh();
        return;
      }
      toast(`${r.revoked} sesiones cerradas`, 'success');
    });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copiado', 'success');
    } catch {
      toast('No se pudo copiar', 'error');
    }
  };

  const otherSessions = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <ShieldCheck size={22} className={styles.titleIcon} /> Administración
          </h1>
          <p className={styles.subtitle}>
            Quién puede entrar, desde dónde está entrando y qué pasó. Los cambios aplican al instante:
            revocar una sesión expulsa a ese dispositivo en la próxima petición.
          </p>
        </div>
        <button type="button" className={styles.ghostBtn} onClick={load} disabled={Boolean(busy)}>
          <RefreshCw size={15} /> Actualizar
        </button>
      </header>

      <div className={styles.tabs} role="tablist">
        <button role="tab" aria-selected={tab === 'users'} className={`${styles.tab} ${tab === 'users' ? styles.tabActive : ''}`} onClick={() => setTab('users')}>
          <Users size={15} /> Usuarios {users && <span className={styles.count}>{users.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'sessions'} className={`${styles.tab} ${tab === 'sessions' ? styles.tabActive : ''}`} onClick={() => setTab('sessions')}>
          <MonitorSmartphone size={15} /> Sesiones activas {sessions && <span className={styles.count}>{sessions.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'events'} className={`${styles.tab} ${tab === 'events' ? styles.tabActive : ''}`} onClick={() => setTab('events')}>
          <Activity size={15} /> Actividad
        </button>
      </div>

      {loadError && (
        <div className={`glass-panel ${styles.errorPanel}`} role="alert">
          <strong>No se pudo cargar el panel.</strong> {loadError}
        </div>
      )}

      {reveal && (
        <div className={`glass-panel ${styles.reveal}`} role="alert">
          <div className={styles.revealHead}>
            <KeyRound size={18} />
            <div>
              <strong>Contraseña provisoria para {reveal.email}</strong>
              <p>Se muestra una sola vez. Pasásela por un canal seguro: al entrar va a tener que elegir la suya.</p>
            </div>
            <button type="button" className={styles.iconBtn} onClick={() => setReveal(null)} aria-label="Cerrar">
              <X size={16} />
            </button>
          </div>
          <div className={styles.secret}>
            <code>{reveal.password}</code>
            <button type="button" className={styles.ghostBtn} onClick={() => copy(reveal.password)}>
              <Copy size={14} /> Copiar
            </button>
          </div>
        </div>
      )}

      {/* ── Usuarios ── */}
      {tab === 'users' && (
        <section className={`glass-panel ${styles.panel}`}>
          <div className={styles.panelHead}>
            <h2>Usuarios</h2>
            <button type="button" className={styles.primaryBtn} onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? <X size={15} /> : <UserPlus size={15} />} {showCreate ? 'Cancelar' : 'Nuevo usuario'}
            </button>
          </div>

          {showCreate && (
            <form className={styles.createForm} onSubmit={createUser}>
              <label className={styles.field}>
                <span>Email</span>
                <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="persona@email.com" autoComplete="off" />
              </label>
              <label className={styles.field}>
                <span>Nombre</span>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre" autoComplete="off" />
              </label>
              <label className={styles.field}>
                <span>Rol</span>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  <option value="member">Usuario</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Contraseña (opcional)</span>
                <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Vacío = se genera una provisoria" autoComplete="off" />
              </label>
              <button type="submit" className={styles.primaryBtn} disabled={busy === 'create'}>
                {busy === 'create' ? <Loader2 size={15} className={styles.spin} /> : <Plus size={15} />} Crear
              </button>
            </form>
          )}

          {!users ? (
            <p className={styles.muted}>Cargando…</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Último acceso</th>
                    <th>Sesiones</th>
                    <th className={styles.actionsCol}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const self = u.id === me.id;
                    const rowBusy = busy === `user-${u.id}`;
                    return (
                      <tr key={u.id} className={!u.is_active ? styles.rowInactive : ''}>
                        <td>
                          <div className={styles.userCell}>
                            <strong>{u.name || '—'}</strong>
                            <span>{u.email}{self && <em> · vos</em>}</span>
                          </div>
                        </td>
                        <td>
                          <select
                            className={styles.inlineSelect}
                            value={u.role}
                            disabled={self || rowBusy}
                            onChange={(e) => patchUser(u, { role: e.target.value }, 'Rol actualizado')}
                            title={self ? 'No podés cambiar tu propio rol' : ''}
                          >
                            <option value="member">Usuario</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td>
                          <span className={`${styles.badge} ${u.is_active ? styles.badgeOk : styles.badgeOff}`}>
                            {u.is_active ? 'Activo' : 'Desactivado'}
                          </span>
                          {u.must_change_password && <span className={`${styles.badge} ${styles.badgeWarn}`}>Clave provisoria</span>}
                        </td>
                        <td className={styles.nowrap}>{fmt(u.last_login_at)}</td>
                        <td>{u.active_sessions}</td>
                        <td>
                          <div className={styles.actions}>
                            <button type="button" className={styles.ghostBtn} disabled={rowBusy} onClick={() => {
                              if (window.confirm(`¿Resetear la contraseña de ${u.email}? Se genera una provisoria y se cierran sus sesiones.`)) {
                                patchUser(u, { resetPassword: true }, 'Contraseña reseteada');
                              }
                            }}>
                              <KeyRound size={14} /> Resetear clave
                            </button>
                            <button type="button" className={styles.ghostBtn} disabled={self || rowBusy} onClick={() => patchUser(u, { is_active: !u.is_active }, u.is_active ? 'Usuario desactivado' : 'Usuario reactivado')}>
                              <UserMinus size={14} /> {u.is_active ? 'Desactivar' : 'Reactivar'}
                            </button>
                            <button type="button" className={`${styles.ghostBtn} ${styles.danger}`} disabled={self || rowBusy} onClick={() => removeUser(u)}>
                              <Trash2 size={14} /> Borrar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Sesiones ── */}
      {tab === 'sessions' && (
        <section className={`glass-panel ${styles.panel}`}>
          <div className={styles.panelHead}>
            <h2>Sesiones activas</h2>
            <div className={styles.actions}>
              <button type="button" className={styles.primaryBtn} disabled={Boolean(busy) || otherSessions === 0} onClick={() => revokeAll('others')}>
                <LogOut size={15} /> Expulsar a todos los demás{otherSessions ? ` (${otherSessions})` : ''}
              </button>
              <button type="button" className={`${styles.ghostBtn} ${styles.danger}`} disabled={Boolean(busy)} onClick={() => revokeAll('all')}>
                <LogOut size={15} /> Incluida la mía
              </button>
            </div>
          </div>
          <p className={styles.muted}>
            Cada fila es un dispositivo logueado. Las sesiones vencen a los 30 días o tras 7 días sin actividad.
          </p>

          {!sessions ? (
            <p className={styles.muted}>Cargando…</p>
          ) : sessions.length === 0 ? (
            <p className={styles.muted}>No hay sesiones activas.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Dispositivo</th>
                    <th>IP</th>
                    <th>Inició</th>
                    <th>Última actividad</th>
                    <th className={styles.actionsCol}></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className={s.current ? styles.rowCurrent : ''}>
                      <td>
                        <div className={styles.userCell}>
                          <strong>{s.user?.name || s.user?.email || '—'}</strong>
                          <span>{s.user?.email}{s.current && <em> · esta sesión</em>}</span>
                        </div>
                      </td>
                      <td title={s.user_agent || ''}>{device(s.user_agent)}</td>
                      <td className={styles.mono}>{s.ip || '—'}</td>
                      <td className={styles.nowrap}>{fmt(s.created_at)}</td>
                      <td className={styles.nowrap} title={fmt(s.last_seen_at)}>{ago(s.last_seen_at)}</td>
                      <td>
                        <button type="button" className={`${styles.ghostBtn} ${s.current ? '' : styles.danger}`} disabled={busy === `session-${s.id}`} onClick={() => revokeSession(s)}>
                          <LogOut size={14} /> {s.current ? 'Salir' : 'Cerrar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Actividad ── */}
      {tab === 'events' && (
        <section className={`glass-panel ${styles.panel}`}>
          <div className={styles.panelHead}>
            <h2>Actividad de acceso</h2>
          </div>
          <p className={styles.muted}>
            Últimos 150 eventos. Tras 5 logins fallidos en 15 minutos el email queda bloqueado por ese lapso.
          </p>
          {!events ? (
            <p className={styles.muted}>Cargando…</p>
          ) : events.length === 0 ? (
            <p className={styles.muted}>Sin eventos todavía.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Cuándo</th>
                    <th>Evento</th>
                    <th>Email</th>
                    <th>IP</th>
                    <th>Dispositivo</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td className={styles.nowrap}>{fmt(ev.at)}</td>
                      <td>
                        <span className={`${styles.badge} ${EVENT_BAD.has(ev.type) ? styles.badgeOff : styles.badgeNeutral}`}>
                          {EVENT_LABEL[ev.type] || ev.type}
                        </span>
                      </td>
                      <td>{ev.email || '—'}</td>
                      <td className={styles.mono}>{ev.ip || '—'}</td>
                      <td title={ev.user_agent || ''}>{device(ev.user_agent)}</td>
                      <td className={styles.detail}>{ev.detail ? JSON.stringify(ev.detail) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
