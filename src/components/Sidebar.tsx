'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Camera,
  Flame,
  MessageSquare,
  ClipboardList,
  ImagePlay,
  Clapperboard,
  CalendarDays,
  Menu,
  X,
  LogOut,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import Logo from './Logo';
import styles from './Sidebar.module.css';

interface Me {
  email: string;
  name: string;
  role: 'admin' | 'member';
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  // Quién está logueado: decide si se muestra la entrada Admin.
  useEffect(() => {
    if (pathname === '/login') return;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setMe(data ? { email: data.email, name: data.name, role: data.role } : null))
      .catch(() => setMe(null));
  }, [pathname]);

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    router.replace('/login');
    router.refresh();
  };

  // Cerrar el drawer al navegar
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // En la pantalla de login no se muestra el sidebar.
  if (pathname === '/login') return null;

  const navItems = [
    { label: 'Dashboard', icon: <LayoutDashboard size={18} />, href: '/' },
    { label: 'Instagram', icon: <Camera size={18} />, href: '/instagram' },
    { label: 'Inspiración', icon: <Flame size={18} />, href: '/inspiracion' },
    { label: 'AI Chat', icon: <MessageSquare size={18} />, href: '/chat' },
    { label: 'Guiones', icon: <ClipboardList size={18} />, href: '/guiones' },
    { label: 'Historias', icon: <ImagePlay size={18} />, href: '/historias' },
    { label: 'Variantes', icon: <Clapperboard size={18} />, href: '/variantes' },
    { label: 'Calendario', icon: <CalendarDays size={18} />, href: '/calendario' },
    ...(me?.role === 'admin' ? [{ label: 'Admin', icon: <ShieldCheck size={18} />, href: '/admin' }] : []),
  ];

  return (
    <>
      <button
        className={styles.menuBtn}
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        aria-expanded={open}
      >
        <Menu size={20} />
      </button>

      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}

      <aside className={`${styles.sidebar} ${open ? styles.open : ''}`}>
        <div className={styles.header}>
          <div className={styles.logo}>
            <Logo size={36} />
            <div className={styles.logoText}>
              <span className={styles.brand}>BAKO</span>
              <span className={styles.product}>Content</span>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>

        <nav className={styles.nav}>
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${isActive ? styles.active : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.footer}>
          <span className={styles.footerLabel}>Tema</span>
          <ThemeToggle />
        </div>
        <Link
          href="/cuenta"
          className={`${styles.navItem} ${styles.accountLink} ${pathname.startsWith('/cuenta') ? styles.active : ''}`}
          title={me?.email || 'Mi cuenta'}
        >
          <UserRound size={16} />
          <span className={styles.accountText}>{me?.name || me?.email || 'Mi cuenta'}</span>
        </Link>
        <button className={styles.logoutBtn} onClick={logout}>
          <LogOut size={16} /> Cerrar sesión
        </button>
      </aside>
    </>
  );
}
