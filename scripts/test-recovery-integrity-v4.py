"""Reviewed recovery v4: local, owned PostgreSQL only; no remote DSN or file writes.

--baseline reproduces the original vulnerabilities without applying v4.
--manifest prints independently reproduced historical fingerprints; it never edits SQL.
--regressions runs existing lifecycle/membership/recovery cases after v4 installation.
The default runs baseline evidence, installation and adversarial v4 regressions.
"""
import importlib.util
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('integrity_invitation', Path(__file__).with_name('test-invitation-atomic.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
f = a.f
ROOT = f.ROOT
V4 = ROOT / 'supabase/migrations/20261014025551_erp_recovery_integrity_v4.sql'
MANIFEST = ROOT / 'supabase/recovery/reviewed-history-v4.json'
VERSIONS = ['erp_recovery_schema_seal', 'erp_recovery_schema_seal_v2', 'erp_recovery_schema_seal_v3']


def reviewed_manifest():
    # Missing or malformed input is fatal, including in --baseline/--manifest mode.
    manifest = json.loads(MANIFEST.read_bytes().decode('utf-8'))
    if (manifest['profile'] != 'postgres-17.11-handyhub-reviewed-local'
            or manifest['metadata_owner'] != 'postgres' or manifest['postgres_major'] != 17
            or manifest['postgres_tested'] != '17.11' or manifest['image'] != f.IMAGE
            or manifest['canonicalization'] != 'sha256(UTF8(snapshot::pg_catalog.text)) of each complete historical JSONB snapshot'
            or set(manifest['snapshot_sha256']) != set(VERSIONS)
            or any(not re.fullmatch('[a-f0-9]{64}', value) for value in manifest['snapshot_sha256'].values())):
        raise ValueError('Historical manifest has an unreviewed profile or shape')
    definitions = dict(zip(['v1', 'v2', 'v3'], ['20261012030100_erp_recovery_integrity.sql',
                                               '20261012030200_erp_durability_integrity.sql',
                                               '20261013010000_erp_invitation_integrity.sql']))
    if set(manifest['reviewed_definition_md5']) != set(definitions):
        raise ValueError('Historical definition anchors missing')
    for version, filename in definitions.items():
        sql = (ROOT / 'supabase/migrations' / filename).read_bytes().decode('utf-8')
        if "IF digest IS DISTINCT FROM '" + manifest['reviewed_definition_md5'][version] + "'" not in sql:
            raise ValueError('Manifest definition anchor does not match its source')
    historical = sorted(path for path in (ROOT / 'supabase/migrations').glob('*.sql')
                        if path.name[:14] <= '20261012030200')
    source_text = ''.join(path.relative_to(ROOT).as_posix() + ' ' + hashlib.sha256(path.read_bytes()).hexdigest() + '\n'
                          for path in historical)
    if (len(historical) != 17 or hashlib.sha256(source_text.encode()).hexdigest() != manifest['source_sha256']['historical_sql_manifest']
            or hashlib.sha256(a.MIGRATION.read_bytes()).hexdigest() != manifest['source_sha256']['v3_sql']):
        raise ValueError('Historical migration bytes differ from reviewed provenance')
    return manifest


def assert_profile(case, versions=VERSIONS):
    manifest = reviewed_manifest()
    case.assertEqual(case.good("SELECT pg_catalog.current_setting('server_version')"), manifest['postgres_tested'])
    case.assertEqual(case.good("SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class WHERE oid='private.erp_permission_catalog'::pg_catalog.regclass"), manifest['metadata_owner'])
    for index, name in enumerate(versions, start=1):
        digest = case.good("SELECT pg_catalog.md5(pg_catalog.jsonb_object_agg(key,value ORDER BY key)::pg_catalog.text) "
                           f"FROM private.{name},pg_catalog.jsonb_each(snapshot) "
                           "WHERE (key ~ '^(trigger|constraint|index|policy|function|grant|relation-state|column-definition|owner)/|^role/handyhub_|^role-member/.*handyhub_|^catalog/permissions$') "
                           "AND key<>'function/private.erp_assert_reviewed_definitions()'")
        case.assertEqual(digest, manifest['reviewed_definition_md5']['v' + str(index)])


def body(sql):
    return sql.replace('BEGIN;', '', 1).removesuffix('COMMIT;\n')


def history(case):
    return {name: case.good(f"SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(snapshot::pg_catalog.text,'UTF8')),'hex') FROM private.{name} WHERE singleton") for name in VERSIONS}


def reseal(version):
    return ("SET LOCAL session_replication_role='replica';"
            f"UPDATE private.erp_recovery_schema_seal_{version} SET snapshot=private.erp_recovery_schema_snapshot();"
            "SET LOCAL session_replication_role='origin';")


class HistoricalBaseline(unittest.TestCase):
    sql = staticmethod(f.ProductConcurrency.sql)
    good = f.ProductConcurrency.good

    @classmethod
    def setUpClass(cls):
        f.ProductConcurrency.setUpClass.__func__(cls)

    def test_manifest_profile_matches_historical_sources(self):
        assert_profile(self, VERSIONS[:2])

    def test_corrupted_v1_is_adopted_by_original_v3(self):
        result = self.sql("BEGIN;ALTER TABLE private.erp_recovery_schema_seal DISABLE TRIGGER erp_schema_seal_immutable;"
                          "UPDATE private.erp_recovery_schema_seal SET snapshot='{}';"
                          "ALTER TABLE private.erp_recovery_schema_seal ENABLE TRIGGER erp_schema_seal_immutable;"
                          "SELECT private.erp_assert_recovery_integrity();" + body(a.MAINTENANCE)
                          + body(a.MIGRATION.read_bytes().decode())
                          + "SELECT previous_v1_digest=pg_catalog.md5('{}'::pg_catalog.jsonb::pg_catalog.text) FROM private.erp_recovery_schema_seal_v3;ROLLBACK;")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip().splitlines()[-1], 't')
        print('BASELINE: original v3 adopts corrupted v1; transaction rolled back', flush=True)


class LegacyVulnerabilities(a.InvitationAtomic):
    def test_catalog_class_shadow_masks_rls(self):
        self.good("BEGIN;CREATE TEMP TABLE pg_class AS SELECT * FROM pg_catalog.pg_class;"
                  "ALTER TABLE public.erp_sale_finance DISABLE ROW LEVEL SECURITY;"
                  "SELECT private.erp_assert_recovery_integrity();ROLLBACK;")
        print('BASELINE: pg_temp.pg_class masks disabled RLS', flush=True)

    def test_catalog_roles_shadow_masks_bypass(self):
        self.good("BEGIN;CREATE TEMP TABLE pg_roles AS SELECT * FROM pg_catalog.pg_roles;"
                  "ALTER ROLE handyhub_invitation_operator BYPASSRLS;"
                  "SELECT private.erp_assert_recovery_integrity();ROLLBACK;")
        print('BASELINE: pg_temp.pg_roles masks BYPASSRLS', flush=True)

    def test_base_acl_can_be_blessed_by_original_reseal(self):
        self.good('BEGIN;GRANT UPDATE(role) ON public.tenant_memberships TO service_role;'
                  + reseal('v3') + 'SELECT private.erp_assert_recovery_integrity();ROLLBACK;')
        print('BASELINE: original v3 accepts an unreviewed membership ACL after reseal', flush=True)

    def test_clean_historical_manifest(self):
        assert_profile(self)
        observed = history(self)
        print('REVIEWED_HISTORY=' + json.dumps(observed, sort_keys=True), flush=True)
        self.assertEqual(observed, reviewed_manifest()['snapshot_sha256'])


class UpgradeV4(a.InvitationAtomic):
    def test_history_changes_are_rejected_before_any_v4_ddl(self):
        for name in VERSIONS:
            for change in ["snapshot='{}'", "snapshot=snapshot||'{\"schema/unreviewed\":\"tampered\"}'::pg_catalog.jsonb"]:
                with self.subTest(version=name, change=change):
                    result = self.sql(f'BEGIN;ALTER TABLE private.{name} DISABLE TRIGGER erp_schema_seal_immutable;'
                                      f'UPDATE private.{name} SET {change};ALTER TABLE private.{name} ENABLE TRIGGER erp_schema_seal_immutable;'
                                      + body(a.MAINTENANCE) + body(V4.read_bytes().decode()) + 'COMMIT;')
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('RECOVERY_HISTORICAL_MANIFEST_DRIFT', result.stderr)
                    self.assertEqual(self.good("SELECT pg_catalog.to_regclass('private.erp_recovery_schema_seal_v4') IS NULL"), 't')

    def test_legacy_preflight_refuses_catalog_and_type_shadows(self):
        shadows = ['CREATE TEMP TABLE pg_class AS SELECT * FROM pg_catalog.pg_class',
                   'CREATE TEMP TABLE pg_roles AS SELECT * FROM pg_catalog.pg_roles',
                   'CREATE TEMP TABLE audit_temp(id integer);CREATE DOMAIN pg_temp.regclass AS pg_catalog.text']
        self.good(a.MAINTENANCE)  # The legacy runbook must finish before its own casts can be shadowed.
        try:
            for shadow in shadows:
                with self.subTest(shadow=shadow):
                    result = self.sql('BEGIN;' + shadow + ';' + body(V4.read_bytes().decode()) + 'COMMIT;')
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('RECOVERY_UNSAFE_TEMP_CATALOG', result.stderr)
                    self.assertEqual(self.good("SELECT pg_catalog.to_regclass('private.erp_recovery_schema_seal_v4') IS NULL"), 't')
        finally:
            self.good(a.RESUME)

    def test_missing_manifest_is_fatal(self):
        with patch.object(Path, 'read_bytes', side_effect=FileNotFoundError('Missing reviewed manifest')):
            with self.assertRaises(FileNotFoundError):
                reviewed_manifest()

    def test_late_failure_restores_every_definition_and_reference(self):
        self.good(a.MAINTENANCE)
        before = self.good('SELECT private.erp_recovery_schema_snapshot()::pg_catalog.text')
        references = history(self)
        try:
            result = self.sql(V4.read_bytes().decode().removesuffix('COMMIT;\n') + 'SELECT 1/0;COMMIT;')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('22012', result.stderr)
            self.assertEqual(self.good('SELECT private.erp_recovery_schema_snapshot()::pg_catalog.text'), before)
            self.assertEqual(history(self), references)
            self.assertEqual(self.good("SELECT pg_catalog.to_regclass('private.erp_recovery_schema_seal_v4') IS NULL"), 't')
            self.assertEqual(self.good("SELECT pg_catalog.to_regprocedure('private.erp_assert_historical_seals()') IS NULL"), 't')
            self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'), 't')
        finally:
            self.good(a.RESUME)

    def test_upgrade_preserves_all_existing_data_and_read_ceiling(self):
        user = f.uuid(940001)
        self.good(f"INSERT INTO auth.users(id) VALUES ('{user}');INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES ('{a.T}','{user}','manager')")
        revision = self.good(f"SELECT coalesce((SELECT revision FROM private.erp_policy_state WHERE tenant_id='{a.T}'),0)")
        self.good(f"SELECT public.erp_set_role_permissions('{a.T}','manager',ARRAY['products.read','finance.sales.read'],{revision})", a.OWNER)
        revision = self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{a.T}' AND user_id='{user}'")
        self.good(f"SELECT public.erp_revoke_membership('{a.T}','{user}',{revision},'identity_review')", a.OWNER)
        revision = self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{a.T}' AND user_id='{user}'")
        self.good(f"SELECT public.erp_restore_membership('{a.T}','{user}',{revision},true,ARRAY['products.read'],NULL)", a.OWNER)
        references = history(self)
        before = """BEGIN;CREATE TEMP TABLE v4_data_manifest(name pg_catalog.text,checksum pg_catalog.text);
DO $$ DECLARE r pg_catalog.record; BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('public','private','auth') AND c.relname NOT IN ('erp_runtime_control','erp_recovery_events') LOOP
  EXECUTE pg_catalog.format($q$INSERT INTO pg_temp.v4_data_manifest SELECT %L,pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(x)::pg_catalog.text,'' ORDER BY pg_catalog.to_jsonb(x)::pg_catalog.text),'')) FROM %I.%I x$q$,r.nspname||'.'||r.relname,r.nspname,r.relname);
 END LOOP;END $$;"""
        after = f"""DO $$ DECLARE r pg_catalog.record; actual pg_catalog.text; BEGIN
 FOR r IN SELECT * FROM pg_temp.v4_data_manifest LOOP
 EXECUTE $q$SELECT pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(x)::pg_catalog.text,'' ORDER BY pg_catalog.to_jsonb(x)::pg_catalog.text),'')) FROM $q$||r.name||' x' INTO actual;
 IF actual IS DISTINCT FROM r.checksum THEN RAISE EXCEPTION 'DATA_CHANGED: %',r.name; END IF;
 END LOOP;
 IF (SELECT permissions FROM private.erp_membership_revocations WHERE tenant_id='{a.T}' AND user_id='{user}') IS DISTINCT FROM ARRAY['products.read'] THEN RAISE EXCEPTION 'READ_CEILING_CHANGED'; END IF;
 END $$;SELECT private.erp_assert_recovery_integrity();ROLLBACK;"""
        self.good(before + body(a.MAINTENANCE) + body(V4.read_bytes().decode()) + body(a.RESUME) + after)
        self.assertEqual(history(self), references)

    def test_install_without_seed(self):
        js = """import {setup,additions,read} from './tests/helpers/tenant-domain-fixture.mjs';
const statements=[];const q=v=>v===null?'NULL':typeof v==='boolean'?(v?'true':'false'):typeof v==='number'?String(v):"'"+v.replaceAll("'","''")+"'";
class Recorder{async exec(s){statements.push(s+';')}async query(s,a=[]){statements.push(s.replace(/\\$(\\d+)/g,(_,n)=>q(a[Number(n)-1]))+';');return{rows:[]}}}
const db=await setup(()=>new Recorder());for(const file of additions)await db.exec(await read('supabase/migrations/'+file));process.stdout.write(statements.join('\\n'));"""
        with f.disposable_postgres('v-four-clean') as clean:
            result = clean.sql(f.record_fixture(js) + a.MAINTENANCE + a.MIGRATION.read_bytes().decode() + a.RESUME
                               + a.MAINTENANCE + V4.read_bytes().decode() + a.RESUME + 'SELECT private.erp_assert_recovery_integrity();')
            self.assertEqual(result.returncode, 0, result.stderr)


class AfterV4(a.InvitationAtomic):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        result = cls.sql(a.MAINTENANCE + V4.read_bytes().decode() + a.RESUME)
        if result.returncode:
            raise RuntimeError(result.stderr)

    def test_active_anchor_and_manifest_are_consistent(self):
        expected = reviewed_manifest()
        source = V4.read_bytes().decode('utf-8')
        for digest in expected['snapshot_sha256'].values():
            self.assertIn(digest, source)
        digest = self.good("SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_object_agg(key,value ORDER BY key)::pg_catalog.text,'UTF8')),'hex') FROM pg_catalog.jsonb_each(private.erp_recovery_schema_snapshot()) WHERE key<>'function/private.erp_assert_reviewed_definitions()'")
        self.assertEqual(digest, expected['active_definition_sha256'])
        self.assertIn("IF digest IS DISTINCT FROM '" + digest + "'", source)
        self.assertEqual(history(self), expected['snapshot_sha256'])

    def reject(self, attack, marker=None, checker='private.erp_assert_recovery_integrity()'):
        result = self.sql('BEGIN;' + attack + ';SELECT ' + checker + ';ROLLBACK;')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('55000', result.stderr)
        if marker:
            self.assertIn(marker, result.stderr)
        self.good('SELECT private.erp_assert_recovery_integrity()')

    def test_all_catalog_shadow_attacks(self):
        attacks = {
            'pg_class': 'ALTER TABLE public.erp_sale_finance DISABLE ROW LEVEL SECURITY',
            'pg_roles': 'ALTER ROLE handyhub_invitation_operator BYPASSRLS',
            'pg_policy': 'ALTER POLICY erp_invitation_ticket_read ON private.erp_invitation_authorizations USING(true)',
            'pg_proc': 'GRANT EXECUTE ON FUNCTION private.erp_invitation_scope(uuid,text) TO authenticated',
            'pg_namespace': 'GRANT USAGE ON SCHEMA private TO anon',
            'pg_auth_members': 'GRANT handyhub_invitation_operator TO authenticated',
            'pg_attribute': 'ALTER TABLE public.erp_products ALTER COLUMN name DROP NOT NULL',
            'pg_trigger': 'ALTER TABLE private.erp_recovery_schema_seal_v4 DISABLE TRIGGER erp_schema_seal_immutable',
            'pg_default_acl': 'ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT SELECT ON TABLES TO PUBLIC',
            'pg_db_role_setting': "ALTER ROLE authenticated SET session_replication_role='replica'",
        }
        for catalog, attack in attacks.items():
            with self.subTest(catalog=catalog):
                columns = ('attrelid,attname,attnum,atttypid,atttypmod,attnotnull,attidentity,attgenerated,attacl,attisdropped'
                           if catalog == 'pg_attribute' else '*')
                # pg_attribute.attmissingval has pseudo-type anyarray: CTAS(*) would
                # fail before the gate. Copy exactly the fields these verifiers use.
                self.reject(f'CREATE TEMP TABLE {catalog} AS SELECT {columns} FROM pg_catalog.{catalog};' + attack)

    def test_benign_catalog_and_type_shadows_cannot_change_results(self):
        self.good("BEGIN;CREATE TEMP TABLE pg_class(id pg_catalog.int4);CREATE TEMP TABLE pg_roles(id pg_catalog.int4);"
                  "CREATE DOMAIN pg_temp.regclass AS pg_catalog.text;CREATE DOMAIN pg_temp.jsonb AS pg_catalog.text;"
                  "CREATE DOMAIN pg_temp.record AS pg_catalog.text;SELECT private.erp_assert_recovery_integrity();ROLLBACK;")

    def test_sensitive_acls_cannot_be_blessed_by_reseal(self):
        attacks = ['GRANT UPDATE(role) ON public.tenant_memberships TO service_role',
                   'GRANT INSERT ON public.tenant_memberships TO authenticated',
                   'GRANT UPDATE(status) ON public.tenants TO service_role',
                   'GRANT INSERT ON public.platform_admins TO authenticated',
                   'GRANT UPDATE(actor_user_id) ON private.erp_invitation_authorizations TO service_role',
                   'GRANT UPDATE(id) ON auth.users TO authenticated',
                   'ALTER TABLE auth.users OWNER TO authenticated',
                   'GRANT SELECT ON public.tenant_data TO authenticated']
        for attack in attacks:
            with self.subTest(attack=attack):
                self.reject(attack + ';' + reseal('v4'), 'RECOVERY_UNREVIEWED_SCHEMA')

    def test_auth_internal_columns_are_opaque_but_all_column_grants_are_pinned(self):
        # The historical scope does not certify the managed Auth table definition.
        # A new field with no explicit grants is harmless to that scope; granting
        # any operational role access to it must still change the reviewed anchor.
        self.good('BEGIN;ALTER TABLE auth.users ADD COLUMN email_confirmed_at pg_catalog.timestamptz;'
                  'SELECT private.erp_assert_recovery_integrity();ROLLBACK;')
        self.reject('ALTER TABLE auth.users ADD COLUMN email_confirmed_at pg_catalog.timestamptz;'
                    'GRANT UPDATE(email_confirmed_at) ON auth.users TO authenticated;'
                    + reseal('v4'), 'RECOVERY_UNREVIEWED_SCHEMA')

    def test_all_historical_payloads_are_pinned_even_after_v4_reseal(self):
        for name in VERSIONS:
            with self.subTest(version=name):
                self.reject(f"ALTER TABLE private.{name} DISABLE TRIGGER erp_schema_seal_immutable;UPDATE private.{name} SET snapshot='{{}}';ALTER TABLE private.{name} ENABLE TRIGGER erp_schema_seal_immutable;"
                            + reseal('v4'), 'RECOVERY_HISTORICAL_MANIFEST_DRIFT')

    def test_permanent_inventory_and_missing_relation(self):
        definition = self.good("SELECT pg_catalog.pg_get_functiondef('private.erp_assert_durable_relations()'::pg_catalog.regprocedure)")
        names = re.findall(r"'(public\.[a-z0-9_]+|private\.[a-z0-9_]+|auth\.users)'", definition)
        self.assertEqual(len(names), 50)
        self.assertEqual(len(set(names)), 50)
        for name in ['private.erp_recovery_schema_seal_v4', 'private.erp_invitation_authorizations']:
            with self.subTest(name=name):
                self.reject('ALTER TABLE ' + name + ' SET UNLOGGED', 'DURABILITY_INVARIANT')
        missing = 'ALTER TABLE public.erp_expenses RENAME TO missing_expenses;CREATE TEMP TABLE erp_expenses(id uuid)'
        self.reject(missing, 'DURABILITY_INVARIANT', 'private.erp_assert_durable_relations()')
        self.reject(missing, 'RLS_INVARIANT')
        self.reject('ALTER TABLE auth.users RENAME TO missing_auth_users', 'DURABILITY_INVARIANT', 'private.erp_assert_durable_relations()')

    def test_postgres_rejects_auth_unlogged_before_gate(self):
        result = self.sql('BEGIN;ALTER TABLE auth.users SET UNLOGGED;ROLLBACK;')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('42P16', result.stderr)
        self.good('SELECT private.erp_assert_recovery_integrity()')

    def test_operational_roles_cannot_change_history_or_validator(self):
        for role in ['anon', 'authenticated', 'service_role']:
            for statement in ["UPDATE private.erp_recovery_schema_seal_v4 SET snapshot='{}'", 'TRUNCATE private.erp_recovery_schema_seal_v4',
                              "CREATE OR REPLACE FUNCTION private.erp_assert_historical_seals() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$",
                              'SELECT private.erp_assert_historical_seals()']:
                with self.subTest(role=role, statement=statement):
                    self.denied(statement, a.OWNER, role=role)


def existing_v4_regressions():
    # Preserve historical fixtures and expectations; only add the explicit upgrade
    # before existing functional cases. No inherited duplicate scenarios are counted.
    upgrade = a.MAINTENANCE + a.MIGRATION.read_bytes().decode() + a.RESUME + a.MAINTENANCE + V4.read_bytes().decode() + a.RESUME
    cases = []
    for filename in ['test-employee-lifecycle.py', 'test-membership-revocation.py',
                     'test-membership-restoration.py', 'test-coordinated-recovery.py']:
        spec = importlib.util.spec_from_file_location('v4_' + filename.replace('-', '_').removesuffix('.py'), Path(__file__).with_name(filename))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for case in vars(module).values():
            if isinstance(case, type) and issubclass(case, unittest.TestCase) and case.__module__ == module.__name__:
                def wrapped_setup(original):
                    def setup(cls):
                        original()
                        result = cls.sql(upgrade)
                        if result.returncode:
                            raise RuntimeError(result.stderr)
                        cls.legacy_closed = True
                    return classmethod(setup)
                case.setUpClass = wrapped_setup(case.setUpClass)
                if filename == 'test-employee-lifecycle.py':
                    # Same real SQL attacks as the historical test. The v4 anchor
                    # rejects the legacy ACL earlier than UNSAFE_LEGACY_FALLBACK.
                    def v4_rejects_legacy_and_trigger_drift(self):
                        self.good(a.MAINTENANCE)
                        self.good('ALTER TABLE public.erp_sales DISABLE TRIGGER erp_validate_history')
                        result = self.sql(a.RESUME)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn('RECOVERY_SCHEMA_DRIFT', result.stderr)
                        self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'), 't')
                        self.good('ALTER TABLE public.erp_sales ENABLE TRIGGER erp_validate_history;GRANT SELECT(payload) ON public.tenant_data TO authenticated')
                        result = self.sql(a.RESUME)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn('RECOVERY_UNREVIEWED_SCHEMA', result.stderr)
                        self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'), 't')
                        self.good('REVOKE SELECT(payload) ON public.tenant_data FROM authenticated')
                    case.test_resume_rejects_disabled_integrity_trigger_and_unsafe_legacy_grants = v4_rejects_legacy_and_trigger_drift
                cases.extend(case(name) for name in sorted(case.__dict__) if name.startswith('test_'))
    return cases


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--baseline', action='store_true')
    modes.add_argument('--manifest', action='store_true')
    modes.add_argument('--regressions', action='store_true')
    args = parser.parse_args()
    reviewed_manifest()  # Validate required local input before creating any resource.
    if args.regressions:
        cases = existing_v4_regressions()
    elif args.manifest:
        cases = [LegacyVulnerabilities('test_clean_historical_manifest')]
    else:
        classes = [HistoricalBaseline, LegacyVulnerabilities]
        if not args.baseline:
            classes += [UpgradeV4, AfterV4]
        cases = [cls(name) for cls in classes for name in sorted(cls.__dict__) if name.startswith('test_')]
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(cases))
    raise SystemExit(not result.wasSuccessful())
