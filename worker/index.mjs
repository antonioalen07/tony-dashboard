// index.mjs — orquestador del worker de Crevy Studio (VPS, sin puerto HTTP).
//
// - Carga variables de entorno (.env / .env.local vía dotenv).
// - Crea el cliente Supabase (URL + anon key).
// - Importa dinámicamente TODOS los worker/jobs/*.mjs que exporten
//   { name, intervalMs, run(ctx) }.
// - Programa cada job con setInterval + guard anti-solape (no re-entra si el
//   tick anterior sigue corriendo).
// - ctx = { supabase, env, log }.

import dotenv from 'dotenv';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cargamos .env.local (convención Next.js, lo que se copia del proyecto) y .env.
// El primero que define una var gana; ninguno pisa lo ya presente en process.env.
dotenv.config({ path: [join(__dirname, '.env.local'), join(__dirname, '.env')] });

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    'Faltan credenciales de Supabase. Definí NEXT_PUBLIC_SUPABASE_URL y ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY (por ej. copiando .env.local del proyecto).',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const ctx = { supabase, env: process.env, log };

/** Descubre e importa los módulos de jobs de ./jobs/*.mjs. */
export async function loadJobs() {
  const jobsDir = join(__dirname, 'jobs');
  let files = [];
  try {
    files = await readdir(jobsDir);
  } catch {
    return [];
  }
  const jobs = [];
  for (const file of files.filter((f) => f.endsWith('.mjs')).sort()) {
    const mod = await import(new URL(`./jobs/${file}`, import.meta.url).href);
    const job = mod.default && mod.default.run ? mod.default : mod;
    if (typeof job.run !== 'function') {
      log(`jobs/${file}: sin run() exportado, lo salto`);
      continue;
    }
    jobs.push({
      name: job.name || file.replace(/\.mjs$/, ''),
      intervalMs: Number(job.intervalMs) > 0 ? Number(job.intervalMs) : 20000,
      run: job.run,
    });
  }
  return jobs;
}

/** Programa un job con guard anti-solape. Devuelve el handle del intervalo. */
function scheduleJob(job) {
  let running = false;
  const tick = async () => {
    if (running) {
      log(`job ${job.name}: tick anterior sigue corriendo, salto`);
      return;
    }
    running = true;
    try {
      await job.run(ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      log(`job ${job.name}: error no capturado — ${msg}`);
    } finally {
      running = false;
    }
  };
  // Primer disparo inmediato, luego cada intervalMs.
  // (No usamos unref: el intervalo debe mantener vivo el proceso del worker.)
  tick();
  return setInterval(tick, job.intervalMs);
}

export async function main() {
  const jobs = await loadJobs();
  if (jobs.length === 0) {
    log('No se encontraron jobs en ./jobs. Nada que programar.');
    return;
  }
  log(`Worker arriba. Jobs: ${jobs.map((j) => `${j.name}@${j.intervalMs}ms`).join(', ')}`);
  const handles = jobs.map(scheduleJob);

  const shutdown = (sig) => {
    log(`Señal ${sig}, apagando worker.`);
    for (const h of handles) clearInterval(h);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Sólo arranca el loop si se ejecuta directamente (no al importarlo en tests).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Fallo fatal en el worker:', err);
    process.exit(1);
  });
}

export { supabase, ctx };
