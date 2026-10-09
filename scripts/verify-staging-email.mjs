// Real SMTP request and identity checks, exclusively for the designated staging.
// A successful SMTP/API response never substitutes for receipt in the real mailbox.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const ref = 'gbblkkgowccjycxtexvx';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const base = process.env.STAGING_APP_URL || 'http://localhost:3000';
const email = process.env.STAGING_TEST_EMAIL?.trim().toLowerCase();
const mode = process.argv[2];
assert.equal(url, `https://${ref}.supabase.co`);
assert.equal(JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64url')).ref, ref);
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
assert.ok(['invite', 'inspect', 'recovery'].includes(mode));
assert.ok(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
const fixtures = JSON.parse(readFileSync('.env.staging-fixtures.json', 'utf8'));
assert.equal(fixtures.ref, ref);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceKey, options);
const evidencePath = 'docs/camada-1c-email-evidence.json';
const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : { ref, base, checks: [] };
assert.equal(evidence.ref, ref);
function record(name, details = {}) {
  const item = { name, checkedAt: new Date().toISOString(), ...details };
  evidence.checks.push(item);
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(item));
}
function check(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.code || result.error.status || 'failed'}`);
  return result.data;
}
async function invitedUser() {
  for (let page = 1; page <= 10; page++) {
    const users = check(await admin.auth.admin.listUsers({ page, perPage: 100 }), 'Read staging identities').users;
    const found = users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (users.length < 100) return null;
  }
  throw new Error('Identity pagination bound exceeded');
}
async function caller(label) {
  const jar = new Map();
  const client = createServerClient(url, key, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => cookies.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
  }, auth: { autoRefreshToken: false } });
  const actor = fixtures.users[label];
  check(await client.auth.signInWithPassword({ email: actor.email, password: actor.password }), 'Synthetic caller sign-in');
  const request = async (tenantId) => {
    const response = await fetch(`${base}/api/team/invite`, {
      method: 'POST', redirect: 'manual', headers: {
        Origin: new URL(base).origin, 'Content-Type': 'application/json',
        Cookie: [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; '),
      }, body: JSON.stringify({ tenantId, email, role: 'employee' }),
    });
    const data = await response.json();
    assert.ok(!JSON.stringify(data).includes(serviceKey));
    assert.ok(!['password', 'token_hash', 'action_link'].some((field) => field in data));
    return { status: response.status, data };
  };
  return { request, close: () => client.auth.signOut({ scope: 'local' }) };
}

try {
  if (mode === 'invite') {
    assert.equal(await invitedUser(), null, 'Real test account already exists; do not reinvite or overwrite it');
    const employee = await caller('employeeA');
    assert.equal((await employee.request(fixtures.tenants.A.id)).status, 403);
    await employee.close();
    record('Employee cannot dispatch an administrative invitation', { outcome: 'PASS' });
    const owner = await caller('ownerA');
    assert.equal((await owner.request(fixtures.tenants.B.id)).status, 403);
    record('Owner A cannot invite into company B', { outcome: 'PASS' });
    const result = await owner.request(fixtures.tenants.A.id);
    await owner.close();
    record('Owner A real invitation SMTP request', { status: result.status, deliveryConfirmed: false });
    assert.equal(result.status, 201, 'Invitation was not accepted by the application/Auth SMTP path');
    assert.equal(result.data.accepted, true);
    const rows = check(await admin.from('tenant_memberships').select('tenant_id,role,is_active').eq('user_id', result.data.userId), 'Invited membership');
    assert.deepEqual(rows, [{ tenant_id: fixtures.tenants.A.id, role: 'employee', is_active: true }]);
    record('Invited UUID has exactly employee membership A', { outcome: 'PASS' });
  } else {
    const user = await invitedUser();
    assert.ok(user, 'The real test account does not exist');
    const rows = check(await admin.from('tenant_memberships').select('tenant_id,role,is_active').eq('user_id', user.id), 'Read invited membership');
    assert.deepEqual(rows, [{ tenant_id: fixtures.tenants.A.id, role: 'employee', is_active: true }]);
    record('Real invited identity state', {
      confirmed: Boolean(user.email_confirmed_at), lastSignInAt: user.last_sign_in_at || null,
      invitationSentAt: user.invited_at || null, recoverySentAt: user.recovery_sent_at || null,
      membership: { company: 'A', role: 'employee', active: true },
    });
    if (mode === 'recovery') {
      assert.ok(user.email_confirmed_at, 'Accept the actual invitation before requesting recovery');
      const client = createClient(url, key, options);
      check(await client.auth.resetPasswordForEmail(email, { redirectTo: `${base}/auth/callback` }), 'Real recovery SMTP request');
      record('Real recovery SMTP request', { accepted: true, deliveryConfirmed: false });
    }
  }
} catch (error) {
  // Deliberately omit SDK payloads, tokens, recipient and credentials.
  console.error(error instanceof assert.AssertionError ? 'Staging email assertion failed; review the last non-sensitive evidence.' : 'Staging email operation failed; inspect staging Auth/provider logs without exposing secrets.');
  process.exitCode = 1;
}
