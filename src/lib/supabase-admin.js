import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno.'
  );
}

/**
 * Cliente administrativo de Supabase (bypasea RLS).
 * Usar EXCLUSIVAMENTE en código de servidor (Route Handlers en src/app/api/*, Server Actions).
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
