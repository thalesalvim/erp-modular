"""Real PostgreSQL invitation/security tests. Only owned, networkless tmpfs containers.
Run: python -B scripts/test-invitation-atomic.py
The historical 17-migration fixture stays unchanged; v3 is applied explicitly.
"""
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import unittest
from unittest.mock import patch
import uuid

spec = importlib.util.spec_from_file_location('invitation_fixture', Path(__file__).with_name('test-product-concurrency.py'))
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
ROOT = f.ROOT
MIGRATION = ROOT / 'supabase/migrations/20261013010000_erp_invitation_integrity.sql'
MAINTENANCE = (ROOT / 'supabase/recovery/phase-2a-enter-maintenance.sql').read_bytes().decode()
RESUME = (ROOT / 'supabase/recovery/phase-2a-resume-normalized.sql').read_bytes().decode()
T, OWNER, MANAGER, EMPLOYEE = f.TENANT, f.OWNER, f.MANAGER, f.EMPLOYEE


class InvitationAtomic(unittest.TestCase):
    sql = staticmethod(f.ProductConcurrency.sql)
    good = f.ProductConcurrency.good
    denied = f.ProductConcurrency.denied

    @classmethod
    def setUpClass(cls):
        f.ProductConcurrency.setUpClass.__func__(cls)
        cls.baseline = cls.sql("SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal UNION ALL SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal_v2").stdout.strip()
        result = cls.sql(MAINTENANCE + MIGRATION.read_bytes().decode() + RESUME)
        if result.returncode:
            raise RuntimeError(result.stderr)

    def setUp(self):
        self.target = str(uuid.uuid4())
        self.good(f"INSERT INTO auth.users(id) VALUES ('{self.target}')")

    def authorize(self, actor=OWNER, role='employee', tenant=T):
        return self.good(f"SELECT public.erp_authorize_invitation('{tenant}','{role}')", actor)

    def bind(self, ticket, target=None):
        result = self.sql(f"SELECT public.erp_bind_invited_membership('{ticket}','{target or self.target}')", OWNER, role='service_role')
        self.assertEqual(result.returncode, 0, result.stderr)

    def prepared(self, actor=OWNER, role='employee', tenant=T, target=None):
        ticket = self.authorize(actor, role, tenant)
        self.bind(ticket, target)
        return ticket

    def command(self, ticket, target=None, role='employee', tenant=T):
        return f"SELECT public.erp_create_invited_membership('{tenant}','{target or self.target}','{role}','{ticket}')"

    def count(self, target=None):
        return self.good(f"SELECT count(*) FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{target or self.target}'")

    def wait(self, condition):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if self.good('SELECT (' + condition + ')::int') == '1':
                return
            time.sleep(.03)  # Poll a database barrier, never use elapsed sleep as ordering proof.
        self.fail('Deterministic database barrier was not reached')

    def race(self, first, second, first_user=None, second_user=None):
        """Control connection holds an advisory gate until both DB waiters are proved.
        Winner acquires its real business locks, then waits on the control gate.
        Loser must be blocked BY winner, checked with pg_blocking_pids.
        """
        pg = f._postgres
        pg.client.assert_same_server()
        key = uuid.uuid4().int % 2**30
        control, winner, loser = ['invite-' + uuid.uuid4().hex[:12] for _ in range(3)]
        args = [pg.client.executable, '--host', pg.client.endpoint, 'container', 'exec', '-i', pg.container_id,
                'psql', '-X', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1']
        gate = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=dict(pg.client.environment))
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        try:
            gate.stdin.write(f"SET application_name='{control}';SELECT pg_advisory_lock({key});\n".encode())
            gate.stdin.flush()
            self.wait(f"EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name='{control}' AND l.locktype='advisory' AND l.granted)")
            a = pool.submit(self.sql, f"SET application_name='{winner}';SET statement_timeout='15s';BEGIN;{first};SELECT pg_advisory_lock({key});COMMIT;", first_user)
            self.wait(f"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{winner}' AND wait_event='advisory')")
            b = pool.submit(self.sql, f"SET application_name='{loser}';SET statement_timeout='15s';BEGIN;{second};COMMIT;", second_user)
            self.wait(f"EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_stat_activity w ON w.application_name='{winner}' WHERE a.application_name='{loser}' AND w.pid=ANY(pg_blocking_pids(a.pid)))")
            gate.stdin.write(f"SELECT pg_advisory_unlock({key});\n\\q\n".encode())
            gate.stdin.flush()
            gate.wait(timeout=5)
            return a.result(timeout=20), b.result(timeout=20)
        finally:
            if gate.poll() is None:
                try:
                    gate.stdin.write(f"SELECT pg_advisory_unlock({key});\n\\q\n".encode()); gate.stdin.flush()
                    gate.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    gate.kill(); gate.wait(timeout=5)  # Only our local CLI process.
            pool.shutdown(wait=True)
            for pipe in (gate.stdin, gate.stdout, gate.stderr):
                try:
                    pipe.close()
                except OSError:
                    pass  # Windows may reject a final buffered flush after psql exits.

    def test_owner_and_manager_hierarchy(self):
        for actor, role in [(OWNER, 'manager'), (OWNER, 'employee'), (MANAGER, 'employee')]:
            target = str(uuid.uuid4()); self.good(f"INSERT INTO auth.users(id) VALUES ('{target}')")
            ticket = self.prepared(actor, role, target=target)
            self.assertEqual(self.good(self.command(ticket, target, role), actor), target)
        for actor, role in [(MANAGER, 'manager'), (EMPLOYEE, 'employee'), (f.ADMIN, 'employee')]:
            self.denied(f"SELECT public.erp_authorize_invitation('{T}','{role}')", actor)

    def test_foreign_tenant_anon_and_null_role_denied(self):
        self.denied(f"SELECT public.erp_authorize_invitation('{f.FOREIGN}','employee')", OWNER)
        self.denied(f"SELECT public.erp_authorize_invitation('{T}','employee')", None, role='anon')
        self.denied(f"SELECT public.erp_authorize_invitation('{T}',NULL)", OWNER)
        self.denied(f"SELECT public.erp_authorize_invitation('{T}','owner')", OWNER)

    def test_revocation_committed_after_ticket_before_association(self):
        ticket = self.prepared(MANAGER)
        self.good(f"UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='{T}' AND user_id='{MANAGER}'")
        try:
            self.denied(self.command(ticket), MANAGER)
            self.assertEqual(self.count(), '0')
        finally:
            self.good(f"UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{MANAGER}'")

    def test_real_revocation_wins_before_association(self):
        ticket = self.prepared(MANAGER)
        revision = self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{MANAGER}'")
        revoke = f"SELECT public.erp_revoke_membership('{T}','{MANAGER}',{revision},'identity_review')"
        try:
            a, b = self.race(revoke, self.command(ticket), OWNER, MANAGER)
            self.assertEqual(a.returncode, 0, a.stderr); self.assertNotEqual(b.returncode, 0); self.assertIn('42501', b.stderr)
            self.assertEqual(self.count(), '0')
        finally:
            # Administrative restoration of this synthetic fixture, never a production flow.
            self.good(f"DELETE FROM private.erp_membership_revocations WHERE tenant_id='{T}' AND user_id='{MANAGER}';UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{MANAGER}'")

    def test_invitation_wins_before_real_revocation(self):
        ticket = self.prepared(MANAGER)
        revision = self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{MANAGER}'")
        try:
            a, b = self.race(self.command(ticket), f"SELECT public.erp_revoke_membership('{T}','{MANAGER}',{revision},'identity_review')", MANAGER, OWNER)
            self.assertEqual(a.returncode, 0, a.stderr); self.assertEqual(b.returncode, 0, b.stderr)
            self.assertEqual(self.count(), '1')
            self.assertEqual(self.good(f"SELECT is_active FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{MANAGER}'"), 'f')
        finally:
            self.good(f"DELETE FROM private.erp_membership_revocations WHERE tenant_id='{T}' AND user_id='{MANAGER}';UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{MANAGER}'")

    def test_suspension_wins(self):
        ticket = self.prepared()
        try:
            a, b = self.race(f"UPDATE public.tenants SET status='Bloqueado' WHERE id='{T}'", self.command(ticket), None, OWNER)
            self.assertEqual(a.returncode, 0, a.stderr); self.assertNotEqual(b.returncode, 0); self.assertEqual(self.count(), '0')
        finally:
            self.good(f"UPDATE public.tenants SET status='Ativo' WHERE id='{T}'")

    def test_invitation_wins_before_suspension(self):
        ticket = self.prepared()
        try:
            a, b = self.race(self.command(ticket), f"UPDATE public.tenants SET status='Bloqueado' WHERE id='{T}'", OWNER)
            self.assertEqual(a.returncode, 0, a.stderr); self.assertEqual(b.returncode, 0, b.stderr); self.assertEqual(self.count(), '1')
        finally:
            self.good(f"UPDATE public.tenants SET status='Ativo' WHERE id='{T}'")

    def test_maintenance_wins(self):
        ticket = self.prepared()
        try:
            a, b = self.race("LOCK TABLE private.erp_runtime_control IN ACCESS EXCLUSIVE MODE;UPDATE private.erp_runtime_control SET maintenance=true WHERE singleton", self.command(ticket), None, OWNER)
            self.assertEqual(a.returncode, 0, a.stderr); self.assertNotEqual(b.returncode, 0); self.assertIn('55000', b.stderr); self.assertEqual(self.count(), '0')
        finally:
            self.good("UPDATE private.erp_runtime_control SET maintenance=false WHERE singleton")

    def test_invitation_wins_before_maintenance(self):
        ticket = self.prepared()
        try:
            a, b = self.race(self.command(ticket), "LOCK TABLE private.erp_runtime_control IN ACCESS EXCLUSIVE MODE;UPDATE private.erp_runtime_control SET maintenance=true WHERE singleton", OWNER)
            self.assertEqual(a.returncode, 0, a.stderr); self.assertEqual(b.returncode, 0, b.stderr); self.assertEqual(self.count(), '1')
        finally:
            self.good("UPDATE private.erp_runtime_control SET maintenance=false WHERE singleton")

    def test_duplicate_recipient_serializes_without_promotion(self):
        first = self.prepared(); second = self.prepared()
        a, b = self.race(self.command(first), self.command(second), OWNER, OWNER)
        self.assertEqual(a.returncode, 0, a.stderr); self.assertNotEqual(b.returncode, 0); self.assertIn('23505', b.stderr)
        self.assertEqual(self.count(), '1')
        self.assertEqual(self.good(f"SELECT consumed_at IS NULL FROM private.erp_invitation_authorizations WHERE id='{second}'"), 't')

    def test_existing_inactive_member_is_not_reactivated(self):
        self.good(f"INSERT INTO public.tenant_memberships(tenant_id,user_id,role,is_active) VALUES ('{T}','{self.target}','employee',false)")
        ticket = self.prepared(); self.denied(self.command(ticket), OWNER, '23505')
        self.assertEqual(self.good(f"SELECT is_active FROM public.tenant_memberships WHERE user_id='{self.target}'"), 'f')

    def test_revoked_target_is_not_restored(self):
        ticket = self.prepared(target=EMPLOYEE)
        revision = self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{EMPLOYEE}'")
        self.good(f"SELECT public.erp_revoke_membership('{T}','{EMPLOYEE}',{revision},'identity_review')", OWNER)
        try:
            self.denied(self.command(ticket, EMPLOYEE), OWNER)
            self.assertEqual(self.good(f"SELECT is_active FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{EMPLOYEE}'"), 'f')
        finally:
            self.good(f"DELETE FROM private.erp_membership_revocations WHERE tenant_id='{T}' AND user_id='{EMPLOYEE}';UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{EMPLOYEE}'")

    def test_inactive_staff_target_rejected(self):
        ticket = self.prepared(target=EMPLOYEE)
        employee = f.uuid(10301)
        self.good(f"INSERT INTO private.erp_employee_lifecycle(tenant_id,employee_id,is_active,linked_user_id) VALUES ('{T}','{employee}',false,'{EMPLOYEE}')")
        try:
            self.denied(self.command(ticket, EMPLOYEE), OWNER)
        finally:
            self.good(f"DELETE FROM private.erp_employee_lifecycle WHERE tenant_id='{T}' AND employee_id='{employee}'")

    def test_inactive_staff_actor_rejected(self):
        employee = f.uuid(10303)
        self.good(f"INSERT INTO private.erp_employee_auth_links VALUES ('{T}','{employee}','{MANAGER}');INSERT INTO private.erp_employee_lifecycle(tenant_id,employee_id,is_active,linked_user_id) VALUES ('{T}','{employee}',false,'{MANAGER}')")
        try:
            self.denied(f"SELECT public.erp_authorize_invitation('{T}','employee')", MANAGER)
        finally:
            self.good(f"DELETE FROM private.erp_employee_lifecycle WHERE tenant_id='{T}' AND employee_id='{employee}';DELETE FROM private.erp_employee_auth_links WHERE tenant_id='{T}' AND employee_id='{employee}'")

    def test_ticket_binding_forgery_replay_and_identity(self):
        ticket = self.authorize()
        self.denied(f"SELECT public.erp_bind_invited_membership('{ticket}','{self.target}')", OWNER)
        self.denied(self.command(ticket), OWNER)
        self.bind(ticket)
        self.denied(self.command(ticket), MANAGER)
        self.denied(self.command(ticket, f.ADMIN), OWNER)
        self.denied(self.command(ticket, role='manager'), OWNER)
        self.denied(self.command(ticket, tenant=f.FOREIGN), OWNER)
        self.good(self.command(ticket), OWNER)
        self.denied(self.command(ticket), OWNER)

    def test_role_demotion_wins_before_association(self):
        ticket = self.prepared(MANAGER)
        try:
            a, b = self.race(f"UPDATE public.tenant_memberships SET role='employee' WHERE tenant_id='{T}' AND user_id='{MANAGER}'", self.command(ticket), None, MANAGER)
            self.assertEqual(a.returncode, 0, a.stderr); self.assertNotEqual(b.returncode, 0); self.assertEqual(self.count(), '0')
        finally:
            self.good(f"UPDATE public.tenant_memberships SET role='manager' WHERE tenant_id='{T}' AND user_id='{MANAGER}'")

    def test_lifecycle_deactivation_serializes_in_both_orders(self):
        employee = f.uuid(10303)
        self.good(f"INSERT INTO private.erp_employee_auth_links VALUES ('{T}','{employee}','{MANAGER}')")
        try:
            for invite_first in [False, True]:
                with self.subTest(invite_first=invite_first):
                    target = str(uuid.uuid4()); self.good(f"INSERT INTO auth.users(id) VALUES ('{target}')")
                    ticket = self.prepared(MANAGER, target=target)
                    version = self.good(f"SELECT version FROM public.erp_employees WHERE tenant_id='{T}' AND id='{employee}'")
                    deactivate = f"SELECT * FROM public.erp_set_employee_active('{T}','{employee}',{version},false,'offboarding')"
                    invite = self.command(ticket, target)
                    a, b = self.race(invite if invite_first else deactivate, deactivate if invite_first else invite,
                                     MANAGER if invite_first else OWNER, OWNER if invite_first else MANAGER)
                    self.assertEqual(a.returncode, 0, a.stderr)
                    if invite_first:
                        self.assertEqual(b.returncode, 0, b.stderr); self.assertEqual(self.count(target), '1')
                    else:
                        self.assertNotEqual(b.returncode, 0); self.assertEqual(self.count(target), '0')
                    self.good(f"DELETE FROM private.erp_employee_lifecycle WHERE tenant_id='{T}' AND employee_id='{employee}';UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{MANAGER}'")
        finally:
            self.good(f"DELETE FROM private.erp_employee_lifecycle WHERE tenant_id='{T}' AND employee_id='{employee}';DELETE FROM private.erp_employee_auth_links WHERE tenant_id='{T}' AND employee_id='{employee}';UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{MANAGER}'")

    def test_restored_read_ceiling_does_not_restore_invitation_authority(self):
        revision = self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{MANAGER}'")
        self.good(f"SELECT public.erp_revoke_membership('{T}','{MANAGER}',{revision},'identity_review')", OWNER)
        revision = self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{MANAGER}'")
        try:
            self.good(f"SELECT public.erp_restore_membership('{T}','{MANAGER}',{revision},true,ARRAY[]::text[],NULL)", OWNER)
            self.denied(f"SELECT public.erp_authorize_invitation('{T}','employee')", MANAGER)
        finally:
            self.good(f"DELETE FROM private.erp_membership_revocations WHERE tenant_id='{T}' AND user_id='{MANAGER}';UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{MANAGER}'")

    def test_binding_is_write_once_and_association_rolls_back(self):
        ticket = self.prepared()
        result = self.sql(f"SELECT public.erp_bind_invited_membership('{ticket}','{self.target}')", OWNER, role='service_role')
        self.assertNotEqual(result.returncode, 0); self.assertIn('40001', result.stderr)
        self.denied('BEGIN;' + self.command(ticket) + ';SELECT 1/0;COMMIT;', OWNER, '22012')
        self.assertEqual(self.count(), '0')
        self.assertEqual(self.good(f"SELECT consumed_at IS NULL FROM private.erp_invitation_authorizations WHERE id='{ticket}'"), 't')
        self.good(self.command(ticket), OWNER)

    def test_expired_authorization_cannot_associate(self):
        ticket = self.good(f"INSERT INTO private.erp_invitation_authorizations(tenant_id,actor_user_id,requested_role,invited_user_id,created_at,expires_at) VALUES ('{T}','{OWNER}','employee','{self.target}',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '10 minutes') RETURNING id")
        self.denied(self.command(ticket), OWNER)
        self.assertEqual(self.count(), '0')

    def test_direct_client_writes_and_technical_role_access_denied(self):
        for actor in [OWNER, MANAGER, EMPLOYEE, f.ADMIN]:
            self.denied(f"INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES ('{T}','{self.target}','employee')", actor)
            self.denied("UPDATE public.tenant_memberships SET is_active=true", actor)
            self.denied('SET ROLE handyhub_invitation_operator', actor)
            self.denied('SELECT * FROM private.erp_invitation_authorizations', actor)
        self.assertEqual(self.good("SELECT count(*) FROM pg_auth_members WHERE roleid='handyhub_invitation_operator'::regrole OR member='handyhub_invitation_operator'::regrole"), '0')
        for relation, column in [('public.tenants', 'id'), ('public.tenant_memberships', 'user_id'), ('private.erp_runtime_control', 'revision')]:
            result = self.sql(f"SET ROLE handyhub_invitation_operator; SET request.jwt.claim.sub='{OWNER}'; UPDATE {relation} SET {column}={column}")
            self.assertNotEqual(result.returncode, 0, relation)

    def test_integrity_and_previous_references_preserved(self):
        self.assertEqual(self.good("SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal UNION ALL SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal_v2"), self.baseline)
        self.good('SELECT private.erp_assert_recovery_integrity()')
        self.assertEqual(self.good("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND left(c.relname,4)='erp_' AND c.relkind='r'"), '44')

    def test_v3_rejects_policy_grant_role_and_durability_drift(self):
        attacks = ["ALTER POLICY erp_invitation_tenant_lock ON public.tenants USING(true)",
                   'GRANT INSERT ON public.tenant_memberships TO authenticated',
                   'ALTER ROLE handyhub_invitation_operator BYPASSRLS',
                   'GRANT UPDATE(status) ON public.tenants TO handyhub_invitation_operator',
                   'GRANT handyhub_invitation_operator TO authenticated',
                   'ALTER TABLE private.erp_invitation_authorizations SET UNLOGGED',
                   'ALTER TABLE private.erp_recovery_schema_seal_v3 SET UNLOGGED',
                   'ALTER TABLE private.erp_invitation_authorizations DISABLE ROW LEVEL SECURITY']
        for attack in attacks:
            with self.subTest(attack=attack):
                result = self.sql('BEGIN;' + attack + ';SELECT private.erp_assert_recovery_integrity();ROLLBACK;')
                self.assertNotEqual(result.returncode, 0); self.assertIn('55000', result.stderr)
        self.good('SELECT private.erp_assert_recovery_integrity()')

    def test_prior_reference_tampering_is_rejected(self):
        result = self.sql("BEGIN;ALTER TABLE private.erp_recovery_schema_seal DISABLE TRIGGER erp_schema_seal_immutable;UPDATE private.erp_recovery_schema_seal SET snapshot='{}';ALTER TABLE private.erp_recovery_schema_seal ENABLE TRIGGER erp_schema_seal_immutable;SELECT private.erp_assert_recovery_integrity();ROLLBACK;")
        self.assertNotEqual(result.returncode, 0); self.assertIn('RECOVERY_PREVIOUS_REFERENCE_DRIFT', result.stderr)
        self.good('SELECT private.erp_assert_recovery_integrity()')

    def test_actual_api_revocation_uses_real_sql_not_mock_authorization(self):
        pg = f._postgres
        result = subprocess.run(['node', 'tests/helpers/invitation-route-postgres.mjs', pg.client.executable,
                                 pg.client.endpoint, pg.container_id, MANAGER, self.target, T,
                                 pg.client.run_id, pg.token, pg.client.server_id, pg.client.image_id],
                                cwd=ROOT, env=dict(pg.client.environment), capture_output=True, text=False)
        try:
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            observed = json.loads(result.stdout)
            self.assertEqual(observed['status'], 403)
            self.assertEqual(observed['rpc'], ['erp_authorize_invitation', 'erp_bind_invited_membership', 'erp_create_invited_membership'])
            self.assertEqual(self.count(), '0')
        finally:
            self.good(f"UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{MANAGER}'")


