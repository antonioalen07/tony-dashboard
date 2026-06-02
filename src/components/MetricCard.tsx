import { ReactNode } from 'react';
import styles from './MetricCard.module.css';

interface MetricCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  trend?: string;
  trendValue?: string;
}

export default function MetricCard({ title, value, icon, trend, trendValue }: MetricCardProps) {
  return (
    <div className={`glass-panel interactive ${styles.card}`}>
      <div className={styles.header}>
        <h4 className={styles.title}>{title}</h4>
        <div className={styles.iconWrapper}>{icon}</div>
      </div>
      <div className={styles.value}>{value}</div>
      {trend && (
        <div className={styles.trend}>
          <span className={trend === 'up' ? 'text-positive' : 'text-secondary'}>
            {trendValue}
          </span>
          <span className={styles.trendLabel}>vs mes pasado</span>
        </div>
      )}
    </div>
  );
}
