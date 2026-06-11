'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import styles from './MetricCard.module.css';

interface MetricCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  trend?: 'up' | 'down';
  trendValue?: string;
  loading?: boolean;
}

/**
 * Count-up sutil: anima la parte numérica del valor como MEJORA progresiva.
 * El valor real nunca depende de la animación (pestañas ocultas, headless o
 * reduced-motion muestran el número final directo).
 */
function useCountUp(value: string, enabled: boolean): string {
  const [display, setDisplay] = useState(value);
  const prev = useRef<string | null>(null);

  useEffect(() => {
    const prevVal = prev.current;
    prev.current = value;

    const reduced = typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const match = value.match(/^([\d.,]+)(.*)$/);
    const target = match ? parseFloat(match[1].replace(',', '.')) : NaN;

    // Sin animación posible o sin cambio: mostrar el valor final directamente.
    if (!enabled || prevVal === value || reduced || !match || Number.isNaN(target) ||
        (typeof document !== 'undefined' && document.hidden)) {
      setDisplay(value);
      return;
    }

    const suffix = match[2];
    const decimals = (match[1].split('.')[1] || '').length;
    const t0 = performance.now();
    const dur = 600;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      setDisplay(p < 1 ? (target * eased).toFixed(decimals) + suffix : value);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Red de seguridad: pase lo que pase, el valor final queda fijado.
    const safety = setTimeout(() => setDisplay(value), dur + 150);
    return () => { cancelAnimationFrame(raf); clearTimeout(safety); };
  }, [value, enabled]);

  return display;
}

export default function MetricCard({ title, value, icon, trend, trendValue, loading }: MetricCardProps) {
  const display = useCountUp(value, !loading);

  return (
    <div className={`glass-panel interactive ${styles.card}`}>
      <div className={styles.header}>
        <h4 className={styles.title}>{title}</h4>
        <div className={styles.iconWrapper}>{icon}</div>
      </div>
      {loading ? (
        <div className={styles.valueSkeleton} aria-hidden="true" />
      ) : (
        <div className={styles.value}>{display}</div>
      )}
      {!loading && trend && trendValue && (
        <div className={styles.trend}>
          <span className={trend === 'up' ? 'text-positive' : styles.trendDown}>{trendValue}</span>
          <span className={styles.trendLabel}>vs mes pasado</span>
        </div>
      )}
    </div>
  );
}
