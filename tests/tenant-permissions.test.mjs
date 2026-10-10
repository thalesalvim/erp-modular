import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/permissions/policy.ts', import.meta.url), 'utf8');
const loaded = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: loaded, exports: loaded.exports });
const { PERMISSIONS, uuid, authorize, planDelegation, projectRecord } = loaded.exports;
const C = uuid('278503c5-d2ac-4556-826b-7f9aa6dc3301');
const A = uuid('00000000-0000-4000-8000-00000000000a');
const B = uuid('00000000-0000-4000-8000-00000000000b');
const user = uuid('00000000-0000-4000-8000-000000000001');
const other = uuid('00000000-0000-4000-8000-000000000002');
const all = Object.keys(PERMISSIONS);
const scope = { tenantId: C, subjectUserId: user, assignedUserIds: [user] };
const ctx = (role = 'employee', grants = []) => ({
  userId: user, membership: { userId: user, tenantId: C, role, active: true },
  tenantActive: true, currentRevision: 4,
  policy: { tenantId: C, revision: 4, grants: { manager: grants, employee: grants } },
});
const denied = result => {
  assert.equal(result.status, 'denied');
  assert.equal(result.code, 'ACCESS_DENIED');
  assert.equal('items' in result, false);
};

test('default deny: anonymous, unknown names, wildcard, prototype keys and platform permissions', () => {
  for (const p of all) denied(authorize(null, p, scope));
  for (const p of ['*', 'toString', '__proto__', 'master.read', 'platform_admin', 'expenses.read']) {
    denied(authorize(ctx('owner'), p, scope));
  }
  for (const p of all) denied(authorize(ctx('platform_admin', all), p, scope));
});
test('every permission defaults off for Manager and Employee; Owner retains catalog authority', () => {
  for (const p of all) {
    for (const role of ['manager', 'employee']) denied(authorize(ctx(role), p, scope));
    assert.equal(authorize(ctx('owner'), p, scope).status, 'allowed', p);
  }
});
test('even corrupt grants cannot exceed role ceilings, including every sensitive Employee field group', () => {
  for (const role of ['manager', 'employee']) {
    for (const [p, rule] of Object.entries(PERMISSIONS)) {
      assert.equal(authorize(ctx(role, all), p, scope).status,
        rule.delegableTo.includes(role) ? 'allowed' : 'denied', `${role}: ${p}`);
    }
  }
  for (const p of all.filter(p => p.startsWith('finance.') || p.includes('private'))) {
    denied(authorize(ctx('employee', all), p, scope));
  }
});
test('Owner delegation is tenant bound, bounded by role and atomic on invalid requests', () => {
  const owner = ctx('owner');
  assert.equal(planDelegation(owner, C, 'manager', ['finance.expenses.read']).status, 'allowed');
  const grant = planDelegation(owner, C, 'employee', ['appointments.read_own', 'appointments.read_own']);
  assert.equal(grant.status, 'allowed');
  assert.equal(grant.expectedRevision, 4);
  assert.equal(grant.grants.length, 1);
  assert.equal(planDelegation(owner, C, 'employee', []).grants.length, 0);
  for (const p of ['finance.expenses.read', 'customers.private_notes.read', '*', 'master.read', 'employees.update']) {
    denied(planDelegation(owner, C, 'employee', ['appointments.read_own', p]));
  }
  for (const role of ['owner', 'platform_admin', '__proto__']) denied(planDelegation(owner, C, role, []));
  denied(planDelegation(owner, A, 'manager', []));
});
test('Manager cannot subdelegate, self-promote or grant even a permission they already possess', () => {
  for (const role of ['manager', 'employee']) {
    for (const target of ['owner', 'manager', 'employee', 'platform_admin']) {
      denied(planDelegation(ctx(role, all), C, target, ['products.read']));
    }
  }
});
test('tenant C context cannot access A/B under any role or permission', () => {
  for (const role of ['owner', 'manager', 'employee']) for (const p of all) for (const tenantId of [A, B]) {
    denied(authorize(ctx(role, all), p, { ...scope, tenantId }));
  }
});
test('inactive membership, mismatched identity, inactive tenant and stale revisions deny', () => {
  const mutations = [
    c => { c.membership.active = false; }, c => { c.tenantActive = false; },
    c => { c.membership.userId = other; }, c => { c.membership.tenantId = A; },
    c => { c.policy.tenantId = B; }, c => { c.currentRevision = 5; },
    c => { c.currentRevision = c.policy.revision = -1; },
    c => { c.currentRevision = c.policy.revision = 1.5; },
  ];
  for (const mutate of mutations) {
    const c = ctx('owner'); mutate(c);
    denied(authorize(c, 'products.read', scope));
    denied(planDelegation(c, C, 'employee', []));
  }
});
test('revocation is immediate with fresh context; old cached policy never authorizes', () => {
  const c = ctx('employee', ['appointments.read_own']);
  assert.equal(authorize(c, 'appointments.read_own', scope).status, 'allowed');
  c.currentRevision++;
  denied(authorize(c, 'appointments.read_own', scope));
  c.policy.revision++; c.policy.grants.employee = [];
  denied(authorize(c, 'appointments.read_own', scope));
});
test('own records require verified Auth UUID: names, null links and other professionals cannot substitute', () => {
  for (const p of ['employees.read_own', 'appointments.read_own', 'attendances.read_own', 'sales.read_own']) {
    const c = ctx('employee', [p]);
    assert.equal(authorize(c, p, scope).status, 'allowed');
    for (const subjectUserId of [other, null, undefined, 'Owner C']) {
      denied(authorize(c, p, { tenantId: C, subjectUserId, professionalName: 'Owner C' }));
    }
  }
  assert.throws(() => uuid('Owner C'), /Invalid UUID/);
});
test('assigned customers require verified relationship; assignment is not inferred from names', () => {
  const c = ctx('employee', ['customers.read_assigned']);
  assert.equal(authorize(c, 'customers.read_assigned', scope).status, 'allowed');
  for (const assignedUserIds of [[], [other], undefined]) {
    denied(authorize(c, 'customers.read_assigned', { tenantId: C, assignedUserIds }));
  }
});
test('enabled modules, fake metadata role and claimed tenant do not confer authority', () => {
  const c = { ...ctx(), allowed_modules: ['finance'], role: 'owner', user_metadata: { role: 'platform_admin' } };
  denied(authorize(c, 'finance.expenses.read', scope));
  denied(authorize(c, 'products.read', { ...scope, tenantId: A }));
});
test('every read contract strips forbidden and unknown fields before serialization', () => {
  for (const [p, rule] of Object.entries(PERMISSIONS).filter(([, r]) => r.action === 'read')) {
    const source = Object.fromEntries(rule.fields.map(field => [field, field === 'id' ? user : 'safe']));
    Object.assign(source, { secret: 'FORBIDDEN', payload: { expenses: ['FORBIDDEN'] }, tenant_id: A });
    const result = projectRecord(ctx('owner'), p, scope, source);
    assert.equal(result.status, 'allowed', p);
    assert.deepEqual(Object.keys(result.items[0]).sort(), [...rule.fields].sort());
    assert.equal(JSON.stringify(result).includes('FORBIDDEN'), false);
  }
});
test('Employee DTO excludes financials, notes, contact details and colleague fields even if present', () => {
  const p = 'appointments.read_own';
  const data = { id: user, date: '2026-10-10', time: '09:00', clientName: 'Synthetic', serviceName: 'Service', status: 'booked',
    price: 100, notes: 'PRIVATE', professionalName: 'OTHER', expenses: ['PRIVATE'], cost: 90 };
  const result = projectRecord(ctx('employee', [p]), p, scope, data);
  assert.equal(result.status, 'allowed');
  for (const field of ['price', 'notes', 'professionalName', 'expenses', 'cost']) assert.equal(field in result.items[0], false);
  denied(projectRecord(ctx('employee', [p]), p, { ...scope, subjectUserId: other }, data));
});
test('nested payloads, missing fields, non-finite numbers and inherited fields fail closed', () => {
  const p = 'customers.read_assigned';
  for (const data of [{ id: user, name: { private: 'secret' } }, { id: user },
    { id: user, name: Infinity }, Object.create({ id: user, name: 'inherited' })]) {
    denied(projectRecord(ctx('employee', [p]), p, scope, data));
  }
  denied(projectRecord(ctx('owner'), 'customers.delete', scope, {}));
});
test('denied response cannot be interpreted as an authorized empty collection', () => {
  const result = projectRecord(ctx(), 'products.read', scope, {});
  denied(result);
  const empty = { status: 'allowed', permission: 'products.read', tenantId: C, policyRevision: 4, items: [] };
  assert.notEqual(result.status, empty.status);
  assert.equal('items' in result, false);
});
test('role ceilings and projection fields cannot be mutated at runtime', () => {
  assert.throws(() => { PERMISSIONS['finance.expenses.read'].delegableTo.push('employee'); });
  assert.throws(() => { PERMISSIONS['appointments.read_own'].fields.push('notes'); });
  assert.throws(() => { PERMISSIONS['finance.expenses.read'].scope = 'own'; });
  assert.throws(() => { PERMISSIONS['master.read'] = PERMISSIONS['products.read']; });
  denied(authorize(ctx('employee', all), 'finance.expenses.read', scope));
});
test('documented read matrix agrees with every permission, scope, field and delegation ceiling', () => {
  const doc = readFileSync(new URL('../docs/tenant-permissions-phase-1.md', import.meta.url), 'utf8');
  for (const [p, rule] of Object.entries(PERMISSIONS).filter(([, rule]) => rule.action === 'read')) {
    const row = `| \`${p}\` | ${rule.scope} | ${rule.fields.join(', ')} | O | ${rule.delegableTo.includes('manager') ? 'D' : '—'} | ${rule.delegableTo.includes('employee') ? 'D' : '—'} |`;
    assert.ok(doc.includes(row), p);
  }
});
