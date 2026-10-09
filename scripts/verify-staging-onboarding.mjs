// Mechanism/API tests using disposable synthetic identities only. No SMTP receipt claim.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const ref = 'gbblkkgowccjycxtexvx';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const base = 'http://localhost:3000';
assert.equal(url, `https://${ref}.supabase.co`);
assert.equal(JSON.parse(Buffer.from(secret.split('.')[1], 'base64url')).ref, ref);
const fixtures = JSON.parse(readFileSync('.env.staging-fixtures.json', 'utf8'));
assert.equal(fixtures.ref, ref);
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(url, secret, options);
const evidence = [];
const check = (result) => { if (result.error) throw new Error(`Staging check: ${result.error.code || result.error.status || 'failed'}`); return result.data; };
const record = (name) => { evidence.push({ name, outcome: 'PASS' }); console.log(`PASS: ${name}`); };
const cookie = (jar) => [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
function clientJar(jar = new Map()) {
  return { jar, client: createServerClient(url, key, { auth: { autoRefreshToken: false }, cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
  } }) };
}
function accept(response, jar) {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';')[0]; const at = pair.indexOf('=');
    const name = pair.slice(0, at), value = pair.slice(at + 1);
    if (value) jar.set(name, decodeURIComponent(value)); else jar.delete(name);
  }
}
async function post(path, body, jar = new Map(), origin = base) {
  const isForm = body instanceof URLSearchParams;
  const response = await fetch(base + path, { method: 'POST', redirect: 'manual', headers: {
    Origin: origin, Cookie: cookie(jar), 'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
  }, body: isForm ? body : JSON.stringify(body) });
  accept(response, jar); return response;
}
async function confirm(token, type, jar = new Map()) {
  const response = await post('/auth/callback', new URLSearchParams({ token_hash: token, type }), jar);
  return { response, jar };
}
async function caller(name) {
  const result = clientJar();
  const actor = fixtures.users[name];
  check(await result.client.auth.signInWithPassword({ email: actor.email, password: actor.password }));
  return result;
}

