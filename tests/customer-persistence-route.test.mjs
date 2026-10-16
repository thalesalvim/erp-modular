import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const next = require('next/server');
const tenant = '00000000-0000-4000-8000-000000000101';
const operation = '00000000-0000-4000-8000-000000000201';
const draft = { fullName: 'Pessoa Fictícia', cpf: '52998224725', birthDate: '1990-04-12', phone: '+5511987654321', notes: '' };
function setup(flag, options = {}) {
  let clients = 0, rpcs = 0;
  const chain = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { tenant_id: tenant, role: options.role ?? 'owner' }, error: null }; } };
  const client = { auth: { async getUser() { return { data: { user: options.noUser ? null : { id: operation } }, error: null }; } }, from() { return chain; }, async rpc() { rpcs++; return { data: { id: operation, version: 1 }, error: options.error ?? null }; } };
  const mod = { exports: {} };
  const source = readFileSync(new URL('../src/app/api/customers/route.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, Request, Response, URL, TextEncoder, process: { env: { HANDYHUB_CUSTOMER_PERSISTENCE_ENABLED: flag } }, require: name => name === 'next/server' ? next : { createServerSupabaseClient: async () => { clients++; return client; } } });
  return { route: mod.exports, counts: () => ({ clients, rpcs }) };
}
function request(method, body = {}, extra = {}) {
  return new Request(`http://localhost:3310/api/customers?tenantId=${tenant}`, { method, headers: { origin: 'http://127.0.0.1:3310', host: '127.0.0.1:3310', 'content-type': 'application/json', ...extra }, ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}) });
}
for (const flag of [undefined, '', 'false', 'TRUE', ' true ', '1']) {
  test(`flag ${JSON.stringify(flag)} blocks all methods before client/Auth/RPC`, async () => {
    const app = setup(flag);
    for (const method of ['GET', 'POST', 'PATCH']) {
      const response = await app.route[method](request(method));
      assert.equal(response.status, 404); assert.equal(await response.text(), '');
    }
    assert.deepEqual(app.counts(), { clients: 0, rpcs: 0 });
  });
}
test('exact true allows authenticated Owner RPC and disables caching', async () => {
  const app = setup('true');
  const response = await app.route.POST(request('POST', { tenantId: tenant, operationId: operation, draft }));
  assert.equal(response.status, 201); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(app.counts(), { clients: 1, rpcs: 1 });
});
test('unauthenticated, manager and employee cannot reach RPC', async () => {
  for (const options of [{ noUser: true }, { role: 'manager' }, { role: 'employee' }]) {
    const app = setup('true', options); const response = await app.route.GET(request('GET'));
    assert.equal(response.status, options.noUser ? 401 : 403); assert.equal(app.counts().rpcs, 0);
  }
});
test('CSRF origin and caller supplied identity are refused before Supabase', async () => {
  const app = setup('true');
  const body = { tenantId: tenant, operationId: operation, draft };
  assert.equal((await app.route.POST(request('POST', body, { origin: 'https://foreign.invalid' }))).status, 400);
  assert.equal((await app.route.POST(request('POST', { ...body, actor: operation }))).status, 400);
  assert.equal(app.counts().clients, 0);
});
test('provider errors never expose raw detail, input or credentials', async () => {
  const app = setup('true', { error: { code: '23505', message: 'unreviewed private input', details: 'private values' } });
  const response = await app.route.POST(request('POST', { tenantId: tenant, operationId: operation, draft }));
  assert.equal(response.status, 409); assert.deepEqual(await response.json(), { code: 'CUSTOMER_CPF_CONFLICT' });
});
test('version and idempotency conflicts are distinguishable', async () => {
  for (const message of ['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'CUSTOMER_REVIEW_REQUIRED']) {
    const app = setup('true', { error: { code: '40001', message } });
    const response = await app.route.POST(request('POST', { tenantId: tenant, operationId: operation, draft }));
    assert.equal(response.status, 409); assert.equal((await response.json()).code, message);
  }
});
test('editing requires an explicit notes value and never forwards omission to SQL', async () => {
  const app = setup('true');
  const withoutNotes = { ...draft };
  delete withoutNotes.notes;
  const response = await app.route.PATCH(request('PATCH', { tenantId: tenant, operationId: operation, customerId: operation, expectedVersion: 1, draft: withoutNotes }));
  assert.equal(response.status, 400); assert.equal(app.counts().clients, 0); assert.equal(app.counts().rpcs, 0);
});
test('optional notes are type checked and bounded before authentication/RPC', async () => {
  for (const notes of [null, 123, 'x'.repeat(2001)]) {
    const app = setup('true');
    const response = await app.route.POST(request('POST', { tenantId: tenant, operationId: operation, draft: { ...draft, notes } }));
    assert.equal(response.status, 400); assert.equal(app.counts().clients, 0);
  }
});
