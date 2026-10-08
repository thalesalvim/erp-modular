export const TENANT_ROLES = ['owner', 'manager', 'employee'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export interface TenantAuthSummary {
  id: string;
  slug: string;
  company_name?: string | null;
  companyName?: string | null;
  plan_name?: string | null;
  planName?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface TenantMembership {
  tenant_id: string;
  role: TenantRole;
  is_active: boolean;
  tenant: TenantAuthSummary;
}

export function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === 'string' && TENANT_ROLES.includes(value as TenantRole);
}

export function resolveMemberships(
  rows: Array<{ tenant_id: string; role: string; is_active: boolean }>,
  tenants: TenantAuthSummary[],
): TenantMembership[] {
  const tenantsById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  return rows.flatMap((row) => {
    const tenant = tenantsById.get(row.tenant_id);
    if (!row.is_active || !isTenantRole(row.role) || !tenant) return [];
    return [{ tenant_id: row.tenant_id, role: row.role, is_active: true, tenant }];
  });
}

export function selectAuthorizedMembership(
  memberships: TenantMembership[],
  requestedTenantId: string,
): TenantMembership | null {
  return memberships.find((membership) => membership.tenant_id === requestedTenantId) ?? null;
}

export function roleLabel(role: TenantRole): string {
  switch (role) {
    case 'owner': return 'Dono';
    case 'manager': return 'Gestor';
    case 'employee': return 'Colaborador';
  }
}

export function mayInviteRole(actorRole: TenantRole, requestedRole: TenantRole): boolean {
  if (actorRole === 'owner') return requestedRole === 'manager' || requestedRole === 'employee';
  return actorRole === 'manager' && requestedRole === 'employee';
}
