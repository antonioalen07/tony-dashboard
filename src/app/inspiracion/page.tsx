'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Flame, Plus, X, RefreshCw, Search, Sparkles, ExternalLink,
  Bookmark, Trash2, Eye, Heart, MessageCircle, Loader2,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import AdaptPanel from '@/components/AdaptPanel';
import { loadWork, saveWork } from '@/lib/workSession';
import styles from './page.module.css';

interface Referent {
  id: string;
  username: string;
  active: boolean;
  last_scanned_at: string | null;
}

export interface BangerVideo {
  id?: string;
  instagram_id: string;
  username: string;
  caption: string;
  cover_url: string;
  post_url: string;
  posted_at: string | null;
  views: number;
  likes: number;
  comments: number;
  duration_s: number | null;
  followers: number | null;
  account_median: number;
  multiplier: number;
  score: number;
  transcript?: string | null;
  adaptation?: any;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fmt = (n: number) => {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
};

const proxied = (url: string) =>
  url ? `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=200&h=300&fit=cover` : '';

const scoreTier = (score: number) => (score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low');

/** Orquesta un scan completo: start + polling hasta done (máx ~4 min). */
async function runScan(username: string, persist: boolean): Promise<any> {
  const startRes = await fetch('/api/inspiration/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const start = await startRes.json();
  if (!startRes.ok || start.error) throw new Error(start.error || 'No se pudo iniciar el scan');

  const params = new URLSearchParams({
    username: start.username,
    postsRunId: start.postsRunId,
    postsDatasetId: start.postsDatasetId,
    detailsRunId: start.detailsRunId,
    detailsDatasetId: start.detailsDatasetId,
    persist: String(persist),
  });

  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(4000);
    const res = await fetch(`/api/inspiration/scan?${params}`);
    const json = await res.json();
    if (json.status === 'done') return json;
    if (json.status === 'failed' || json.error) throw new Error(json.error || 'El scan falló');
  }
  throw new Error('El scan tardó demasiado (timeout)');
}

export default function InspiracionPage() {
  const { toast } = useToast();

  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [referents, setReferents] = useState<Referent[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [saved, setSaved] = useState<BangerVideo[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);

  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);

  const [searchUser, setSearchUser] = useState('');
  const [searching, setSearching] = useState(false);
  const [ephemeral, setEphemeral] = useState<BangerVideo[] | null>(null);
  const [ephemeralUser, setEphemeralUser] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const [adaptTarget, setAdaptTarget] = useState<BangerVideo | null>(null);

  // Caché de sesión de trabajo: la búsqueda puntual sobrevive al cambiar de sección.
  useEffect(() => {
    const cached = loadWork<{ user: string; results: BangerVideo[] | null; input: string }>('inspiracion', {
      user: '', results: null, input: '',
    });
    if (cached.results && cached.results.length > 0) {
      setEphemeral(cached.results);
      setEphemeralUser(cached.user);
    }
    if (cached.input) setSearchUser(cached.input);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveWork('inspiracion', { user: ephemeralUser, results: ephemeral, input: searchUser });
  }, [hydrated, ephemeral, ephemeralUser, searchUser]);

  const loadReferents = useCallback(async () => {
    const res = await fetch('/api/referents');
    if (res.status === 428) { setMigrationNeeded(true); return; }
    const json = await res.json();
    if (json.data) setReferents(json.data);
  }, []);

  const loadSaved = useCallback(async () => {
    const res = await fetch('/api/inspiration');
    if (res.status === 428) { setMigrationNeeded(true); setLoadingSaved(false); return; }
    const json = await res.json();
    if (json.data) setSaved(json.data);
    setLoadingSaved(false);
  }, []);

  useEffect(() => {
    loadReferents();
    loadSaved();
  }, [loadReferents, loadSaved]);

  const addReferent = async () => {
    const username = newUsername.trim();
    if (!username) return;
    const res = await fetch('/api/referents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    if (res.status === 428) { setMigrationNeeded(true); return; }
    const json = await res.json();
    if (json.error) { toast(json.error, 'error'); return; }
    setNewUsername('');
    toast(`@${json.data.username} agregado a tus referentes`, 'success');
    loadReferents();
  };

  const removeReferent = async (r: Referent) => {
    await fetch(`/api/referents?id=${r.id}`, { method: 'DELETE' });
    setReferents((prev) => prev.filter((x) => x.id !== r.id));
    toast(`@${r.username} quitado`, 'info');
  };

  const scanReferents = async () => {
    const actives = referents.filter((r) => r.active);
    if (actives.length === 0) { toast('Agregá al menos un referente primero', 'info'); return; }
    setScanning(true);
    let totalBangers = 0;
    for (let i = 0; i < actives.length; i++) {
      const r = actives[i];
      setScanStatus(`Escaneando @${r.username}… (${i + 1}/${actives.length})`);
      try {
        const result = await runScan(r.username, true);
        totalBangers += result.savedCount || 0;
        if (result.warning === 'migration_required') setMigrationNeeded(true);
      } catch (e: any) {
        toast(`@${r.username}: ${e.message}`, 'error');
      }
    }
    setScanStatus(null);
    setScanning(false);
    await Promise.all([loadSaved(), loadReferents()]);
    toast(
      totalBangers > 0
        ? `Escaneo completo: ${totalBangers} banger${totalBangers === 1 ? '' : 's'} detectado${totalBangers === 1 ? '' : 's'} 🔥`
        : 'Escaneo completo: ningún video superó el umbral viral esta vez',
      totalBangers > 0 ? 'success' : 'info'
    );
  };

  const searchAccount = async () => {
    const username = searchUser.trim().replace(/^@/, '');
    if (!username) return;
    setSearching(true);
    setEphemeral(null);
    try {
      const result = await runScan(username, false);
      setEphemeral(result.posts || []);
      setEphemeralUser(result.username);
      if ((result.posts || []).length === 0) toast(result.error || 'No se encontraron reels', 'info');
    } catch (e: any) {
      toast(e.message, 'error');
    }
    setSearching(false);
  };

  const saveEphemeral = async (video: BangerVideo) => {
    const res = await fetch('/api/inspiration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(video),
    });
    if (res.status === 428) { setMigrationNeeded(true); return; }
    const json = await res.json();
    if (json.error) { toast(json.error, 'error'); return; }
    toast('Guardado en tu inspiración', 'success');
    loadSaved();
  };

  const deleteSaved = async (video: BangerVideo) => {
    if (!video.id) return;
    await fetch(`/api/inspiration?id=${video.id}`, { method: 'DELETE' });
    setSaved((prev) => prev.filter((x) => x.id !== video.id));
    toast('Video eliminado', 'info');
  };

  const renderCard = (video: BangerVideo, isEphemeral: boolean) => (
    <article key={video.instagram_id} className={styles.card}>
      <a href={video.post_url} target="_blank" rel="noreferrer" className={styles.coverLink}>
        {video.cover_url ? (
          <img src={proxied(video.cover_url)} alt="" className={styles.cover} referrerPolicy="no-referrer" loading="lazy" />
        ) : (
          <div className={styles.cover} aria-hidden="true" />
        )}
        <span className={`${styles.scoreBadge} ${styles[scoreTier(video.score)]}`}>{Math.round(video.score)}</span>
      </a>
      <div className={styles.cardBody}>
        <div className={styles.cardTop}>
          <span className={styles.account}>@{video.username}</span>
          {video.multiplier > 0 && (
            <span className={styles.multiplier}>{video.multiplier}x su mediana</span>
          )}
        </div>
        <p className={styles.caption}>{(video.caption || 'Sin caption').split('\n')[0]}</p>
        <div className={styles.metrics}>
          <span><Eye size={13} /> {fmt(video.views)}</span>
          <span><Heart size={13} /> {fmt(video.likes)}</span>
          <span><MessageCircle size={13} /> {fmt(video.comments)}</span>
          {video.posted_at && <span>{new Date(video.posted_at).toLocaleDateString('es')}</span>}
        </div>
        <div className={styles.cardActions}>
          <button className={styles.adaptBtn} onClick={() => setAdaptTarget(video)}>
            <Sparkles size={14} /> Adaptar a mi marca
          </button>
          {isEphemeral ? (
            <button className={styles.iconBtn} onClick={() => saveEphemeral(video)} title="Guardar en inspiración">
              <Bookmark size={15} />
            </button>
          ) : (
            <button className={styles.iconBtn} onClick={() => deleteSaved(video)} title="Eliminar">
              <Trash2 size={15} />
            </button>
          )}
          <a href={video.post_url} target="_blank" rel="noreferrer" className={styles.iconBtn} title="Ver en Instagram">
            <ExternalLink size={15} />
          </a>
        </div>
      </div>
    </article>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}><Flame size={22} className={styles.titleIcon} /> Inspiración</h1>
          <p className={styles.subtitle}>
            Banger Hunter: detectá qué está viralizando entre tus referentes y adaptalo a tu marca.
          </p>
        </div>
      </header>

      {migrationNeeded && (
        <div className={styles.migrationNotice}>
          <strong>Falta un paso:</strong> ejecutá <code>supabase_migration_inspiration.sql</code> en el
          SQL Editor de Supabase para activar referentes, bangers guardados y sesiones de chat.
          La búsqueda puntual funciona igual sin eso.
        </div>
      )}

      {/* ---- Referentes fijos ---- */}
      <section className="glass-panel">
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>Tus referentes</h2>
            <p className={styles.sectionSub}>Cuentas que escaneás seguido. Un banger = supera el umbral viral de su propia cuenta.</p>
          </div>
          <button className={styles.scanBtn} onClick={scanReferents} disabled={scanning || referents.length === 0}>
            <RefreshCw size={15} className={scanning ? styles.spin : ''} />
            {scanning ? 'Escaneando…' : 'Escanear referentes'}
          </button>
        </div>

        {scanStatus && <div className={styles.scanStatus}><Loader2 size={14} className={styles.spin} /> {scanStatus}</div>}

        <div className={styles.chips}>
          {referents.map((r) => (
            <span key={r.id} className={styles.chip} title={r.last_scanned_at ? `Último scan: ${new Date(r.last_scanned_at).toLocaleString('es')}` : 'Nunca escaneado'}>
              @{r.username}
              <button onClick={() => removeReferent(r)} aria-label={`Quitar @${r.username}`}><X size={13} /></button>
            </span>
          ))}
          <div className={styles.addChip}>
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addReferent()}
              placeholder="@cuenta"
              disabled={migrationNeeded}
            />
            <button onClick={addReferent} disabled={migrationNeeded || !newUsername.trim()} aria-label="Agregar referente">
              <Plus size={15} />
            </button>
          </div>
        </div>
      </section>

      {/* ---- Búsqueda puntual ---- */}
      <section className="glass-panel">
        <h2 className={styles.sectionTitle}>Investigar una cuenta</h2>
        <p className={styles.sectionSub}>
          Análisis puntual sin guardarla como referente. Los resultados no se almacenan, salvo los que marques con <Bookmark size={12} style={{ verticalAlign: '-2px' }} />.
        </p>
        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            value={searchUser}
            onChange={(e) => setSearchUser(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !searching && searchAccount()}
            placeholder="@cuenta a investigar"
          />
          <button className={styles.scanBtn} onClick={searchAccount} disabled={searching || !searchUser.trim()}>
            {searching ? <Loader2 size={15} className={styles.spin} /> : <Search size={15} />}
            {searching ? 'Investigando…' : 'Investigar'}
          </button>
        </div>

        {searching && (
          <div className={styles.scanStatus}>
            <Loader2 size={14} className={styles.spin} /> Trayendo los últimos reels y calculando viralidad (~1 min)…
          </div>
        )}

        {ephemeral && ephemeral.length > 0 && (
          <>
            <div className={styles.ephemeralHead}>
              Resultados de <strong>@{ephemeralUser}</strong> · ordenados por score · <em>no guardados</em>
            </div>
            <div className={styles.grid}>{ephemeral.map((v) => renderCard(v, true))}</div>
          </>
        )}
      </section>

      {/* ---- Bangers guardados ---- */}
      <section className="glass-panel">
        <h2 className={styles.sectionTitle}>Bangers detectados</h2>
        <p className={styles.sectionSub}>Videos que superaron el umbral viral (score ≥ 60) en los escaneos de tus referentes.</p>

        {loadingSaved ? (
          <div className={styles.grid}>
            {[0, 1, 2].map((i) => <div key={i} className={styles.cardSkeleton} />)}
          </div>
        ) : saved.length === 0 ? (
          <div className={styles.empty}>
            Todavía no hay bangers guardados. Agregá referentes arriba y tocá <strong>Escanear referentes</strong>: cada video que esté rompiendo su propia mediana va a aparecer acá.
          </div>
        ) : (
          <div className={styles.grid}>{saved.map((v) => renderCard(v, false))}</div>
        )}
      </section>

      {adaptTarget && (
        <AdaptPanel
          video={adaptTarget}
          onClose={() => setAdaptTarget(null)}
          onSaved={loadSaved}
        />
      )}
    </div>
  );
}
