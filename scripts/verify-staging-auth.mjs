// Explicitly targeted integration tests. Run with --env-file=.env.staging.local.
// Credentials stay in ignored .env.staging-fixtures.json; evidence contains only generic labels.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const ref = 'gbblkkgowccjycxtexvx';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mode = process.argv[2];
const base = process.env.STAGING_APP_URL || 'http://localhost:3000';
assert.equal(url, `https://${ref}.supabase.co`, 'Only the designated staging is allowed');
assert.equal(JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64url')).ref, ref);
assert.equal(JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64url')).role, 'service_role');
assert.ok(['provision', 'before', 'after'].includes(mode));
assert.ok(new URL(base).hostname === 'localhost' || new URL(base).hostname === '127.0.0.1' || new URL(base).hostname.endsWith('.vercel.app'));
const fixturePath = '.env.staging-fixtures.json';
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceKey, options);
const client = () => createClient(url, key, options);
const check = (result, label) => {
  if (result.error) throw new Error(`${label} failed (${result.error.code || result.error.status || 'unknown'})`);
  return result.data;
};
const evidence = [];
const record = (name, outcome = 'PASS') => { evidence.push({ name, outcome }); console.log(`${outcome}: ${name}`); };
let fixtures = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : { ref, users: {}, tenants: {} };
assert.equal(fixtures.ref, ref);
const save = () => writeFileSync(fixturePath, JSON.stringify(fixtures), { mode: 0o600 });

async function provision() {
  if (!Object.keys(fixtures.users).length) {
    const existing = check(await admin.auth.admin.listUsers(), 'Verify empty synthetic Auth');
    assert.equal(existing.users.length, 0, 'Refuse to provision over unrelated users');
  }
  for (const label of ['ownerA', 'managerA', 'employeeA', 'ownerB', 'noMembership', 'multipleMemberships', 'platformAdmin']) {
    if (fixtures.users[label]) continue;
    const email = `hh-1b-${label.toLowerCase()}@example.invalid`;
    const password = randomBytes(30).toString('base64url') + '!aA9';
    const link = check(await admin.auth.admin.generateLink({ type: 'signup', email, password }), `Generate ${label} signup`);
    // Verify the genuine Auth token. No global auto-confirm setting, SQL auth.users insertion or forged JWT.
    const verifier = client();
    const confirmation = check(await verifier.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' }), `Confirm ${label} token`);
    assert.equal(confirmation.user.id, link.user.id);
    fixtures.users[label] = { id: link.user.id, email, password };
    save();
    await verifier.auth.signOut();
    record(`Synthetic Auth ${label} provisioned and token verified`);
  }
  for (const name of ['A', 'B']) {
    if (fixtures.tenants[name]) continue;
    const slug = `hh-staging-${name.toLowerCase()}`;
    const row = check(await admin.from('tenants').insert({ slug, company_name: `Synthetic Company ${name}`, owner_name: `Synthetic Owner ${name}`, owner_email: fixtures.users[`owner${name}`].email, allowed_modules: { dashboard: true, team: true, settings: true } }).select('id,slug').single(), `Tenant ${name}`);
    fixtures.tenants[name] = row; save();
  }
  const memberships = [
    ['ownerA', 'A', 'owner'], ['managerA', 'A', 'manager'], ['employeeA', 'A', 'employee'], ['ownerB', 'B', 'owner'],
    ['multipleMemberships', 'A', 'manager'], ['multipleMemberships', 'B', 'employee'],
  ].map(([user, tenant, role]) => ({ user_id: fixtures.users[user].id, tenant_id: fixtures.tenants[tenant].id, role, is_active: true }));
  check(await admin.from('tenant_memberships').upsert(memberships, { onConflict: 'tenant_id,user_id' }), 'Memberships');
  check(await admin.from('platform_admins').upsert({ user_id: fixtures.users.platformAdmin.id, role: 'platform_admin' }), 'Platform administrator');
  const emptyArrays = Object.fromEntries(['customers', 'services', 'promotions', 'products', 'stockMoves', 'sales', 'expenses', 'appointments', 'attendances'].map((name) => [name, []]));
  for (const name of ['A', 'B']) {
    const { id, slug } = fixtures.tenants[name];
    const employees = name === 'A' ? [{ id: 'synthetic-employee-a', authUserId: fixtures.users.employeeA.id, name: 'Synthetic Employee A', roles: ['Colaborador'], role: 'Colaborador', systemRole: 'Colaborador', schedule: [] }] : [];
    check(await admin.from('tenant_data').upsert({ tenant_id: id, tenant_slug: slug, data_key: 'all_data', payload: { ...emptyArrays, marker: name, employees, rolesList: ['Colaborador'] } }, { onConflict: 'tenant_id,data_key' }), `Synthetic data ${name}`);
    const existing = check(await admin.from('companies').select('id').eq('tenant_id', id), 'Company metadata');
    if (!existing.length) check(await admin.from('companies').insert({ name: `Synthetic Company ${name}`, tenant_id: id }), 'Company fixture');
  }
  record('Two tenants, six memberships, one platform admin, isolated synthetic business rows');
}

async function appSession(label) {
  const jar = new Map();
  const ssr = createServerClient(url, key, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const fixture = fixtures.users[label];
  check(await ssr.auth.signInWithPassword({ email: fixture.email, password: fixture.password }), `${label} SSR sign-in`);
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function request(path, cookie, method = 'GET', body) {
  const response = await fetch(new URL(path, base), { method, headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: new URL(base).origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

async function authenticationAndApis() {
  const source = readFileSync('src/lib/auth/authService.ts', 'utf8');
  const authCode = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }).replace("'./authorization'", JSON.stringify(pathToFileURL(`${process.cwd()}/src/lib/auth/authorization.ts`).href));
  const { signInWithEmail } = await import(`data:text/javascript;base64,${Buffer.from(authCode).toString('base64')}`);
  const expected = { ownerA: ['owner'], managerA: ['manager'], employeeA: ['employee'], ownerB: ['owner'], noMembership: [], multipleMemberships: ['employee', 'manager'], platformAdmin: [] };
  for (const [label, roles] of Object.entries(expected)) {
    const user = fixtures.users[label];
    const auth = client();
    const identity = await signInWithEmail(auth, user.email, user.password);
    assert.equal(identity.user.id, user.id);
    assert.deepEqual(identity.memberships.map((m) => m.role).sort(), roles.toSorted());
    for (const membership of identity.memberships) {
      const tenant = label === 'ownerB' || (label === 'multipleMemberships' && membership.role === 'employee') ? 'B' : 'A';
      assert.equal(membership.tenant_id, fixtures.tenants[tenant].id);
    }
    await auth.auth.signOut();
    assert.equal((await auth.auth.getUser()).data.user, null);
    record(`${label}: actual authService login, membership, role and logout`);
  }
  const invalid = await client().auth.signInWithPassword({ email: fixtures.users.ownerA.email, password: 'incorrect-synthetic-password' });
  assert.ok(invalid.error); record('Invalid password rejected by Auth');
  const ownerCookie = await appSession('ownerA');
  const employeeCookie = await appSession('employeeA');
  const adminCookie = await appSession('platformAdmin');
  const a = fixtures.tenants.A.id;
  const b = fixtures.tenants.B.id;
  assert.equal((await request('/api/master/tenants')).status, 401);
  for (const cookie of [ownerCookie, employeeCookie]) {
    assert.equal((await request('/api/master/tenants', cookie)).status, 403);
    assert.equal((await request(`/api/master/tenants/${a}`, cookie, 'PATCH', { status: 'Bloqueado' })).status, 403);
    assert.equal((await request('/api/master/tenants', cookie, 'POST', { slug: 'unauthorized', company_name: 'Denied' })).status, 403);
    assert.equal((await request(`/api/master/tenants/${a}`, cookie, 'DELETE')).status, 403);
  }
  record('Master APIs: anon 401; ordinary owner/employee all CRUD 403');
  assert.equal((await request(`/api/master/tenants/${b}?support=true&isMaster=true`, ownerCookie, 'PATCH', { status: 'Bloqueado' })).status, 403);
  assert.equal((await request(`/api/master/tenants?tenant_id=${b}&role=platform_admin`, employeeCookie)).status, 403);
  record('Master ignores manipulated tenant, role and support parameters');
  const listing = await request('/api/master/tenants', adminCookie);
  assert.equal(listing.status, 200);
  assert.ok(listing.json.tenants.some((t) => t.id === a));
  assert.ok(listing.json.tenants.some((t) => t.id === b));
  assert.ok(listing.json.tenants.every((t) => !('logins' in t)));
  const invoice = { id: 'synthetic-integration-invoice', referenceMonth: '2026-10', amount: 1, dueDate: '2026-10-20', status: 'Aberto' };
  assert.equal((await request(`/api/master/tenants/${a}`, adminCookie, 'PATCH', { invoices: [invoice], status: 'Bloqueado' })).status, 200);
  const persisted = check(await admin.from('tenants').select('status,invoices').eq('id', a).single(), 'Verify Master persistence');
  assert.equal(persisted.status, 'Bloqueado'); assert.equal(persisted.invoices[0].id, invoice.id);
  assert.equal((await request(`/api/master/tenants/${a}`, adminCookie, 'PATCH', { invoices: [], status: 'Ativo' })).status, 200);
  assert.equal((await request(`/api/master/tenants/${a}`, adminCookie, 'PATCH', { logins: [] })).status, 400);
  const created = await request('/api/master/tenants', adminCookie, 'POST', { slug: 'synthetic-api-disposable', company_name: 'Synthetic API Disposable' });
  assert.equal(created.status, 201);
  assert.equal((await request(`/api/master/tenants/${created.json.tenant.id}`, adminCookie, 'DELETE')).status, 200);
  const foreignOrigin = await fetch(`${base}/api/master/tenants/${a}`, { method: 'PATCH', headers: { Cookie: adminCookie, Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Bloqueado' }) });
  assert.equal(foreignOrigin.status, 400);
  record('Platform admin CRUD persisted; credentials/mass assignment and foreign origin rejected');
  assert.equal((await request('/api/team/invite', employeeCookie, 'POST', { tenantId: a, email: 'synthetic-invite@example.invalid', role: 'employee' })).status, 403);
  assert.equal((await request('/api/team/invite', ownerCookie, 'POST', { tenantId: b, email: 'synthetic-invite@example.invalid', role: 'employee' })).status, 403);
  assert.equal((await request('/api/team/invite', ownerCookie, 'POST', { tenantId: a, email: 'synthetic-invite@example.invalid', role: 'owner' })).status, 403);
  assert.equal((await request('/api/equipe')).status, 405);
  assert.equal((await request('/api/equipe', undefined, 'POST', {})).status, 410);
  record('Equipe legacy API retired; unauthorized invites, cross-tenant invites and promotion rejected');
}

async function closedDatabase() {
  const a = fixtures.tenants.A.id, b = fixtures.tenants.B.id;
  const anon = client();
  for (const table of ['tenants', 'tenant_data', 'companies', 'tenant_memberships', 'platform_admins']) {
    assert.ok((await anon.from(table).select(table === 'tenants' ? 'id,slug' : '*')).error, `anon ${table} denied`);
  }
  for (const table of ['tenants', 'tenant_data', 'companies']) {
    for (const operation of ['insert', 'update', 'delete']) {
      let query = anon.from(table);
      if (operation === 'insert') query = query.insert(table === 'tenants' ? { slug: 'anon-denied', company_name: 'Denied' } : table === 'companies' ? { tenant_id: a, name: 'Denied' } : { tenant_id: a, tenant_slug: fixtures.tenants.A.slug, data_key: 'denied', payload: {} });
      if (operation === 'update') query = query.update(table === 'tenants' ? { company_name: 'Denied' } : table === 'companies' ? { name: 'Denied' } : { payload: {} }).eq(table === 'tenants' ? 'id' : 'tenant_id', a);
      if (operation === 'delete') query = query.delete().eq(table === 'tenants' ? 'id' : 'tenant_id', a);
      assert.ok((await query).error);
    }
  }
  record('anon business SELECT/INSERT/UPDATE/DELETE denied through direct PostgREST');
  const auths = {};
  for (const label of ['ownerA', 'managerA', 'employeeA', 'ownerB', 'noMembership', 'multipleMemberships']) {
    const c = client(); const u = fixtures.users[label];
    check(await c.auth.signInWithPassword({ email: u.email, password: u.password }), `${label} sign-in`);
    auths[label] = c;
    const ids = check(await c.from('tenants').select('id,slug'), `${label} tenant read`).map((t) => t.id).sort();
    const expected = label === 'ownerB' ? [b] : label === 'noMembership' ? [] : label === 'multipleMemberships' ? [a, b].sort() : [a];
    assert.deepEqual(ids, expected);
    const rows = check(await c.from('tenant_data').select('tenant_id,payload'), 'Data isolation');
    assert.deepEqual(rows.map((r) => r.tenant_id).sort(), expected);
    const companies = check(await c.from('companies').select('tenant_id'), 'Companies isolation');
    assert.deepEqual(companies.map((r) => r.tenant_id).sort(), expected);
  }
  record('Own-company reads allowed, foreign-company reads invisible; outsider empty; multiple memberships exact A/B');
  const owner = auths.ownerA;
  const changeB = check(await owner.from('tenant_data').update({ payload: { marker: 'unauthorized' } }).eq('tenant_id', b).select('tenant_id'), 'Foreign update');
  assert.equal(changeB.length, 0);
  const ownRow = check(await owner.from('tenant_data').select('id,payload').eq('tenant_id', a).single(), 'Own row');
  const mismatch = await owner.from('tenant_data').update({ tenant_slug: fixtures.tenants.B.slug }).eq('id', ownRow.id);
  assert.ok(mismatch.error);
  const transfer = await owner.from('tenant_data').update({ tenant_slug: fixtures.tenants.B.slug, tenant_id: b }).eq('id', ownRow.id);
  assert.ok(transfer.error);
  const targetB = check(await admin.from('tenant_data').select('payload').eq('tenant_id', b).single(), 'Verify B unchanged');
  assert.equal(targetB.payload.marker, 'B');
  record('A-to-B UPDATE touches zero rows; slug-only and matching slug/id transfers rejected; B unchanged');
  for (const [label, forbidden] of [['ownerA', b], ['ownerB', a]]) {
    for (const [table, column, body] of [['tenants', 'id', { company_name: 'Denied' }], ['companies', 'tenant_id', { name: 'Denied' }], ['tenant_data', 'tenant_id', { payload: { denied: true } }]]) {
      assert.equal(check(await auths[label].from(table).update(body).eq(column, forbidden).select(column), 'Symmetric foreign update').length, 0);
      assert.equal(check(await auths[label].from(table).delete().eq(column, forbidden).select(column), 'Symmetric foreign delete').length, 0);
    }
    const forbiddenSlug = forbidden === b ? fixtures.tenants.B.slug : fixtures.tenants.A.slug;
    assert.equal(check(await auths[label].from('tenant_data').select('id').eq('tenant_slug', forbiddenSlug), 'Manipulated slug filter').length, 0);
    assert.ok((await auths[label].from('tenant_data').insert({ tenant_id: forbidden, tenant_slug: forbiddenSlug, data_key: 'foreign-denied', payload: {} })).error);
  }
  const companyA = check(await owner.from('companies').select('id').eq('tenant_id', a).single(), 'Own company');
  assert.ok((await owner.from('companies').update({ tenant_id: b }).eq('id', companyA.id)).error);
  record('A/B isolation is symmetric across all three business tables, including DELETE, INSERT and company transfer');
  const employeeChange = check(await auths.employeeA.from('tenant_data').update({ payload: { denied: true } }).eq('tenant_id', a).select('id'), 'Employee update');
  assert.equal(employeeChange.length, 0);
  const employeeInsert = await auths.employeeA.from('tenant_data').insert({ tenant_id: a, tenant_slug: fixtures.tenants.A.slug, data_key: 'employee-denied', payload: {} });
  assert.ok(employeeInsert.error);
  assert.equal(check(await auths.employeeA.from('companies').update({ name: 'Denied' }).eq('tenant_id', a).select('id'), 'Employee company update').length, 0);
  assert.equal(check(await auths.managerA.from('tenants').update({ owner_name: 'Denied' }).eq('id', a).select('id'), 'Manager owner-only operation').length, 0);
  assert.equal(check(await auths.employeeA.from('tenant_data').delete().eq('tenant_id', a).select('id'), 'Employee delete').length, 0);
  assert.ok((await auths.managerA.from('tenants').insert({ slug: 'manager-denied', company_name: 'Denied' })).error);
  assert.ok((await owner.from('tenants').update({ status: 'Bloqueado' }).eq('id', a)).error);
  assert.ok((await owner.from('tenants').select('id,invoices').eq('id', a)).error);
  assert.ok((await owner.from('tenants').select('id,logins').eq('id', a)).error);
  assert.ok((await owner.from('tenant_memberships').insert({ tenant_id: b, user_id: fixtures.users.ownerA.id, role: 'owner' })).error);
  assert.ok((await owner.from('platform_admins').insert({ user_id: fixtures.users.ownerA.id })).error);
  const profile = check(await owner.from('tenants').update({ owner_name: 'Synthetic Owner A verified' }).eq('id', a).select('id'), 'Own profile update');
  assert.equal(profile.length, 1);
  const ownChange = check(await owner.from('tenant_data').update({ payload: { ...ownRow.payload, verified: true } }).eq('tenant_id', a).select('id'), 'Owner data update');
  assert.equal(ownChange.length, 1);
  const manager = check(await auths.managerA.from('tenant_data').update({ payload: ownRow.payload }).eq('tenant_id', a).select('id'), 'Manager data update');
  assert.equal(manager.length, 1);
  check(await owner.from('tenant_data').upsert({ tenant_id: a, tenant_slug: fixtures.tenants.A.slug, data_key: 'all_data', payload: ownRow.payload }, { onConflict: 'tenant_slug,data_key' }), 'Application legacy upsert');
  const bRow = check(await auths.ownerB.from('tenant_data').select('id,payload').eq('tenant_id', b).single(), 'Owner B own row');
  assert.equal(check(await auths.ownerB.from('tenant_data').update({ payload: bRow.payload }).eq('id', bRow.id).select('id'), 'Owner B own update').length, 1);
  record('Employee writes denied; owner/manager own writes allowed; subscription/invoices/logins and role escalation denied');
}

try {
  if (mode === 'provision') await provision();
  else {
    await authenticationAndApis();
    if (mode === 'after') await closedDatabase();
  }
  writeFileSync(`docs/camada-1b-${mode}-evidence.json`, JSON.stringify({ ref, timestamp: new Date().toISOString(), phase: mode, results: evidence }, null, 2) + '\n');
} catch (error) {
  // Never serialize SDK request/session objects or fixture credentials.
  console.error(`FAILED: ${error instanceof assert.AssertionError ? error.message : error.message?.replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted]')}`);
  process.exitCode = 1;
}
