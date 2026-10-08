import { NextResponse } from 'next/server';
import { isTenantRole, mayInviteRole } from '@/lib/auth/authorization';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo da solicitação inválido.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });

  const input = body as Record<string, unknown>;
  const tenantId = typeof input.tenantId === 'string' ? input.tenantId : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const requestedRole = input.role;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !isTenantRole(requestedRole)) {
    return NextResponse.json({ error: 'Informe empresa, e-mail e cargo válidos.' }, { status: 400 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from('tenant_memberships')
    .select('role, is_active')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (membershipError) return NextResponse.json({ error: 'Não foi possível confirmar a permissão neste tenant.' }, { status: 503 });
  if (!membership || !isTenantRole(membership.role) || !mayInviteRole(membership.role, requestedRole)) {
    return NextResponse.json({ error: 'Sem permissão para convidar este cargo nesta empresa.' }, { status: 403 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return NextResponse.json({ error: 'NEXT_PUBLIC_SITE_URL não está configurada para este ambiente.' }, { status: 503 });

  let redirectTo: string;
  try {
    const parsed = new URL(siteUrl);
    const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash ||
        (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal))) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_SITE_URL deve ser uma origem HTTPS válida.' }, { status: 503 });
    }
    redirectTo = new URL('/auth/callback?next=%2F', parsed.origin).toString();
  } catch {
    return NextResponse.json({ error: 'NEXT_PUBLIC_SITE_URL inválida.' }, { status: 503 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: invitation, error: invitationError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (invitationError || !invitation.user) {
      return NextResponse.json({ error: 'Não foi possível enviar o convite. Verifique se o e-mail já possui conta.' }, { status: 409 });
    }

    const { error: insertError } = await admin.from('tenant_memberships').insert({
      tenant_id: tenantId,
      user_id: invitation.user.id,
      role: requestedRole,
      is_active: true,
    });
    if (insertError) {
      return NextResponse.json({ error: 'Convite criado, mas a associação não foi concluída; requer revisão administrativa.' }, { status: 502 });
    }
    return NextResponse.json({ accepted: true, userId: invitation.user.id }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Convites indisponíveis até configurar a chave administrativa server-side.' }, { status: 503 });
  }
}