try {
  const settingsResponse = await fetch(url + '/auth/v1/settings', { headers: { apikey: key } });
  assert.equal(settingsResponse.status, 200);
  assert.equal((await settingsResponse.json()).disable_signup, true);
  const signupClient = createClient(url, key, options);
  const signup = await signupClient.auth.signUp({ email: `hh-blocked-${randomUUID()}@example.invalid`, password: randomBytes(32).toString('hex') });
  assert.equal(signup.error?.code, 'signup_disabled');
  assert.equal(signup.data.user, null);
  record('Public signup disabled: direct anon signup returns signup_disabled without creating an identity');
  const email = `hh-onboarding-mechanism-${randomUUID()}@example.invalid`;
  const link = check(await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: base + '/auth/callback' } }));
  const id = link.user.id;
  record('Administrative Auth invitation-link provisioning still creates a synthetic identity with public signup disabled; no SMTP receipt claim');
  check(await admin.from('tenant_memberships').insert({ tenant_id: fixtures.tenants.A.id, user_id: id, role: 'employee', is_active: true }));
  const view = await fetch(base + '/auth/callback?' + new URLSearchParams({ token_hash: link.properties.hashed_token, type: 'invite' }));
  assert.equal(view.status, 200);
  assert.equal(view.headers.get('referrer-policy'), 'strict-origin');
  assert.match(view.headers.get('cache-control'), /no-store/);
  assert.equal(check(await admin.auth.admin.getUserById(id)).user.email_confirmed_at, undefined);
  record('GET confirmation preserves OTP; Referer excludes token path and same-origin POST remains required');
  const rejected = await confirm('f'.repeat(64), 'invite');
  assert.equal(new URL(rejected.response.headers.get('location')).pathname, '/auth/link-error');
  const foreign = await post('/auth/callback', new URLSearchParams({ token_hash: link.properties.hashed_token, type: 'invite' }), new Map(), 'https://example.invalid');
  assert.equal(new URL(foreign.headers.get('location')).pathname, '/auth/link-error');
  assert.equal(check(await admin.auth.admin.getUserById(id)).user.email_confirmed_at, undefined);
  record('Invalid and foreign-origin callbacks cannot establish a session or consume the valid invitation');
  const { response, jar } = await confirm(link.properties.hashed_token, 'invite');
  assert.equal(new URL(response.headers.get('location')).pathname, '/auth/activate');
  assert.ok(jar.has('handyhub-password-context'));
  assert.ok(response.headers.getSetCookie().some((item) => item.startsWith('handyhub-password-context=') && /HttpOnly/i.test(item) && /SameSite=strict/i.test(item)));
  const page = await fetch(base + '/auth/activate', { headers: { Cookie: cookie(jar) } });
  assert.ok((await page.text()).includes('Ativar meu acesso'));
  const recoveredPage = await fetch(base + '/auth/update-password', { headers: { Cookie: cookie(jar) } });
  assert.ok((await recoveredPage.text()).includes('Este acesso exige'));
  record('Verified invitation establishes exact SSR user and signed HttpOnly context; recovery screen rejects invitation context');
  const password = randomBytes(30).toString('base64url') + '!aA9';
  const payload = { kind: 'invite', password, confirmation: password };
  const noContext = new Map(jar); noContext.delete('handyhub-password-context');
  assert.equal((await post('/auth/password', payload, noContext)).status, 401);
  const tampered = new Map(jar); tampered.set('handyhub-password-context', jar.get('handyhub-password-context') + 'x');
  assert.equal((await post('/auth/password', payload, tampered)).status, 401);
  assert.equal((await post('/auth/password', { ...payload, kind: 'recovery' }, jar)).status, 401);
  assert.equal((await post('/auth/password', { ...payload, userId: fixtures.users.ownerB.id }, jar)).status, 400);
  assert.equal((await post('/auth/password', { ...payload, confirmation: 'different' }, jar)).status, 400);
  record('Password API rejects absent/tampered/wrong-flow context, arbitrary user and mismatched confirmation');
  const replayJar = new Map(jar);
  assert.equal((await post('/auth/password', payload, jar)).status, 200);
  assert.equal(jar.has('handyhub-password-context'), false);
  assert.equal((await post('/auth/password', payload, replayJar)).status, 401);
  const repeated = await confirm(link.properties.hashed_token, 'invite');
  assert.equal(new URL(repeated.response.headers.get('location')).pathname, '/auth/link-error');
  record('Synthetic initial password saves through ordinary updateUser; cleared/old Auth context and consumed OTP cannot be reused');
  const login = createClient(url, key, options);
  check(await login.auth.signInWithPassword({ email, password }));
  assert.equal(check(await login.auth.getUser()).user.id, id);
  const members = check(await login.from('tenant_memberships').select('tenant_id,role').eq('user_id', id));
  assert.deepEqual(members, [{ tenant_id: fixtures.tenants.A.id, role: 'employee' }]);
  assert.deepEqual(check(await login.from('tenants').select('id').eq('id', fixtures.tenants.B.id)), []);
  assert.deepEqual(check(await login.from('tenant_data').update({ data_key: 'attack' }).eq('tenant_id', fixtures.tenants.B.id).select('tenant_id')), []);
  await login.auth.signOut({ scope: 'local' });
  record('Synthetic password login preserves only employee A; B SELECT/UPDATE remain denied by real RLS');
  const recovery = check(await admin.auth.admin.generateLink({ type: 'recovery', email }));
  const reset = await confirm(recovery.properties.hashed_token, 'recovery');
  assert.equal(new URL(reset.response.headers.get('location')).pathname, '/auth/update-password');
  const resetPage = await fetch(base + '/auth/update-password', { headers: { Cookie: cookie(reset.jar) } });
  assert.ok((await resetPage.text()).includes('Salvar nova senha'));
  const changed = randomBytes(30).toString('base64url') + '!aA9';
  assert.equal((await post('/auth/password', { kind: 'recovery', password: changed, confirmation: changed }, reset.jar)).status, 200);
  assert.ok((await login.auth.signInWithPassword({ email, password })).error);
  check(await login.auth.signInWithPassword({ email, password: changed }));
  await login.auth.signOut({ scope: 'local' });
  record('Synthetic recovery has separate screen/context; old password fails and new password logs in');
  const newTenant = { slug: `hh-owner-error-${randomUUID()}`, company_name: 'Synthetic onboarding failure', owner_name: 'Synthetic Owner', owner_email: fixtures.users.ownerA.email };
  assert.equal((await post('/api/master/tenants', newTenant)).status, 401);
  const employee = await caller('employeeA');
  assert.equal((await post('/api/master/tenants', newTenant, employee.jar)).status, 403);
  await employee.client.auth.signOut({ scope: 'local' });
  const platform = await caller('platformAdmin');
  const ownerAttempt = await post('/api/master/tenants', newTenant, platform.jar);
  assert.equal(ownerAttempt.status, 409);
  const details = await ownerAttempt.json();
  assert.equal(details.onboarding.stage, 'invitation');
  assert.equal(details.onboarding.retainedTenant, false);
  assert.deepEqual(check(await admin.from('tenants').select('id').eq('slug', newTenant.slug)), []);
  assert.deepEqual(check(await admin.from('tenant_memberships').select('tenant_id,role').eq('user_id', fixtures.users.ownerA.id)), [{ tenant_id: fixtures.tenants.A.id, role: 'owner' }]);
  await platform.client.auth.signOut({ scope: 'local' });
  record('Master denies anon/employee; confirmed account is not attached/promoted and freshly created tenant is compensated');
  const anon = createClient(url, key, options);
  for (const table of ['tenants', 'tenant_data', 'tenant_memberships']) assert.ok((await anon.from(table).select('*')).error);
  record('Anon remains denied on company tables after local onboarding changes');
} catch (error) {
  console.error(error instanceof assert.AssertionError ? `FAILED: ${error.message.split('\n')[0]}` : 'FAILED: staging onboarding mechanism check');
  process.exitCode = 1;
} finally {
  writeFileSync('docs/camada-1c-onboarding-api-evidence.json', JSON.stringify({ ref, timestamp: new Date().toISOString(), emailDeliveryValidated: false, results: evidence }, null, 2) + '\n');
}
