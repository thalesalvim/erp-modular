import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { escapeHtml, parseAuthCallback, type AuthCallback } from '@/lib/auth/callback';

export const dynamic = 'force-dynamic';

function protect(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

function failure(origin: string) {
  // No token, email, tenant or SDK error detail in the response or logs.
  return protect(NextResponse.redirect(new URL('/?auth=callback-error', origin), 303));
}

async function establishSession(callback: AuthCallback, origin: string) {
  const supabase = await createServerSupabaseClient();
  const result = callback.kind === 'pkce'
    ? await supabase.auth.exchangeCodeForSession(callback.code)
    : await supabase.auth.verifyOtp({ token_hash: callback.tokenHash, type: callback.type });
  if (result.error) return failure(origin);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return failure(origin);
  // This callback never inserts memberships or reads tenant/role from the URL.
  return protect(NextResponse.redirect(new URL(callback.destination, origin), 303));
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  try {
    const callback = parseAuthCallback(url.searchParams);
    if (callback.kind === 'pkce') return await establishSession(callback, url.origin);
    // Mail scanners may GET the link. Consume the OTP only after an explicit same-origin POST.
    const label = callback.type === 'invite' ? 'Confirmar convite' : 'Confirmar acesso';
    const form = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${label} — HandyHub</title><style>body{font:16px system-ui;background:#020617;color:#f1f5f9;display:grid;place-items:center;min-height:95vh}main{max-width:28rem;padding:2rem;border:1px solid #334155;border-radius:1rem;background:#0f172a}button{padding:1rem;border:0;border-radius:.7rem;background:#4f46e5;color:white;font-weight:700;cursor:pointer}</style><main><h1>${label}</h1><p>Continue para validar este link e entrar com a conta convidada ou confirmada.</p><form method="post" action="/auth/callback"><input type="hidden" name="token_hash" value="${escapeHtml(callback.tokenHash)}"><input type="hidden" name="type" value="${callback.type}"><input type="hidden" name="next" value="${callback.destination}"><button type="submit">${label}</button></form></main></html>`;
    const response = protect(new NextResponse(form, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    response.headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    return response;
  } catch {
    return failure(url.origin);
  }
}

export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin;
  try {
    if (request.headers.get('origin') !== origin ||
        !request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
      return failure(origin);
    }
    // Bound the streamed form before parsing; do not trust Content-Length alone.
    const reader = request.body?.getReader();
    if (!reader) return failure(origin);
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) { await reader.cancel(); return failure(origin); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const callback = parseAuthCallback(new URLSearchParams(new TextDecoder().decode(bytes)));
    if (callback.kind !== 'otp') return failure(origin);
    return await establishSession(callback, origin);
  } catch {
    return failure(origin);
  }
}
