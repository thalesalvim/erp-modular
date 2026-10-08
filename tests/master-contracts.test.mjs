import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTenantMutation, isUuid } from '../src/lib/master/contracts.ts';

test('Master rejects credential and role/identity mass assignment', () => {
  for (const key of ['logins', 'id', 'tenant_id', 'slug', 'user_id', 'platform_admin', 'created_at', '__proto__']) {
    assert.throws(() => validateTenantMutation(JSON.parse(`{"${key}":"malicious"}`)));
  }
  assert.throws(() => validateTenantMutation({ slug: 'valid', company_name: 'A', logins: [] }, true));
  assert.ok(isUuid('12345678-1234-1234-1234-123456789012'));
  assert.ok(!isUuid('anything-or-eq'));
});

test('Master validates subscription and invoice content', () => {
  assert.deepEqual(validateTenantMutation({ status: 'Bloqueado', monthly_fee: 100 }), { status: 'Bloqueado', monthly_fee: 100 });
  for (const input of [{ status: 'anything' }, { monthly_fee: -1 }, { due_day: 40 }, { allowed_modules: { arbitrary: true } }, { allowed_modules: { team: 'true' } }]) {
    assert.throws(() => validateTenantMutation(input));
  }
  const invoice = { id: 'inv-1', referenceMonth: '2026-10', amount: 100, dueDate: '2026-10-10', status: 'Aberto' };
  assert.ok(validateTenantMutation({ invoices: [invoice] }));
  for (const changed of [{ ...invoice, receiptUrl: 'javascript:alert(1)' }, { ...invoice, receiptUrl: 'data:text/html;base64,abc' }, { ...invoice, cardLast4: '1234567890123456' }, { ...invoice, amount: NaN }]) {
    assert.throws(() => validateTenantMutation({ invoices: [changed] }));
  }
  assert.throws(() => validateTenantMutation({ invoices: [invoice, invoice] }));
});

test('Master creation allows supported fields and rejects missing or invalid identity', () => {
  assert.deepEqual(validateTenantMutation({ slug: 'synthetic-a', company_name: 'Synthetic A' }, true), { slug: 'synthetic-a', company_name: 'Synthetic A' });
  for (const input of [{ company_name: 'A' }, { slug: '../a', company_name: 'A' }, { slug: 'a', company_name: '' }, { slug: 'a', company_name: 'A', owner_email: 'bad' }]) {
    assert.throws(() => validateTenantMutation(input, true));
  }
});
