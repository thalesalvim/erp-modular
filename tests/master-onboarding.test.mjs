import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionFirstOwner, ProvisioningFailure } from '../src/lib/master/onboarding.ts';

const tenant = { id: 'new-tenant-c', slug: 'synthetic-c', status: 'Pendente' };
function backend(failAt, failCleanup = false) {
  const calls = [];
  const step = async (name, result) => { calls.push(name); if (name === failAt) throw new ProvisioningFailure(502, 'synthetic_failure'); return result; };
  return { calls, service: {
    createPendingTenant: () => step('tenant', tenant),
    inviteOwner: () => step('invitation', 'auth-owner-c'),
    createInactiveOwner: () => step('membership'),
    finalizeTenant: () => step('tenant-finalization', { ...tenant, status: 'Ativo' }),
    activateOwner: () => step('membership-activation'),
    removePendingTenant: async (id) => { assert.equal(id, tenant.id); calls.push('remove-pending'); if (failCleanup) throw new Error(); },
    keepTenantPending: async (id, userId) => { assert.equal(id, tenant.id); assert.equal(userId, 'auth-owner-c'); calls.push('deactivate-and-pend'); if (failCleanup) throw new Error(); },
  } };
}
test('Master activates the fixed owner only after tenant, Auth and inactive membership succeed', async () => {
  const { calls, service } = backend();
  const result = await provisionFirstOwner(service);
  assert.equal(result.ok, true);
  assert.deepEqual(result.owner, { userId: 'auth-owner-c', role: 'owner', invitationDispatched: true });
  assert.deepEqual(calls, ['tenant', 'invitation', 'membership', 'tenant-finalization', 'membership-activation']);
});
test('failed owner invitation compensates only the freshly created pending tenant', async () => {
  const { calls, service } = backend('invitation');
  const result = await provisionFirstOwner(service);
  assert.equal(result.ok, false);
  assert.equal(result.onboarding.retainedTenant, false);
  assert.equal(result.onboarding.invitationDispatched, false);
  assert.deepEqual(calls, ['tenant', 'invitation', 'remove-pending']);
});
test('failure after mail dispatch retains explicit pending state with owner disabled', async () => {
  for (const failure of ['membership', 'tenant-finalization', 'membership-activation']) {
    const { calls, service } = backend(failure);
    const result = await provisionFirstOwner(service);
    assert.equal(result.ok, false);
    assert.equal(result.onboarding.stage, failure);
    assert.equal(result.onboarding.tenantId, tenant.id);
    assert.equal(result.onboarding.membershipActive, false);
    assert.equal(result.onboarding.invitationDispatched, true);
    assert.equal(calls.at(-1), 'deactivate-and-pend');
    assert.match(result.error, /parcial/);
  }
});
test('compensation failure reports uncertainty and never reports a successful onboarding', async () => {
  const { service } = backend('membership-activation', true);
  const result = await provisionFirstOwner(service);
  assert.equal(result.ok, false);
  assert.equal(result.onboarding.cleanupFailed, true);
  assert.equal(result.onboarding.membershipActive, null);
});
