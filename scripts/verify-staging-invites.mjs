// Exercises real staging OTPs through the application callback. No email delivery is simulated as success.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const ref = 'gbblkkgowccjycxtexvx';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const base = process.env.STAGING_APP_URL || 'http://localhost:3000';
assert.equal(url, `https://${ref}.supabase.co`);
assert.equal(JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64url')).ref, ref);
assert.equal(JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64url')).role, 'service_role');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'No production or external app target');
assert.notEqual(process.env.AUTH_INVITE_TEMPLATE_MODE, 'token_hash', 'Unconfigured real template must remain disabled');
const fixtures = JSON.parse(readFileSync('.env.staging-fixtures.json', 'utf8'));
assert.equal(fixtures.ref, ref);
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceKey, options);
const check = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.code || result.error.status || 'failed'}`);
  return result.data;
};
const evidence = [];
const record = (name) => { evidence.push({ name, outcome: 'PASS' }); console.log(`PASS: ${name}`); };
const source = readFileSync('src/lib/auth/authService.ts', 'utf8');
const compiled = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })
  .replace("'./authorization'", JSON.stringify(pathToFileURL(`${process.cwd()}/src/lib/auth/authorization.ts`).href));
const { signInWithEmail, updateOwnPassword, signOutAndClearIdentity } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function jarClient(jar = new Map()) {
  const client = createServerClient(url, key, {
    auth: { autoRefreshToken: false },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
    },
  });
  return { client, jar };
}
function acceptCookies(response, jar) {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';')[0];
    const index = pair.indexOf('=');
    const name = pair.slice(0, index), value = pair.slice(index + 1);
    if (value) jar.set(name, decodeURIComponent(value)); else jar.delete(name);
  }
}
const cookies = (jar) => [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
async function confirm(tokenHash, type, jar = new Map(), next = '/') {
  const form = new URLSearchParams({ token_hash: tokenHash, type, next });
  const response = await fetch(`${base}/auth/callback`, {
    method: 'POST', redirect: 'manual',
    headers: { Origin: new URL(base).origin, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies(jar) },
    body: form,
  });
  acceptCookies(response, jar);
  return { response, jar };
}
async function api(label, body) {
  const { client, jar } = jarClient();
  const actor = fixtures.users[label];
  check(await client.auth.signInWithPassword({ email: actor.email, password: actor.password }), 'Caller sign-in');
  const response = await fetch(`${base}/api/team/invite`, {
    method: 'POST', headers: { Origin: new URL(base).origin, 'Content-Type': 'application/json', Cookie: cookies(jar) },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.ok(!JSON.stringify(data).includes(serviceKey));
  assert.ok(!('action_link' in data) && !('token_hash' in data) && !('password' in data));
  // Do not invalidate other synthetic browser/API sessions for the same caller.
  await client.auth.signOut({ scope: 'local' });
  return response.status;
}

try {
  const email = `hh-callback-invite-${randomUUID()}@example.invalid`;
  const link = check(await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: `${base}/auth/callback` } }), 'Generate official invite');
  assert.equal(link.properties.verification_type, 'invite');
  const id = link.user.id;
  check(await admin.from('tenant_memberships').insert({ tenant_id: fixtures.tenants.A.id, user_id: id, role: 'employee', is_active: true }), 'Synthetic UUID membership');
  const before = check(await admin.auth.admin.getUserById(id), 'Before link GET');
  assert.equal(before.user.email_confirmed_at, undefined);
  const view = await fetch(`${base}/auth/callback?${new URLSearchParams({ token_hash: link.properties.hashed_token, type: 'invite' })}`, { redirect: 'manual' });
  assert.equal(view.status, 200);
  assert.ok((await view.text()).includes('Confirmar convite'));
  assert.match(view.headers.get('cache-control'), /no-store/);
  assert.equal(view.headers.get('referrer-policy'), 'no-referrer');
  const afterGet = check(await admin.auth.admin.getUserById(id), 'After link GET');
  assert.equal(afterGet.user.email_confirmed_at, undefined);
  record('Official invite token GET renders confirmation without consuming the token');

  const accepted = await confirm(link.properties.hashed_token, 'invite');
  assert.equal(accepted.response.status, 303);
  assert.equal(new URL(accepted.response.headers.get('location')).pathname, '/auth/update-password');
  assert.ok(accepted.jar.size > 0);
  const acceptedClient = jarClient(accepted.jar).client;
  const acceptedUser = check(await acceptedClient.auth.getUser(), 'SSR cookie session');
  assert.equal(acceptedUser.user.id, id);
  const memberships = check(await acceptedClient.from('tenant_memberships').select('tenant_id,role').eq('user_id', id), 'Accepted membership');
  assert.deepEqual(memberships, [{ tenant_id: fixtures.tenants.A.id, role: 'employee' }]);
  record('Official invite OTP POST creates verified Auth session and SSR cookies for the exact invited UUID/membership');

  // Test-only random password stays in memory; the product never creates/stores an employee password.
  const password = randomBytes(30).toString('base64url') + '!aA9';
  await updateOwnPassword(acceptedClient, password);
  await signOutAndClearIdentity(acceptedClient);
  assert.equal((await acceptedClient.auth.getUser()).data.user, null);
  const login = createClient(url, key, options);
  const identity = await signInWithEmail(login, email, password);
  assert.equal(identity.user.id, id);
  assert.equal(identity.memberships.length, 1);
  assert.equal(identity.memberships[0].tenant_id, fixtures.tenants.A.id);
  assert.equal(identity.memberships[0].role, 'employee');
  await login.auth.signOut();
  record('Invited identity sets its own Auth password, logs out and logs in normally with preserved membership');

  const replay = await confirm(link.properties.hashed_token, 'invite');
  assert.equal(new URL(replay.response.headers.get('location')).searchParams.get('auth'), 'callback-error');
  assert.equal(replay.jar.size, 0);
  const invalid = await confirm('f'.repeat(64), 'invite');
  assert.equal(new URL(invalid.response.headers.get('location')).searchParams.get('auth'), 'callback-error');
  assert.equal(invalid.jar.size, 0);
  record('Consumed and invalid real OTPs create no new session and redirect to a generic error');

  const recovery = check(await admin.auth.admin.generateLink({ type: 'recovery', email }), 'Generate recovery token');
  const recovered = await confirm(recovery.properties.hashed_token, 'recovery');
  assert.equal(new URL(recovered.response.headers.get('location')).pathname, '/auth/update-password');
  const recoveredClient = jarClient(recovered.jar).client;
  assert.equal(check(await recoveredClient.auth.getUser(), 'Recovery session').user.id, id);
  const newPassword = randomBytes(30).toString('base64url') + '!aA9';
  await updateOwnPassword(recoveredClient, newPassword);
  await signOutAndClearIdentity(recoveredClient);
  assert.ok((await login.auth.signInWithPassword({ email, password })).error);
  assert.equal((await signInWithEmail(login, email, newPassword)).user.id, id);
  await login.auth.signOut();
  record('Official recovery token establishes the correct SSR session; old password fails and new Auth password succeeds');

  const callbackAttack = await fetch(`${base}/auth/callback?${new URLSearchParams({ token_hash: 'a'.repeat(64), type: 'invite', tenant_id: fixtures.tenants.B.id })}`, { redirect: 'manual' });
  assert.equal(new URL(callbackAttack.headers.get('location')).searchParams.get('auth'), 'callback-error');
  const redirectAttack = await fetch(`${base}/auth/callback?${new URLSearchParams({ code: '0123456789', next: 'https://example.invalid' })}`, { redirect: 'manual' });
  assert.equal(new URL(redirectAttack.headers.get('location')).origin, new URL(base).origin);
  const foreign = await fetch(`${base}/auth/callback`, { method: 'POST', redirect: 'manual', headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token_hash: 'a'.repeat(64), type: 'invite' }) });
  assert.equal(new URL(foreign.headers.get('location')).searchParams.get('auth'), 'callback-error');
  record('Callback rejects tenant injection, foreign redirect and cross-origin confirmation');

  const input = { tenantId: fixtures.tenants.A.id, email: 'synthetic-invite@example.invalid', role: 'employee' };
  assert.equal(await api('employeeA', input), 403);
  assert.equal(await api('ownerA', { ...input, tenantId: fixtures.tenants.B.id }), 403);
  assert.equal(await api('managerA', { ...input, role: 'owner' }), 403);
  assert.equal(await api('ownerA', { ...input, role: 'owner' }), 403);
  assert.equal(await api('ownerA', { ...input, role: 'platform_admin' }), 400);
  for (const key of ['tenant_id', 'redirect', 'redirectTo', 'userId']) {
    assert.equal(await api('ownerA', { ...input, [key]: 'injected' }), 400);
  }
  assert.equal(await api('ownerA', { ...input, email: '<bad>@example.invalid' }), 400);
  record('Real invite endpoint rejects employee, foreign tenant, owner promotion and manipulated fields');

  assert.equal(await api('ownerA', input), 503);
  assert.equal(await api('ownerA', { ...input, role: 'manager' }), 503);
  assert.equal(await api('managerA', input), 503);
  record('Authorized owner/manager requests fail closed while the real email template remains unconfigured');

  const existing = await admin.auth.admin.generateLink({ type: 'invite', email: fixtures.users.ownerA.email });
  assert.ok(existing.error, 'A confirmed account is not silently re-invited or promoted');
  const ownerRow = check(await admin.from('tenant_memberships').select('tenant_id,role').eq('user_id', fixtures.users.ownerA.id), 'Existing owner unchanged');
  assert.deepEqual(ownerRow, [{ tenant_id: fixtures.tenants.A.id, role: 'owner' }]);
  record('Official Auth rejects invite generation for an existing confirmed identity; membership remains unchanged');
} catch (error) {
  console.error(`FAILED: ${error instanceof assert.AssertionError ? 'assertion failed in staging invitation check' : error.message?.replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted]')}`);
  process.exitCode = 1;
} finally {
  writeFileSync('docs/camada-1b-invite-mechanism-evidence.json', JSON.stringify({ ref, timestamp: new Date().toISOString(),
    phase: 'callback-mechanism-only', email_delivery_validated: false,
    email_delivery_required_for_production: true, results: evidence }, null, 2) + '\n');
}
