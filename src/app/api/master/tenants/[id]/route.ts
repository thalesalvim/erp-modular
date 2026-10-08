import { isUuid, MASTER_TENANT_COLUMNS } from '@/lib/master/contracts';
import { masterResponse, readMasterMutation, requirePlatformAdmin } from '@/lib/master/server';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const access = await requirePlatformAdmin();
  if (access.response) return access.response;
  const { id } = await context.params;
  if (!isUuid(id)) return masterResponse({ error: 'Empresa inválida.' }, 400);
  let input;
  try { input = await readMasterMutation(request); }
  catch { return masterResponse({ error: 'Alteração ou origem inválidas.' }, 400); }
  const { data, error } = await access.admin.from('tenants').update(input).eq('id', id).select(MASTER_TENANT_COLUMNS).maybeSingle();
  if (error) return masterResponse({ error: 'Alteração recusada pelo banco.' }, 502);
  if (!data) return masterResponse({ error: 'Empresa não encontrada.' }, 404);
  return masterResponse({ tenant: data });
}

export async function DELETE(request: Request, context: Context) {
  const access = await requirePlatformAdmin();
  if (access.response) return access.response;
  if (request.headers.get('origin') !== new URL(request.url).origin) return masterResponse({ error: 'Origem inválida.' }, 403);
  const { id } = await context.params;
  if (!isUuid(id)) return masterResponse({ error: 'Empresa inválida.' }, 400);
  // Foreign keys protect business data: this endpoint never cascades a business purge.
  const { data, error } = await access.admin.from('tenants').delete().eq('id', id).select('id').maybeSingle();
  if (error) return masterResponse({ error: 'Empresa com dados vinculados não pode ser excluída.' }, error.code === '23503' ? 409 : 502);
  if (!data) return masterResponse({ error: 'Empresa não encontrada.' }, 404);
  return masterResponse({ deleted: true });
}