class Installation(unittest.TestCase):
    sql = staticmethod(f.ProductConcurrency.sql)
    good = f.ProductConcurrency.good

    @classmethod
    def setUpClass(cls):
        f.ProductConcurrency.setUpClass.__func__(cls)

    def test_clean_install_before_normalized_seed(self):
        # Roles are cluster-wide: a clean install needs its own owned cluster.
        js = """import {setup,additions,read} from './tests/helpers/tenant-domain-fixture.mjs';
const statements=[];const q=v=>v===null?'NULL':typeof v==='boolean'?(v?'true':'false'):typeof v==='number'?String(v):"'"+v.replaceAll("'","''")+"'";
class Recorder{async exec(s){statements.push(s+';')}async query(s,a=[]){statements.push(s.replace(/\\$(\\d+)/g,(_,n)=>q(a[Number(n)-1]))+';');return{rows:[]}}}
const db=await setup(()=>new Recorder());for(const f of additions)await db.exec(await read('supabase/migrations/'+f));process.stdout.write(statements.join('\\n'));"""
        sql = f.record_fixture(js) + MAINTENANCE + MIGRATION.read_bytes().decode() + RESUME + 'SELECT private.erp_assert_recovery_integrity();'
        with f.disposable_postgres('invitation-clean') as clean:
            result = clean.sql(sql)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_update_requires_maintenance_and_refuses_preexisting_drift(self):
        result = self.sql(MIGRATION.read_bytes().decode())
        self.assertNotEqual(result.returncode, 0); self.assertIn('MAINTENANCE_REQUIRED', result.stderr)
        self.good(MAINTENANCE)
        try:
            self.good('ALTER TABLE public.erp_products DISABLE ROW LEVEL SECURITY')
            result = self.sql(MIGRATION.read_bytes().decode())
            self.assertNotEqual(result.returncode, 0); self.assertIn('RLS_INVARIANT', result.stderr)
            self.assertEqual(self.good("SELECT to_regclass('private.erp_recovery_schema_seal_v3') IS NULL"), 't')
        finally:
            self.good('ALTER TABLE public.erp_products ENABLE ROW LEVEL SECURITY'); self.good(RESUME)

    def test_late_install_failure_rolls_back_and_preserves_data(self):
        self.good(MAINTENANCE)
        before = self.good('SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal_v2')
        migration = MIGRATION.read_bytes().decode()
        result = self.sql(migration.removesuffix('COMMIT;\n') + 'SELECT 1/0;COMMIT;')
        self.assertNotEqual(result.returncode, 0); self.assertIn('22012', result.stderr)
        self.assertEqual(self.good("SELECT to_regclass('private.erp_recovery_schema_seal_v3') IS NULL"), 't')
        self.assertEqual(self.good('SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal_v2'), before)
        self.assertEqual(self.good('SELECT count(*) FROM public.erp_products'), '3')
        self.good(RESUME)

    def test_successful_upgrade_preserves_all_existing_rows_and_read_ceiling(self):
        target = f.uuid(910000001)
        revision = self.good(f"SELECT coalesce((SELECT revision FROM private.erp_policy_state WHERE tenant_id='{T}'),0)")
        self.good(f"INSERT INTO auth.users(id) VALUES ('{target}');INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES ('{T}','{target}','manager')")
        self.good(f"SELECT public.erp_set_role_permissions('{T}','manager',ARRAY['products.read','finance.sales.read'],{revision})", OWNER)
        revision = self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{target}'")
        self.good(f"SELECT public.erp_revoke_membership('{T}','{target}',{revision},'identity_review')", OWNER)
        revision = self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{target}'")
        self.good(f"SELECT public.erp_restore_membership('{T}','{target}',{revision},true,ARRAY['products.read'],NULL)", OWNER)
        self.good(MAINTENANCE)
        before = """BEGIN;CREATE TEMP TABLE upgrade_manifest(name text,checksum text);
DO $$ DECLARE r record; digest text; BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND n.nspname IN ('public','private','auth')
   AND c.relname NOT IN ('erp_runtime_control','erp_recovery_events') LOOP
  EXECUTE format($query$SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) FROM %I.%I x$query$,r.nspname,r.relname) INTO digest;
  INSERT INTO upgrade_manifest VALUES(format('%I.%I',r.nspname,r.relname),digest);
 END LOOP;
END $$;"""
        after = f"""DO $$ DECLARE r record; digest text; BEGIN
 FOR r IN SELECT * FROM upgrade_manifest LOOP
  EXECUTE $query$SELECT md5(coalesce(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) FROM $query$||r.name||' x' INTO digest;
  IF digest IS DISTINCT FROM r.checksum THEN RAISE EXCEPTION 'DATA_CHANGED: %',r.name; END IF;
 END LOOP;
 IF (SELECT permissions FROM private.erp_membership_revocations WHERE tenant_id='{T}' AND user_id='{target}') IS DISTINCT FROM ARRAY['products.read'] THEN
  RAISE EXCEPTION 'READ_CEILING_CHANGED'; END IF;
END $$;SELECT private.erp_assert_recovery_integrity();ROLLBACK;"""
        migration = MIGRATION.read_bytes().decode().replace('BEGIN;', '', 1).removesuffix('COMMIT;\n')
        try:
            self.good(before + migration + after)
        finally:
            self.good(RESUME)



if __name__ == '__main__':
    unittest.main(verbosity=2)
