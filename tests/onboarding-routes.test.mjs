// Execute the real handlers with isolated Auth/DB adapters. No SDK, network,
// environment file, real identity, invitation or external database is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as passwordContext from '../src/lib/auth/password-context.ts';
import { provisionFirstOwner, ProvisioningFailure } from '../src/lib/master/onboarding.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { NextResponse } = require('next/server');
const { issuePasswordContext, PASSWORD_CONTEXT_COOKIE } = passwordContext;
const origin = 'https://staging.example.invalid';
const tenantA = '10000000-0000-4000-8000-00000000000a';
const tenantB = '10000000-0000-4000-8000-00000000000b';
const callerId = '20000000-0000-4000-8000-00000000000a';
const invitedId = '20000000-0000-4000-8000-00000000000c';
const sessionId = '30000000-0000-4000-8000-00000000000a';
const signingKey = 'synthetic-local-context-key';
const tokenHash = 'a'.repeat(64);
const normalize = (value) => JSON.parse(JSON.stringify(value));

function load(file, dependencies, env = {}, logs = []) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(compiled, {
    module: loaded, exports: loaded.exports, URL, URLSearchParams, TextDecoder, Uint8Array,
    Request, Response, Buffer, process: { env },
    console: { error: (...args) => logs.push(normalize(args)) },
    require: (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return loaded.exports;
}

const authorization = load('lib/auth/authorization.ts', {});
const invitations = load('lib/auth/invitations.ts', { './authorization': authorization });
const contracts = load('lib/master/contracts.ts', {});
const callbacks = load('lib/auth/callback.ts', {});
function request(path, body, requestOrigin = origin) {
  return new Request(origin + path, { method: 'POST', headers: {
    Origin: requestOrigin, 'Content-Type': 'application/json',
  }, body: JSON.stringify(body) });
}

// Model equality filters rather than returning an inactive/foreign row that the
// real Data API would have excluded. Record writes and authorization predicates.
function query(table, result, trace) {
  const entry = { table, filters: [], operation: 'select' };
  trace.push(entry);
  const builder = {
    select() { return builder; },
    eq(field, value) { entry.filters.push([field, value]); return builder; },
    insert(value) { entry.operation = 'insert'; entry.value = normalize(value); return builder; },
    update(value) { entry.operation = 'update'; entry.value = normalize(value); return builder; },
    delete() { entry.operation = 'delete'; return builder; },
    single() { return Promise.resolve(result); },
    maybeSingle() { return Promise.resolve(result); },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return builder;
}

function masterGuard({ user = { id: callerId }, authError = null, adminRow = null, roleError = null } = {}) {
  let elevatedClients = 0;
  const trace = [];
  const server = load('lib/master/server.ts', {
    'server-only': {}, 'next/server': { NextResponse }, './contracts': contracts,
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: {
      getUser: async () => ({ data: { user }, error: authError }),
    } }) },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => {
      elevatedClients++;
      return { from: (table) => { assert.equal(table, 'platform_admins'); return query(table, { data: adminRow, error: roleError }, trace); } };
    } },
  });
  return { server, trace, elevatedClients: () => elevatedClients };
}

test('Master rejects missing/revoked Auth before initializing an elevated client', async () => {
  for (const input of [{ user: null }, { authError: { code: 'session_not_found' } }]) {
    const guard = masterGuard(input);
    assert.equal((await guard.server.requirePlatformAdmin()).response.status, 401);
    assert.equal(guard.elevatedClients(), 0);
  }
});

test('Master ignores metadata admin claims and requires a database platform_admin record', async () => {
  const guard = masterGuard({ user: { id: callerId, user_metadata: { platform_admin: true, role: 'platform_admin' } } });
  assert.equal((await guard.server.requirePlatformAdmin()).response.status, 403);
  assert.deepEqual(guard.trace[0].filters, [['user_id', callerId], ['role', 'platform_admin']]);
  const allowed = masterGuard({ adminRow: { user_id: callerId } });
  assert.ok((await allowed.server.requirePlatformAdmin()).admin);
  const unavailable = masterGuard({ roleError: { code: 'database_unavailable' } });
  assert.equal((await unavailable.server.requirePlatformAdmin()).response.status, 503);
});

