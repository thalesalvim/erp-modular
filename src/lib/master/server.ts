import 'server-only';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { validateTenantMutation } from './contracts';

export function masterResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Every administrative request authenticates the caller before using elevated credentials.
export async function requirePlatformAdmin() {
  try {
    const caller = await createServerSupabaseClient();
    const { data: { user }, error } = await caller.auth.getUser();
    if (error || !user) return { response: masterResponse({ error: 'Autenticação necessária.' }, 401) };
    const admin = createSupabaseAdminClient();
    const { data, error: roleError } = await admin.from('platform_admins')
      .select('user_id').eq('user_id', user.id).eq('role', 'platform_admin').maybeSingle();
    if (roleError) return { response: masterResponse({ error: 'Validação de privilégios indisponível.' }, 503) };
    if (!data) return { response: masterResponse({ error: 'Acesso Master negado.' }, 403) };
    return { admin };
  } catch {
    return { response: masterResponse({ error: 'Serviço administrativo indisponível.' }, 503) };
  }
}

export async function readMasterMutation(request: Request, creating = false) {
  // Cookie authentication also requires a same-origin mutation. No cross-site form requests.
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new Error('Origem inválida.');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Envie JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Corpo obrigatório.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2e6) { await reader.cancel(); throw new Error('Corpo excede o limite.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return validateTenantMutation(JSON.parse(new TextDecoder().decode(bytes)), creating);
}
