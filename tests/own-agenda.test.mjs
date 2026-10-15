import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { agendaContract, ownAgendaRoute, loadOwnAgendaModule } from './helpers/own-agenda-route.mjs';

const require = createRequire(import.meta.url);
// VM-only configuration; never enables an actual local or hosted environment.
const enabledEnvironment = { HANDYHUB_OWN_AGENDA_ENABLED: 'true' };
const tenant = '00000000-0000-4000-8000-00000000010a';
const user = '00000000-0000-4000-8000-000000000003';
const row = { id: '00000000-0000-4000-8000-000000010331', date: '2026-10-10', time: '09:00:00',
  clientName: 'Cliente sintético', serviceName: 'Serviço sintético', status: 'Agendado' };
const request = suffix => new Request('https://local.example.invalid/api/agenda/own' + (suffix ?? '?tenantId=' + tenant));
function fixture(options = {}) {
  const trace = [];
  const client = {
    auth: { getUser: async () => { trace.push('auth'); return { data: { user: options.noUser ? null : { id: user } }, error: options.authError ?? null }; } },
    from: table => {
      assert.equal(table, 'tenant_memberships', 'No business/legacy read allowed');
      const filters = {};
      const builder = {
        select: fields => { assert.equal(fields, 'tenant_id'); return builder; },
        eq: (key, value) => { filters[key] = value; return builder; },
        maybeSingle: async () => { trace.push(filters); return { data: options.noMembership ? null : { tenant_id: tenant }, error: options.membershipError ?? null }; },
      };
      return builder;
    },
    rpc: async (name, args, config) => {
      trace.push('rpc'); assert.equal(name, 'erp_read_own_appointments');
      assert.deepEqual(JSON.parse(JSON.stringify(args)), { p_tenant: tenant });
      assert.deepEqual(JSON.parse(JSON.stringify(config)), { get: true });
      return { data: options.data === undefined ? [row] : options.data, error: options.rpcError ?? null };
    },
  };
  return { trace, route: ownAgendaRoute(async () => client, enabledEnvironment) };
}

test('GET uses verified identity, fresh active membership and only the read-only RPC', async () => {
  const { route, trace } = fixture();
  const response = await route.GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready', items: [row] });
  assert.deepEqual(trace, ['auth', { tenant_id: tenant, user_id: user, is_active: true }, 'rpc']);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Cookie');
});
test('Empty success is distinct from missing membership and SQL denial', async () => {
  const empty = await fixture({ data: [] }).route.GET(request());
  assert.deepEqual(await empty.json(), { status: 'ready', items: [] });
  for (const options of [{ noMembership: true }, { rpcError: { code: '42501', message: 'private SQL detail' } }]) {
    const response = await fixture(options).route.GET(request());
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { code: 'ACCESS_DENIED' });
  }
});
test('Equivalent UUID case is normalized before comparing the authorized membership', async () => {
  assert.equal((await fixture().route.GET(request('?tenantId=' + tenant.toUpperCase()))).status, 200);
});
test('Missing/expired session denies before membership/RPC; provider outage is explicit', async () => {
  for (const options of [{ noUser: true }, { authError: { status: 401 } }, { authError: { status: 503 } }]) {
    const { route, trace } = fixture(options);
    const response = await route.GET(request());
    assert.equal(response.status, options.authError?.status === 503 ? 503 : 401);
    assert.deepEqual(trace, ['auth']);
  }
});
test('Unknown/duplicate parameters and supplied identities are rejected before SDK use', async () => {
  const route = ownAgendaRoute(async () => { throw new Error('Must not contact SDK'); }, enabledEnvironment);
  for (const suffix of ['', '?tenantId=wrong', `?tenantId=${tenant}&tenantId=${tenant}`, `?tenantId=${tenant}&userId=${user}`, `?tenantId=${tenant}&role=owner`]) {
    assert.equal((await route.GET(request(suffix))).status, 400);
  }
});
test('Missing RPC, maintenance, transport/membership failure and JWT errors never use fallback', async () => {
  for (const code of ['PGRST202', '55000', 'unknown']) {
    const response = await fixture({ rpcError: { code, message: 'token=private-provider-detail' } }).route.GET(request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'AGENDA_UNAVAILABLE' });
  }
  assert.equal((await fixture({ rpcError: { code: 'PGRST301' } }).route.GET(request())).status, 401);
  assert.equal((await fixture({ membershipError: { code: 'PGRST000' } }).route.GET(request())).status, 503);
  assert.equal((await ownAgendaRoute(async () => { throw new Error('secret transport failure'); }, enabledEnvironment).GET(request())).status, 503);
});
test('Schema drift, private fields, duplicate IDs and malformed RPC responses fail closed', async () => {
  for (const data of [null, {}, [{ ...row, price: 100 }], [{ ...row, notes: 'private' }], [{ ...row, time: 'bad' }], [row, row], [{ ...row, clientName: {} }]]) {
    assert.equal((await fixture({ data }).route.GET(request())).status, 503);
  }
});

