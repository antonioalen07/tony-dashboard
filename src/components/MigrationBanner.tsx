'use client';

import { AlertTriangle } from 'lucide-react';

/**
 * Aviso reutilizable de Crevy Studio: se muestra cuando faltan las tablas
 * (respuesta 428 de los APIs, o error "relation does not exist" al consultar
 * Supabase directo). Mismo espíritu que el aviso inline de Inspiración.
 */
export default function MigrationBanner({
  sql = 'supabase_migration_studio.sql',
}: {
  sql?: string;
}) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'flex-start',
        padding: '1rem 1.25rem',
        borderRadius: 'var(--radius-md)',
        background: 'var(--accent-soft)',
        border: '1px solid color-mix(in srgb, var(--accent-primary) 35%, transparent)',
        color: 'var(--text-primary)',
        lineHeight: 1.5,
      }}
    >
      <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent-primary)' }} />
      <div>
        <strong>Falta un paso:</strong> ejecutá{' '}
        <code
          style={{
            background: 'var(--surface-2)',
            padding: '0.1rem 0.4rem',
            borderRadius: 6,
            fontSize: '0.9em',
          }}
        >
          {sql}
        </code>{' '}
        en el SQL Editor de Supabase para activar Crevy Studio (Historias, Variantes y Calendario).
      </div>
    </div>
  );
}
