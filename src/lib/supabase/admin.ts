import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '../supabaseConfig';

export function createSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não está configurada no servidor.');
  }
  if (serviceRoleKey.startsWith('sb_publishable_') || serviceRoleKey.startsWith('NEXT_PUBLIC_')) {
    throw new Error('A chave administrativa não pode ser uma chave pública.');
  }

  const config = getSupabaseConfig({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    appEnvironment: process.env.NEXT_PUBLIC_APP_ENV,
    deploymentEnvironment: process.env.VERCEL_ENV,
  });

  return createClient(config.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