const clientModule = loadOwnAgendaModule('lib/agenda/own-client.ts', { './own-contract': agendaContract });
test('Client requests only own endpoint without cache; HTTP errors stay errors', async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.equal(url, '/api/agenda/own?tenantId=' + tenant);
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'same-origin');
    return Response.json({ status: 'ready', items: [] });
  };
  assert.equal((await clientModule.loadOwnAgenda(tenant, new AbortController().signal, fetcher)).status, 'ready');
  for (const status of [401, 403, 503]) {
    const state = await clientModule.loadOwnAgenda(tenant, new AbortController().signal, async () => Response.json({ secret: 'hidden' }, { status }));
    assert.equal(state.status, 'error'); assert.equal('items' in state, false);
  }
  assert.equal(calls, 1);
});
test('Network, cancellation and malformed success cannot become an authorized empty agenda', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => Response.json({ items: [] }), async () => Response.json({ status: 'ready', items: null })]) {
    assert.equal((await clientModule.loadOwnAgenda(tenant, new AbortController().signal, fetcher)).status, 'error');
  }
  assert.equal((await clientModule.loadOwnAgenda('wrong', new AbortController().signal, async () => { throw new Error('Must not fetch'); })).code, 'ACCESS_DENIED');
});
test('Old identity/tenant/reload responses are never selected after switching or logout', () => {
  const old = { key: 'user-a/tenant-a/0', state: { status: 'ready', items: [row] } };
  for (const key of [null, 'user-b/tenant-a/0', 'user-a/tenant-b/0', 'user-a/tenant-a/1']) {
    assert.equal(clientModule.currentOwnAgendaState(key, old).status, 'loading');
  }
  assert.equal(clientModule.currentOwnAgendaState(old.key, old).status, 'ready');
});
test('Real React renderer displays operational fields, escaped text and distinct error/empty states', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { OwnAgendaView } = loadAgendaView(() => ({}));
  const render = state => renderToStaticMarkup(React.createElement(OwnAgendaView, { state }));
  const html = render({ status: 'ready', items: [{ ...row, clientName: '<script>alert(1)</script>' }] });
  assert.match(html, /10\/10\/2026/); assert.match(html, /09:00:00/); assert.match(html, /Serviço sintético/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|Finalizar|Excluir|Editar|R\$/);
  assert.match(render({ status: 'error', code: 'ACCESS_DENIED' }), /role="alert"/);
  assert.match(render({ status: 'ready', items: [] }), /Nenhum agendamento/);
});
test('Pilot sources contain no legacy adapter/cache, financial actions or administrative client', () => {
  for (const path of ['app/api/agenda/own/route.ts', 'app/meus-agendamentos/page.tsx', 'components/agenda/OwnAgendaView.tsx', 'lib/agenda/own-client.ts']) {
    const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /tenant_data|saveTenantData|dbService|localStorage|sessionStorage|createSupabaseAdminClient|service_role/);
  }
});
test('Actual page selection boundary changes child identity and hides it on logout/loading/error', () => {
  let auth = { user: { id: user }, selectedMembership: { tenant_id: tenant }, loading: false, error: null };
  const page = loadAgendaView(() => auth);
  const boundary = page.OwnAgendaPage().props.children.type;
  const first = boundary();
  auth = { ...auth, selectedMembership: { tenant_id: '00000000-0000-4000-8000-000000000102' } };
  assert.notEqual(boundary().key, first.key);
  auth = { ...auth, user: { id: '00000000-0000-4000-8000-000000000004' } };
  assert.notEqual(boundary().key, first.key);
  for (const flags of [{ user: null }, { loading: true }, { error: 'unverified' }, { selectedMembership: null }]) {
    const original = auth; auth = { ...auth, ...flags }; assert.equal(boundary(), null); auth = original;
  }
});

function loadAgendaView(useAuth) {
  return loadOwnAgendaModule('components/agenda/OwnAgendaView.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'), react: require('react'),
    'next/link': { default: () => null },
    '@/components/auth/AuthEntry': { TenantAuthEntry: () => null },
    '@/components/auth/AuthProvider': { useAuth },
    '@/lib/agenda/own-client': clientModule,
  });
}

const disabledEnvironments = [{}, ...['', 'false', 'FALSE', 'TRUE', 'True', '1', '0', 'yes', 'on',
  ' true', 'true ', 'true\n', 'undefined', 'null', true].map(value => ({ HANDYHUB_OWN_AGENDA_ENABLED: value }))];

