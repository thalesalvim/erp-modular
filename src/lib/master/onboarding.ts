import type { MasterTenantRow } from './contracts';

export interface OwnerProvisioningBackend {
  createPendingTenant(): Promise<MasterTenantRow>;
  inviteOwner(): Promise<string>;
  createInactiveOwner(tenantId: string, userId: string): Promise<void>;
  finalizeTenant(tenantId: string): Promise<MasterTenantRow>;
  activateOwner(tenantId: string, userId: string): Promise<void>;
  removePendingTenant(tenantId: string): Promise<void>;
  keepTenantPending(tenantId: string, userId: string): Promise<void>;
}

export class ProvisioningFailure extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super('Provisioning step failed.'); this.status = status; this.code = code;
  }
}

// Auth email dispatch and PostgREST cannot share one transaction. Keep membership
// inactive until every other step succeeds; report retained state on any failure.
export async function provisionFirstOwner(backend: OwnerProvisioningBackend) {
  let tenant: MasterTenantRow | undefined;
  let userId: string | undefined;
  let stage = 'tenant';
  try {
    tenant = await backend.createPendingTenant();
    stage = 'invitation';
    userId = await backend.inviteOwner();
    stage = 'membership';
    await backend.createInactiveOwner(tenant.id, userId);
    stage = 'tenant-finalization';
    tenant = await backend.finalizeTenant(tenant.id);
    stage = 'membership-activation';
    await backend.activateOwner(tenant.id, userId);
    return { ok: true as const, tenant, owner: { userId, role: 'owner' as const, invitationDispatched: true } };
  } catch (error) {
    let retainedTenant = Boolean(tenant);
    let cleanupFailed = false;
    if (tenant) {
      try {
        if (userId) await backend.keepTenantPending(tenant.id, userId);
        else { await backend.removePendingTenant(tenant.id); retainedTenant = false; }
      } catch { cleanupFailed = true; }
    }
    return { ok: false as const, status: error instanceof ProvisioningFailure ? error.status : 502,
      onboarding: { stage, invitationDispatched: Boolean(userId), membershipActive: cleanupFailed ? null : false,
        retainedTenant, cleanupFailed, ...(retainedTenant ? { tenantId: tenant?.id } : {}), ...(userId ? { userId } : {}) },
      error: userId || retainedTenant
        ? 'Cadastro parcial: requer revisão administrativa. Não tente cadastrar novamente a mesma empresa. O acesso owner não foi concluído.'
        : 'Empresa não cadastrada. Não foi possível concluir o convite do primeiro owner. Verifique e-mail, slug e o envio de convites.',
    };
  }
}
