import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { invitationRedirect, parseInvitationInput } from '@/lib/auth/invitations';

export const dynamic = 'force-dynamic';

function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return reply({ error: 'Autenticação necessária.' }, 401);

  if (request.headers.get('origin') !== new URL(request.url).origin ||
      !request.headers.get('content-type')?.startsWith('application/json')) {
    return reply({ error: 'Origem ou formato inválido.' }, 400);
  }

  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Invitation required.');
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); throw new Error('Invitation too large.'); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return reply({ error: 'Corpo da solicitação inválido.' }, 400);
  }
  let input;
  try {
    input = parseInvitationInput(body);
  } catch {
    return reply({ error: 'Informe somente empresa, e-mail e cargo válidos.' }, 400);
  }
  const { tenantId, email, role: requestedRole } = input;

  // Set only after the actual Auth email template is configured and reviewed.
  // A default implicit invitation must not be dispatched to a code-only/SSR callback.
  if (process.env.AUTH_INVITE_TEMPLATE_MODE !== 'token_hash') {
    return reply({ error: 'Convites indisponíveis até configurar o e-mail deste ambiente.' }, 503);
  }

  let redirectTo: string;
  try {
    redirectTo = invitationRedirect(process.env.NEXT_PUBLIC_SITE_URL);
  } catch {
    return reply({ error: 'Origem de convite indisponível neste ambiente.' }, 503);
  }

  let invitationSent = false;
  try {
    // Session RPC, never a service_role association. It records the actor from
    // auth.uid() and refuses disabled tenants, runtime, identities and hierarchy.
    const { data: authorizationId, error: authorizationError } = await supabase.rpc('erp_authorize_invitation', {
      p_tenant: tenantId, p_role: requestedRole,
    });
    if (authorizationError || typeof authorizationId !== 'string') {
      return reply({ error: 'Não foi possível autorizar o convite nesta empresa.' }, authorizationError?.code === '42501' ? 403 : 503);
    }
    const admin = createSupabaseAdminClient();
    const { data: invitation, error: invitationError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (invitationError || !invitation.user) {
      // Operational diagnosis without recipient, token, credential or SDK message.
      console.error('Auth invitation dispatch failed', {
        code: invitationError ? invitationError.code ?? 'unknown_auth_error' : 'missing_user',
        status: invitationError?.status ?? null,
        name: invitationError?.name ?? null,
      });
      // Confirmed/existing accounts are not silently attached to another tenant or promoted.
      const status = invitationError?.status === 429 ? 429 : (invitationError?.status ?? 500) >= 500 ? 502 : 409;
      return reply({ error: 'Não foi possível enviar o convite. Tente novamente mais tarde ou solicite revisão administrativa.' }, status);
    }
    invitationSent = true;

    // Only this server binds the exact Auth-returned UID to the authorization.
    // Sending an email cannot be rolled back by a PostgreSQL transaction.
    const { error: bindError } = await admin.rpc('erp_bind_invited_membership', {
      p_authorization: authorizationId, p_invited_user: invitation.user.id,
    });
    if (bindError) {
      return reply({ error: 'Convite enviado, mas a associação não foi concluída; requer revisão administrativa.' }, 502);
    }
    // PostgreSQL rechecks and locks current authority through insertion/commit.
    const { data: associatedUserId, error: associationError } = await supabase.rpc('erp_create_invited_membership', {
      p_tenant: tenantId, p_invited_user: invitation.user.id, p_role: requestedRole, p_authorization: authorizationId,
    });
    if (associationError || associatedUserId !== invitation.user.id) {
      const status = associationError?.code === '42501' ? 403
        : ['23505', '40001'].includes(associationError?.code ?? '') ? 409
          : associationError?.code === '55000' ? 503 : 502;
      return reply({ error: 'Convite enviado, mas não foi possível confirmar a associação. A autorização deve ser revista; o e-mail não foi cancelado.' }, status);
    }
    return reply({ accepted: true, userId: invitation.user.id }, 201);
  } catch {
    return reply({ error: invitationSent
      ? 'Convite enviado, mas não foi possível confirmar a associação. Requer revisão administrativa; o e-mail não foi cancelado.'
      : 'Convites indisponíveis neste ambiente.' }, 503);
  }
}
