import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseConfig } from './supabaseConfig';

// Keep direct references: Next.js inlines NEXT_PUBLIC_* values at build time.
const config = getSupabaseConfig({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  appEnvironment: process.env.NEXT_PUBLIC_APP_ENV,
});

// Tenant filters and UI roles are not authorization; real access depends on RLS/grants.
export const supabase = createBrowserClient(config.url, config.publicKey, {
  auth: {
    flowType: 'pkce',
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true,
  },
});
