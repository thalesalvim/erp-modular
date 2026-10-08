import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/auth/authorization.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports });
const { resolveMemberships, selectAuthorizedMembership, isTenantRole, mayInviteRole, roleLabel } = loaded.exports;

test('identity resolution accepts only active, recognized memberships with a matching tenant', () => {
  const tenant = { id: 'tenant-a', slug: 'empresa-a' };
  const memberships = resolveMemberships([
    { tenant_id: 'tenant-a', role: 'owner', is_active: true },
    { tenant_id: 'tenant-a', role: 'manager', is_active: false },
    { tenant_id: 'tenant-a', role: 'platform_admin', is_active: true },
    { tenant_id: 'tenant-missing', role: 'employee', is_active: true },
  ], [tenant]);

  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].tenant_id, 'tenant-a');
  assert.equal(memberships[0].role, 'owner');
  assert.equal(memberships[0].tenant.slug, 'empresa-a');
});

test('tenant selection is limited to the memberships already resolved for the user', () => {
  const authorized = { tenant_id: 'tenant-a', role: 'employee', is_active: true, tenant: { id: 'tenant-a' } };
  const memberships = [authorized];

  assert.equal(selectAuthorizedMembership(memberships, 'tenant-a'), authorized);
  assert.equal(selectAuthorizedMembership(memberships, 'tenant-b'), null);
});

test('invite roles follow the owner and manager hierarchy', () => {
  assert.equal(isTenantRole('owner'), true);
  assert.equal(isTenantRole('platform_admin'), false);
  assert.equal(mayInviteRole('owner', 'manager'), true);
  assert.equal(mayInviteRole('owner', 'employee'), true);
  assert.equal(mayInviteRole('manager', 'employee'), true);
  assert.equal(mayInviteRole('manager', 'manager'), false);
  assert.equal(mayInviteRole('employee', 'employee'), false);
  assert.equal(roleLabel('owner'), 'Dono');
});