test('Disabled GET is an empty uncached 404 and cannot be enabled by request inputs', async () => {
  let clientsCreated = 0;
  for (const environment of disabledEnvironments) {
    const route = ownAgendaRoute(async () => { clientsCreated++; throw new Error('Must not create Supabase client'); }, environment);
    for (const suffix of ['', '?tenantId=' + tenant,
      '?tenantId=' + tenant + '&HANDYHUB_OWN_AGENDA_ENABLED=true&enabled=true']) {
      const response = await route.GET(new Request('https://local.example.invalid/api/agenda/own' + suffix, {
        headers: { Cookie: 'HANDYHUB_OWN_AGENDA_ENABLED=true; enabled=true',
          HANDYHUB_OWN_AGENDA_ENABLED: 'true', 'x-handyhub-own-agenda-enabled': 'true', 'x-middleware-subrequest': 'proxy' },
      }));
      assert.equal(response.status, 404);
      assert.equal(await response.text(), '');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  }
  assert.equal(clientsCreated, 0, 'Auth, membership and RPC cannot run without a client');
});

test('GET rechecks the flag per invocation rather than retaining an enabled state', async () => {
  const environment = { ...enabledEnvironment };
  let clientsCreated = 0;
  const route = ownAgendaRoute(async () => {
    clientsCreated++;
    return { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
  }, environment);
  assert.equal((await route.GET(request())).status, 401);
  delete environment.HANDYHUB_OWN_AGENDA_ENABLED;
  assert.equal((await route.GET(request())).status, 404);
  assert.equal(clientsCreated, 1);
});

function serverPage(environment, view) {
  return loadOwnAgendaModule('app/meus-agendamentos/page.tsx', {
    'server-only': {}, 'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': require('next/navigation'), 'next/server': { connection: async () => {} },
    '@/components/agenda/OwnAgendaView': view,
  }, environment);
}

test('Server page rejects every disabled value with the real Next notFound before rendering the client', async () => {
  let clientAccesses = 0;
  for (const environment of disabledEnvironments) {
    const page = serverPage(environment, { get OwnAgendaPage() { clientAccesses++; throw new Error('Must not render client'); } });
    await assert.rejects(page.default({ searchParams: Promise.resolve({ HANDYHUB_OWN_AGENDA_ENABLED: 'true' }) }),
      error => error.digest === 'NEXT_HTTP_ERROR_FALLBACK;404');
  }
  assert.equal(clientAccesses, 0);
});

test('Only exact true lets the server render the existing authenticated client boundary', async () => {
  const environment = { ...enabledEnvironment };
  const OwnAgendaPage = () => null;
  const page = serverPage(environment, { OwnAgendaPage });
  assert.equal((await page.default()).type, OwnAgendaPage);
  environment.HANDYHUB_OWN_AGENDA_ENABLED = 'false';
  await assert.rejects(page.default(), error => error.digest === 'NEXT_HTTP_ERROR_FALLBACK;404');
});

function proxyModule(environment, updateSupabaseSession) {
  return loadOwnAgendaModule('proxy.ts', {
    'next/server': require('next/server'), '@/lib/supabase/proxy': { updateSupabaseSession },
  }, environment);
}

test('Proxy denies both disabled routes before session refresh, including direct, encoded and RSC requests', async () => {
  const { NextRequest } = require('next/server');
  let sessionCalls = 0;
  for (const environment of disabledEnvironments) {
    const { proxy } = proxyModule(environment, async () => { sessionCalls++; throw new Error('Must not contact Auth'); });
    for (const path of ['/meus-agendamentos', '/meus-agendamentos/', '/%6deus-agendamentos',
      '/api/agenda/own', '/api/agenda/own/', '/api/agenda/%6fwn']) {
      const response = await proxy(new NextRequest('https://local.example.invalid' + path + '?enabled=true&_rsc=synthetic', {
        headers: { RSC: '1', Cookie: 'HANDYHUB_OWN_AGENDA_ENABLED=true', HANDYHUB_OWN_AGENDA_ENABLED: 'true' },
      }));
      assert.equal(response.status, 404);
      assert.equal(await response.text(), '');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  }
  assert.equal(sessionCalls, 0);
});

test('Proxy preserves session handling on unrelated routes and when explicitly enabled', async () => {
  const { NextRequest } = require('next/server');
  const sentinel = new Response(null, { status: 204 });
  const seen = [];
  const refresh = async request => { seen.push(request.nextUrl.pathname); return sentinel; };
  for (const path of ['/', '/sobre', '/api/team/invite', '/meus-agendamentos-outro']) {
    assert.equal(await proxyModule({}, refresh).proxy(new NextRequest('https://local.example.invalid' + path)), sentinel);
  }
  for (const path of ['/meus-agendamentos', '/api/agenda/own']) {
    assert.equal(await proxyModule(enabledEnvironment, refresh).proxy(new NextRequest('https://local.example.invalid' + path)), sentinel);
  }
  assert.equal(seen.length, 6);
});

test('Client modules neither read nor receive the server-only activation flag', () => {
  for (const path of ['components/agenda/OwnAgendaView.tsx', 'lib/agenda/own-client.ts', 'lib/agenda/own-contract.ts']) {
    const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /HANDYHUB_OWN_AGENDA_ENABLED|NEXT_PUBLIC_.*AGENDA/);
  }
  const page = readFileSync(new URL('../src/app/meus-agendamentos/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /['"]use client['"]/);
  assert.match(page, /import 'server-only'/);
  assert.ok(page.indexOf('await connection()') < page.indexOf('process.env.HANDYHUB_OWN_AGENDA_ENABLED'));
});
