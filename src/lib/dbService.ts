import { supabase } from './supabase';

// Buscar dados de um tenant específico no Supabase
export async function getTenantFromCloud(slug: string) {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error) {
    console.error('Erro ao buscar tenant:', error);
    return null;
  }
  return data;
}

// Salvar/Atualizar dados operacionais (clientes, agendamentos, etc.) na nuvem
export async function saveTenantDataCloud(slug: string, dataKey: string, payload: any) {
  const { error } = await supabase
    .from('tenant_data')
    .upsert(
      { tenant_slug: slug, data_key: dataKey, payload, updated_at: new Date() },
      { onConflict: 'tenant_slug,data_key' }
    );

  if (error) {
    console.error(`Erro ao salvar ${dataKey} na nuvem:`, error);
  }
}

// Carregar dados operacionais da nuvem
export async function getTenantDataCloud(slug: string, dataKey: string) {
  const { data, error } = await supabase
    .from('tenant_data')
    .select('payload')
    .eq('tenant_slug', slug)
    .eq('data_key', dataKey)
    .single();

  if (error || !data) {
    return null;
  }
  return data.payload;
}