function teamHandler({ user = { id: callerId }, member = { tenant_id: tenantA, user_id: callerId, role: 'owner', is_active: true },
  membershipError = null, invitationError = null, insertError = null, env = { AUTH_INVITE_TEMPLATE_MODE: 'token_hash', NEXT_PUBLIC_SITE_URL: origin } } = {}) {
  const trace = [], logs = [];
  let elevatedClients = 0;
  const caller = { auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (table) => {
    assert.equal(table, 'tenant_memberships');
    const result = { data: member, error: membershipError };
    const builder = query(table, result, trace);
    builder.maybeSingle = async () => {
      const filters = trace.at(-1).filters;
      return { data: member && filters.every(([key, value]) => member[key] === value) ? member : null, error: membershipError };
    };
    return builder;
  } };
  const route = load('app/api/team/invite/route.ts', {
    'next/server': { NextResponse }, '@/lib/auth/authorization': authorization, '@/lib/auth/invitations': invitations,
    '@/lib/supabase/server': { createServerSupabaseClient: async () => caller },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => {
      elevatedClients++;
      return { auth: { admin: { inviteUserByEmail: async (email, options) => {
        trace.push({ operation: 'invite', email, options: normalize(options) });
        return { data: { user: invitationError ? null : { id: invitedId } }, error: invitationError };
      } } }, from: (table) => query(table, { data: null, error: insertError }, trace) };
    } },
  }, env, logs);
  return { route, trace, logs, elevatedClients: () => elevatedClients };
}
const employeeInput = { tenantId: tenantA, email: 'employee-c@example.invalid', role: 'employee' };

test('Employee invitation requires Auth and rejects cross-site or injected identities before dispatch', async () => {
  const anon = teamHandler({ user: null });
  assert.equal((await anon.route.POST(request('/api/team/invite', employeeInput))).status, 401);
  assert.equal(anon.elevatedClients(), 0);
  for (const [body, csrfOrigin] of [[employeeInput, 'https://other.example.invalid'], [{ ...employeeInput, userId: invitedId }, origin],
    [{ ...employeeInput, platform_admin: true }, origin], [{ ...employeeInput, redirectTo: 'https://other.example.invalid' }, origin]]) {
    const handler = teamHandler();
    assert.equal((await handler.route.POST(request('/api/team/invite', body, csrfOrigin))).status, 400);
    assert.equal(handler.elevatedClients(), 0);
  }
});

test('Employee invitation rejects foreign/inactive memberships and employee metadata escalation', async () => {
  for (const change of [{ tenant_id: tenantB }, { is_active: false }, { role: 'employee' }]) {
    const handler = teamHandler({ user: { id: callerId, user_metadata: { role: 'owner' } },
      member: { tenant_id: tenantA, user_id: callerId, role: 'owner', is_active: true, ...change } });
    assert.equal((await handler.route.POST(request('/api/team/invite', employeeInput))).status, 403);
    assert.equal(handler.elevatedClients(), 0);
    assert.deepEqual(handler.trace[0].filters, [['tenant_id', tenantA], ['user_id', callerId], ['is_active', true]]);
  }
});

test('Owner/manager invitation rejects privilege escalation and stops when authorization lookup fails', async () => {
  for (const [actorRole, requestedRole] of [['owner', 'owner'], ['manager', 'manager'], ['manager', 'owner']]) {
    const handler = teamHandler({ member: { tenant_id: tenantA, user_id: callerId, role: actorRole, is_active: true } });
    assert.equal((await handler.route.POST(request('/api/team/invite', { ...employeeInput, role: requestedRole }))).status, 403);
    assert.equal(handler.elevatedClients(), 0);
  }
  const unavailable = teamHandler({ membershipError: { code: 'database_unavailable' } });
  assert.equal((await unavailable.route.POST(request('/api/team/invite', employeeInput))).status, 503);
  assert.equal(unavailable.elevatedClients(), 0);
});

