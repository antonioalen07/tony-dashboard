'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, Camera, Flame, MessageSquare, Menu, X, LogOut } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import Logo from './Logo';
import styles from './Sidebar.module.css';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

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
              <span className={styles.brand}>Crevy</span>
              <span className={styles.product}>Content</span>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>

        <nav className={styles.nav}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${pathname === item.href ? styles.active : ''}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.footer}>
          <span className={styles.footerLabel}>Tema</span>
          <ThemeToggle />
        </div>
        <button className={styles.logoutBtn} onClick={logout}>
          <LogOut size={16} /> Cerrar sesión
        </button>
      </aside>
    </>
  );
}
