#!/usr/bin/env python3
"""Lifecycle/recovery probes in disposable PostgreSQL 17.11; no remote DSN/data."""
import concurrent.futures
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('history_fixture', Path(__file__).with_name('test-historical-snapshots.py'))
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)
fixture = history.fixture
T, A, OWNER, EMPLOYEE, MANAGER = history.T, history.A, history.OWNER, history.EMPLOYEE, history.MANAGER
STAFF = history.SELLER
RECOVERY = fixture.ROOT / 'supabase/recovery'


class EmployeeLifecycle(unittest.TestCase):
    setUpClass = classmethod(fixture.ProductConcurrency.setUpClass.__func__)
    sql = staticmethod(fixture.ProductConcurrency.sql)
    good = fixture.ProductConcurrency.good
    denied = fixture.ProductConcurrency.denied
    wait_for = fixture.ProductConcurrency.wait_for

    def setUp(self):
        self.good("UPDATE private.erp_runtime_control SET maintenance=false;")
        self.good("DELETE FROM private.erp_employee_lifecycle;")
        self.good("UPDATE public.tenant_memberships SET is_active=true;")
        self.version = int(self.good(f"SELECT version FROM public.erp_employees WHERE tenant_id='{T}' AND id='{STAFF}'"))
        rev = self.good(f"SELECT coalesce((SELECT revision FROM private.erp_policy_state WHERE tenant_id='{T}'),0)")
        self.good(f"SELECT public.erp_set_role_permissions('{T}','employee',ARRAY['appointments.read_own','sales.read_own','attendances.read_own'],{rev})", OWNER)

    def command(self, active, version=None, tenant=T, staff=STAFF):
        reason = 'authorized_return' if active else 'offboarding'
        return f"SELECT * FROM public.erp_set_employee_active('{tenant}','{staff}',{version or self.version},{str(active).lower()},'{reason}');"

    def active(self):
        return self.good(f"SELECT is_active FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{EMPLOYEE}'")

    def post(self):
        sale = history.HistoricalSnapshots()
        sale.setUp()
        self.version = int(self.good(f"SELECT version FROM public.erp_employees WHERE tenant_id='{T}' AND id='{STAFF}'"))
        self.good(sale.sale(), OWNER)
        return sale

    def test_deactivation_revokes_reads_and_preserves_history_identity_and_auth(self):
        sale = self.post()
        before = sale.sale_state()
        links = self.good(f"SELECT auth_user_id FROM private.erp_employee_auth_links WHERE tenant_id='{T}' AND employee_id='{STAFF}'")
        self.good(self.command(False), OWNER)
        self.assertEqual(self.active(),'f')
        for table in ['erp_appointments','erp_sales','erp_attendances','tenant_data']:
            self.assertEqual(self.good(f"SELECT count(*) FROM public.{table} WHERE tenant_id='{T}'", EMPLOYEE),'0')
        self.denied(f"SELECT * FROM public.erp_read_own_appointments('{T}')", EMPLOYEE)
        self.assertEqual(sale.sale_state(),before)
        self.assertEqual(self.good(f"SELECT auth_user_id FROM private.erp_employee_auth_links WHERE tenant_id='{T}' AND employee_id='{STAFF}'"),links)
        self.assertEqual(self.good(f"SELECT count(*) FROM auth.users WHERE id='{EMPLOYEE}'"),'1')

    def test_disabled_staff_cannot_be_used_for_new_sales_or_attendances(self):
        sale = history.HistoricalSnapshots(); sale.setUp()
        version = int(self.good(f"SELECT version FROM public.erp_employees WHERE tenant_id='{T}' AND id='{STAFF}'"))
        self.good(self.command(False, version), OWNER)
        self.denied(sale.sale(), OWNER)
        self.denied(sale.service(), OWNER)
        sale.assert_sale_absent()
        self.denied(fixture.rpc(history.PRODUCT,sale.product_version,{'price':101}),EMPLOYEE)
        self.denied(f"UPDATE public.erp_employees SET version=version WHERE id='{STAFF}'",EMPLOYEE)

    def test_only_owner_can_reactivate_and_direct_writes_or_role_forgery_fail(self):
        self.good(self.command(False),OWNER)
        for user in [EMPLOYEE,MANAGER,fixture.ADMIN,fixture.uuid(6)]:
            self.denied(self.command(True,self.version+1),user)
        self.denied(self.command(True,self.version+1),None,role='anon')
        self.denied('SET ROLE handyhub_lifecycle_operator',OWNER)
        self.denied(f"UPDATE public.tenant_memberships SET is_active=true WHERE user_id='{EMPLOYEE}'",OWNER)
        self.denied('UPDATE private.erp_employee_lifecycle SET is_active=true',OWNER)
        self.good(self.command(True,self.version+1),OWNER)
        self.assertEqual(self.active(),'t')
        self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_appointments WHERE tenant_id='{T}'",EMPLOYEE),'1')

    def test_independent_membership_block_is_preserved_and_later_changes_conflict(self):
        self.good(f"UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='{T}' AND user_id='{EMPLOYEE}'")
        self.good(self.command(False),OWNER)
        self.good(self.command(True,self.version+1),OWNER)
        self.assertEqual(self.active(),'f')
        self.good(f"UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{EMPLOYEE}'")
        self.good(self.command(False,self.version+2),OWNER)
        # Even a repeated independent block increments membership revision.
        self.good(f"UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='{T}' AND user_id='{EMPLOYEE}'")
        self.denied(self.command(True,self.version+3),OWNER,'40001')
        self.assertEqual(self.active(),'f')

    def test_external_membership_enable_does_not_bypass_inactive_staff(self):
        self.good(self.command(False),OWNER)
        self.denied(f"UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{EMPLOYEE}'",None,'42501')
        self.assertEqual(self.active(),'f')
        self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_appointments WHERE tenant_id='{T}'",EMPLOYEE),'0')
        self.assertEqual(self.good(f"SELECT count(*) FROM public.tenant_data WHERE tenant_id='{T}'",EMPLOYEE),'0')

    def test_foreign_tenant_and_same_auth_identity_other_tenant_are_independent(self):
        self.denied(self.command(False,tenant=A),OWNER)
        self.good(f"""INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES('{A}','{EMPLOYEE}','employee');
          INSERT INTO private.erp_employee_auth_links VALUES('{A}','{fixture.uuid(10101)}','{EMPLOYEE}');""")
        self.good(self.command(False),OWNER)
        self.assertEqual(self.good(f"SELECT is_active FROM public.tenant_memberships WHERE tenant_id='{A}' AND user_id='{EMPLOYEE}'"),'t')
        self.assertEqual(self.good(f"SELECT private.has_tenant_role('{A}',ARRAY['employee'])",EMPLOYEE),'t')

    def test_unlinked_staff_can_be_disabled_without_guessing_an_auth_identity(self):
        staff = fixture.uuid(10303)
        version = int(self.good(f"SELECT version FROM public.erp_employees WHERE tenant_id='{T}' AND id='{staff}'"))
        self.assertTrue(self.good(self.command(False,version,staff=staff),OWNER).endswith('|f|'))
        self.assertEqual(self.good(f"SELECT linked_user_id IS NULL FROM private.erp_employee_lifecycle WHERE tenant_id='{T}' AND employee_id='{staff}'"),'t')
        self.denied(f"INSERT INTO private.erp_employee_auth_links VALUES('{T}','{staff}','{MANAGER}')",None,'42501')
        self.good(self.command(True,version+1,staff=staff),OWNER)

    def test_owner_identity_cannot_be_disabled_by_this_flow(self):
        staff = fixture.uuid(10303)
        self.good(f"INSERT INTO private.erp_employee_auth_links VALUES('{T}','{staff}','{OWNER}')")
        try:
            version = int(self.good(f"SELECT version FROM public.erp_employees WHERE tenant_id='{T}' AND id='{staff}'"))
            self.denied(self.command(False,version,staff=staff),OWNER)
        finally:
            self.good(f"DELETE FROM private.erp_employee_auth_links WHERE tenant_id='{T}' AND employee_id='{staff}'")

    def test_before_use_ddl_rollback_preserves_closed_json_and_original_data(self):
        # Fresh cluster: roles are cluster-wide, so a second database is insufficient.
        name = f'handyhub-rollback-before-{os.getpid()}'
        subprocess.run(['docker','run','-d','--rm','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data',
                        '-e','POSTGRES_HOST_AUTH_METHOD=trust',fixture.IMAGE],check=True,stdout=subprocess.DEVNULL)
        try:
            for _ in range(100):
                ready = subprocess.run(['docker','exec',name,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres'],
                                       stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                if ready.returncode==0: break
                time.sleep(.1)
            else: self.fail('Fresh PostgreSQL not ready')
            def query(statement):
                return subprocess.run(['docker','exec','-i',name,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
                                      input=statement,text=True,capture_output=True,timeout=30)
            js = """
import {setup,additions,read} from './tests/helpers/tenant-domain-fixture.mjs';
const out=[]; const q=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+v.replaceAll("'","''")+"'";
class Recorder {async exec(sql){out.push(sql+';')} async query(sql,args=[]){out.push(sql.replace(/\\$(\\d+)/g,(_,n)=>q(args[Number(n)-1]))+';');return {rows:[]}}}
await setup(()=>new Recorder());
// This safety barrier is OUTSIDE the DDL transaction, so rollback cannot undo it.
out.push(`REVOKE ALL ON public.tenant_data FROM PUBLIC,anon,authenticated,service_role;
REVOKE SELECT(tenant_id,tenant_slug,data_key,payload,updated_at),INSERT(tenant_id,tenant_slug,data_key,payload,updated_at),
UPDATE(tenant_id,tenant_slug,data_key,payload,updated_at) ON public.tenant_data FROM PUBLIC,anon,authenticated,service_role;`);
out.push('BEGIN;');
for(const f of additions) out.push((await read('supabase/migrations/'+f)).replace(/^BEGIN;$/gm,'').replace(/^COMMIT;$/gm,''));
out.push('ROLLBACK;');process.stdout.write(out.join('\\n'));
"""
            sql = subprocess.run(['node','--input-type=module','-e',js],cwd=fixture.ROOT,capture_output=True,text=True,check=True).stdout
            result = query(sql); self.assertEqual(result.returncode,0,result.stderr)
            result = query("SELECT to_regclass('public.erp_employees') IS NULL,to_regclass('private.erp_runtime_control') IS NULL; SELECT count(*),bool_and(payload=jsonb_build_object('untouched',right(tenant_slug,1))) FROM public.tenant_data;")
            self.assertEqual(result.returncode,0,result.stderr); self.assertEqual(result.stdout.strip(),'t|t\n3|t')
            result = query(f"SET SESSION AUTHORIZATION authenticated; SET request.jwt.claim.sub='{EMPLOYEE}'; SELECT payload FROM public.tenant_data;")
            self.assertNotEqual(result.returncode,0); self.assertIn('42501',result.stderr)
        finally:
            subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

    def test_retention_fks_and_immutable_audit_prevent_cascading_deletion(self):
        sale = self.post(); self.good(self.command(False),OWNER)
        self.denied(f"DELETE FROM auth.users WHERE id='{EMPLOYEE}'",None,'23503')
        self.denied(f"DELETE FROM public.erp_employees WHERE tenant_id='{T}' AND id='{STAFF}'",None,'23503')
        self.denied('DELETE FROM private.erp_employee_lifecycle_audit',None,'55000')
        self.assertTrue(sale.sale_state())

    def test_incomplete_transaction_rolls_back_status_membership_version_and_audit(self):
        count = self.good('SELECT count(*) FROM private.erp_employee_lifecycle_audit')
        self.denied('BEGIN;'+self.command(False)+self.command(True)+'COMMIT;',OWNER,'40001')
        self.assertEqual(self.active(),'t')
        self.assertEqual(self.good('SELECT count(*) FROM private.erp_employee_lifecycle_audit'),count)
        self.assertEqual(self.good(f"SELECT version FROM public.erp_employees WHERE tenant_id='{T}' AND id='{STAFF}'"),str(self.version))

    def test_two_connections_serialize_operation_and_deactivation(self):
        sale = history.HistoricalSnapshots(); sale.setUp()
        version = int(self.good(f"SELECT version FROM public.erp_employees WHERE tenant_id='{T}' AND id='{STAFF}'"))
        with concurrent.futures.ThreadPoolExecutor() as pool:
            posting = pool.submit(self.sql,"SET application_name='lifecycle-post'; BEGIN;"+sale.sale()+'SELECT pg_sleep(2); COMMIT;',OWNER)
            self.wait_for('lifecycle-post')
            disabling = pool.submit(self.sql,"SET application_name='lifecycle-disable';"+self.command(False,version),OWNER)
            self.wait_for('lifecycle-disable','Lock')
            self.assertEqual(posting.result().returncode,0)
            result = disabling.result(); self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(sale.sale_state())
        self.assertEqual(self.active(),'f')

    def test_maintenance_resume_preserves_operations_and_never_restores_json(self):
        sale = self.post(); before = sale.sale_state()
        self.good((RECOVERY/'phase-2a-enter-maintenance.sql').read_text())
        self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'t')
        self.denied(self.command(False),OWNER)
        self.denied(fixture.rpc(history.PRODUCT,sale.product_version,{'price':101}),OWNER)
        self.denied("UPDATE public.erp_products SET name='blocked'",None,'55000')
        self.denied('SELECT payload FROM public.tenant_data',EMPLOYEE)
        self.good('BEGIN READ ONLY;'+(RECOVERY/'phase-2a-verify.sql').read_text()+'COMMIT;')
        self.assertEqual(sale.sale_state(),before)
        self.good((RECOVERY/'phase-2a-resume-normalized.sql').read_text())
        self.denied('DELETE FROM private.erp_recovery_events',None,'55000')
        self.denied('SELECT payload FROM public.tenant_data',EMPLOYEE)
        self.denied('SELECT payload FROM public.tenant_data',OWNER)
        self.assertEqual(sale.sale_state(),before)

    def test_resume_rejects_disabled_integrity_trigger_and_unsafe_legacy_grants(self):
        self.good((RECOVERY/'phase-2a-enter-maintenance.sql').read_text())
        self.good('ALTER TABLE public.erp_sales DISABLE TRIGGER erp_validate_history')
        result = self.sql((RECOVERY/'phase-2a-resume-normalized.sql').read_text())
        self.assertNotEqual(result.returncode,0); self.assertIn('RECOVERY_SCHEMA_DRIFT',result.stderr)
        self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'t')
        self.good('ALTER TABLE public.erp_sales ENABLE TRIGGER erp_validate_history; GRANT SELECT(payload) ON public.tenant_data TO authenticated')
        result = self.sql((RECOVERY/'phase-2a-resume-normalized.sql').read_text())
        self.assertNotEqual(result.returncode,0); self.assertIn('UNSAFE_LEGACY_FALLBACK',result.stderr)
        self.good('REVOKE SELECT(payload) ON public.tenant_data FROM authenticated')


if __name__ == '__main__':
    unittest.main(verbosity=2)
