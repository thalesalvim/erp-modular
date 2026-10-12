import assert from 'node:assert/strict';
import test from 'node:test';
import { read, additions, setup, seed, actor, fails, grant, tenant, users, ids, uid } from './helpers/tenant-domain-fixture.mjs';

test('M4: immutable historical snapshots in isolated PGlite', async t => {
  const db = await setup();
  try {
    for (const file of additions) await db.exec(await read(`supabase/migrations/${file}`));
    await seed(db);
    const saleId = uid(800001), attendanceId = uid(800002), invalidId = uid(800003);
    const saleSql = 'SELECT public.erp_post_sale($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) id';
    const saleArgs = [tenant.C,saleId,ids(tenant.C,23),1,ids(tenant.C,1),ids(tenant.C,11),'2026-10-11',2,'100','10','60','synthetic-evidence','synthetic','BRL'];
    const attendanceSql = 'SELECT public.erp_post_attendance($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) id';
    const attendanceArgs = [tenant.C,attendanceId,ids(tenant.C,24),1,ids(tenant.C,1),ids(tenant.C,11),'2026-10-11','09:00','100','10','synthetic','BRL'];
    const query = `SELECT s.product_name_snapshot,s.seller_name_snapshot,s.quantity,f.unit_price,f.gross_total,
      f.discount,f.total,c.unit_cost,c.total_cost,f.total-c.total_cost AS margin
      FROM public.erp_sales s JOIN public.erp_sale_finance f USING(tenant_id,id)
      JOIN public.erp_sale_cmv c USING(tenant_id,id) WHERE s.tenant_id=$1 AND s.id=$2`;
    let saleBefore;

    await t.test('incomplete previous records remain unknown without guessed historical costs', async () => {
      const row = (await db.query('SELECT history_state,product_name_snapshot FROM public.erp_sales WHERE tenant_id=$1 AND id=$2', [tenant.C,ids(tenant.C,41)])).rows[0];
      assert.equal(row.history_state,'incomplete'); assert.equal(row.product_name_snapshot,null);
      assert.equal((await db.query('SELECT count(*)::int n FROM public.erp_sale_cmv')).rows[0].n,0);
    });
    await t.test('Owner posts a complete sale with atomic monetary values and private audit', async () => {
      assert.equal((await actor(db,users.owner,saleSql,saleArgs)).rows[0].id,saleId);
      saleBefore = (await db.query(query,[tenant.C,saleId])).rows[0];
      assert.deepEqual(saleBefore,{ product_name_snapshot:'Synthetic product',seller_name_snapshot:'Same display name',quantity:2,
        unit_price:'100.00',gross_total:'200.00',discount:'10.00',total:'190.00',unit_cost:'60.00',total_cost:'120.00',margin:'70.00' });
      const audit = (await db.query('SELECT actor_user_id FROM private.erp_history_postings WHERE sale_id=$1',[saleId])).rows;
      assert.deepEqual(audit,[{actor_user_id:users.owner}]);
    });
    await t.test('catalog price/cost and name changes never rewrite historical revenue, CMV or margin', async () => {
      await actor(db,users.owner,'SELECT public.erp_update_product($1,$2,1,$3::jsonb,$4::jsonb)',
        [tenant.C,ids(tenant.C,23),JSON.stringify({name:'Renamed product',price:150}),JSON.stringify({cost:80})]);
      await db.query("UPDATE public.erp_employees SET name='Renamed professional' WHERE tenant_id=$1 AND id=$2",[tenant.C,ids(tenant.C,1)]);
      assert.deepEqual((await db.query(query,[tenant.C,saleId])).rows[0],saleBefore);
    });
    await t.test('attendance labels and practiced amounts survive service/professional renames', async () => {
      await actor(db,users.owner,attendanceSql,attendanceArgs);
      const sql = `SELECT a.service_name_snapshot,a.professional_name_snapshot,a.client_name_snapshot,f.gross_value,f.discount,f.net_value
        FROM public.erp_attendances a JOIN public.erp_attendance_finance f USING(tenant_id,id) WHERE a.tenant_id=$1 AND a.id=$2`;
      const before = (await db.query(sql,[tenant.C,attendanceId])).rows;
      assert.equal(before[0].professional_name_snapshot,'Renamed professional');
      await db.query("UPDATE public.erp_services SET name='New service',price=300 WHERE tenant_id=$1 AND id=$2",[tenant.C,ids(tenant.C,24)]);
      await db.query("UPDATE public.erp_employees SET name='Another professional label' WHERE tenant_id=$1 AND id=$2",[tenant.C,ids(tenant.C,1)]);
      assert.deepEqual((await db.query(sql,[tenant.C,attendanceId])).rows,before);
      await fails(() => db.query('UPDATE public.erp_attendances SET status=$1 WHERE tenant_id=$2 AND id=$3',['cancelled',tenant.C,attendanceId]),'55000');
    });
    await t.test('roles/foreign tenants deny posting and revenue-only grants do not reveal CMV', async () => {
      for (const user of [users.manager,users.employee,users.admin,users.outsider]) await fails(() => actor(db,user,saleSql,saleArgs),'42501');
      await fails(() => actor(db,users.owner,saleSql,[tenant.A,...saleArgs.slice(1)]),'42501');
      await grant(db,'manager',['finance.sales.read','finance.products.cost.read']);
      await grant(db,'employee',['sales.read_own','attendances.read_own']);
      assert.equal((await actor(db,users.manager,'SELECT * FROM public.erp_sale_cmv')).rows.length,0);
      assert.equal((await actor(db,users.employee,'SELECT * FROM public.erp_sale_cmv')).rows.length,0);
      assert.equal((await actor(db,users.employee,'SELECT product_name_snapshot FROM public.erp_sales WHERE id=$1',[saleId])).rows[0].product_name_snapshot,'Synthetic product');
      await fails(() => actor(db,users.owner,'UPDATE public.erp_sales SET product_name_snapshot=$1 WHERE id=$2',['forged',saleId]),'42501');
      await fails(() => actor(db,users.owner,'SELECT * FROM private.erp_history_postings'),'42501');
    });
    await t.test('posted records are immutable and invalid cents or missing cost leave no partial records', async () => {
      await fails(() => db.query('UPDATE public.erp_sale_cmv SET unit_cost=0 WHERE id=$1',[saleId]),'55000');
      for (const cost of [null,'1.001','NaN','Infinity']) {
        const args = [...saleArgs]; args[1]=invalidId; args[3]=2; args[10]=cost;
        await fails(() => actor(db,users.owner,saleSql,args),'22023');
      }
      assert.equal((await db.query('SELECT count(*)::int n FROM public.erp_sales WHERE id=$1',[invalidId])).rows[0].n,0);
      await fails(() => actor(db,users.owner,saleSql,[...saleArgs.slice(0,3),2,...saleArgs.slice(4)]),'23505');
      assert.deepEqual((await db.query(query,[tenant.C,saleId])).rows[0],saleBefore);
    });
    await t.test('missing monetary fragments fail deferred validation and rollback the root', async () => {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[users.owner]);
      try {
        await fails(() => db.query(`INSERT INTO public.erp_sales(tenant_id,id,product_id,seller_employee_id,occurred_on,quantity,status,
          history_state,product_name_snapshot,product_version_snapshot,seller_name_snapshot,posted_at)
          VALUES($1,$2,$3,$4,'2026-10-11',2,'posted','posted','Synthetic product',2,'Synthetic professional',clock_timestamp())`,
        [tenant.C,invalidId,ids(tenant.C,23),ids(tenant.C,1)]),'23514');
      } finally { await db.query("SELECT set_config('request.jwt.claim.sub','',false)"); }
      assert.equal((await db.query('SELECT count(*)::int n FROM public.erp_sales WHERE id=$1',[invalidId])).rows[0].n,0);
    });
  } finally { await db.close(); }
});
