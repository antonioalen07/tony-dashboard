'use client';

import { useCallback, useEffect, useState } from 'react';
import { HardDrive, ChevronDown, RefreshCw } from 'lucide-react';
import styles from './StorageMeter.module.css';

interface Usage {
  usedBytes: number;
  limitBytes: number;
  breakdown: { key: string; label: string; bytes: number }[];
}

export const fmtBytes = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB`
  : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(0)} MB`
  : `${Math.max(0, Math.round(b / 1024))} KB`;

async function fetchUsage(fresh: boolean): Promise<Usage> {
  const res = await fetch(`/api/storage/usage${fresh ? '?fresh=1' : ''}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'No se pudo medir');
  return json as Usage;
}

/**
 * Cuánto Storage de Supabase se está usando contra el límite del plan. Cuando
 * se llena, fallan en silencio las subidas y las variantes nuevas — ya pasó dos
 * veces — así que conviene verlo justo donde se genera lo que más ocupa.
 *
 * `refreshKey`: cambialo para volver a medir (después de borrar o generar).
 */
export default function StorageMeter({ refreshKey = 0 }: { refreshKey?: number }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  /** Vuelca una medición (o su error) al estado. */
  const apply = useCallback((p: Promise<Usage>) => {
    p.then((u) => { setUsage(u); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo medir'))
      .finally(() => setLoading(false));
  }, []);

  /** Botón de re-medir: muestra el spinner mientras tanto. */
  const load = (fresh: boolean) => {
    setLoading(true);
    apply(fetchUsage(fresh));
  };

  useEffect(() => { apply(fetchUsage(refreshKey > 0)); }, [apply, refreshKey]);

  if (error && !usage) {
    return <div className={styles.meter}><HardDrive size={14} /> <span className={styles.muted}>Storage: {error}</span></div>;
  }
  if (!usage) {
    return <div className={styles.meter}><HardDrive size={14} /> <span className={styles.muted}>Midiendo el Storage…</span></div>;
  }

  const pct = Math.min(100, (usage.usedBytes / usage.limitBytes) * 100);
  const level = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';

  return (
    <div className={styles.meter} data-level={level}>
      <button className={styles.head} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <HardDrive size={14} />
        <span className={styles.title}>Storage</span>
        <span className={styles.bar} aria-hidden>
          <span className={styles.fill} style={{ width: `${pct}%` }} />
        </span>
        <span className={styles.nums}>
          {fmtBytes(usage.usedBytes)} de {fmtBytes(usage.limitBytes)} · {pct.toFixed(0)}%
        </span>
        <ChevronDown size={14} className={open ? styles.chevOpen : ''} />
      </button>
      <button
        className={styles.refresh}
        onClick={() => load(true)}
        disabled={loading}
        title="Volver a medir"
        aria-label="Volver a medir el Storage"
      >
        <RefreshCw size={13} className={loading ? styles.spin : ''} />
      </button>

      {open && (
        <div className={styles.breakdown}>
          {usage.breakdown.map((g) => (
            <div key={g.key} className={styles.row}>
              <span>{g.label}</span>
              <span className={styles.rowBar} aria-hidden>
                <span style={{ width: `${usage.usedBytes ? (g.bytes / usage.usedBytes) * 100 : 0}%` }} />
              </span>
              <span className={styles.rowNum}>{fmtBytes(g.bytes)}</span>
            </div>
          ))}
          {level !== 'ok' && (
            <p className={styles.tip}>
              Lo que más crece son las variantes: borrá las que ya probaste o publicaste. Si se llena,
              las subidas y las variantes nuevas dejan de guardarse.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
