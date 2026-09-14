/**
 * CLI de administración de acceso — para el arranque y para emergencias.
 *
 * Habla directo con Supabase con SUPABASE_SERVICE_ROLE_KEY (de .env.local), así
 * que sirve aunque no puedas entrar a la app. El hash de la clave es el mismo
 * scrypt que usa src/lib/auth.ts.
 *
 * Uso:
 *   node scripts/auth-cli.mjs create-user <email> [--name "Nombre"] [--role admin|member] [--temp]
 *       Crea el usuario. Pide la clave (oculta). Con --temp genera una provisoria,
 *       la imprime, y el usuario tiene que cambiarla al entrar.
 *   node scripts/auth-cli.mjs set-password <email>
 *       Cambia la clave (la pide oculta) y cierra las sesiones de ese usuario.
 *   node scripts/auth-cli.mjs hash
 *       Sólo imprime el hash de una clave, para pegarlo a mano en el SQL Editor:
 *       INSERT INTO app_users (email, name, role, password_hash) VALUES ('a@b.com', 'A', 'admin', '<hash>');
 *   node scripts/auth-cli.mjs list
 *   node scripts/auth-cli.mjs revoke-all
 *       Expulsa a todos (revoca todas las sesiones).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import readline from 'node:readline';

// ── Entorno ─────────────────────────────────────────────────────────────────
const env = {};
const envPath = path.join(import.meta.dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const [cmd, ...argv] = process.argv.slice(2);
const args = { _: [] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    args[k] = v;
  } else args._.push(argv[i]);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = scryptSync(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function policyError(pw) {
  if (pw.length < 10) return 'mínimo 10 caracteres';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'tiene que combinar letras y números';
  return null;
}

/** Pregunta sin eco (la clave no queda ni en pantalla ni en el historial). */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput;
    rl.question(question, (answer) => {
      rl._writeToOutput = write;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) write.call(rl, question);
    };
  });
}

async function askPassword() {
  for (;;) {
    const a = await promptHidden('Contraseña: ');
    const err = policyError(a);
    if (err) {
      console.log(`  ✗ ${err}`);
      continue;
    }
    const b = await promptHidden('Repetir:     ');
    if (a !== b) {
      console.log('  ✗ no coinciden');
      continue;
    }
    return a;
  }
}

async function rest(method, pathAndQuery, body) {
  const res = await fetch(`${URL_}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404 || /relation .* does not exist|schema cache/i.test(text)) {
      throw new Error('La tabla app_users no existe: corré supabase_migration_auth.sql en el SQL Editor.');
    }
    throw new Error(`${method} ${pathAndQuery} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : [];
}

const needEnv = () => {
  if (!URL_ || !KEY) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local');
    process.exit(1);
  }
};

const email = () => {
  const e = String(args._[0] || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    console.error('Email inválido. Uso: node scripts/auth-cli.mjs <comando> <email> [...]');
    process.exit(1);
  }
  return e;
};

// ── Comandos ────────────────────────────────────────────────────────────────
const commands = {
  async hash() {
    const pw = await askPassword();
    console.log('\n' + hashPassword(pw));
  },

  async 'create-user'() {
    needEnv();
    const e = email();
    const role = args.role === 'admin' ? 'admin' : 'member';
    const name = typeof args.name === 'string' ? args.name : '';
    let pw;
    let mustChange = false;
    if (args.temp) {
      pw = tempPassword();
      mustChange = true;
    } else {
      pw = await askPassword();
    }
    const [user] = await rest('POST', 'app_users', {
      email: e,
      name,
      role,
      password_hash: hashPassword(pw),
      must_change_password: mustChange,
    });
    console.log(`✓ usuario creado: ${user.email} (${user.role})${name ? ` — ${name}` : ''}`);
    if (mustChange) console.log(`  clave provisoria (mostrada una sola vez): ${pw}`);
  },

  async 'set-password'() {
    needEnv();
    const e = email();
    const [user] = await rest('GET', `app_users?select=id,email&email=eq.${encodeURIComponent(e)}`);
    if (!user) throw new Error(`No existe ${e}`);
    const pw = await askPassword();
    await rest('PATCH', `app_users?id=eq.${user.id}`, { password_hash: hashPassword(pw), must_change_password: false });
    const revoked = await rest('PATCH', `app_sessions?user_id=eq.${user.id}&revoked_at=is.null`, { revoked_at: new Date().toISOString() });
    console.log(`✓ contraseña de ${e} actualizada; ${revoked.length} sesiones cerradas`);
  },

  async list() {
    needEnv();
    const users = await rest('GET', 'app_users?select=email,name,role,is_active,must_change_password,last_login_at&order=created_at');
    if (!users.length) return console.log('(sin usuarios)');
    console.table(users.map((u) => ({ email: u.email, nombre: u.name, rol: u.role, activo: u.is_active, provisoria: u.must_change_password, ultimo_login: u.last_login_at || '—' })));
  },

  async 'revoke-all'() {
    needEnv();
    const revoked = await rest('PATCH', 'app_sessions?revoked_at=is.null', { revoked_at: new Date().toISOString() });
    console.log(`✓ ${revoked.length} sesiones revocadas — todos afuera`);
  },
};

if (!cmd || !commands[cmd]) {
  console.log('Comandos: create-user <email> [--name N] [--role admin|member] [--temp] · set-password <email> · hash · list · revoke-all');
  process.exit(cmd ? 1 : 0);
}

commands[cmd]().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
