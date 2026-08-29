'use client';

import { useState } from 'react';
import { ExternalLink, Eye, EyeOff, Trash2 } from 'lucide-react';
import { describeLink, shortLabel } from '@/lib/videoEmbed';
import styles from './VideoRefLink.module.css';

interface VideoRefLinkProps {
  url: string;
  /** Nota escrita a mano. Si falta se muestra el dominio + path recortado. */
  label?: string;
  onRemove?: () => void;
  /** Abre el preview ya desplegado (útil en la vista de referencias). */
  defaultOpen?: boolean;
}

/**
 * Un link de referencia: se toca y abre el video en Instagram/YouTube/TikTok,
 * o se previsualiza acá mismo sin salir de la pantalla.
 *
 * El iframe se monta SOLO cuando se abre el preview: veinte referencias con
 * veinte players cargando a la vez cuelgan la pestaña.
 */
export default function VideoRefLink({ url, label, onRemove, defaultOpen = false }: VideoRefLinkProps) {
  const info = describeLink(url);
  const [open, setOpen] = useState(defaultOpen && Boolean(info.embedUrl));

  return (
    <div className={styles.wrapper}>
      <div className={styles.row}>
        <span className={styles.provider} data-provider={info.provider}>
          {info.providerLabel}
        </span>

        <a
          href={info.href}
          target="_blank"
          rel="noreferrer"
          className={styles.link}
          title={info.href}
        >
          {label?.trim() || shortLabel(url)}
        </a>

        <div className={styles.actions}>
          {info.embedUrl && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setOpen((v) => !v)}
              title={open ? 'Ocultar preview' : 'Previsualizar acá'}
              aria-expanded={open}
            >
              {open ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
          <a
            href={info.href}
            target="_blank"
            rel="noreferrer"
            className={styles.iconBtn}
            title="Abrir en una pestaña nueva"
          >
            <ExternalLink size={14} />
          </a>
          {onRemove && (
            <button type="button" className={styles.iconBtn} onClick={onRemove} title="Quitar referencia">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {open && info.embedUrl && (
        <div className={styles.embedBox} style={{ maxWidth: info.maxWidth }}>
          <div className={styles.embedFrame} style={{ aspectRatio: String(info.ratio) }}>
            <iframe
              src={info.embedUrl}
              title={label?.trim() || shortLabel(url)}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              scrolling="no"
            />
          </div>
          <p className={styles.embedNote}>
            ¿No carga? Suele ser una cuenta privada o el bloqueo de cookies del navegador:{' '}
            <a href={info.href} target="_blank" rel="noreferrer">abrilo en {info.providerLabel}</a>.
          </p>
        </div>
      )}
    </div>
  );
}
