import assert from 'node:assert/strict';
import test from 'node:test';
import { read, additions, setup, seed, actor, fails, grant, tenant, users, ids } from './helpers/tenant-domain-fixture.mjs';

test('employee lifecycle and maintenance in isolated PGlite', async t => {
  const db = await setup();
  try {
    for (const file of additions) await db.exec(await read(`supabase/migrations/${file}`));
    await seed(db);
    await grant(db,'employee',['appointments.read_own','sales.read_own']);
    const staff = ids(tenant.C,1);
    const sql = 'SELECT * FROM public.erp_set_employee_active($1,$2,$3,$4,$5)';
    const change = (active,version,user=users.owner,target=tenant.C) => actor(db,user,sql,
      [target,staff,version,active,active?'authorized_return':'offboarding']);
    const before = (await db.query('SELECT * FROM public.erp_sales WHERE tenant_id=$1 ORDER BY id',[tenant.C])).rows;

    await t.test('deactivation changes only business access and keeps UUID relationships/history', async () => {
      const row = (await change(false,1)).rows[0];
      assert.equal(row.version,2); assert.equal(row.is_active,false); assert.equal(row.membership_active,false);
      assert.equal((await actor(db,users.employee,'SELECT * FROM public.erp_appointments')).rows.length,0);
      assert.equal((await actor(db,users.employee,'SELECT * FROM public.tenant_data')).rows.length,0);
      assert.deepEqual((await db.query('SELECT * FROM public.erp_sales WHERE tenant_id=$1 ORDER BY id',[tenant.C])).rows,before);
      assert.equal((await db.query('SELECT id FROM auth.users WHERE id=$1',[users.employee])).rows.length,1);
    });
    await t.test('unauthorized reactivation, tenant manipulation and raw metadata updates are denied', async () => {
      for (const user of [users.manager,users.employee,users.admin,users.outsider]) await fails(() => change(true,2,user),'42501');
      await fails(() => change(true,2,users.owner,tenant.A),'42501');
      await fails(() => actor(db,users.owner,'UPDATE private.erp_employee_lifecycle SET is_active=true'),'42501');
      await fails(() => change(false,1),'40001');
    });
    await t.test('independent membership enable cannot bypass inactive staff; conflict prevents reopening', async () => {
      await fails(() => db.query('UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id=$1 AND user_id=$2',[tenant.C,users.employee]),'42501');
      // A subsequent independent block still invalidates the saved restoration lease.
      await db.query('UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id=$1 AND user_id=$2',[tenant.C,users.employee]);
      assert.equal((await actor(db,users.employee,'SELECT * FROM public.erp_appointments')).rows.length,0);
      await fails(() => change(true,2),'40001');
      // A different linked colleague demonstrates authorized restoration without
      // fabricating a lease or undoing the independent change on the first subject.
      const peer = ids(tenant.C,2);
      await actor(db,users.owner,sql,[tenant.C,peer,1,false,'offboarding']);
      const restored = await actor(db,users.owner,sql,[tenant.C,peer,2,true,'authorized_return']);
      assert.equal(restored.rows[0].membership_active,true);
      assert.equal((await actor(db,users.peer,'SELECT * FROM public.erp_appointments')).rows.length,1);
    });
    await t.test('retention blocks Auth and employee deletion without cascading historical loss', async () => {
      await fails(() => db.query('DELETE FROM auth.users WHERE id=$1',[users.employee]),'23503');
      await fails(() => db.query('DELETE FROM public.erp_employees WHERE tenant_id=$1 AND id=$2',[tenant.C,staff]),'23503');
      await fails(() => db.exec('DELETE FROM private.erp_employee_lifecycle_audit'),'55000');
    });
    await t.test('maintenance closes SQL/JSON, verifies data and resumes only normalized access', async () => {
      await db.exec(await read('supabase/recovery/phase-2a-enter-maintenance.sql'));
      await fails(() => change(false,3),'42501');
      await fails(() => actor(db,users.employee,'SELECT payload FROM public.tenant_data'),'42501');
      await db.exec(await read('supabase/recovery/phase-2a-verify.sql'));
      assert.deepEqual((await db.query('SELECT * FROM public.erp_sales WHERE tenant_id=$1 ORDER BY id',[tenant.C])).rows,before);
      await db.exec(await read('supabase/recovery/phase-2a-resume-normalized.sql'));
      await fails(() => actor(db,users.employee,'SELECT payload FROM public.tenant_data'),'42501');
      assert.equal((await actor(db,users.employee,'SELECT * FROM public.erp_appointments')).rows.length,0);
      assert.equal((await actor(db,users.peer,'SELECT * FROM public.erp_appointments')).rows.length,1);
    });
  } finally { await db.close(); }
});
