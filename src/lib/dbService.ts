import { supabase } from './supabase';

const TENANT_COLUMNS = [
  'id', 'slug', 'company_name', 'owner_name', 'owner_email', 'plan_name', 'monthly_fee',
  'due_day', 'status', 'allowed_modules', 'logo_type', 'logo_icon', 'logo_url',
  'primary_color', 'created_at',
].join(',');

export async function getTenantFromCloud(tenantId: string) {
  const { data, error } = await supabase
    .from('tenants')
    .select(TENANT_COLUMNS)
    .eq('id', tenantId)
    .maybeSingle();

  if (error) {
    console.error('Erro ao buscar tenant associado:', error);
    return null;
  }
  return data;
}

export async function saveAllTenantDataCloud(tenantId: string, tenantSlug: string, allData: {
  employees?: unknown[];
  customers?: unknown[];
  services?: unknown[];
  rolesList?: string[];
  promotions?: unknown[];
  products?: unknown[];
  stockMoves?: unknown[];
  sales?: unknown[];
  expenses?: unknown[];
  appointments?: unknown[];
  attendances?: unknown[];
}) {
  if (!tenantId || !tenantSlug) throw new Error('A associação autorizada e o tenant são obrigatórios.');
  const { error } = await supabase
    .from('tenant_data')
    .upsert(
      { tenant_id: tenantId, tenant_slug: tenantSlug, data_key: 'all_data', payload: allData, updated_at: new Date() },
      { onConflict: 'tenant_id,data_key' },
    );

  if (error) throw error;
}

export async function getAllTenantDataCloud(tenantId: string) {
  if (!tenantId) throw new Error('A associação autorizada é obrigatória.');
  const { data, error } = await supabase
    .from('tenant_data')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('data_key', 'all_data')
    .maybeSingle();

  if (error || !data) return null;
  return data.payload;
}
