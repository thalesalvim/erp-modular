import { supabase } from './supabase';

// Buscar dados de um tenant específico no Supabase (metadados, plano, logins)
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

// Salvar TODOS os dados operacionais da empresa de uma só vez (1 única requisição)
export async function saveAllTenantDataCloud(slug: string, allData: {
  employees?: any[];
  customers?: any[];
  services?: any[];
  rolesList?: string[];
  promotions?: any[];
  products?: any[];
  stockMoves?: any[];
  sales?: any[];
  expenses?: any[];
  appointments?: any[];
  attendances?: any[];
}) {
  const { error } = await supabase
    .from('tenant_data')
    .upsert(
      { 
        tenant_slug: slug, 
        data_key: 'all_data', 
        payload: allData, 
        updated_at: new Date() 
      },
      { onConflict: 'tenant_slug,data_key' }
    );

  if (error) {
    console.error(`Erro ao salvar dados completos na nuvem:`, error);
  }
}

// Carregar TODOS os dados operacionais da nuvem de uma só vez (1 única requisição ultra-rápida)
export async function getAllTenantDataCloud(slug: string) {
  const { data, error } = await supabase
    .from('tenant_data')
    .select('payload')
    .eq('tenant_slug', slug)
    .eq('data_key', 'all_data')
    .single();

  if (error || !data) {
    return null;
  }
  return data.payload;
}