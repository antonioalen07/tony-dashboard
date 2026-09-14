import { createClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase — DOS caras según dónde corre:
 *
 * - Servidor (route handlers, proxy, server components): habla directo con
 *   Supabase usando SUPABASE_SERVICE_ROLE_KEY, que bypassa RLS y NUNCA sale
 *   del servidor.
 * - Navegador: no recibe ninguna key. Apunta a /api/db, un gateway same-origin
 *   que exige sesión válida y reenvía a Supabase con la service key. Así la
 *   base queda cerrada a la anon key (ver supabase_migration_lock_anon.sql) y
 *   expulsar a alguien de la app lo expulsa también de la base.
 *
 * Fallbacks placeholder para que la creación del cliente NUNCA rompa el build
 * si una env var falta al evaluar el módulo. En runtime, si faltan, fallan las
 * llamadas, no el build.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';

let warned = false;
function serverKey(): string {
  // Acceso vía alias a propósito: Next inlina `process.env.NEXT_PUBLIC_*` textual
  // en el bundle del navegador y no queremos que ninguna key viaje al cliente.
  const env = process.env as Record<string, string | undefined>;
  if (!env.SUPABASE_SERVICE_ROLE_KEY && !warned) {
    warned = true;
    console.warn(
      '[supabase] Falta SUPABASE_SERVICE_ROLE_KEY: el servidor usa la anon key. ' +
        'Deja de funcionar al correr supabase_migration_lock_anon.sql.',
    );
  }
  return env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';
}

const noAuth = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export const supabase =
  typeof window === 'undefined'
    ? createClient(SUPABASE_URL, serverKey(), noAuth)
    : createClient(`${window.location.origin}/api/db`, 'gateway', noAuth);
