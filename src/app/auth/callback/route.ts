import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { escapeHtml, parseAuthCallback, type AuthCallback } from '@/lib/auth/callback';
import { issuePasswordContext, PASSWORD_CONTEXT_COOKIE, PASSWORD_CONTEXT_SECONDS, validatedSessionId } from '@/lib/auth/password-context';

export const dynamic = 'force-dynamic';

function protect(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Pragma', 'no-cache');
  // no-referrer makes native form POSTs send Origin:null. strict-origin
  // preserves same-origin CSRF validation while excluding token-bearing paths.
  response.headers.set('Referrer-Policy', 'strict-origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

function failure(origin: string) {
  // No token, email, tenant or SDK error detail in the response or logs.
  return protect(NextResponse.redirect(new URL('/auth/link-error', origin), 303));
}

async function establishSession(callback: AuthCallback, origin: string) {
  if (callback.kind === 'otp' && (callback.type === 'invite' || callback.type === 'recovery') &&
      !process.env.SUPABASE_SERVICE_ROLE_KEY) return failure(origin);
  const supabase = await createServerSupabaseClient();
  const result = callback.kind === 'pkce'
    ? await supabase.auth.exchangeCodeForSession(callback.code)
    : await supabase.auth.verifyOtp({ token_hash: callback.tokenHash, type: callback.type });
  if (result.error) {
    console.error('Auth callback failed', { stage: 'verify', code: result.error.code ?? null, status: result.error.status ?? null });
    return failure(origin);
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    console.error('Auth callback failed', { stage: 'user', code: error?.code ?? null, status: error?.status ?? null });
    return failure(origin);
  }
  // This callback never inserts memberships or reads tenant/role from the URL.
  const response = protect(NextResponse.redirect(new URL(callback.destination, origin), 303));
  if (callback.kind === 'otp' && (callback.type === 'invite' || callback.type === 'recovery')) {
    if (!result.data.session || !data.user.updated_at) return failure(origin);
    const sessionId = validatedSessionId(result.data.session.access_token, data.user.id);
    response.cookies.set(PASSWORD_CONTEXT_COOKIE, issuePasswordContext({ kind: callback.type,
      userId: data.user.id, sessionId, authVersion: data.user.updated_at }, process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''), {
      httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'strict', path: '/auth', maxAge: PASSWORD_CONTEXT_SECONDS,
    });
  } else {
    response.cookies.set(PASSWORD_CONTEXT_COOKIE, '', { httpOnly: true, path: '/auth', maxAge: 0 });
  }
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  try {
    const callback = parseAuthCallback(url.searchParams);
    if (callback.kind === 'pkce') return await establishSession(callback, url.origin);
    // Mail scanners may GET the link. Consume the OTP only after an explicit same-origin POST.
    const label = callback.type === 'invite' ? 'Confirmar convite' : callback.type === 'recovery' ? 'Recuperar senha' : 'Confirmar acesso';
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
      console.error('Auth callback failed', { stage: 'request', sameOrigin: request.headers.get('origin') === origin, formContentType: request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded') ?? false });
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
  } catch (error) {
    console.error('Auth callback failed', { stage: 'parse', name: error instanceof Error ? error.name : 'unknown' });
    return failure(origin);
  }
}
