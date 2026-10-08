import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseConfig } from '../supabaseConfig';

export async function updateSupabaseSession(request: NextRequest) {
  const config = getSupabaseConfig({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    appEnvironment: process.env.NEXT_PUBLIC_APP_ENV,
    deploymentEnvironment: process.env.VERCEL_ENV,
  });
  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.publicKey, {
    auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}