test('Invitation configuration failure causes no Auth dispatch or membership write', async () => {
  for (const env of [{ NEXT_PUBLIC_SITE_URL: origin }, { AUTH_INVITE_TEMPLATE_MODE: 'token_hash', NEXT_PUBLIC_SITE_URL: origin + '/wrong' }]) {
    const handler = teamHandler({ env });
    assert.equal((await handler.route.POST(request('/api/team/invite', employeeInput))).status, 503);
    assert.equal(handler.elevatedClients(), 0);
  }
});

test('Authorized employee invitation uses the Auth-returned UID and the reviewed tenant/callback', async () => {
  for (const role of ['owner', 'manager']) {
    const handler = teamHandler({ member: { tenant_id: tenantA, user_id: callerId, role, is_active: true } });
    const response = await handler.route.POST(request('/api/team/invite', employeeInput));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { accepted: true, userId: invitedId });
    assert.deepEqual(handler.trace[1].options, { redirectTo: origin + '/auth/callback' });
    assert.equal(handler.trace[2].table, 'tenant_memberships');
    assert.deepEqual(handler.trace[2].value, { tenant_id: tenantA, user_id: invitedId, role: 'employee', is_active: true });
  }
});

test('Failed or existing-account invitation never creates membership or reports acceptance', async () => {
  for (const [providerStatus, httpStatus] of [[400, 409], [429, 429], [500, 502]]) {
    const handler = teamHandler({ invitationError: { status: providerStatus, code: 'synthetic_failure', message: 'private-provider-detail' } });
    const response = await handler.route.POST(request('/api/team/invite', employeeInput));
    assert.equal(response.status, httpStatus);
    assert.equal(handler.trace.some((entry) => entry.operation === 'insert'), false);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private-provider-detail|example.invalid/);
    assert.doesNotMatch(JSON.stringify(handler.logs), /private-provider-detail|example.invalid/);
  }
  const partial = teamHandler({ insertError: { code: 'synthetic_membership_failure' } });
  const response = await partial.route.POST(request('/api/team/invite', employeeInput));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /associação não foi concluída/);
});

test('Master handler provisions a fixed Owner and activates only the Auth-returned membership after finalization', async () => {
  const trace = [];
  const pending = { id: tenantB, slug: 'synthetic-c', status: 'Pendente' };
  const results = [{ data: pending, error: null }, { data: null, error: null },
    { data: { ...pending, status: 'Ativo' }, error: null }, { data: { id: 'membership-c' }, error: null }];
  const admin = { from: (table) => query(table, results.shift(), trace), auth: { admin: {
    inviteUserByEmail: async (email, options) => { trace.push({ operation: 'invite', email, options: normalize(options) });
      return { data: { user: { id: invitedId } }, error: null }; },
  } } };
  const server = masterGuard().server;
  const route = load('app/api/master/tenants/route.ts', {
    '@/lib/master/contracts': contracts,
    '@/lib/master/server': { ...server, requirePlatformAdmin: async () => ({ admin }) },
    '@/lib/auth/invitations': invitations, '@/lib/master/onboarding': { provisionFirstOwner, ProvisioningFailure },
  }, { AUTH_INVITE_TEMPLATE_MODE: 'token_hash', NEXT_PUBLIC_SITE_URL: origin });
  const input = { slug: 'synthetic-c', company_name: 'Synthetic C', owner_name: 'Synthetic Owner C', owner_email: 'owner-c@example.invalid' };
  for (const change of [{ role: 'platform_admin' }, { user_id: invitedId }]) {
    assert.equal((await route.POST(request('/api/master/tenants', { ...input, ...change }))).status, 400);
    assert.equal(trace.length, 0);
  }
  assert.equal((await route.POST(request('/api/master/tenants', input, 'null'))).status, 400);
  assert.equal(trace.length, 0);
  const response = await route.POST(request('/api/master/tenants', input));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).owner.role, 'owner');
  assert.deepEqual(trace.map((entry) => entry.operation), ['insert', 'invite', 'insert', 'update', 'update']);
  assert.deepEqual(trace.filter((entry) => entry.table).map((entry) => entry.table), ['tenants', 'tenant_memberships', 'tenants', 'tenant_memberships']);
  assert.equal(trace[0].value.status, 'Pendente');
  assert.deepEqual(trace[1].options, { redirectTo: origin + '/auth/callback', data: { display_name: input.owner_name } });
  assert.deepEqual(trace[2].value, { tenant_id: tenantB, user_id: invitedId, role: 'owner', is_active: false });
  assert.deepEqual(trace[3].value, { status: 'Ativo' });
  assert.deepEqual(trace[4].value, { is_active: true });
  assert.deepEqual(trace[4].filters, [['tenant_id', tenantB], ['user_id', invitedId], ['role', 'owner'], ['is_active', false]]);
  assert.equal(results.length, 0);
});

