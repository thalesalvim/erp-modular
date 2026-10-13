import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const migrations = [
  '20261008020335_security_identity_memberships.sql',
  '20261008020339_security_tenant_data_identity.sql',
  '20261008020344_security_rls_policies.sql',
];
const additions = [
  '20261010060000_erp_permissions.sql',
  '20261010060100_erp_domains.sql',
  '20261010060200_erp_domain_rls.sql',
  '20261011010000_erp_product_concurrency.sql',
  '20261011020000_erp_own_appointments_read.sql',
  '20261011030000_erp_historical_snapshots.sql',
  '20261011030100_erp_historical_posting.sql',
  '20261012010000_erp_lifecycle_state.sql',
  '20261012010100_erp_lifecycle_commands.sql',
  '20261012020000_erp_membership_revocation.sql',
  '20261012020100_erp_membership_restoration.sql',
  '20261012030000_erp_coordinated_recovery.sql',
  '20261012030100_erp_recovery_integrity.sql',
  '20261012030200_erp_durability_integrity.sql',
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
async function setup(createDb = () => new PGlite()) {
  const db = createDb();
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
    // New-operation guards use the real Owner scope even during synthetic seeding.
    const owner = t === tenant.A ? users.ownerA : t === tenant.B ? users.ownerB : users.owner;
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
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
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
}
async function grant(db, role, permissions, as = users.owner, target = tenant.C, expected) {
  const state = await db.query('SELECT revision FROM private.erp_policy_state WHERE tenant_id=$1', [target]);
  const rev = expected ?? Number(state.rows[0]?.revision ?? 0);
  return actor(db, as, 'SELECT public.erp_set_role_permissions($1,$2,$3::text[],$4) AS revision', [target, role, permissions, rev]);
}


export { read, additions, uid, tenant, users, ids, actor, fails, setup, insert, seed, grant };
