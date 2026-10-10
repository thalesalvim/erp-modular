import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrations = [
  '20261008020335_security_identity_memberships.sql',
  '20261008020339_security_tenant_data_identity.sql',
  '20261008020344_security_rls_policies.sql',
];
const additions = [
  '20261010060000_erp_permissions.sql',
  '20261010060100_erp_domains.sql',
  '20261010060200_erp_domain_rls.sql',
];
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = { A: uid(101), B: uid(102), C: uid(103) };
const users = { owner: uid(1), manager: uid(2), employee: uid(3), peer: uid(4), admin: uid(5), outsider: uid(6), ownerA: uid(7), ownerB: uid(8) };
const ids = (t, n) => uid(Number(t.slice(-3)) * 100 + n);

async function actor(db, user, sql, params = [], role = 'authenticated') {
  assert.ok(['authenticated', 'anon'].includes(role));
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  try { return await db.query(sql, params); }
  finally {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}
const fails = (fn, code) => assert.rejects(fn, error => error.code === code);
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE supabase_admin NOLOGIN;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
  await db.exec(await read('supabase/baseline/public-before-0.5.sql'));
  for (const file of migrations) await db.exec(await read(`supabase/migrations/${file}`));
  for (const user of Object.values(users)) await db.query('INSERT INTO auth.users VALUES ($1)', [user]);
  for (const [label, id] of Object.entries(tenant)) {
    await db.query("INSERT INTO public.tenants(id,slug,company_name,status) VALUES ($1,$2,$3,'Ativo')", [id, `synthetic-${label}`, `Synthetic ${label}`]);
    await db.query("INSERT INTO public.tenant_data(tenant_id,tenant_slug,data_key,payload) VALUES ($1,$2,'all_data',$3)", [id, `synthetic-${label}`, JSON.stringify({ untouched: label })]);
  }
  for (const [user, t, role] of [[users.owner, tenant.C, 'owner'], [users.manager, tenant.C, 'manager'],
    [users.employee, tenant.C, 'employee'], [users.peer, tenant.C, 'employee'], [users.ownerA, tenant.A, 'owner'], [users.ownerB, tenant.B, 'owner']]) {
    await db.query('INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES ($1,$2,$3)', [t, user, role]);
  }
  await db.query('INSERT INTO public.platform_admins(user_id) VALUES ($1)', [users.admin]);
  await db.exec("SET handyhub.cutover_ready = 'yes'");
  await db.exec(await read('supabase/activation/camada-1-cutover.sql'));
  return db;
}
async function insert(db, table, t, id, data) {
  const row = { tenant_id: t, id, ...data };
  const cols = Object.keys(row);
  await db.query(`INSERT INTO public.erp_${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
}
async function seed(db) {
  for (const t of Object.values(tenant)) {
    const id = n => ids(t, n);
    for (const n of [1, 2, 3]) {
      await insert(db, 'employees', t, id(n), { name: 'Same display name' });
      await insert(db, 'customers', t, id(10 + n), { name: `Synthetic client ${n}` });
    }
    await insert(db, 'customer_contacts', t, id(11), { phone: 'SYNTHETIC_PRIVATE' });
    await insert(db, 'customer_notes', t, id(11), { notes: 'SYNTHETIC_PRIVATE' });
    await insert(db, 'employee_private', t, id(2), { phone: 'SYNTHETIC_PRIVATE', email: 'synthetic@example.invalid' });
    await insert(db, 'employee_schedules', t, id(20), { employee_id: id(2), day_index: 1, is_working: true, open_time: '09:00', close_time: '17:00' });
    await insert(db, 'professional_roles', t, id(21), { name: 'Professional function, not Auth role' });
    await insert(db, 'employee_roles', t, id(22), { employee_id: id(2), role_id: id(21) });
    await insert(db, 'products', t, id(23), { name: 'Synthetic product', category: 'test', price: 100 });
    await insert(db, 'product_costs', t, id(23), { cost: 70 });
    await insert(db, 'product_stock', t, id(23), { initial_stock: 10, min_stock: 2 });
    await insert(db, 'services', t, id(24), { name: 'Synthetic service', duration_minutes: 30, price: 100, assigned_role_id: id(21) });
    await insert(db, 'promotions', t, id(25), { title: 'Synthetic', discount_percent: 10 });
    await insert(db, 'promotion_targets', t, id(26), { promotion_id: id(25), product_id: id(23) });
    for (const n of [1, 2, 3]) {
      for (const table of ['appointments', 'attendances']) await insert(db, table, t, id(30 + n), {
        customer_id: id(10 + n), service_id: id(24), responsible_employee_id: n === 3 ? null : id(n),
        occurred_on: '2026-10-10', occurred_at: '09:00', status: 'synthetic',
      });
      await insert(db, 'sales', t, id(40 + n), { product_id: id(23), seller_employee_id: n === 3 ? null : id(n), occurred_on: '2026-10-10', quantity: 1, status: 'synthetic' });
    }
    await insert(db, 'appointment_finance', t, id(31), { price: 100 });
    await insert(db, 'appointment_notes', t, id(31), { notes: 'SYNTHETIC_PRIVATE' });
    await insert(db, 'attendance_finance', t, id(31), { gross_value: 100, discount: 10, net_value: 90, payment_method: 'synthetic' });
    await insert(db, 'attendance_notes', t, id(31), { notes: 'SYNTHETIC_PRIVATE' });
    await insert(db, 'sale_customers', t, id(41), { customer_id: id(11) });
    await insert(db, 'sale_finance', t, id(41), { unit_price: 100, total: 100, payment_method: 'synthetic' });
    await insert(db, 'sale_notes', t, id(41), { notes: 'SYNTHETIC_PRIVATE' });
    await insert(db, 'stock_moves', t, id(50), { product_id: id(23), type: 'Entrada', quantity: 1 });
    await insert(db, 'expenses', t, id(51), { occurred_on: '2026-10-10', description: 'SYNTHETIC_PRIVATE', amount: 40, category: 'management', status: 'synthetic' });
  }
  for (const [n, user] of [[1, users.employee], [2, users.peer]]) {
    await db.query('INSERT INTO private.erp_employee_auth_links VALUES ($1,$2,$3)', [tenant.C, ids(tenant.C, n), user]);
    await db.query('INSERT INTO private.erp_customer_assignments VALUES ($1,$2,$3)', [tenant.C, ids(tenant.C, 10 + n), ids(tenant.C, n)]);
  }
}
async function grant(db, role, permissions, as = users.owner, target = tenant.C, expected) {
  const state = await db.query('SELECT revision FROM private.erp_policy_state WHERE tenant_id=$1', [target]);
  const rev = expected ?? Number(state.rows[0]?.revision ?? 0);
  return actor(db, as, 'SELECT public.erp_set_role_permissions($1,$2,$3::text[],$4) AS revision', [target, role, permissions, rev]);
}

test('Phase 2A: actual SQL authorization in isolated PGlite, synthetic identities only', async t => {
  const db = await setup();
  try {
    const legacyAclSql = `SELECT c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity,a.attname,a.attacl
      FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0
      WHERE c.oid IN ('public.tenants'::regclass,'public.tenant_data'::regclass,'public.tenant_memberships'::regclass,'public.platform_admins'::regclass)
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

    await t.test('legacy payload, grants and policies remain unchanged; no backfill occurred', async () => {
      assert.deepEqual((await db.query(legacyAclSql)).rows, legacyAcl);
      assert.deepEqual((await db.query("SELECT * FROM pg_policies WHERE tablename='tenant_data' ORDER BY policyname")).rows, legacyBefore.rows);
      assert.deepEqual((await db.query('SELECT tenant_id,payload FROM public.tenant_data ORDER BY tenant_id')).rows, dataBefore.rows);
      assert.equal((await db.query('SELECT count(*)::int n FROM private.erp_policy_state')).rows[0].n, 0);
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
      assert.equal(flags.rows.length, 26);
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
          if (['erp_employee_schedules','erp_employee_roles','erp_promotion_targets'].includes(table)) assert.equal(rows.length, 0, table);
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
    await t.test('Owner CRUD is tenant restricted; Manager and Employee writes remain denied', async () => {
      const data = [tenant.C, uid(999), 'New', 10];
      const sql = 'INSERT INTO public.erp_products(tenant_id,id,name,price) VALUES ($1,$2,$3,$4) RETURNING id';
      for (const user of [users.manager, users.employee]) await fails(() => actor(db, user, sql, data), '42501');
      await fails(() => actor(db, users.owner, sql, [tenant.A, uid(999), 'Denied', 10]), '42501');
      assert.equal((await actor(db, users.owner, sql, data)).rows.length, 1);
      assert.equal((await actor(db, users.owner, "UPDATE public.erp_products SET name='Updated' WHERE id=$1 RETURNING version", [uid(999)])).rows[0].version, 2);
      for (const user of [users.manager, users.employee]) {
        assert.equal((await actor(db, user, "UPDATE public.erp_products SET name='Denied' RETURNING id")).rows.length, 0);
        assert.equal((await actor(db, user, 'DELETE FROM public.erp_products RETURNING id')).rows.length, 0);
      }
      assert.equal((await actor(db, users.owner, 'DELETE FROM public.erp_products WHERE id=$1 RETURNING id', [uid(999)])).rows.length, 1);
      assert.equal((await actor(db, users.owner, 'DELETE FROM public.erp_products WHERE tenant_id=$1 RETURNING id', [tenant.A])).rows.length, 0);
    });
    await t.test('cross-tenant foreign keys reject references and membership links', async () => {
      await fails(() => actor(db, users.owner, 'INSERT INTO public.erp_sales(tenant_id,product_id,occurred_on,quantity,status) VALUES ($1,$2,current_date,1,$3)', [tenant.C, ids(tenant.A, 23), 'synthetic']), '23503');
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
      const functions = (await db.query("SELECT p.oid::regprocedure::text signature FROM pg_proc p WHERE p.proname LIKE 'erp_%' AND p.prosecdef")).rows;
      for (const { signature } of functions) await db.exec(`ALTER FUNCTION ${signature} OWNER TO erp_metadata_owner`);
      assert.equal((await actor(db, users.employee, 'SELECT * FROM public.erp_appointments')).rows.length, 1);
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
