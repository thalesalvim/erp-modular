import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readSql = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

const baselinePath = 'supabase/baseline/public-before-0.5.sql';
const migrationPaths = [
  'supabase/migrations/20261008020335_security_identity_memberships.sql',
  'supabase/migrations/20261008020339_security_tenant_data_identity.sql',
  'supabase/migrations/20261008020344_security_rls_policies.sql',
];
const cutoverPath = 'supabase/activation/camada-1-cutover.sql';

const users = {
  ownerA: '00000000-0000-0000-0000-00000000000a',
  managerA: '00000000-0000-0000-0000-00000000000b',
  employeeA: '00000000-0000-0000-0000-00000000000c',
  ownerB: '00000000-0000-0000-0000-00000000000d',
  platformAdmin: '00000000-0000-0000-0000-00000000000e',
  outsider: '00000000-0000-0000-0000-00000000000f',
};

async function asRole(db, role, userId, sql) {
  await db.exec(`SET ROLE ${role};`);
  if (userId) {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  }
  try {
    return await db.query(sql);
  } finally {
    await db.exec('RESET ROLE;');
    await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}

test('the staged foundation enforces tenant boundaries after the guarded cutover', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE supabase_admin NOLOGIN;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      CREATE FUNCTION auth.uid() RETURNS uuid
        LANGUAGE sql STABLE
        AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
    `);

    await db.exec(await readSql(baselinePath));
    for (const migration of migrationPaths) {
      await db.exec(await readSql(migration));
    }

    // Model the definer/identity-table owner without BYPASSRLS to catch recursive
    // policies if owner access is accidentally removed from membership helpers.
    await db.exec(`
      CREATE ROLE migration_owner NOLOGIN;
      GRANT USAGE, CREATE ON SCHEMA public, private TO migration_owner;
      GRANT USAGE ON SCHEMA auth TO migration_owner;
      ALTER TABLE public.tenant_memberships OWNER TO migration_owner;
      ALTER TABLE public.platform_admins OWNER TO migration_owner;
      ALTER FUNCTION private.has_tenant_role(uuid, text[]) OWNER TO migration_owner;
      ALTER FUNCTION private.is_platform_admin() OWNER TO migration_owner;
    `);

    await db.exec(`
      INSERT INTO auth.users (id) VALUES
        ('${users.ownerA}'), ('${users.managerA}'), ('${users.employeeA}'),
        ('${users.ownerB}'), ('${users.platformAdmin}'), ('${users.outsider}');
      INSERT INTO public.tenants (id, slug, company_name) VALUES
        ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Test A'),
        ('10000000-0000-0000-0000-00000000000b', 'tenant-b', 'Test B');
      INSERT INTO public.tenant_memberships (tenant_id, user_id, role) VALUES
        ('10000000-0000-0000-0000-00000000000a', '${users.ownerA}', 'owner'),
        ('10000000-0000-0000-0000-00000000000a', '${users.managerA}', 'manager'),
        ('10000000-0000-0000-0000-00000000000a', '${users.employeeA}', 'employee'),
        ('10000000-0000-0000-0000-00000000000b', '${users.ownerB}', 'owner');
      INSERT INTO public.platform_admins (user_id) VALUES ('${users.platformAdmin}');
      INSERT INTO public.tenant_data (tenant_slug, data_key, payload) VALUES
        ('tenant-a', 'all_data', '{"marker":"A"}'),
        ('tenant-b', 'all_data', '{"marker":"B"}');
      INSERT INTO public.companies (name, tenant_id) VALUES
        ('Company A', '10000000-0000-0000-0000-00000000000a'),
        ('Company B', '10000000-0000-0000-0000-00000000000b');
    `);

    const backfilled = await db.query(
      'SELECT count(*)::int AS count FROM public.tenant_data WHERE tenant_id IS NOT NULL',
    );
    assert.equal(backfilled.rows[0].count, 2, 'existing payload rows receive stable tenant IDs');

    const preCutoverAnon = await asRole(
      db,
      'anon',
      null,
      'SELECT count(*)::int AS count FROM public.tenant_data',
    );
    assert.equal(preCutoverAnon.rows[0].count, 2, 'the legacy baseline reproduces the currently open database');
    await assert.rejects(
      () => asRole(db, 'anon', null, 'SELECT user_id FROM public.tenant_memberships'),
      /permission denied/i,
      'new membership data is closed even before the legacy-table cutover',
    );

    await db.exec("SET handyhub.cutover_ready = 'yes';");
    await db.exec(await readSql(cutoverPath));

    const securityFlags = await db.query(`SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class WHERE oid IN ('public.tenants'::regclass, 'public.tenant_data'::regclass,
      'public.companies'::regclass, 'public.tenant_memberships'::regclass, 'public.platform_admins'::regclass)`);
    assert.equal(securityFlags.rows.length, 5);
    assert.ok(securityFlags.rows.every((row) => row.relrowsecurity && !row.relforcerowsecurity));

    const tenantA = '10000000-0000-0000-0000-00000000000a';
    const tenantB = '10000000-0000-0000-0000-00000000000b';

    await assert.rejects(
      () => asRole(db, 'anon', null, 'SELECT id FROM public.tenants'),
      /permission denied/i,
      'anon has no table privileges after cutover',
    );

    const ownTenants = await asRole(
      db,
      'authenticated',
      users.ownerA,
      'SELECT slug FROM public.tenants ORDER BY slug',
    );
    assert.deepEqual(ownTenants.rows.map((row) => row.slug), ['tenant-a']);
    const crossTenant = await asRole(
      db,
      'authenticated',
      users.ownerA,
      `SELECT tenant_slug FROM public.tenant_data WHERE tenant_id = '${tenantB}'`,
    );
    assert.equal(crossTenant.rows.length, 0, 'tenant A cannot read tenant B');

    const ownPayload = await asRole(
      db,
      'authenticated',
      users.ownerA,
      `SELECT payload->>'marker' AS marker FROM public.tenant_data WHERE tenant_id = '${tenantA}'`,
    );
    assert.deepEqual(ownPayload.rows.map((row) => row.marker), ['A']);

    const crossUpdate = await asRole(
      db,
      'authenticated',
      users.ownerA,
      `UPDATE public.tenant_data SET payload = '{"marker":"changed"}'::jsonb WHERE tenant_id = '${tenantB}' RETURNING tenant_id`,
    );
    assert.equal(crossUpdate.rows.length, 0, 'tenant A cannot update tenant B');
    const crossDelete = await asRole(
      db,
      'authenticated',
      users.ownerA,
      `DELETE FROM public.tenant_data WHERE tenant_id = '${tenantB}' RETURNING tenant_id`,
    );
    assert.equal(crossDelete.rows.length, 0, 'tenant A cannot delete tenant B');

    const ownCompanies = await asRole(
      db,
      'authenticated',
      users.ownerA,
      'SELECT name FROM public.companies ORDER BY name',
    );
    assert.deepEqual(ownCompanies.rows.map((row) => row.name), ['Company A']);

    const managerProfile = await asRole(db, 'authenticated', users.managerA,
      `UPDATE public.tenants SET owner_name = 'denied' WHERE id = '${tenantA}' RETURNING id`);
    assert.equal(managerProfile.rows.length, 0, 'manager cannot perform owner-only profile changes');
    const employeeCompany = await asRole(db, 'authenticated', users.employeeA,
      `UPDATE public.companies SET name = 'denied' WHERE tenant_id = '${tenantA}' RETURNING id`);
    assert.equal(employeeCompany.rows.length, 0, 'employee cannot change company metadata');
    await assert.rejects(() => asRole(db, 'authenticated', users.ownerA,
      `UPDATE public.companies SET tenant_id = '${tenantB}' WHERE tenant_id = '${tenantA}'`),
      /row-level security/i, 'WITH CHECK rejects transfer of company ownership to another tenant');
    const ownerBRead = await asRole(db, 'authenticated', users.ownerB, 'SELECT slug FROM public.tenants');
    assert.deepEqual(ownerBRead.rows.map((row) => row.slug), ['tenant-b']);
    const crossCompany = await asRole(
      db,
      'authenticated',
      users.ownerA,
      `SELECT name FROM public.companies WHERE tenant_id = '${tenantB}'`,
    );
    assert.equal(crossCompany.rows.length, 0, 'tenant A cannot read tenant B companies');

    const outsiderTenants = await asRole(
      db,
      'authenticated',
      users.outsider,
      'SELECT slug FROM public.tenants',
    );
    assert.equal(outsiderTenants.rows.length, 0, 'a signed-in user without membership sees no tenant');

    const ownerUpdate = await asRole(
      db,
      'authenticated',
      users.ownerA,
      `UPDATE public.tenant_data SET payload = '{"marker":"owner-updated"}'::jsonb WHERE tenant_id = '${tenantA}' RETURNING tenant_id`,
    );
    assert.equal(ownerUpdate.rows.length, 1, 'owner can update their own tenant data');

    await assert.rejects(
      () => asRole(
        db,
        'authenticated',
        users.ownerA,
        `UPDATE public.tenants SET status = 'Bloqueado' WHERE id = '${tenantA}'`,
      ),
      /permission denied/i,
      'tenant owners cannot change platform-controlled subscription status',
    );

    const legacyUpsert = await asRole(
      db,
      'authenticated',
      users.managerA,
      `INSERT INTO public.tenant_data (tenant_slug, data_key, payload)
       VALUES ('tenant-a', 'legacy-write', '{"marker":"manager"}'::jsonb)
       RETURNING tenant_id`,
    );
    assert.equal(legacyUpsert.rows[0].tenant_id, tenantA, 'legacy slug writes are attached to the stable ID');

    await assert.rejects(
      () => asRole(
        db,
        'authenticated',
        users.ownerA,
        `INSERT INTO public.tenant_data (tenant_slug, data_key, payload)
         VALUES ('tenant-b', 'cross-write', '{}'::jsonb)`,
      ),
      /Unknown tenant|row-level security|violates row-level security/i,
      'tenant A cannot insert data for tenant B',
    );

    const employeeOwnMembership = await asRole(
      db,
      'authenticated',
      users.employeeA,
      'SELECT user_id FROM public.tenant_memberships',
    );
    assert.deepEqual(employeeOwnMembership.rows.map((row) => row.user_id), [users.employeeA]);
    const employeeUpdate = await asRole(
      db,
      'authenticated',
      users.employeeA,
      `UPDATE public.tenant_data SET payload = '{}'::jsonb WHERE tenant_id = '${tenantA}' RETURNING tenant_id`,
    );
    assert.equal(employeeUpdate.rows.length, 0, 'employee membership is read-only for the monolithic payload');

    await assert.rejects(
      () => asRole(db, 'authenticated', users.ownerA, 'SELECT logins FROM public.tenants'),
      /permission denied/i,
      'legacy passwords are not readable after cutover',
    );
    await assert.rejects(
      () => asRole(
        db,
        'authenticated',
        users.ownerA,
        `INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
         VALUES ('${tenantA}', '${users.outsider}', 'owner')`,
      ),
      /permission denied/i,
      'clients cannot grant memberships directly',
    );

    const adminTenants = await asRole(
      db,
      'authenticated',
      users.platformAdmin,
      'SELECT slug FROM public.tenants ORDER BY slug',
    );
    assert.deepEqual(adminTenants.rows.map((row) => row.slug), ['tenant-a', 'tenant-b']);
    const serverTenants = await asRole(
      db,
      'service_role',
      null,
      'SELECT slug FROM public.tenants ORDER BY slug',
    );
    assert.deepEqual(serverTenants.rows.map((row) => row.slug), ['tenant-a', 'tenant-b']);
  } finally {
    await db.close();
  }
});
