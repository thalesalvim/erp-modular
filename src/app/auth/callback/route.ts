import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

function safeNextPath(value: string | null, origin: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/', requestUrl.origin));

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL('/?auth=callback-error', requestUrl.origin));

  return NextResponse.redirect(new URL(safeNextPath(requestUrl.searchParams.get('next'), requestUrl.origin), requestUrl.origin));
}
