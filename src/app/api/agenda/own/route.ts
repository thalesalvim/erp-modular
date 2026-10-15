import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isAgendaUuid, parseOwnAppointments } from '@/lib/agenda/own-contract';

export const dynamic = 'force-dynamic';

function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff',
  } });
}

/** Only own-scoped reading. The selected tenant is a hint, never authority. */
export async function GET(request: Request) {
  if (process.env.HANDYHUB_OWN_AGENDA_ENABLED !== 'true') {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }
  try {
    const params = new URL(request.url).searchParams;
    const requestedTenantId = params.get('tenantId');
    if (!isAgendaUuid(requestedTenantId) || params.getAll('tenantId').length !== 1 ||
        [...params.keys()].some(key => key !== 'tenantId')) {
      return reply({ code: 'INVALID_REQUEST' }, 400);
    }
    const tenantId = requestedTenantId.toLowerCase();

    const client = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) {
      return authError && (authError.status ?? 0) >= 500
        ? reply({ code: 'AGENDA_UNAVAILABLE' }, 503)
        : reply({ code: 'AUTH_REQUIRED' }, 401);
    }

    // Fresh session-bound membership check; no browser claims, role names or admin client.
    const { data: membership, error: membershipError } = await client
      .from('tenant_memberships').select('tenant_id')
      .eq('tenant_id', tenantId).eq('user_id', user.id).eq('is_active', true).maybeSingle();
    if (membershipError) return reply({ code: membershipError.code === '42501' ? 'ACCESS_DENIED' : 'AGENDA_UNAVAILABLE' }, membershipError.code === '42501' ? 403 : 503);
    if (!membership || membership.tenant_id !== tenantId) return reply({ code: 'ACCESS_DENIED' }, 403);

    // SQL rechecks permission, tenant status and the actual Auth/employee link.
    const { data, error } = await client.rpc('erp_read_own_appointments', { p_tenant: tenantId }, { get: true });
    if (error) {
      if (error.code === '42501') return reply({ code: 'ACCESS_DENIED' }, 403);
      if (['PGRST301', 'PGRST302', '28000', '28P01'].includes(error.code ?? '')) return reply({ code: 'AUTH_REQUIRED' }, 401);
      return reply({ code: 'AGENDA_UNAVAILABLE' }, 503);
    }
    return reply({ status: 'ready', items: parseOwnAppointments(data) }, 200);
  } catch {
    // No raw provider/SQL messages, identity, tokens or legacy fallback in errors/logs.
    return reply({ code: 'AGENDA_UNAVAILABLE' }, 503);
  }
}
