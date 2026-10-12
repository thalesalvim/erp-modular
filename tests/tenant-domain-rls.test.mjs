import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { read, additions, uid, tenant, users, ids, actor, fails, setup, insert, seed, grant } from './helpers/tenant-domain-fixture.mjs';

test('Phase 2A: actual SQL authorization in isolated PGlite, synthetic identities only', async t => {
  const db = await setup();
  try {
    const legacyAclSql = `SELECT c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity,a.attname,a.attacl
      FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0
      WHERE c.oid IN ('public.tenants'::regclass,'public.tenant_data'::regclass,'public.platform_admins'::regclass)
      ORDER BY c.relname,a.attnum`;
    const legacyAcl = (await db.query(legacyAclSql)).rows;
    const legacyBefore = await db.query("SELECT * FROM pg_policies WHERE tablename='tenant_data' ORDER BY policyname");
    const dataBefore = await db.query('SELECT tenant_id,payload FROM public.tenant_data ORDER BY tenant_id');
    for (const file of additions) await db.exec(await read(`supabase/migrations/${file}`));
    const emptyDomains = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'erp_%'");
    for (const { tablename } of emptyDomains.rows) assert.equal((await db.query(`SELECT count(*)::int n FROM public.${tablename}`)).rows[0].n, 0);
    await seed(db);
    const tableRows = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'erp_%' ORDER BY tablename");
    const tables = tableRows.rows.map(r => r.tablename);
    const catalog = (await db.query('SELECT * FROM private.erp_permission_catalog ORDER BY permission')).rows;
    const employeeGrants = catalog.filter(c => c.delegable_to.includes('employee')).map(c => c.permission);
    const managerGrants = catalog.filter(c => c.delegable_to.includes('manager')).map(c => c.permission);

    await t.test('legacy payload/grants preserved; only restrictive membership ceiling added; no backfill', async () => {
      assert.deepEqual((await db.query(legacyAclSql)).rows, legacyAcl);
      const policies = (await db.query("SELECT * FROM pg_policies WHERE tablename='tenant_data' ORDER BY policyname")).rows;
      assert.deepEqual(policies.filter(p => p.policyname !== 'tenant_data_membership_ceiling'), legacyBefore.rows);
      const ceiling = policies.filter(p => p.policyname === 'tenant_data_membership_ceiling');
      assert.equal(ceiling.length, 1);
      assert.equal(ceiling[0].permissive, 'RESTRICTIVE');
      assert.equal(ceiling[0].cmd, 'ALL');
      assert.deepEqual(ceiling[0].roles, ['authenticated']);
      assert.deepEqual((await db.query('SELECT tenant_id,payload FROM public.tenant_data ORDER BY tenant_id')).rows, dataBefore.rows);
      assert.equal((await db.query('SELECT count(*)::int n FROM private.erp_policy_state')).rows[0].n, 0);
      assert.equal((await db.query("SELECT has_any_column_privilege('authenticated','public.tenant_memberships','UPDATE') allowed")).rows[0].allowed,false);
    });
    await t.test('SQL catalog exactly matches all Phase 1 permissions, scopes, fields and ceilings', async () => {
      const require = createRequire(import.meta.url); const ts = require('typescript'); const loaded = { exports: {} };
      vm.runInNewContext(ts.transpileModule(await read('src/lib/permissions/policy.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: loaded, exports: loaded.exports });
      const expected = JSON.parse(JSON.stringify(loaded.exports.PERMISSIONS));
      assert.equal(catalog.length, Object.keys(expected).length);
      for (const row of catalog) {
        assert.deepEqual({ domain: row.domain, action: row.action, scope: row.scope, fields: row.fields, delegableTo: row.delegable_to }, expected[row.permission]);
      }
    });
    await t.test('every new public table has forced RLS; no anon or service_role operational grants', async () => {
      const flags = await db.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN (SELECT (schemaname||'.'||tablename)::regclass FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'erp_%')");
      assert.equal(flags.rows.length, 27);
      assert.ok(flags.rows.every(r => r.relrowsecurity && r.relforcerowsecurity));
      for (const table of tables) for (const role of ['anon', 'service_role']) {
        const p = await db.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed", [role, `public.${table}`]);
        assert.equal(p.rows[0].allowed, false, `${role} ${table}`);
      }
    });
    await t.test('anonymous access and unauthenticated RPC invocation are denied', async () => {
      for (const table of tables) await fails(() => actor(db, null, `SELECT * FROM public.${table}`, [], 'anon'), '42501');
      await fails(() => actor(db, null, 'SELECT public.erp_set_role_permissions($1,$2,$3,0)', [tenant.C, 'employee', []], 'anon'), '42501');
      for (const table of tables) assert.equal((await actor(db, null, `SELECT * FROM public.${table}`)).rows.length, 0);
    });
    await t.test('all Manager and Employee reads denied until explicit grants; platform admin is independent', async () => {
      for (const user of [users.manager, users.employee, users.admin, users.outsider]) for (const table of tables) {
        assert.equal((await actor(db, user, `SELECT * FROM public.${table}`)).rows.length, 0, table);
      }
    });
    await t.test('Owner reads only own tenant on every table, including finance', async () => {
      for (const user of [users.owner, users.ownerA, users.ownerB]) {
        const allowed = user === users.owner ? tenant.C : user === users.ownerA ? tenant.A : tenant.B;
        for (const table of tables) {
          const rows = (await actor(db, user, `SELECT * FROM public.${table}`)).rows;
          if (['erp_employee_schedules','erp_employee_roles','erp_promotion_targets','erp_sale_cmv'].includes(table)) assert.equal(rows.length, 0, table);
          else assert.ok(rows.length > 0, table);
          assert.ok(rows.every(r => r.tenant_id === allowed), table);
        }
      }
    });
    await t.test('Owner delegation persists atomically with revision and secret-free audit', async () => {
      const result = await grant(db, 'employee', employeeGrants);
      assert.equal(Number(result.rows[0].revision), 1);
      const audit = (await db.query('SELECT * FROM private.erp_permission_audit')).rows;
      assert.equal(audit.length, 1); assert.equal(audit[0].actor_user_id, users.owner);
      assert.deepEqual(audit[0].previous_permissions, []);
      assert.deepEqual([...audit[0].next_permissions].sort(), [...employeeGrants].sort());
      const cols = Object.keys(audit[0]);
      assert.deepEqual(cols.sort(), ['id','tenant_id','actor_user_id','target_role','previous_permissions','next_permissions','revision','recorded_at'].sort());
    });
    await t.test('Employee reads own/assigned records by Auth UUID despite identical employee names', async () => {
      for (const table of ['erp_appointments', 'erp_attendances', 'erp_sales', 'erp_employees', 'erp_customers']) {
        const rows = (await actor(db, users.employee, `SELECT * FROM public.${table}`)).rows;
        assert.equal(rows.length, 1, table); assert.equal(rows[0].tenant_id, tenant.C);
        if (table === 'erp_employees') assert.equal(rows[0].id, ids(tenant.C, 1));
        if (table === 'erp_customers') assert.equal(rows[0].id, ids(tenant.C, 11));
      }
      for (const table of tables) {
        const rows = (await actor(db, users.employee, `SELECT * FROM public.${table} WHERE tenant_id IN ($1,$2)`, [tenant.A, tenant.B])).rows;
        assert.equal(rows.length, 0, table);
      }
    });
    await t.test('Employee cannot read financial, private, colleague, contact or structured pending fields directly or through joins', async () => {
      const deniedTables = ['expenses','product_costs','product_stock','stock_moves','appointment_finance','attendance_finance','sale_finance','customer_contacts','customer_notes','employee_private','employee_schedules','employee_roles','appointment_notes','attendance_notes','sale_notes','sale_customers','promotion_targets'];
      for (const table of deniedTables) assert.equal((await actor(db, users.employee, `SELECT * FROM public.erp_${table}`)).rows.length, 0, table);
      const joined = (await actor(db, users.employee, `SELECT a.id,n.notes,f.price FROM public.erp_appointments a
        LEFT JOIN public.erp_appointment_notes n USING(tenant_id,id)
        LEFT JOIN public.erp_appointment_finance f USING(tenant_id,id)`)).rows;
      assert.equal(joined.length, 1); assert.equal(joined[0].notes, null); assert.equal(joined[0].price, null);
      const products = (await actor(db, users.employee, 'SELECT * FROM public.erp_products')).rows;
      assert.equal(products.length, 1); assert.equal('cost' in products[0], false);
    });
    await t.test('Manager financial access requires explicit Owner grant and never includes private notes', async () => {
      await grant(db, 'manager', ['appointments.read']);
      assert.equal((await actor(db, users.manager, 'SELECT * FROM public.erp_appointments')).rows.length, 3);
      assert.equal((await actor(db, users.manager, 'SELECT * FROM public.erp_expenses')).rows.length, 0);
      await grant(db, 'manager', managerGrants);
      assert.equal((await actor(db, users.manager, 'SELECT * FROM public.erp_expenses')).rows.length, 1);
      for (const table of ['customer_notes','employee_private','appointment_notes','attendance_notes','sale_notes']) {
        assert.equal((await actor(db, users.manager, `SELECT * FROM public.erp_${table}`)).rows.length, 0);
      }
      for (const table of tables) assert.ok((await actor(db, users.manager, `SELECT * FROM public.${table}`)).rows.every(r => r.tenant_id === tenant.C));
    });
    await t.test('privilege escalation, unknown grants, Master, other tenants and stale writes are rejected atomically', async () => {
      const before = (await db.query('SELECT * FROM private.erp_role_permissions ORDER BY tenant_id,role,permission')).rows;
      const revision = Number((await db.query('SELECT revision FROM private.erp_policy_state WHERE tenant_id=$1', [tenant.C])).rows[0].revision);
      for (const user of [users.manager, users.employee, users.admin, users.outsider]) await fails(() => grant(db, 'employee', ['products.read'], user), '42501');
      for (const permissions of [['finance.expenses.read'], ['products.read', '*'], ['master.read'], ['employees.update'], [null]]) await fails(() => grant(db, 'employee', permissions), '42501');
      for (const role of ['owner','platform_admin']) await fails(() => grant(db, role, []), '22023');
      await fails(() => grant(db, 'employee', [], users.owner, tenant.A), '42501');
      await fails(() => grant(db, 'employee', [], users.owner, tenant.C, revision - 1), '40001');
      assert.deepEqual((await db.query('SELECT * FROM private.erp_role_permissions ORDER BY tenant_id,role,permission')).rows, before);
      assert.equal(Number((await db.query('SELECT revision FROM private.erp_policy_state WHERE tenant_id=$1', [tenant.C])).rows[0].revision), revision);
      // Even a privileged fixture write cannot corrupt a role ceiling.
      await fails(() => db.query("INSERT INTO private.erp_role_permissions VALUES ($1,'employee','finance.expenses.read')", [tenant.C]), '23514');
    });
    await t.test('Owner, Manager and Employee cannot directly change grants, identity links, assignments or audit', async () => {
      for (const user of [users.owner, users.manager, users.employee]) {
        for (const table of ['erp_role_permissions','erp_policy_state','erp_permission_catalog','erp_permission_audit','erp_employee_auth_links','erp_customer_assignments']) {
          await fails(() => actor(db, user, `SELECT * FROM private.${table}`), '42501');
          await fails(() => actor(db, user, `DELETE FROM private.${table}`), '42501');
        }
        await fails(() => actor(db, user, "UPDATE public.tenant_memberships SET role='owner' WHERE user_id=$1", [user]), '42501');
        await fails(() => actor(db, user, 'INSERT INTO public.platform_admins(user_id) VALUES ($1)', [user]), '42501');
      }
    });
    await t.test('revocation, membership deactivation and tenant block take effect on the next statement', async () => {
      await grant(db, 'employee', []);
      assert.equal((await actor(db, users.employee, 'SELECT * FROM public.erp_appointments')).rows.length, 0);
      await grant(db, 'employee', employeeGrants);
      await db.query('UPDATE public.tenant_memberships SET is_active=false WHERE user_id=$1', [users.employee]);
      for (const table of tables) assert.equal((await actor(db, users.employee, `SELECT * FROM public.${table}`)).rows.length, 0);
      await db.query('UPDATE public.tenant_memberships SET is_active=true WHERE user_id=$1', [users.employee]);
      await db.query("UPDATE public.tenants SET status='Bloqueado' WHERE id=$1", [tenant.C]);
      for (const user of [users.owner, users.manager, users.employee]) assert.equal((await actor(db, user, 'SELECT * FROM public.erp_products')).rows.length, 0);
      await fails(() => grant(db, 'employee', []), '42501');
      await db.query("UPDATE public.tenants SET status='Ativo' WHERE id=$1", [tenant.C]);
    });
    await t.test('record reassignment revokes personal access; no Auth link grants no personal access', async () => {
      await db.query('UPDATE public.erp_appointments SET responsible_employee_id=$1 WHERE tenant_id=$2 AND id=$3', [ids(tenant.C, 3), tenant.C, ids(tenant.C, 31)]);
      assert.equal((await actor(db, users.employee, 'SELECT * FROM public.erp_appointments')).rows.length, 0);
      await db.query('UPDATE public.erp_appointments SET responsible_employee_id=$1 WHERE tenant_id=$2 AND id=$3', [ids(tenant.C, 1), tenant.C, ids(tenant.C, 31)]);
      await db.query('DELETE FROM private.erp_employee_auth_links WHERE tenant_id=$1 AND auth_user_id=$2', [tenant.C, users.employee]);
      assert.equal((await actor(db, users.employee, 'SELECT * FROM public.erp_appointments')).rows.length, 0);
      await db.query('INSERT INTO private.erp_employee_auth_links VALUES ($1,$2,$3)', [tenant.C, ids(tenant.C, 1), users.employee]);
    });
    await t.test('all client writes are closed; Owner product updates require the versioned command', async () => {
      for (const user of [users.owner, users.manager, users.employee]) {
        await fails(() => actor(db, user, 'INSERT INTO public.erp_products(tenant_id,id,name,price) VALUES ($1,$2,$3,$4)', [tenant.C,uid(999),'New',10]), '42501');
        await fails(() => actor(db, user, "UPDATE public.erp_products SET name='Denied'"), '42501');
        await fails(() => actor(db, user, 'DELETE FROM public.erp_products'), '42501');
      }
      const sql = "SELECT * FROM public.erp_update_product($1,$2,$3,$4::jsonb)";
      const args = [tenant.C,ids(tenant.C,23),1,JSON.stringify({name:'Updated'})];
      for (const user of [users.manager,users.employee]) await fails(() => actor(db,user,sql,args),'42501');
      assert.equal((await actor(db,users.owner,sql,args)).rows[0].version,2);
      await fails(() => actor(db,users.owner,sql,args),'40001');
    });
    await t.test('cross-tenant foreign keys reject references and membership links', async () => {
      await fails(() => db.query('INSERT INTO public.erp_sales(tenant_id,product_id,occurred_on,quantity,status) VALUES ($1,$2,current_date,1,$3)', [tenant.C, ids(tenant.A, 23), 'synthetic']), '23503');
      await fails(() => db.query('INSERT INTO private.erp_employee_auth_links VALUES ($1,$2,$3)', [tenant.C, ids(tenant.C, 3), users.ownerA]), '23503');
      await fails(() => db.query('INSERT INTO private.erp_customer_assignments VALUES ($1,$2,$3)', [tenant.C, ids(tenant.A, 11), ids(tenant.C, 1)]), '23503');
      await fails(() => insert(db, 'appointment_finance', tenant.C, ids(tenant.B, 31), { price: 1 }), '23503');
    });
    await t.test('identity, tenant and responsible-user changes cannot be forged through column updates', async () => {
      for (const user of [users.owner, users.manager, users.employee]) {
        for (const [col, value] of [['tenant_id', tenant.A], ['id', uid(999)], ['responsible_employee_id', ids(tenant.C, 2)]]) {
          await fails(() => actor(db, user, `UPDATE public.erp_appointments SET ${col}=$1`, [value]), '42501');
        }
      }
      await fails(() => db.query('UPDATE public.erp_products SET tenant_id=$1 WHERE tenant_id=$2', [tenant.A, tenant.C]), '23514');
    });
    await t.test('every inter-domain FK includes tenant identity and restricts deletion', async () => {
      const constraints = (await db.query(`SELECT c.conname,c.confrelid::regclass::text parent,c.confdeltype,
        array(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) cols
        FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
        WHERE c.contype='f' AND t.relname LIKE 'erp_%'`)).rows;
      assert.ok(constraints.length > 30);
      for (const c of constraints) {
        if (c.parent === 'private.erp_permission_catalog') continue;
        assert.equal(c.cols[0], 'tenant_id', c.conname);
        assert.equal(c.confdeltype, 'r', c.conname);
        if (c.parent !== 'tenants' && c.parent !== 'private.erp_policy_state'
          && c.parent !== 'private.erp_permission_catalog') assert.equal(c.cols.length, 2, c.conname);
      }
    });
    await t.test('numeric integrity, duplicate identity links and invalid promotion references fail', async () => {
      await fails(() => insert(db, 'expenses', tenant.C, uid(990), { occurred_on: '2026-10-10', description: 'x', amount: -1, category: 'x', status: 'x' }), '23514');
      await fails(() => db.query('UPDATE public.erp_attendance_finance SET discount=101 WHERE tenant_id=$1', [tenant.C]), '23514');
      await fails(() => db.query('INSERT INTO private.erp_employee_auth_links VALUES ($1,$2,$3)', [tenant.C, ids(tenant.C, 3), users.employee]), '23505');
      await fails(() => insert(db, 'promotion_targets', tenant.C, uid(990), { promotion_id: ids(tenant.C, 25), product_id: ids(tenant.C, 23), service_id: ids(tenant.C, 24) }), '23514');
    });
    await t.test('helpers and delegation work with trusted metadata ownership but without SUPERUSER or BYPASSRLS', async () => {
      await db.exec(`CREATE ROLE erp_metadata_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
        GRANT USAGE,CREATE ON SCHEMA private,public TO erp_metadata_owner;
        GRANT USAGE ON SCHEMA auth TO erp_metadata_owner;
        ALTER TABLE public.tenants OWNER TO erp_metadata_owner;
        ALTER TABLE public.tenant_memberships OWNER TO erp_metadata_owner;`);
      const privateTables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='private' AND tablename LIKE 'erp_%'")).rows;
      for (const { tablename } of privateTables) await db.exec(`ALTER TABLE private.${tablename} OWNER TO erp_metadata_owner`);
      const functions = (await db.query("SELECT p.oid::regprocedure::text signature FROM pg_proc p WHERE p.proname LIKE 'erp_%' AND p.prosecdef AND p.proname NOT IN ('erp_update_product','erp_read_own_appointments','erp_post_sale','erp_post_attendance','erp_validate_history','erp_set_employee_active','erp_guard_new_staff_operation')")).rows;
      for (const { signature } of functions) await db.exec(`ALTER FUNCTION ${signature} OWNER TO erp_metadata_owner`);
      assert.equal((await actor(db, users.employee, 'SELECT * FROM public.erp_appointments')).rows.length, 1);
      const agenda = (await actor(db, users.employee, 'SELECT * FROM public.erp_read_own_appointments($1)', [tenant.C])).rows;
      assert.equal(agenda.length, 1);
      assert.equal(agenda[0].clientName, 'Synthetic client 1');
      assert.equal(agenda[0].serviceName, 'Synthetic service');
      assert.equal((await actor(db, users.employee, 'SELECT * FROM public.erp_expenses')).rows.length, 0);
      await grant(db, 'manager', []);
      assert.equal((await actor(db, users.manager, 'SELECT * FROM public.erp_expenses')).rows.length, 0);
    });
    await t.test('definer helpers fix search_path and have no public/anonymous execution', async () => {
      const funcs = (await db.query("SELECT p.proname,p.proconfig,p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname LIKE 'erp_%' AND p.prosecdef")).rows;
      assert.ok(funcs.length >= 5);
      for (const f of funcs) {
        assert.ok(f.proconfig.includes('search_path=""'), f.proname);
        const p = await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS allowed", [f.oid]);
        assert.equal(p.rows[0].allowed, false, f.proname);
      }
    });
  } finally { await db.close(); }
});