function passwordHandler({ userId = callerId, tokenUserId = userId, cookieUserId = userId,
  session = true, cookieKind = 'invite', updatedAt = 'v1', authError = null, updateError = null, authorizedCookie = true } = {}) {
  let authVersion = updatedAt;
  const updates = [];
  const accessToken = `header.${Buffer.from(JSON.stringify({ sub: tokenUserId, session_id: sessionId })).toString('base64url')}.signature`;
  const contextCookie = authorizedCookie ? issuePasswordContext({ kind: cookieKind, userId: cookieUserId, sessionId, authVersion: updatedAt }, signingKey) : undefined;
  const supabase = { auth: {
    getUser: async () => ({ data: { user: { id: userId, updated_at: authVersion } }, error: authError }),
    getSession: async () => ({ data: { session: session ? { access_token: accessToken } : null } }),
    updateUser: async (value) => { updates.push(normalize(value)); if (!updateError) authVersion = 'v2'; return { error: updateError }; },
  } };
  const guard = load('lib/auth/password-flow-server.ts', {
    'server-only': {}, 'next/headers': { cookies: async () => ({ get: () => contextCookie ? { value: contextCookie } : undefined }) },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => supabase },
    './password-context': passwordContext,
  }, { SUPABASE_SERVICE_ROLE_KEY: signingKey });
  const route = load('app/auth/password/route.ts', {
    'next/server': { NextResponse }, '@/lib/auth/password-flow-server': guard, '@/lib/auth/password-context': passwordContext,
  });
  return { route, updates };
}
const passwordInput = { kind: 'invite', password: 'Local-only-synthetic-password', confirmation: 'Local-only-synthetic-password' };

test('Password handler rejects absent context, wrong flow/identity and invalid session before changing credentials', async () => {
  for (const options of [{ authorizedCookie: false }, { cookieKind: 'recovery' }, { cookieUserId: invitedId },
    { tokenUserId: invitedId }, { session: false }, { authError: { code: 'session_not_found' } }]) {
    const handler = passwordHandler(options);
    assert.equal((await handler.route.POST(request('/auth/password', passwordInput))).status, 401);
    assert.equal(handler.updates.length, 0);
  }
});

test('Password handler rejects CSRF and identity/tenant injection before changing credentials', async () => {
  for (const [body, csrfOrigin] of [[passwordInput, 'null'], [{ ...passwordInput, userId: invitedId }, origin],
    [{ ...passwordInput, tenant_id: tenantB }, origin], [{ ...passwordInput, role: 'owner' }, origin]]) {
    const handler = passwordHandler();
    assert.equal((await handler.route.POST(request('/auth/password', body, csrfOrigin))).status, 400);
    assert.equal(handler.updates.length, 0);
  }
});

test('Password success clears its context and an old context cannot authorize a sequential replay', async () => {
  const handler = passwordHandler();
  const first = await handler.route.POST(request('/auth/password', passwordInput));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { saved: true });
  assert.equal(first.cookies.get(PASSWORD_CONTEXT_COOKIE).value, '');
  assert.equal((await handler.route.POST(request('/auth/password', passwordInput))).status, 401);
  assert.equal(handler.updates.length, 1);
  assert.deepEqual(Object.keys(handler.updates[0]), ['password']);
});

test('Password provider failure never reports success or leaks the provider detail', async () => {
  const handler = passwordHandler({ updateError: { message: 'private-provider-detail' } });
  const response = await handler.route.POST(request('/auth/password', passwordInput));
  assert.equal(response.status, 422);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private-provider-detail|Local-only/);
  assert.equal(response.cookies.get(PASSWORD_CONTEXT_COOKIE), undefined);
});

