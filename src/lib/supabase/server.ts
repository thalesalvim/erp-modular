import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseConfig } from '../supabaseConfig';

export async function createServerSupabaseClient() {
  const config = getSupabaseConfig({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    appEnvironment: process.env.NEXT_PUBLIC_APP_ENV,
    deploymentEnvironment: process.env.VERCEL_ENV,
  });
  const cookieStore = await cookies();

  return createServerClient(config.url, config.publicKey, {
    auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies; src/proxy.ts refreshes them.
        }
      },
    },
  });
}
