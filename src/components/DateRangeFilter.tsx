'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarRange, X } from 'lucide-react';
import {
  RANGE_PRESETS,
  isFiltered,
  rangeLabel,
  type DateRange,
  type RangeKey,
} from '@/lib/dateRange';
import styles from './DateRangeFilter.module.css';

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Reels que sobreviven al filtro y total, para dar feedback del recorte. */
  count?: number;
  total?: number;
  /** Aclaración de qué NO depende del rango (ej. seguidores en el dashboard). */
  note?: string;
}

export default function DateRangeFilter({ value, onChange, count, total, note }: DateRangeFilterProps) {
  const [customOpen, setCustomOpen] = useState(value.key === 'custom');
  const popRef = useRef<HTMLDivElement>(null);

  // Cerrar el panel de fechas al hacer clic afuera o con Escape.
  useEffect(() => {
    if (!customOpen) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setCustomOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setCustomOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [customOpen]);

  const selectPreset = (key: RangeKey) => {
    setCustomOpen(false);
    onChange({ key, from: null, to: null });
  };

  const toggleCustom = () => {
    setCustomOpen((open) => !open);
    if (value.key !== 'custom') onChange({ ...value, key: 'custom' });
  };

  const setBound = (side: 'from' | 'to', raw: string) => {
    onChange({ ...value, key: 'custom', [side]: raw || null });
  };

  const filtered = isFiltered(value);
  const showCount = count != null && total != null;

  return (
    <div className={styles.bar}>
      <div className={styles.group} role="group" aria-label="Filtrar por fecha">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.key}
            className={`${styles.pill} ${value.key === p.key ? styles.active : ''}`}
            onClick={() => selectPreset(p.key)}
          >
            {p.label}
          </button>
        ))}

        <div className={styles.customWrap} ref={popRef}>
          <button
            className={`${styles.pill} ${value.key === 'custom' ? styles.active : ''}`}
            onClick={toggleCustom}
            aria-expanded={customOpen}
            title="Elegir un rango de fechas a medida"
          >
            <CalendarRange size={13} /> Personalizado
          </button>

          {customOpen && (
            <div className={styles.pop}>
              <label className={styles.field}>
                <span>Desde</span>
                <input
                  type="date"
                  value={value.from ?? ''}
                  max={value.to ?? undefined}
                  onChange={(e) => setBound('from', e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>Hasta</span>
                <input
                  type="date"
                  value={value.to ?? ''}
                  min={value.from ?? undefined}
                  onChange={(e) => setBound('to', e.target.value)}
                />
              </label>
              <p className={styles.popHint}>
                Podés dejar un extremo vacío: queda abierto hacia ese lado.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className={styles.meta}>
        {showCount && (
          <span className={styles.count}>
            {filtered ? (
              <>
                <strong>{count}</strong> de {total} reels · {rangeLabel(value)}
              </>
            ) : (
              <>
                <strong>{total}</strong> reels · {rangeLabel(value)}
              </>
            )}
          </span>
        )}
        {filtered && (
          <button
            className={styles.clear}
            onClick={() => selectPreset('all')}
            title="Quitar el filtro de fechas"
          >
            <X size={12} /> Limpiar
          </button>
        )}
      </div>

      {note && filtered && <p className={styles.note}>{note}</p>}
    </div>
  );
}
