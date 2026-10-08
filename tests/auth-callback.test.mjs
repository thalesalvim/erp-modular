import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file, dependencies = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, URL, URLSearchParams,
    require: (name) => { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import: ${name}`); } });
  return loaded.exports;
}
const callbacks = load('../src/lib/auth/callback.ts');
const authorization = load('../src/lib/auth/authorization.ts');
const invitations = load('../src/lib/auth/invitations.ts', { './authorization': authorization });
const parse = (query) => callbacks.parseAuthCallback(new URLSearchParams(query));
const hash = 'a'.repeat(64);
const a = 'e9aa2efe-0102-4001-9000-00abc123abcd';

test('invitation and recovery tokens force password setup without a PKCE code', () => {
  for (const type of ['invite', 'recovery']) {
    const result = parse(`token_hash=${hash}&type=${type}&next=/equipe`);
    assert.equal(result.kind, 'otp');
    assert.equal(result.type, type);
    assert.equal(result.destination, '/auth/update-password');
  }
});

test('real PKCE callback remains separate from email OTP verification', () => {
  const result = parse('code=01234567-1234-1234-1234-0123456789ab&next=/auth/account');
  assert.equal(result.kind, 'pkce');
  assert.equal(result.destination, '/auth/account');
  assert.throws(() => parse(`code=0123456789&token_hash=${hash}&type=invite`));
});

test('callback rejects tenant, role, email and unrecognized OTP types', () => {
  for (const addition of ['tenant_id=tenant-b', 'tenantId=tenant-b', 'role=owner', 'email=other@example.invalid']) {
    assert.throws(() => parse(`token_hash=${hash}&type=invite&${addition}`));
  }
  for (const type of ['sms', 'phone_change', 'signup', 'arbitrary']) {
    assert.throws(() => parse(`token_hash=${hash}&type=${type}`));
  }
});

test('callback rejects missing, duplicate, malformed and oversized credentials', () => {
  for (const query of ['', 'type=invite', `token_hash=${hash}`, `token_hash=${hash}&type=invite&type=recovery`,
    `token_hash=${hash}&token_hash=${hash}&type=invite`, 'code=short', `token_hash=${'a'.repeat(513)}&type=invite`,
    `token_hash=<script>&type=invite`]) assert.throws(() => parse(query));
});

test('callback destinations reject alternate origins and encoded open redirects', () => {
  for (const next of ['https://example.invalid', '//example.invalid', '/\\example.invalid', '/%2f%2fexample.invalid',
    '/auth/account?next=https://example.invalid', '/equipe#fragment', '/unknown', '/\n/equipe']) {
    assert.throws(() => parse(`token_hash=${hash}&type=email&next=${encodeURIComponent(next)}`));
  }
  assert.equal(parse(`token_hash=${hash}&type=email&next=/equipe`).destination, '/equipe');
});

test('HTML confirmation escapes attribute delimiters', () => {
  assert.equal(callbacks.escapeHtml('<a "quoted" & \'single\'>'), '&lt;a &quot;quoted&quot; &amp; &#39;single&#39;&gt;');
});

test('invitation input forbids caller-selected identity, redirect and privileged fields', () => {
  const valid = { tenantId: a, email: ' Employee@Example.invalid ', role: 'employee' };
  assert.equal(invitations.parseInvitationInput(valid).email, 'employee@example.invalid');
  for (const key of ['userId', 'invited_by', 'tenant_id', 'redirect', 'redirectTo', 'platform_admin', 'is_active']) {
    assert.throws(() => invitations.parseInvitationInput({ ...valid, [key]: 'injected' }));
  }
  for (const email of ['bad', 'a\nb@example.invalid', '<a>@example.invalid', 'a'.repeat(250) + '@example.invalid']) {
    assert.throws(() => invitations.parseInvitationInput({ ...valid, email }));
  }
  assert.throws(() => invitations.parseInvitationInput({ ...valid, role: 'platform_admin' }));
  assert.throws(() => invitations.parseInvitationInput({ ...valid, tenantId: 'tenant-b' }));
});

test('invitation redirect uses only the reviewed server origin', () => {
  assert.equal(invitations.invitationRedirect('http://localhost:3000'), 'http://localhost:3000/auth/callback');
  assert.equal(invitations.invitationRedirect('https://staging.example.invalid'), 'https://staging.example.invalid/auth/callback');
  for (const origin of [undefined, 'http://remote.example.invalid', 'https://user:password@example.invalid',
    'https://staging.example.invalid/other', 'https://staging.example.invalid/?next=other', 'javascript:alert(1)']) {
    assert.throws(() => invitations.invitationRedirect(origin));
  }
});

test('owner/manager permissions cannot invite or promote to owner/platform admin', () => {
  assert.equal(authorization.mayInviteRole('owner', 'employee'), true);
  assert.equal(authorization.mayInviteRole('owner', 'manager'), true);
  assert.equal(authorization.mayInviteRole('manager', 'employee'), true);
  for (const actor of ['owner', 'manager', 'employee']) {
    assert.equal(authorization.mayInviteRole(actor, 'owner'), false);
    assert.equal(authorization.mayInviteRole(actor, 'platform_admin'), false);
  }
  assert.equal(authorization.mayInviteRole('employee', 'employee'), false);
});
