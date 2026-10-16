import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const draftKeys = new Set(['fullName', 'cpf', 'birthDate', 'phone', 'notes']);
function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
}
function unavailable() { return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } }); }
function failure(code?: string, message?: string) {
  if (code === '42501') return reply({ code: 'ACCESS_DENIED' }, 403);
  if (code === '23505') return reply({ code: 'CUSTOMER_CPF_CONFLICT' }, 409);
  if (code === '22023') return reply({ code: message === 'INVALID_JUSTIFICATION' ? message : 'INVALID_CUSTOMER_FIELDS' }, 400);
  if (code === '40001') return reply({ code: ['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'CUSTOMER_REVIEW_REQUIRED'].includes(message ?? '') ? message : 'VERSION_CONFLICT' }, 409);
  return reply({ code: 'CUSTOMERS_UNAVAILABLE' }, 503);
}

async function handle(request: Request, write: boolean) {
  // Check BEFORE client construction, Auth, parsing sensitive input, membership or RPC.
  if (process.env.HANDYHUB_CUSTOMER_PERSISTENCE_ENABLED !== 'true') return unavailable();
  try {
    const url = new URL(request.url);
    let tenantId: unknown, customerId: unknown, operationId: unknown, expectedVersion: unknown, draft: unknown, reason: unknown;
    if (write) {
      // Next may internally reconstruct localhost while the browser uses 127.0.0.1.
      // Host is the actual browser destination; never trust a caller-selected tenant/actor.
      const host = request.headers.get('host');
      const expectedOrigin = host && !/[/@\\\s]/.test(host) ? new URL(`${url.protocol}//${host}`).origin : url.origin;
      if (request.headers.get('origin') !== expectedOrigin || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply({ code: 'INVALID_REQUEST' }, 400);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 8192) return reply({ code: 'INVALID_REQUEST' }, 413);
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !['tenantId', 'customerId', 'operationId', 'expectedVersion', 'draft', 'reason'].includes(k))) return reply({ code: 'INVALID_REQUEST' }, 400);
      ({ tenantId, customerId, operationId, expectedVersion, draft, reason } = data as Record<string, unknown>);
      if (!uuid(operationId) || !draft || typeof draft !== 'object' || Array.isArray(draft) || (reason !== undefined && typeof reason !== 'string')) return reply({ code: 'INVALID_REQUEST' }, 400);
      const fields = draft as Record<string, unknown>;
      if (Object.keys(fields).some(k => !draftKeys.has(k)) || ['fullName', 'cpf', 'birthDate', 'phone'].some(k => typeof fields[k] !== 'string') || (fields.notes !== undefined && (typeof fields.notes !== 'string' || fields.notes.length > 2000))) return reply({ code: 'INVALID_CUSTOMER_FIELDS' }, 400);
      // An old four-field PATCH must never silently clear existing notes.
      // Empty notes is allowed; omission during editing is an explicit contract error.
      if (request.method === 'PATCH' && typeof fields.notes !== 'string') return reply({ code: 'INVALID_CUSTOMER_FIELDS' }, 400);
      if (request.method === 'PATCH' ? !uuid(customerId) || !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1 : customerId !== undefined || expectedVersion !== undefined) return reply({ code: 'INVALID_REQUEST' }, 400);
    } else {
      if ([...url.searchParams.keys()].some(k => !['tenantId', 'customerId'].includes(k)) || url.searchParams.getAll('tenantId').length !== 1 || url.searchParams.getAll('customerId').length > 1) return reply({ code: 'INVALID_REQUEST' }, 400);
      tenantId = url.searchParams.get('tenantId'); customerId = url.searchParams.get('customerId') ?? undefined;
      if (customerId !== undefined && !uuid(customerId)) return reply({ code: 'INVALID_REQUEST' }, 400);
    }
    if (!uuid(tenantId)) return reply({ code: 'INVALID_REQUEST' }, 400);
    const client = await createServerSupabaseClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return reply({ code: 'AUTH_REQUIRED' }, 401);
    const { data: member, error: memberError } = await client.from('tenant_memberships').select('tenant_id,role')
      .eq('tenant_id', tenantId).eq('user_id', user.id).eq('is_active', true).maybeSingle();
    if (memberError) return reply({ code: 'CUSTOMERS_UNAVAILABLE' }, 503);
    if (!member || member.tenant_id !== tenantId || member.role !== 'owner') return reply({ code: 'ACCESS_DENIED' }, 403);
    // The user's JWT reaches PostgreSQL. SQL rechecks identity, pilot and locks.
    const result = write
      ? await client.rpc('hh_customer_write', { p_tenant: tenantId, p_operation: operationId, p_data: draft, p_customer: customerId ?? null, p_expected: expectedVersion ?? null, p_reason: reason || null })
      : await client.rpc('hh_customer_read', { p_tenant: tenantId, p_customer: customerId ?? null });
    if (result.error) return failure(result.error.code, result.error.message);
    return reply(result.data, write && request.method === 'POST' ? 201 : 200);
  } catch { return reply({ code: 'CUSTOMERS_UNAVAILABLE' }, 503); }
}
export async function GET(request: Request) { return handle(request, false); }
export async function POST(request: Request) { return handle(request, true); }
export async function PATCH(request: Request) { return handle(request, true); }
