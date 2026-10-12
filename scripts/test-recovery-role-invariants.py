#!/usr/bin/env python3
"""B3 role trust boundary: PostgreSQL 17, synthetic data, disposable/offline only."""
import importlib.util
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('seal', Path(__file__).with_name('test-recovery-seal-hardening.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
f = b.f
TECH = ['handyhub_product_writer', 'handyhub_own_agenda_reader', 'handyhub_history_writer',
        'handyhub_lifecycle_operator', 'handyhub_membership_reviewer']
PROVIDER = """
CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
GRANT anon,authenticated,service_role TO authenticator WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
"""

class Bootstrap(b.BeforeSeal):
    def test_original_authenticated_bypass_before_install(self):
        self.assertEqual(self.good('SELECT count(*) FROM public.erp_sale_finance', f.uuid(6)), '0')
        self.rejected_install('ALTER ROLE authenticated BYPASSRLS', 'RECOVERY_UNSAFE_OPERATIONAL_ROLE')
        self.assertEqual(self.good('SELECT count(*) FROM public.erp_sale_finance', f.uuid(6)), '0')

    def test_authenticated_superuser_before_install(self):
        # The existing parameter gate already rejects SUPERUSER (implicit SET).
        self.rejected_install('ALTER ROLE authenticated SUPERUSER', 'RECOVERY_UNSAFE_PARAMETER_PRIVILEGE')

    def test_alternative_operational_roles_with_bypass(self):
        for role in ['anon', *TECH]:
            with self.subTest(role=role):
                self.rejected_install(f'ALTER ROLE {role} BYPASSRLS', 'RECOVERY_UNSAFE_OPERATIONAL_ROLE')
        self.rejected_install(PROVIDER + 'ALTER ROLE authenticator BYPASSRLS', 'RECOVERY_UNSAFE_OPERATIONAL_ROLE')

    def test_technical_nologin_noinherit_and_other_dangerous_attributes(self):
        for role in TECH:
            for attribute in ['LOGIN', 'INHERIT', 'CREATEROLE', 'CREATEDB', 'REPLICATION']:
                with self.subTest(role=role, attribute=attribute):
                    self.rejected_install(f'ALTER ROLE {role} {attribute}', 'RECOVERY_UNSAFE_OPERATIONAL_ROLE')
        for attribute in ['LOGIN', 'CREATEROLE', 'CREATEDB', 'REPLICATION']:
            self.rejected_install(f'ALTER ROLE authenticated {attribute}', 'RECOVERY_UNSAFE_OPERATIONAL_ROLE')

    def test_outbound_memberships_all_inherit_set_combinations(self):
        for inherit in ['TRUE', 'FALSE']:
            for set_role in ['TRUE', 'FALSE']:
                ddl = ('CREATE ROLE b3_bridge NOLOGIN; CREATE ROLE b3_privileged NOLOGIN BYPASSRLS; '
                       'GRANT b3_privileged TO b3_bridge; '
                       f'GRANT b3_bridge TO authenticated WITH INHERIT {inherit}, SET {set_role}')
                self.rejected_install(ddl, 'RECOVERY_UNSAFE_ROLE_MEMBERSHIP')

    def test_incoming_unknown_role_cannot_inherit_grants_and_bypass_policies(self):
        # BYPASSRLS is not inherited; it is held by the unknown child role itself.
        for role in ['anon', 'authenticated', 'service_role']:
            self.rejected_install('CREATE ROLE b3_custom LOGIN BYPASSRLS; '
                                  f'GRANT {role} TO b3_custom WITH INHERIT TRUE, SET FALSE',
                                  'RECOVERY_UNSAFE_ROLE_MEMBERSHIP')

    def test_capability_and_metadata_owner_paths_are_closed(self):
        self.rejected_install('GRANT handyhub_history_writer TO authenticated', 'RECOVERY_UNSAFE_ROLE_MEMBERSHIP')
        self.rejected_install('CREATE ROLE b3_bridge NOLOGIN; GRANT b3_bridge TO handyhub_history_writer',
                              'RECOVERY_UNSAFE_ROLE_MEMBERSHIP')
        self.rejected_install('GRANT postgres TO authenticated', 'RECOVERY_UNSAFE_PARAMETER_PRIVILEGE')

    def test_authenticator_cannot_inherit_or_administer_service_role(self):
        for alteration in ['GRANT service_role TO authenticator WITH INHERIT TRUE',
                           'GRANT service_role TO authenticator WITH ADMIN TRUE',
                           'ALTER ROLE authenticator INHERIT',
                           'REVOKE authenticated FROM authenticator; GRANT authenticator TO authenticated']:
            self.rejected_install(PROVIDER + alteration, 'RECOVERY_UNSAFE_')

    def test_service_exception_cannot_administer_roles_or_broker_new_paths(self):
        self.rejected_install('ALTER ROLE service_role CREATEROLE', 'RECOVERY_UNSAFE_OPERATIONAL_ROLE')
        self.rejected_install('CREATE ROLE b3_bridge NOLOGIN; GRANT b3_bridge TO service_role',
                              'RECOVERY_UNSAFE_ROLE_MEMBERSHIP')

    def test_initial_safe_provider_configuration_and_resume(self):
        # Full transaction rolls back so this class still has no seal afterwards.
        statements = ('BEGIN;' + PROVIDER + b.body(b.B.read_text()) +
                      b.body((b.REC/'phase-2a-enter-maintenance.sql').read_text()) +
                      b.body(b.RESUME) + "SELECT maintenance FROM private.erp_runtime_control;ROLLBACK;")
        self.assertEqual(self.good(statements), 'f')
        self.assertEqual(self.good("SELECT to_regclass('private.erp_recovery_schema_seal') IS NULL"), 't')

    def test_safe_inherit_flags_and_explicit_administrative_exception(self):
        # No membership is inferred safe from rolINHERIT alone; safe empty graphs work.
        ddl = ('ALTER ROLE authenticated NOINHERIT; CREATE ROLE b3_dba SUPERUSER NOLOGIN; '
               'GRANT authenticated TO b3_dba')
        self.good('BEGIN;' + ddl + ';' + b.body(b.B.read_text()) + ';ROLLBACK;')

class Installed(b.AfterSeal):
    def test_unsafe_attributes_and_memberships_after_seal_fail_closed(self):
        for ddl in ['ALTER ROLE authenticated BYPASSRLS', 'ALTER ROLE anon BYPASSRLS',
                    'ALTER ROLE handyhub_history_writer LOGIN',
                    'CREATE ROLE b3_bridge NOLOGIN; GRANT b3_bridge TO authenticated']:
            self.rejected_resume(ddl, 'RECOVERY_UNSAFE_')

    def test_snapshot_replacement_cannot_promote_unsafe_operational_role(self):
        self.rejected_resume("ALTER ROLE authenticated BYPASSRLS; SET LOCAL session_replication_role='replica'; "
                             "UPDATE private.erp_recovery_schema_seal SET snapshot=private.erp_recovery_schema_snapshot(); "
                             "SET LOCAL session_replication_role='origin'", 'RECOVERY_UNSAFE_OPERATIONAL_ROLE')

    def test_nonadministrators_cannot_change_roles_or_invoke_verifier(self):
        for actor in [b.OWNER, b.c.MANAGER, b.EMPLOYEE, f.uuid(5)]:
            for sql in ['ALTER ROLE authenticated BYPASSRLS', 'ALTER ROLE authenticated SUPERUSER',
                        'GRANT service_role TO authenticated', 'SET ROLE handyhub_history_writer',
                        'SELECT private.erp_assert_operational_roles()']:
                self.denied(sql, actor)

class Provider(b.BeforeSeal):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for sql in [PROVIDER, b.B.read_text()]:
            result = cls.sql(sql)
            if result.returncode:
                raise RuntimeError(result.stderr)

    def test_provider_connections(self):
        self.good((b.REC/'phase-2a-enter-maintenance.sql').read_text())
        self.good(b.RESUME)
        # Existing connection can SET LOCAL ROLE for successive requests; mode and
        # identity stay operational. Another connection uses the same broker model.
        prefix = 'SET SESSION AUTHORIZATION authenticator;'
        request = (f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='{f.uuid(6)}';"
                   'SELECT count(*) FROM public.erp_sale_finance;COMMIT;')
        self.assertEqual(self.good(prefix + request + request), '0\n0')
        self.assertEqual(self.good(prefix + request), '0')
        self.assertEqual(self.good(prefix + "SET ROLE service_role;SELECT current_user,rolbypassrls FROM pg_roles WHERE rolname=current_user"), 'service_role|t')
        result = self.sql(f"SET SESSION AUTHORIZATION authenticated; SET request.jwt.claim.sub='{b.OWNER}';SET ROLE service_role;")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('42501', result.stderr)
        flags = self.good("SELECT bool_and(NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper) FROM pg_roles WHERE left(rolname,9)='handyhub_'")
        self.assertEqual(flags, 't')

if __name__ == '__main__':
    classes = [Bootstrap, Installed, Provider]
    cases = [cls(name) for cls in classes for name in cls.__dict__ if name.startswith('test_')
             and (not sys.argv[1:] or name in sys.argv[1:])]
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(cases))
    sys.exit(not result.wasSuccessful())
