"""Managed foundation release regression. Only owned, networkless local PostgreSQL.

The managed fixture simulates recorded metadata; it is not a hosted certification.
--review prints candidates from TWO independent fixtures and never updates anchors.
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import unittest
import uuid
from unittest.mock import patch

import managed_v6_release as release
from postgres_harness import LocalDocker, DisposablePostgres, HarnessSafetyError

ROOT = release.ROOT
RELEASE = release.RELEASE
PROFILE = ROOT / 'tests/helpers/managed-v6-profile.json'
CLI = Path.home() / 'AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
CLIENT = None
RESOURCES = []
ACK = "SET handyhub.managed_install='pilot-v6-1';"
ZERO = '0' * 64
A = '00000000-0000-4000-8000-000000000101'
B = '00000000-0000-4000-8000-000000000102'
OWNER, MANAGER, EMPLOYEE, FOREIGN = [f'00000000-0000-4000-8000-{n:012}' for n in (1, 2, 3, 4)]
BASELINE_FILES = ['supabase/baseline/staging-application-baseline.sql', *[
    'supabase/migrations/' + n for n in (
        '20261008020335_security_identity_memberships.sql',
        '20261008020339_security_tenant_data_identity.sql',
        '20261008020344_security_rls_policies.sql')]]


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def code(result):
    match = re.search(r'ERROR:\s+([A-Z0-9]{5}):', result.stderr)
    return match[1] if match else 'COMMAND_FAILED'


def good(pg, sql, database_user='postgres'):
    result = pg.sql(sql, timeout=60, database_user=database_user)
    if result.returncode:
        # Synthetic SQL, but omit SQL context and input even for local fixtures.
        match = re.search(r'ERROR:\s+[A-Z0-9]{5}:\s*([^\n]+)', result.stderr)
        raise AssertionError(code(result) + ': ' + (match[1] if match else 'diagnostics withheld'))
    return result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ''


def actor(pg, sql, user=OWNER, role='authenticated'):
    # PostgREST changes role as authenticator. A NOSUPERUSER installer cannot
    # SET SESSION AUTHORIZATION to API identities; never fake that as a pass.
    # Provider preload libraries are recorded but absent in vanilla PostgreSQL.
    # Bootstrap switches session identity; all assertions run as authenticator.
    return pg.sql(f'SET SESSION AUTHORIZATION authenticator;SET ROLE {role};SET request.jwt.claim.sub={q(user)};' + sql,database_user='fixture_root')


def verified_acls(pg, profile):
    """Replay only the enumerated, reviewed ACL metadata in the owned fixture."""
    names = {r['name'] for r in profile['roles']} | {'PUBLIC','dashboard_user','pg_database_owner'}
    for obj in sorted(profile['acl_objects'],key=lambda o:o['kind']=='column'):
        kind,name,entries=obj['kind'],obj['name'],obj['entries']
        if not entries:
            continue
        if kind=='column':
            prefix='';suffix=' ON TABLE '+name
        elif kind.startswith('default_'):
            owner,schema=name.split('/')
            target={'r':'TABLES','S':'SEQUENCES','f':'FUNCTIONS'}[kind[8:]]
            prefix=f'ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA {schema} '
            suffix=' ON '+target
        else:
            prefix=''
            suffix=' ON '+kind.upper()+' '+name
        grantees=','.join(sorted(names | {e['grantee'] for e in entries}))
        col=' ('+obj['column']+')' if kind=='column' else ''
        sql=prefix+'REVOKE ALL'+col+suffix+' FROM '+grantees+';'
        for entry in entries:
            grantor='postgres' if entry['grantor']=='pg_database_owner' else entry['grantor']
            sql+=f'SET ROLE {grantor};'+prefix+'GRANT '+entry['privilege']+col+suffix+' TO '+entry['grantee']
            sql+=(' WITH GRANT OPTION' if entry['grantable'] else '')+';RESET ROLE;'
        good(pg,sql,database_user='fixture_root')


def fixture(pg):
    # OID 10 must remain SUPERUSER on PostgreSQL 17.11. Model hosted postgres
    # with a fresh role; provider bootstrap is separate and never the installer.
    good(pg, 'CREATE ROLE fixture_root SUPERUSER LOGIN;')
    good(pg, 'ALTER ROLE postgres RENAME TO supabase_admin;'
         'CREATE ROLE postgres NOSUPERUSER CREATEROLE CREATEDB LOGIN INHERIT BYPASSRLS REPLICATION;'
         'ALTER DATABASE postgres OWNER TO postgres;', database_user='fixture_root')
    p = json.loads(PROFILE.read_text(encoding='utf-8'))
    # Match the verified locale instead of weakening the database fingerprint.
    result=pg.exec(['psql','-X','-U','fixture_root','-d','template1','-Atq','-v','ON_ERROR_STOP=1'],
        data=("ALTER DATABASE postgres RENAME TO fixture_original;CREATE DATABASE postgres OWNER postgres TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE "
              +q(p['database'][3])+" LC_CTYPE "+q(p['database'][4])+';').encode('utf-8'))
    if result.returncode:raise AssertionError('Verified managed locale is not reproducible locally: '+code(result))
    roles = {r['name']: r for r in p['roles']}
    extra = {e[k] for e in p['memberships'] for k in ('member', 'role')}
    extra.update({'dashboard_user'})
    builtin = set(good(pg, "SELECT string_agg(rolname,',') FROM pg_catalog.pg_roles").split(','))
    for name in sorted((set(roles) | extra) - builtin):
        good(pg, f'CREATE ROLE {name} NOLOGIN', database_user='fixture_root')
    for name, r in roles.items():
        if name == 'postgres' or name.startswith('pg_'):
            continue  # Apply restricted executor last, after fixture construction.
        options = ' '.join(('' if r[k] else 'NO') + keyword for k, keyword in (
            ('login', 'LOGIN'), ('inherit', 'INHERIT'), ('create_db', 'CREATEDB'),
            ('superuser', 'SUPERUSER'), ('bypass_rls', 'BYPASSRLS'),
            ('create_role', 'CREATEROLE'), ('replication', 'REPLICATION')))
        good(pg, f'ALTER ROLE {name} {options}', database_user='fixture_root')
    good(pg, "CREATE SCHEMA auth AUTHORIZATION supabase_admin;"
         "SET ROLE supabase_admin;GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role,postgres;"
         "GRANT USAGE,CREATE ON SCHEMA auth TO supabase_auth_admin,dashboard_user;RESET ROLE;"
         "SET ROLE supabase_auth_admin;CREATE TABLE auth.users(id uuid PRIMARY KEY);"
         + p['auth_uid']['definition'] + ';'
         "ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;"
         "GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON auth.users TO postgres,dashboard_user;"
         "GRANT SELECT ON auth.users TO postgres WITH GRANT OPTION;RESET ROLE;", database_user='fixture_root')
    for name in BASELINE_FILES:
        good(pg, (ROOT / name).read_bytes().decode('utf-8'))
    good(pg, f"INSERT INTO auth.users VALUES('{OWNER}'),('{MANAGER}'),('{EMPLOYEE}'),('{FOREIGN}');"
         f"INSERT INTO public.tenants(id,slug,company_name) VALUES('{A}','synthetic-a','Synthetic A'),('{B}','synthetic-b','Synthetic B');"
         f"INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES('{A}','{OWNER}','owner'),('{A}','{MANAGER}','manager'),('{A}','{EMPLOYEE}','employee'),('{B}','{FOREIGN}','owner');"
         f"INSERT INTO public.platform_admins(user_id) VALUES('{OWNER}');"
         f"INSERT INTO public.tenant_data(tenant_id,tenant_slug,data_key,payload) VALUES('{A}','synthetic-a','all_data','{{\"untouched\":true}}');"
         "SET handyhub.cutover_ready='yes';" + (ROOT / 'supabase/activation/camada-1-cutover.sql').read_bytes().decode())
    for e in p['memberships']:
        good(pg, f"GRANT {e['role']} TO {e['member']} WITH ADMIN {str(e['admin']).upper()},INHERIT {str(e['inherit']).upper()},SET {str(e['set']).upper()}", database_user='supabase_admin')
    verified_acls(pg,p)
    for role in p['roles']:
        for config in role['config'] or []:
            key,value=config.split('=',1)
            if key in ('search_path','session_preload_libraries'):
                if not re.fullmatch(r'[A-Za-z0-9_$\s,."\\]+',value):raise ValueError('Unreviewed list setting')
                setting=value
            else:setting=q(value)
            good(pg,'ALTER ROLE '+role['name']+' SET "'+key+'" TO '+setting,database_user='fixture_root')
    actual=json.loads(snapshot(pg))
    if actual!=p['observed_baseline']:
        differences=sorted(k for k in set(actual)|set(p['observed_baseline']) if actual.get(k)!=p['observed_baseline'].get(k))
        raise AssertionError('Reconstructed metadata differs from reviewed observations: '+json.dumps(differences))


def snapshot(pg):
    return good(pg, "SET search_path='';" + (RELEASE / 'snapshot.sql').read_bytes().decode())


def fingerprint(pg):
    query = (RELEASE / 'snapshot.sql').read_bytes().decode()
    return good(pg, "SET search_path='';SELECT encode(sha256(convert_to(x.snapshot::text,'UTF8')),'hex') FROM (" + query + ') x')


def baseline_rows(pg):
    return good(pg, "SELECT jsonb_build_array("
                "(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenants t),"
                "(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenant_memberships t),"
                "(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenant_data t),"
                "(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM auth.users t))")


def inventory():
    CLIENT.assert_same_server()
    result = {'engine': CLIENT.server_id}
    for key, args in [
        ('containers', ['container', 'ls', '-aq', '--no-trunc']),
        ('networks', ['network', 'ls', '--no-trunc', '--format', '{{.ID}}']),
        ('volumes', ['volume', 'ls', '-q']), ('images', ['image', 'ls', '-q', '--no-trunc'])]:
        r = CLIENT._command(args)
        if r.returncode:
            raise HarnessSafetyError('Docker inventory unavailable')
        result[key] = sorted(set(r.stdout.split()))
    return result


def review():
    candidates = []
    for _ in range(2):
        with DisposablePostgres(CLIENT, purpose='managed-v-six-review') as pg:
            RESOURCES.append(pg.container_id)
            fixture(pg)
            baseline = fingerprint(pg)
            candidate = {'baseline_sha256': baseline, 'root_sha256': ZERO}
            # Never seal a review rehearsal: rollback before the root row insertion.
            ddl = release.render('root.sql', candidate).split('-- REFERENCES and rows')[0]
            query = (RELEASE / 'snapshot.sql').read_bytes().decode()
            root = good(pg, "BEGIN;SET LOCAL search_path='';" + ddl + "SELECT encode(sha256(convert_to(x.snapshot::text,'UTF8')),'hex') FROM (" + query + ') x;ROLLBACK;')
            candidates.append({'baseline_sha256': baseline, 'root_sha256': root})
    if candidates[0] != candidates[1]:
        raise HarnessSafetyError('Independent clean constructions differ')
    print('REVIEW_CANDIDATE=' + json.dumps(candidates[0]), flush=True)


class ManagedRelease(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pg = DisposablePostgres(CLIENT, purpose='managed-v-six-tests')
        cls.addClassCleanup(cls.pg.close)
        cls.pg.start(); RESOURCES.append(cls.pg.container_id)
        fixture(cls.pg)
        cls.rows = baseline_rows(cls.pg)
        cls.provider = json.loads(snapshot(cls.pg))
        good(cls.pg, ACK + release.installation_sql())

    def test_01_installed_closed_without_historic_seals(self):
        self.assertEqual(good(self.pg, 'SELECT release_id FROM handyhub_private.release'), 'managed-customer-foundation-v6-1')
        self.assertEqual(good(self.pg, "SELECT count(*) FROM pg_catalog.pg_class WHERE relname LIKE 'erp_recovery_schema_seal%'"), '0')
        self.assertEqual(good(self.pg, 'SELECT maintenance FROM handyhub_private.runtime'), 't')
        self.assertEqual(good(self.pg, 'SELECT count(*) FROM handyhub_private.pilot_tenants'), '0')
        result=actor(self.pg, f"SELECT public.hh_customer_access('{A}','customers.create')")
        self.assertEqual(result.returncode,0,code(result));self.assertEqual(result.stdout.strip(),'f')

    def test_02_preserves_rows_and_provider_objects(self):
        self.assertEqual(self.rows, baseline_rows(self.pg))
        now = json.loads(snapshot(self.pg))
        for key, value in self.provider.items():
            if key.startswith(('auth.', 'function/auth.', 'schema/auth')):
                self.assertEqual(value, now[key])
        self.assertEqual(good(self.pg, "SELECT has_schema_privilege('handyhub_managed_reader','auth','USAGE')"), 'f')

    def test_03_permission_and_tenant_isolation(self):
        # Setup must commit to be observable to independent authenticated connections.
        good(self.pg, f"INSERT INTO handyhub_private.pilot_tenants VALUES('{A}',true),('{B}',true);UPDATE handyhub_private.runtime SET maintenance=false;")
        try:
            for user, tenant, permission, expected in [
                (OWNER,A,'customers.create','t'), (OWNER,A,'customers.update','t'),
                (OWNER,A,'customers.read','t'), (OWNER,B,'customers.read','f'),
                (FOREIGN,B,'customers.read','t'), (FOREIGN,A,'customers.read','f'),
                (MANAGER,A,'customers.create','f'), (EMPLOYEE,A,'customers.create','f'),
                (OWNER,A,'finance.read','f')]:
                r = actor(self.pg, f"SELECT public.hh_customer_access('{tenant}',{q(permission)})", user)
                self.assertEqual(r.returncode,0,code(r));self.assertEqual(r.stdout.strip(),expected)
        finally:
            good(self.pg, 'UPDATE handyhub_private.runtime SET maintenance=true;UPDATE handyhub_private.pilot_tenants SET enabled=false;')

    def test_04_no_role_or_private_escape(self):
        for role in ('anon','authenticated','service_role'):
            for statement in (
                'SELECT * FROM handyhub_private.release', 'SELECT handyhub_private.snapshot()',
                'SELECT handyhub_private.actor()', 'SET ROLE handyhub_managed_reader',
                "UPDATE handyhub_private.runtime SET maintenance=false"):
                self.assertNotEqual(actor(self.pg, statement, role=role).returncode,0,role+': '+statement)
            if role!='service_role':
                self.assertNotEqual(actor(self.pg,f"INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES('{B}','{MANAGER}','owner')",role=role).returncode,0)

    def test_05_integrity_detects_tampering_and_temp_shadows(self):
        for mutation in (
            'ALTER TABLE handyhub_private.runtime DISABLE ROW LEVEL SECURITY',
            'GRANT SELECT ON handyhub_private.release TO authenticated',
            'GRANT handyhub_managed_reader TO authenticated',
            'ALTER ROLE handyhub_managed_reader BYPASSRLS',
            'GRANT SELECT(user_id) ON public.tenant_memberships TO anon',
            'ALTER TABLE handyhub_private.runtime SET UNLOGGED',
            'ALTER TABLE handyhub_private.release DISABLE TRIGGER immutable_release',
            'ALTER FUNCTION handyhub_private.assert_integrity() IMMUTABLE',
            'ALTER DATABASE postgres OWNER TO supabase_admin',
            "CREATE OR REPLACE FUNCTION handyhub_private.actor() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS 'SELECT NULL::uuid'",
        ):
            r = self.pg.sql('BEGIN;CREATE TEMP TABLE pg_class AS SELECT * FROM pg_catalog.pg_class;'
                            'CREATE TEMP TABLE pg_roles AS SELECT * FROM pg_catalog.pg_roles;'
                            + mutation + ';SELECT handyhub_private.assert_integrity();COMMIT;',database_user='supabase_admin')
            self.assertEqual(code(r),'55000')
        good(self.pg, 'SELECT handyhub_private.assert_integrity()')

    def test_06_reinstall_rejected_without_changes(self):
        before = snapshot(self.pg)
        self.assertEqual(code(self.pg.sql(ACK + release.installation_sql())), '55000')
        self.assertEqual(before, snapshot(self.pg))

    def test_07_immutable_root(self):
        for statement in ("UPDATE handyhub_private.release SET root_sha256=repeat('0',64)",
                          'DELETE FROM handyhub_private.release', 'TRUNCATE handyhub_private.release'):
            self.assertEqual(code(self.pg.sql(statement)), '55000')

    def test_08_revocation_suspension_maintenance(self):
        good(self.pg, 'UPDATE handyhub_private.runtime SET maintenance=false;'
             f"UPDATE handyhub_private.pilot_tenants SET enabled=true WHERE tenant_id='{A}';")
        try:
            for change, undo in [
                (f"UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='{A}' AND user_id='{OWNER}'", f"UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{A}' AND user_id='{OWNER}'"),
                (f"UPDATE public.tenants SET status='Suspenso' WHERE id='{A}'", f"UPDATE public.tenants SET status='Ativo' WHERE id='{A}'"),
                ('UPDATE handyhub_private.runtime SET maintenance=true','UPDATE handyhub_private.runtime SET maintenance=false')]:
                good(self.pg, change)
                result=actor(self.pg,f"SELECT public.hh_customer_access('{A}','customers.create')")
                self.assertEqual(result.returncode,0,code(result));self.assertEqual(result.stdout.strip(),'f')
                good(self.pg,undo)
        finally:
            good(self.pg,'UPDATE handyhub_private.runtime SET maintenance=true;UPDATE handyhub_private.pilot_tenants SET enabled=false;')

    def test_14_postflight_pins_validator_body_independently(self):
        sql=("BEGIN;CREATE OR REPLACE FUNCTION handyhub_private.assert_integrity() RETURNS void "
             "LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS 'BEGIN RETURN; END';"
             +release.render('postflight.sql',release.manifest())+'COMMIT;')
        result=self.pg.sql(sql)
        self.assertEqual(code(result),'55000')
        self.assertIn('MANAGED_V6_VALIDATOR_BODY',result.stderr)
        good(self.pg,'SELECT handyhub_private.assert_integrity()')

    def test_15_null_identity_and_unauthenticated_rpc(self):
        result=actor(self.pg,f"SELECT public.hh_customer_access('{A}','customers.create')",user='')
        self.assertEqual(result.returncode,0);self.assertEqual(result.stdout.strip(),'f')
        for role in ('anon','service_role'):
            self.assertEqual(code(actor(self.pg,f"SELECT public.hh_customer_access('{A}','customers.create')",role=role)),'42501')

    def test_16_missing_manifest_or_modified_sources_refused_offline(self):
        with patch.object(release.Path,'read_text',side_effect=FileNotFoundError):
            self.assertRaises(FileNotFoundError,release.manifest)
        with patch.object(release.Path,'read_bytes',return_value=b'changed'):
            self.assertRaises(ValueError,release.manifest)

    def test_17_offline_sql_output_preserves_utf8_lf(self):
        for flag in ('--print-sql','--preflight-only'):
            result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/managed_v6_release.py'),flag],
                                  capture_output=True,text=False,timeout=10,env=dict(CLIENT.environment))
            self.assertEqual(result.returncode,0)
            self.assertNotIn(b'\r',result.stdout)
            self.assertIn(b'BEGIN',result.stdout)
            self.assertNotIn(b'{{',result.stdout)
            result.stdout.decode('utf-8')

    def test_18_existing_acl_policy_role_and_auth_contracts_unchanged(self):
        now=json.loads(snapshot(self.pg))
        self.assertEqual({k:now[k] for k in self.provider},self.provider)
        self.assertEqual(good(self.pg,"SELECT has_table_privilege('service_role','public.tenant_memberships','INSERT,UPDATE,DELETE')"),'t')
        self.assertEqual(good(self.pg,"SELECT has_table_privilege('service_role','public.platform_admins','INSERT,UPDATE,DELETE')"),'t')

    def test_19_legacy_company_membership_admin_and_json_commands_continue(self):
        t=str(uuid.uuid4());before=baseline_rows(self.pg)
        sql=(f"BEGIN;INSERT INTO public.tenants(id,slug,company_name) VALUES('{t}','local-{t}','Synthetic');"
             f"INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES('{t}','{EMPLOYEE}','owner');"
             f"UPDATE public.tenant_memberships SET role='manager' WHERE tenant_id='{t}';"
             f"INSERT INTO public.platform_admins(user_id) VALUES('{MANAGER}');"
             f"INSERT INTO public.tenant_data(tenant_id,tenant_slug,data_key,payload) VALUES('{t}','local-{t}','all_data','{{}}');"
             f"UPDATE public.tenant_data SET payload='[]' WHERE tenant_id='{t}';"
             f"DELETE FROM public.tenant_data WHERE tenant_id='{t}';"
             f"DELETE FROM public.tenant_memberships WHERE tenant_id='{t}';"
             f"DELETE FROM public.tenants WHERE id='{t}';"
             f"DELETE FROM public.platform_admins WHERE user_id='{MANAGER}';ROLLBACK;")
        result=actor(self.pg,sql,role='service_role')
        self.assertEqual(result.returncode,0,code(result));self.assertEqual(before,baseline_rows(self.pg))
        self.assertEqual(good(self.pg,"SELECT to_regprocedure('public.erp_authorize_invitation(uuid,text)') IS NULL"),'t')

    def test_20_pilot_guard_denies_only_target_tenant_including_moves_and_truncate(self):
        good(self.pg,f"UPDATE handyhub_private.pilot_tenants SET enabled=(tenant_id='{A}');")
        before=baseline_rows(self.pg)
        try:
            for sql in (
                f"INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES('{A}','{FOREIGN}','owner')",
                f"UPDATE public.tenant_memberships SET role='owner' WHERE tenant_id='{A}' AND user_id='{EMPLOYEE}'",
                f"DELETE FROM public.tenant_memberships WHERE tenant_id='{A}' AND user_id='{EMPLOYEE}'",
                f"UPDATE public.tenant_memberships SET tenant_id='{A}' WHERE tenant_id='{B}' AND user_id='{FOREIGN}'",
                f"UPDATE public.tenant_memberships SET tenant_id='{B}' WHERE tenant_id='{A}' AND user_id='{EMPLOYEE}'",
                'TRUNCATE public.tenant_memberships'):
                result=actor(self.pg,sql,role='service_role')
                self.assertEqual(code(result),'42501');self.assertIn('MANAGED_V6_PILOT_IDENTITY_COMMAND_REQUIRED',result.stderr)
            for sql in ('ALTER TABLE public.tenant_memberships DISABLE TRIGGER handyhub_pilot_membership_guard',
                        "SET session_replication_role='replica'",'SET ROLE postgres'):
                self.assertEqual(code(actor(self.pg,sql,role='service_role')),'42501')
            other=actor(self.pg,f"BEGIN;UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='{B}';ROLLBACK;",role='service_role')
            self.assertEqual(other.returncode,0,code(other));self.assertEqual(before,baseline_rows(self.pg))
        finally:good(self.pg,'UPDATE handyhub_private.pilot_tenants SET enabled=false;')

    def test_21_auth_delete_cascade_preserved_for_nonpilot_and_guarded_for_pilot(self):
        before=baseline_rows(self.pg)
        result=self.pg.sql(f"BEGIN;DELETE FROM auth.users WHERE id='{FOREIGN}';ROLLBACK;",database_user='supabase_auth_admin')
        self.assertEqual(result.returncode,0,code(result));self.assertEqual(before,baseline_rows(self.pg))
        good(self.pg,f"UPDATE handyhub_private.pilot_tenants SET enabled=true WHERE tenant_id='{A}';")
        try:
            result=self.pg.sql(f"BEGIN;DELETE FROM auth.users WHERE id='{OWNER}';ROLLBACK;",database_user='supabase_auth_admin')
            self.assertEqual(code(result),'42501');self.assertEqual(before,baseline_rows(self.pg))
        finally:good(self.pg,'UPDATE handyhub_private.pilot_tenants SET enabled=false;')


class PreflightAndRollback(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pg = DisposablePostgres(CLIENT,purpose='managed-v-six-preflight')
        cls.addClassCleanup(cls.pg.close);cls.pg.start();RESOURCES.append(cls.pg.container_id)
        fixture(cls.pg)

    def test_09_readonly_preflight(self):
        before=snapshot(self.pg)
        good(self.pg,ACK+'BEGIN READ ONLY;'+release.render('preflight.sql',release.manifest())+'ROLLBACK;')
        self.assertEqual(before,snapshot(self.pg))

    def test_10_unsafe_baseline_refused(self):
        for change in (
            'ALTER TABLE public.tenants DISABLE ROW LEVEL SECURITY',
            'GRANT SELECT ON public.tenant_memberships TO anon',
            'CREATE TABLE public.erp_customers(id uuid)',
            'GRANT authenticated TO anon',
            'ALTER TABLE auth.users OWNER TO postgres',
            'ALTER TABLE public.tenants ADD COLUMN unexpected text',
            'CREATE ROLE unreviewed NOLOGIN;GRANT unreviewed TO authenticated',
            "ALTER ROLE anon SET statement_timeout='4s'",
        ):
            statement='BEGIN;'+change+';SET SESSION AUTHORIZATION postgres;'+ACK+release.render('preflight.sql',release.manifest())+'COMMIT;'
            result=self.pg.sql(statement,database_user='supabase_admin')
            self.assertIn(code(result),('42501','55000'))
            self.assertIn('MANAGED_V6_',result.stderr)
            self.assertEqual(good(self.pg,"SELECT to_regnamespace('handyhub_private') IS NULL"),'t')

    def test_11_superuser_missing_privileges_and_ack_refused(self):
        self.assertEqual(code(self.pg.sql(release.installation_sql())), '42501')
        for change in ('ALTER ROLE postgres NOCREATEROLE',
                       'ALTER ROLE postgres NOINHERIT'):
            self.assertIn(code(self.pg.sql(ACK+'BEGIN;'+change+';'+release.render('preflight.sql',release.manifest())+'COMMIT;')),('42501','55000'))

    def test_12_late_failure_rolls_back_schema_roles_and_rows(self):
        before=snapshot(self.pg);rows=baseline_rows(self.pg)
        sql=release.installation_sql().removesuffix('COMMIT;\n')+'SELECT 1/0;COMMIT;'
        self.assertEqual(code(self.pg.sql(ACK+sql)), '22012')
        self.assertEqual(before,snapshot(self.pg));self.assertEqual(rows,baseline_rows(self.pg))
        self.assertEqual(good(self.pg,"SELECT to_regnamespace('handyhub_private') IS NULL"),'t')
        self.assertEqual(good(self.pg,"SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname='handyhub_managed_reader'"),'0')

    def test_13_success_after_rollback_then_reinstall_refused(self):
        sql=ACK+release.installation_sql()
        good(self.pg,sql)
        self.assertEqual(code(self.pg.sql(sql)),'55000')

    def test_12b_shared_reads_and_json_continue_during_installer_ddl(self):
        names=['managed-'+uuid.uuid4().hex for _ in range(2)];key=uuid.uuid4().int%(2**30)
        args=[CLIENT.executable,'--host',CLIENT.endpoint,'container','exec','-i',self.pg.container_id,
              'psql','-X','-U','fixture_root','-d','postgres','-Atq','-v','ON_ERROR_STOP=1']
        child=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=dict(CLIENT.environment))
        pool=concurrent.futures.ThreadPoolExecutor(1)
        def wait(condition):
            deadline=time.monotonic()+12
            while time.monotonic()<deadline:
                if good(self.pg,'SELECT ('+condition+')::int')=='1':return
                time.sleep(.03)
            raise AssertionError('SYNCHRONIZATION_TIMEOUT: local installer barrier')
        try:
            child.stdin.write(f"SET application_name='{names[0]}';SELECT pg_advisory_lock({key});\n".encode());child.stdin.flush()
            wait(f"EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name='{names[0]}' AND l.locktype='advisory' AND l.granted)")
            sql=f"SET application_name='{names[1]}';SET statement_timeout='20s';"+ACK+release.installation_sql().removesuffix('COMMIT;\n')+f'SELECT pg_advisory_lock({key});ROLLBACK;'
            task=pool.submit(self.pg.sql,sql,timeout=30)
            wait(f"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{names[1]}' AND wait_event='advisory')")
            peer=actor(self.pg,f"SET statement_timeout='1500ms';SELECT count(*) FROM public.tenants;UPDATE public.tenant_data SET payload=payload WHERE tenant_id='{A}';")
            self.assertEqual(peer.returncode,0,code(peer))
            blocked=actor(self.pg,f"SET lock_timeout='200ms';UPDATE public.tenant_memberships SET is_active=is_active WHERE tenant_id='{B}';",role='service_role')
            self.assertEqual(code(blocked),'55P03')  # unavoidable brief trigger/FK DDL lock
            child.stdin.write(b'\\q\n');child.stdin.flush();child.wait(timeout=5)
            result=task.result(timeout=25);self.assertEqual(result.returncode,0,code(result))
            self.assertEqual(good(self.pg,"SELECT to_regnamespace('handyhub_private') IS NULL"),'t')
        finally:
            if child.poll() is None:
                child.kill();child.wait(timeout=5)
            good(self.pg,"SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name="+q(names[1]))
            pool.shutdown(wait=True,cancel_futures=True)
            for stream in (child.stdin,child.stdout,child.stderr):stream.close()


def main():
    global CLIENT
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker',default=str(CLI) if CLI.is_file() else None)
    parser.add_argument('--review',action='store_true')
    args=parser.parse_args()
    CLIENT=LocalDocker(executable=args.docker)
    before=inventory()
    try:
        if args.review:
            review();success=True
        else:
            release.manifest()
            suite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(c) for c in (ManagedRelease,PreflightAndRollback)])
            result=unittest.TextTestRunner(verbosity=2).run(suite)
            success=result.wasSuccessful() and not result.skipped
    finally:
        after=inventory()
        print('ISOLATION='+json.dumps({'inventories_equal':before==after,'owned_ids':RESOURCES,'endpoint':CLIENT.endpoint}),flush=True)
        if before!=after:
            raise HarnessSafetyError('Docker resources changed; no global cleanup attempted')
    raise SystemExit(0 if success else 1)


if __name__=='__main__':
    main()
