'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  HardDrive, RefreshCw, Loader2, ImageOff, Check, AlertTriangle,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import type { MediaAsset } from '@/lib/studio-types';
import { MIGRATION_REQUIRED_STATUS } from '@/lib/studio-types';
import styles from './DrivePicker.module.css';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
}

type Status = 'checking' | 'disconnected' | 'connected' | 'migration';

interface DrivePickerProps {
  /** Se dispara con el asset ya importado (subido al bucket + fila en media_assets). */
  onPicked?: (asset: MediaAsset) => void;
}

export default function DrivePicker({ onPicked }: DrivePickerProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>('checking');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());

  const loadFiles = useCallback(
    async (pageToken?: string) => {
      try {
        const qs = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
        const res = await fetch(`/api/google/files${qs}`);

        if (res.status === 401) {
          setStatus('disconnected');
          return;
        }
        if (res.status === MIGRATION_REQUIRED_STATUS) {
          setStatus('migration');
          return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'No se pudieron cargar los archivos');

        setStatus('connected');
        setFiles((prev) => (pageToken ? [...prev, ...json.files] : json.files));
        setNextPageToken(json.nextPageToken);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error cargando Drive', 'error');
      } finally {
        setLoadingMore(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    // Fetch inicial al montar: setState tras await es el patrón esperado acá.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFiles();
  }, [loadFiles]);

  const loadMore = () => {
    if (!nextPageToken) return;
    setLoadingMore(true);
    void loadFiles(nextPageToken);
  };

  const connect = () => {
    window.location.href = '/api/google/auth';
  };

  const importFile = async (file: DriveFile) => {
    setImportingId(file.id);
    try {
      const res = await fetch('/api/google/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: file.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo importar');

      setPickedIds((prev) => new Set(prev).add(file.id));
      toast(`"${file.name}" importado`, 'success');
      onPicked?.(json.asset as MediaAsset);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error importando', 'error');
    } finally {
      setImportingId(null);
    }
  };

  if (status === 'checking') {
    return (
      <div className={styles.state}>
        <Loader2 className={styles.spin} size={22} />
        <span>Comprobando conexión con Drive…</span>
      </div>
    );
  }

  if (status === 'migration') {
    return (
      <div className={styles.state}>
        <AlertTriangle size={22} />
        <span>Falta correr la migración del Studio para usar Google Drive.</span>
      </div>
    );
  }

  if (status === 'disconnected') {
    return (
      <div className={styles.state}>
        <HardDrive size={26} />
        <p className={styles.stateText}>Conectá tu Google Drive para importar imágenes.</p>
        <button type="button" className={styles.connectBtn} onClick={connect}>
          <HardDrive size={16} />
          Conectar Google Drive
        </button>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          <HardDrive size={15} /> Google Drive
        </span>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => loadFiles()}
          aria-label="Recargar"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {files.length === 0 ? (
        <div className={styles.empty}>No se encontraron imágenes en tu Drive.</div>
      ) : (
        <div className={styles.grid}>
          {files.map((file) => {
            const picked = pickedIds.has(file.id);
            const busy = importingId === file.id;
            return (
              <button
                key={file.id}
                type="button"
                className={styles.tile}
                disabled={busy}
                onClick={() => importFile(file)}
                title={file.name}
              >
                <Thumb file={file} />
                <span className={styles.tileName}>{file.name}</span>
                {busy && (
                  <span className={styles.overlay}>
                    <Loader2 className={styles.spin} size={20} />
                  </span>
                )}
                {picked && !busy && (
                  <span className={`${styles.overlay} ${styles.overlayPicked}`}>
                    <Check size={20} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {nextPageToken && (
        <button
          type="button"
          className={styles.moreBtn}
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? <Loader2 className={styles.spin} size={15} /> : null}
          Cargar más
        </button>
      )}
    </div>
  );
}

/** Miniatura con fallback a icono si el thumbnailLink no carga. */
function Thumb({ file }: { file: DriveFile }) {
  const [failed, setFailed] = useState(false);
  if (!file.thumbnailLink || failed) {
    return (
      <span className={styles.thumbFallback}>
        <ImageOff size={20} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.thumb}
      src={file.thumbnailLink}
      alt={file.name}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
