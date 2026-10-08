import { MASTER_TENANT_COLUMNS } from '@/lib/master/contracts';
import { masterResponse, readMasterMutation, requirePlatformAdmin } from '@/lib/master/server';

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
  const { data, error } = await access.admin.from('tenants').insert(input).select(MASTER_TENANT_COLUMNS).single();
  if (error) return masterResponse({ error: 'Cadastro recusado. Verifique slug e campos.' }, error.code === '23505' ? 409 : 502);
  return masterResponse({ tenant: data }, 201);
}
