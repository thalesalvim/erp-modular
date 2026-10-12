import assert from 'node:assert/strict';
import test from 'node:test';
import { read, additions, setup, seed, actor, fails, grant, tenant, users, ids } from './helpers/tenant-domain-fixture.mjs';

test('coordinated recovery and schema seal in PGlite (no concurrency claim)', async t => {
  const db = await setup();
  try {
    for (const file of additions) await db.exec(await read(`supabase/migrations/${file}`));
    await seed(db);
    await grant(db, 'employee', ['products.read']);
    const staff = ids(tenant.C, 1);
    const recover = () => actor(db, users.owner,
      'SELECT * FROM public.erp_recover_employee_membership($1,$2,$3,2,3,true,$4)',
      [tenant.C, users.employee, staff, ['products.read']]);
    await t.test('deactivate then revoke can recover with two versions and a minimum ceiling', async () => {
      await actor(db, users.owner, 'SELECT * FROM public.erp_set_employee_active($1,$2,1,false,$3)', [tenant.C, staff, 'offboarding']);
      await actor(db, users.owner, 'SELECT * FROM public.erp_revoke_membership($1,$2,2,$3)', [tenant.C, users.employee, 'identity_review']);
      const result = (await recover()).rows[0];
      assert.equal(result.employee_version, 3);
      assert.equal(result.activity_revision, 4);
      assert.ok((await actor(db, users.employee, 'SELECT * FROM public.erp_products')).rows.length > 0);
      assert.equal((await actor(db, users.employee, 'SELECT * FROM public.erp_sale_finance')).rows.length, 0);
      assert.equal((await actor(db, users.employee, 'SELECT * FROM public.tenant_data')).rows.length, 0);
      await fails(recover, '40001');
    });
    await t.test('independent block leaves an audit gap and remains blocked', async () => {
      const peer = ids(tenant.C, 2);
      await actor(db, users.owner, 'SELECT * FROM public.erp_set_employee_active($1,$2,1,false,$3)', [tenant.C, peer, 'offboarding']);
      await db.query('UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id=$1 AND user_id=$2', [tenant.C, users.peer]);
      await actor(db, users.owner, 'SELECT * FROM public.erp_revoke_membership($1,$2,3,$3)', [tenant.C, users.peer, 'identity_review']);
      await fails(() => actor(db, users.owner, 'SELECT * FROM public.erp_recover_employee_membership($1,$2,$3,2,4,true,$4)',
        [tenant.C, users.peer, peer, ['products.read']]), '40001');
    });
    await db.exec(await read('supabase/recovery/phase-2a-enter-maintenance.sql'));
    await t.test('missing trigger rejects resume and preserves maintenance', async () => {
      await db.exec('BEGIN; DROP TRIGGER erp_guard_record ON public.erp_products');
      await fails(() => db.query('SELECT private.erp_assert_recovery_integrity()'), '55000');
      await db.exec('ROLLBACK');
      assert.equal((await db.query('SELECT maintenance FROM private.erp_runtime_control')).rows[0].maintenance, true);
    });
    await t.test('intact definitions resume without reopening legacy JSON', async () => {
      await db.exec(await read('supabase/recovery/phase-2a-resume-normalized.sql'));
      assert.equal((await db.query('SELECT maintenance FROM private.erp_runtime_control')).rows[0].maintenance, false);
      await fails(() => actor(db, users.employee, 'SELECT * FROM public.tenant_data'), '42501');
    });
  } finally { await db.close(); }
});
