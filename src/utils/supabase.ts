import { createClient } from '@supabase/supabase-js';

// Fallbacks placeholder para que la creación del cliente NUNCA rompa el build
// si una env var falta al evaluar el módulo. En runtime (local/Vercel) se usan
// los valores reales; si faltaran ahí, las llamadas fallan, no el build.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
