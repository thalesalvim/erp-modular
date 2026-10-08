import type { SupabaseClient, User } from '@supabase/supabase-js';
import { resolveMemberships, type TenantAuthSummary, type TenantMembership } from './authorization';

const TENANT_AUTH_COLUMNS = [
  'id', 'slug', 'company_name', 'owner_name', 'owner_email', 'plan_name', 'monthly_fee',
  'due_day', 'status', 'allowed_modules', 'invoices', 'logo_type', 'logo_icon', 'logo_url',
  'primary_color', 'created_at',
].join(',');

export interface IdentityContext {
  user: User;
  memberships: TenantMembership[];
}

export async function loadIdentityContext(
  client: SupabaseClient,
  user: User,
): Promise<IdentityContext> {
  const { data: rows, error: membershipsError } = await client
    .from('tenant_memberships')
    .select('tenant_id, role, is_active')
    .eq('user_id', user.id)
    .eq('is_active', true);

  if (membershipsError) throw membershipsError;
  const activeRows = (rows ?? []) as Array<{ tenant_id: string; role: string; is_active: boolean }>;
  const tenantIds = [...new Set(activeRows.map((row) => row.tenant_id))];
  if (tenantIds.length === 0) return { user, memberships: [] };

  // Never select `logins`: it contains the retired legacy password hashes.
  const { data: tenants, error: tenantsError } = await client
    .from('tenants')
    .select(TENANT_AUTH_COLUMNS)
    .in('id', tenantIds);

  if (tenantsError) throw tenantsError;
  return {
    user,
    memberships: resolveMemberships(activeRows, (tenants ?? []) as unknown as TenantAuthSummary[]),
  };
}

export async function signInWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<IdentityContext> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) throw new Error('Informe e-mail e senha.');

  const { error: signInError } = await client.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });
  if (signInError) throw signInError;

  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data.user) {
    await client.auth.signOut();
    throw userError ?? new Error('A sessão Auth não contém um usuário válido.');
  }
  try {
    return await loadIdentityContext(client, data.user);
  } catch (identityError) {
    await client.auth.signOut();
    throw identityError;
  }
}

export async function sendPasswordRecovery(client: SupabaseClient, email: string, redirectTo: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Informe o e-mail da conta.');
  const { error } = await client.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
  if (error) throw error;
}

export async function updateOwnPassword(client: SupabaseClient, password: string) {
  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data.user) throw userError ?? new Error('Entre novamente para alterar a senha.');
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

export async function updateOwnEmail(client: SupabaseClient, email: string, emailRedirectTo: string) {
  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data.user) throw userError ?? new Error('Entre novamente para alterar o e-mail.');
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Informe o novo e-mail.');
  const { error } = await client.auth.updateUser({ email: normalizedEmail }, { emailRedirectTo });
  if (error) throw error;
}

export async function signOutAndClearIdentity(client: SupabaseClient) {
  const { error } = await client.auth.signOut();
  clearIdentityCaches();
  if (error) throw error;
}

export function clearIdentityCaches() {
  if (typeof window === 'undefined') return;
  const prefixes = ['saas_cache_', 'saas_active_', 'master_', 'machine_saved_'];
  const exactKeys = ['saas_tenants_db', 'machine_remember_creds'];
  for (const storage of [window.localStorage, window.sessionStorage]) {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => key !== null,
    );
    for (const key of keys) {
      if (exactKeys.includes(key) || prefixes.some((prefix) => key.startsWith(prefix))) storage.removeItem(key);
    }
  }
}