test('Email scanner GET renders confirmation without contacting Auth or consuming the invitation', async () => {
  let clientCalls = 0;
  const route = load('app/auth/callback/route.ts', {
    'next/server': { NextResponse }, '@/lib/auth/callback': callbacks,
    '@/lib/auth/password-context': passwordContext,
    '@/lib/supabase/server': { createServerSupabaseClient: async () => { clientCalls++; throw new Error(); } },
  });
  const response = await route.GET(new Request(origin + `/auth/callback?token_hash=${tokenHash}&type=invite`));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Confirmar convite/);
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin');
  assert.equal(clientCalls, 0);
  assert.equal(response.cookies.get(PASSWORD_CONTEXT_COOKIE), undefined);
});

test('Rejected/reused OTP and cross-site callback do not issue a password context', async () => {
  let otpCalls = 0;
  const route = load('app/auth/callback/route.ts', {
    'next/server': { NextResponse }, '@/lib/auth/callback': callbacks,
    '@/lib/auth/password-context': passwordContext,
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: {
      verifyOtp: async () => { otpCalls++; return { error: { code: 'otp_expired', status: 403 } }; },
      getUser: async () => { throw new Error('Must not load identity after rejected OTP'); },
    } }) },
  }, { SUPABASE_SERVICE_ROLE_KEY: signingKey });
  for (const csrfOrigin of ['null', origin]) {
    const response = await route.POST(new Request(origin + '/auth/callback', { method: 'POST',
      headers: { Origin: csrfOrigin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token_hash: tokenHash, type: 'invite' }),
    }));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), origin + '/auth/link-error');
    assert.equal(response.cookies.get(PASSWORD_CONTEXT_COOKIE), undefined);
  }
  assert.equal(otpCalls, 1);
});

function otpHandler({ user = { id: callerId, updated_at: 'v1' }, tokenUserId = callerId, secret = signingKey } = {}) {
  let otpCalls = 0;
  const accessToken = `header.${Buffer.from(JSON.stringify({ sub: tokenUserId, session_id: sessionId })).toString('base64url')}.signature`;
  const route = load('app/auth/callback/route.ts', {
    'next/server': { NextResponse }, '@/lib/auth/callback': callbacks, '@/lib/auth/password-context': passwordContext,
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: {
      verifyOtp: async () => { otpCalls++; return { data: { session: { access_token: accessToken } }, error: null }; },
      getUser: async () => ({ data: { user }, error: null }),
    } }) },
  }, { SUPABASE_SERVICE_ROLE_KEY: secret });
  const confirm = (type) => route.POST(new Request(origin + '/auth/callback', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token_hash: tokenHash, type, next: '/equipe' }),
  }));
  return { confirm, otpCalls: () => otpCalls };
}

test('Valid invite/recovery callbacks issue separate contexts bound to the verified identity and session', async () => {
  for (const [kind, path] of [['invite', '/auth/activate'], ['recovery', '/auth/update-password']]) {
    const handler = otpHandler();
    const response = await handler.confirm(kind);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), origin + path);
    const cookie = response.cookies.get(PASSWORD_CONTEXT_COOKIE);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, 'strict');
    assert.equal(cookie.path, '/auth');
    assert.equal(checkContext(cookie.value, kind), true);
    assert.equal(checkContext(cookie.value, kind === 'invite' ? 'recovery' : 'invite'), false);
  }
});

function checkContext(cookie, kind) {
  return passwordContext.checkPasswordContext(cookie, { kind, userId: callerId, sessionId, authVersion: 'v1' }, signingKey);
}

test('Activation callback rejects mismatched/unverified identity and missing signing configuration', async () => {
  for (const options of [{ user: null }, { user: { id: callerId } }, { tokenUserId: invitedId }, { secret: '' }]) {
    const handler = otpHandler(options);
    const response = await handler.confirm('invite');
    assert.equal(response.headers.get('location'), origin + '/auth/link-error');
    assert.equal(response.cookies.get(PASSWORD_CONTEXT_COOKIE), undefined);
    if (options.secret === '') assert.equal(handler.otpCalls(), 0, 'missing config must not consume the OTP');
  }
});
