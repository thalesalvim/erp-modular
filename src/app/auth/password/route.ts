import { NextResponse } from 'next/server';
import { requirePasswordFlow } from '@/lib/auth/password-flow-server';
import { PASSWORD_CONTEXT_COOKIE, validatePasswordInput } from '@/lib/auth/password-context';
export const dynamic = 'force-dynamic';
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin ||
      !request.headers.get('content-type')?.startsWith('application/json')) return reply('Origem ou formato inválido.', 400);
  let input;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); throw new Error(); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    input = validatePasswordInput(JSON.parse(new TextDecoder().decode(body)));
  } catch { return reply('Use senhas iguais, entre 8 e 128 caracteres.', 400); }
  const access = await requirePasswordFlow(input.kind);
  if (!access) return reply('Link inválido, expirado ou já utilizado. Solicite outro link.', 401);
  // Ordinary authenticated updateUser: never an admin password override.
  const { error } = await access.supabase.auth.updateUser({ password: input.password });
  if (error) return reply('Não foi possível salvar a senha. Verifique os requisitos ou solicite outro link.', 422);
  const response = NextResponse.json({ saved: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  response.cookies.set(PASSWORD_CONTEXT_COOKIE, '', { httpOnly: true, path: '/auth', maxAge: 0 });
  return response;
}
