'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Camera, MessageSquare } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import Logo from './Logo';
import styles from './Sidebar.module.css';

export default function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { label: 'Dashboard', icon: <LayoutDashboard size={18} />, href: '/' },
    { label: 'Instagram', icon: <Camera size={18} />, href: '/instagram' },
    { label: 'AI Chat', icon: <MessageSquare size={18} />, href: '/chat' },
  ];

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.logo}>
          <Logo size={36} />
          <div className={styles.logoText}>
            <span className={styles.brand}>Crevy</span>
            <span className={styles.product}>Content</span>
          </div>
        </div>
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
    </aside>
  );
}
