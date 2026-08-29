'use client';

import { Database, RefreshCw } from 'lucide-react';
import styles from './MigrationBanner.module.css';

type MigrationBannerProps = {
  onRetry?: () => void;
  /** Archivo .sql que hay que pegar en el SQL Editor. Cada sección tiene el suyo. */
  file?: string;
};

export default function MigrationBanner({
  onRetry,
  file = 'supabase_migration_studio.sql',
}: MigrationBannerProps) {
  return (
    <div className={`glass-panel ${styles.banner}`} role="status">
      <div className={styles.icon}>
        <Database size={22} />
      </div>

      <div className={styles.content}>
        <h3 className={styles.title}>Falta correr la migración</h3>
        <p className={styles.text}>
          Para usar esta sección necesitás ejecutar la migración{' '}
          <code className={styles.code}>{file}</code> en el{' '}
          <strong>SQL Editor</strong> de Supabase. Una vez creadas las tablas,
          volvé a esta pantalla.
        </p>

        {onRetry && (
          <button type="button" className={styles.retry} onClick={onRetry}>
            <RefreshCw size={16} />
            <span>Reintentar</span>
          </button>
        )}
      </div>
    </div>
  );
}
