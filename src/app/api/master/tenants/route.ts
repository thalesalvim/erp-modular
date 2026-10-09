import { MASTER_TENANT_COLUMNS, type MasterTenantRow } from '@/lib/master/contracts';
import { masterResponse, readMasterMutation, requirePlatformAdmin } from '@/lib/master/server';
import { invitationRedirect } from '@/lib/auth/invitations';
import { provisionFirstOwner, ProvisioningFailure } from '@/lib/master/onboarding';

export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await requirePlatformAdmin();
  if (access.response) return access.response;
  const { data, error } = await access.admin.from('tenants').select(MASTER_TENANT_COLUMNS).order('created_at');
  if (error) return masterResponse({ error: 'Não foi possível carregar as empresas.' }, 502);
  return masterResponse({ tenants: data });
}

export async function POST(request: Request) {
  const access = await requirePlatformAdmin();
  if (access.response) return access.response;
  let input;
  try { input = await readMasterMutation(request, true); }
  catch { return masterResponse({ error: 'Cadastro ou origem inválidos.' }, 400); }
  let redirectTo: string;
  try {
    if (process.env.AUTH_INVITE_TEMPLATE_MODE !== 'token_hash') throw new Error();
    redirectTo = invitationRedirect(process.env.NEXT_PUBLIC_SITE_URL);
  } catch { return masterResponse({ error: 'Cadastro indisponível até configurar os convites deste ambiente.' }, 503); }
  const admin = access.admin;
  const result = await provisionFirstOwner({
    async createPendingTenant() {
      const { data, error } = await admin.from('tenants').insert({ ...input, status: 'Pendente' }).select(MASTER_TENANT_COLUMNS).single();
      if (error || !data) throw new ProvisioningFailure(error?.code === '23505' ? 409 : 502, 'tenant_insert');
      return data as unknown as MasterTenantRow;
    },
    async inviteOwner() {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(String(input.owner_email), {
        redirectTo, data: { display_name: String(input.owner_name) },
      });
      // display_name is presentation only. No role/tenant authorization in user_metadata.
      if (error || !data.user) throw new ProvisioningFailure(error?.status === 429 ? 429 : (error?.status ?? 500) >= 500 ? 502 : 409, 'owner_invitation');
      return data.user.id;
    },
    async createInactiveOwner(tenantId, userId) {
      const { error } = await admin.from('tenant_memberships').insert({ tenant_id: tenantId, user_id: userId, role: 'owner', is_active: false });
      if (error) throw new ProvisioningFailure(502, 'owner_membership');
    },
    async finalizeTenant(tenantId) {
      const { data, error } = await admin.from('tenants').update({ status: input.status ?? 'Ativo' }).eq('id', tenantId).select(MASTER_TENANT_COLUMNS).single();
      if (error || !data) throw new ProvisioningFailure(502, 'tenant_finalization');
      return data as unknown as MasterTenantRow;
    },
    async activateOwner(tenantId, userId) {
      const { data, error } = await admin.from('tenant_memberships').update({ is_active: true })
        .eq('tenant_id', tenantId).eq('user_id', userId).eq('role', 'owner').eq('is_active', false).select('id').single();
      if (error || !data) throw new ProvisioningFailure(502, 'owner_activation');
    },
    async removePendingTenant(tenantId) {
      const { data, error } = await admin.from('tenants').delete().eq('id', tenantId).eq('status', 'Pendente').select('id').single();
      if (error || !data) throw new Error('Cleanup failed.');
    },
    async keepTenantPending(tenantId, userId) {
      const { error: membershipError } = await admin.from('tenant_memberships').update({ is_active: false })
        .eq('tenant_id', tenantId).eq('user_id', userId).eq('role', 'owner');
      if (membershipError) throw new Error('Partial membership reconciliation failed.');
      const { data, error } = await admin.from('tenants').update({ status: 'Pendente' }).eq('id', tenantId).select('id').single();
      if (error || !data) throw new Error('Partial tenant reconciliation failed.');
    },
  });
  if (!result.ok) return masterResponse({ error: result.error, onboarding: result.onboarding }, result.status);
  return masterResponse({ tenant: result.tenant, owner: result.owner }, 201);
}
