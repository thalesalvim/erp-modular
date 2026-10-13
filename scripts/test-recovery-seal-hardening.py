#!/usr/bin/env python3
"""B1/B2 adversarial probes: isolated PostgreSQL, no remote DSN or real identities."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
sys.dont_write_bytecode=True
sp=importlib.util.spec_from_file_location('recovery',Path(__file__).with_name('test-coordinated-recovery.py'))
c=importlib.util.module_from_spec(sp);sp.loader.exec_module(c)
r,f=c.r,c.r.f
T,OWNER,EMPLOYEE=c.T,c.OWNER,c.EMPLOYEE
ROOT=f.ROOT
B=ROOT/'supabase/migrations/20261012030100_erp_recovery_integrity.sql'
REC=c.RECOVERY
RESUME=(REC/'phase-2a-resume-normalized.sql').read_text()

def body(sql):
 return sql.replace('BEGIN;','').replace('COMMIT;','')

class BeforeSeal(unittest.TestCase):
 sql=staticmethod(f.ProductConcurrency.sql)
 good=f.ProductConcurrency.good
 denied=f.ProductConcurrency.denied
 @classmethod
 def setUpClass(cls):
  original=subprocess.run
  def run(args,*a,**kw):
   if isinstance(args,list) and args[:3]==['node','--input-type=module','-e']:
    args=args.copy()
    args[3]=args[3].replace('for(const f of additions)',"for(const f of additions.filter(n=>!n.startsWith('202610120301')&&!n.startsWith('202610120302')))")
   return original(args,*a,**kw)
  with patch.object(subprocess,'run',side_effect=run):
   f.ProductConcurrency.setUpClass.__func__(cls)
 def rejected_install(self,ddl,marker):
  result=self.sql('BEGIN;'+ddl+';'+body(B.read_text())+';COMMIT;')
  self.assertNotEqual(result.returncode,0);self.assertIn(marker,result.stderr)
  self.assertEqual(self.good("SELECT to_regclass('private.erp_recovery_schema_seal') IS NULL"),'t')
 def test_all_27_business_tables_require_rls_and_force_before_install(self):
  tables=self.good("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND left(c.relname,4)='erp_' AND relkind='r' ORDER BY relname").splitlines()
  self.assertEqual(len(tables),27)
  for name in tables:
   for alteration in ['DISABLE ROW LEVEL SECURITY','NO FORCE ROW LEVEL SECURITY']:
    with self.subTest(table=name,alteration=alteration):
     self.rejected_install(f'ALTER TABLE public.{name} {alteration}','RLS_INVARIANT')
  self.assertEqual(self.good('SELECT count(*) FROM public.erp_sale_finance',f.uuid(6)),'0')
 def test_metadata_and_history_force_expectations(self):
  self.rejected_install('ALTER TABLE private.erp_history_postings NO FORCE ROW LEVEL SECURITY','METADATA_RLS_INVARIANT')
  self.rejected_install('ALTER TABLE private.erp_role_permissions DISABLE ROW LEVEL SECURITY','METADATA_RLS_INVARIANT')
 def test_policy_column_catalog_and_function_owner_cannot_become_reference(self):
  for ddl in [
   'ALTER POLICY erp_read ON public.erp_sale_finance USING(true)',
   'ALTER TABLE public.erp_products ALTER COLUMN name DROP NOT NULL',
   "UPDATE private.erp_permission_catalog SET delegable_to=ARRAY['manager','employee'] WHERE permission='finance.sales.read'",
   'ALTER FUNCTION public.erp_update_product(uuid,uuid,bigint,jsonb,jsonb,jsonb) OWNER TO postgres',
  ]:
   with self.subTest(ddl=ddl): self.rejected_install(ddl,'RECOVERY_UNREVIEWED_SCHEMA')
 def test_bootstrap_refuses_unsafe_execution_and_defaults(self):
  self.rejected_install("SET LOCAL session_replication_role='replica'",'RECOVERY_UNSAFE_SESSION_MODE')
  self.rejected_install("ALTER ROLE authenticated SET session_replication_role='replica'",'RECOVERY_UNSAFE_REPLICATION_DEFAULT')
  self.rejected_install('GRANT SET ON PARAMETER session_replication_role TO authenticated','RECOVERY_UNSAFE_PARAMETER_PRIVILEGE')
 def test_intact_install_and_resume(self):
  self.good(B.read_text())
  self.good((REC/'phase-2a-enter-maintenance.sql').read_text()); self.good(RESUME)
  self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'f')
  self.assertEqual(self.good('SELECT count(*) FROM public.erp_sale_finance',f.uuid(6)),'0')

class AfterSeal(unittest.TestCase):
 sql=staticmethod(f.ProductConcurrency.sql)
 good=f.ProductConcurrency.good
 denied=f.ProductConcurrency.denied
 wait_for=f.ProductConcurrency.wait_for
 @classmethod
 def setUpClass(cls): f.ProductConcurrency.setUpClass.__func__(cls)
 def setUp(self): self.good((REC/'phase-2a-enter-maintenance.sql').read_text())
 def tearDown(self): self.good(RESUME)
 def rejected_resume(self,ddl,marker):
  result=self.sql('BEGIN;'+ddl+';'+body(RESUME)+';COMMIT;')
  self.assertNotEqual(result.returncode,0);self.assertIn(marker,result.stderr)
  self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'t')
 def test_safe_admin_session_but_database_default_replica(self):
  self.good("ALTER DATABASE postgres SET session_replication_role='replica'")
  try:
   self.assertEqual(self.good('SHOW session_replication_role'),'replica')
   result=self.sql("SET session_replication_role='origin';"+RESUME)
   self.assertNotEqual(result.returncode,0);self.assertIn('RECOVERY_UNSAFE_REPLICATION_DEFAULT',result.stderr)
   self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'t')
  finally: self.good('ALTER DATABASE postgres RESET session_replication_role')
 def test_server_default_hidden_by_safe_current_setting_is_rejected(self):
  def wait_mode(mode):
   for _ in range(40):
    if self.good('SHOW session_replication_role')==mode: return
    time.sleep(.05)
   self.fail('Local reload did not become observable')
  self.good("ALTER SYSTEM SET session_replication_role='replica'")
  try:
   self.good('SELECT pg_reload_conf()');wait_mode('replica')
   self.assertEqual(self.good("SELECT count(*) FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) v WHERE v='session_replication_role=replica'"),'0')
   result=self.sql("SET session_replication_role='origin';"+RESUME)
   self.assertNotEqual(result.returncode,0);self.assertIn('RECOVERY_UNSAFE_REPLICATION_DEFAULT',result.stderr)
   self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'t')
  finally:
   self.good('ALTER SYSTEM RESET session_replication_role')
   self.good('SELECT pg_reload_conf()');wait_mode('origin')
 def test_role_and_role_database_defaults(self):
  self.rejected_resume("ALTER ROLE authenticated SET session_replication_role='replica'",'RECOVERY_UNSAFE_REPLICATION_DEFAULT')
  self.rejected_resume("ALTER ROLE authenticated IN DATABASE postgres SET session_replication_role='replica'",'RECOVERY_UNSAFE_REPLICATION_DEFAULT')
  self.rejected_resume("ALTER ROLE authenticated SET session_replication_role='replica'; ALTER ROLE authenticated IN DATABASE postgres SET session_replication_role='origin'",'RECOVERY_UNSAFE_REPLICATION_DEFAULT')
 def test_new_login_connection_inherits_role_database_default(self):
  self.good("CREATE ROLE seal_pool_probe LOGIN NOINHERIT; ALTER ROLE seal_pool_probe IN DATABASE postgres SET session_replication_role='replica'")
  try:
   result=subprocess.run(['docker','exec',f.CONTAINER,'psql','-XAtq','-U','seal_pool_probe','-d','postgres','-c','SHOW session_replication_role'],capture_output=True,text=True,timeout=10)
   self.assertEqual(result.returncode,0,result.stderr); self.assertEqual(result.stdout.strip(),'replica')
   result=self.sql(RESUME)
   self.assertNotEqual(result.returncode,0);self.assertIn('RECOVERY_UNSAFE_REPLICATION_DEFAULT',result.stderr)
  finally: self.good('ALTER ROLE seal_pool_probe IN DATABASE postgres RESET session_replication_role; DROP ROLE seal_pool_probe')
 def test_parameter_set_grants_and_reachable_noinherit_role(self):
  for target in ['authenticated','PUBLIC','handyhub_product_writer']:
   for privilege in ['SET','ALTER SYSTEM']:
    self.rejected_resume(f'GRANT {privilege} ON PARAMETER session_replication_role TO {target}','RECOVERY_UNSAFE_PARAMETER_PRIVILEGE')
  self.rejected_resume('CREATE ROLE seal_setter NOLOGIN; GRANT SET ON PARAMETER session_replication_role TO seal_setter; GRANT seal_setter TO authenticated WITH INHERIT FALSE, SET TRUE','RECOVERY_UNSAFE_PARAMETER_PRIVILEGE')
 def test_current_replica_or_local_mode_is_refused(self):
  for mode in ['replica','local']:
   self.rejected_resume(f"SET LOCAL session_replication_role='{mode}'",'RECOVERY_UNSAFE_SESSION_MODE')
 def test_policy_cannot_be_promoted_even_if_admin_replaces_stored_snapshot(self):
  # Attack fixture only: no production runbook may skip triggers to update a seal.
  self.rejected_resume("ALTER POLICY erp_read ON public.erp_sale_finance USING(true); SET LOCAL session_replication_role='replica'; UPDATE private.erp_recovery_schema_seal SET snapshot=private.erp_recovery_schema_snapshot(); SET LOCAL session_replication_role='origin'",'RECOVERY_UNREVIEWED_SCHEMA')
 def test_rls_force_cannot_be_promoted_to_new_reference(self):
  self.rejected_resume("ALTER TABLE public.erp_sale_finance NO FORCE ROW LEVEL SECURITY; SET LOCAL session_replication_role='replica'; UPDATE private.erp_recovery_schema_seal SET snapshot=private.erp_recovery_schema_snapshot(); SET LOCAL session_replication_role='origin'",'RLS_INVARIANT')
 def test_removed_changed_and_disabled_trigger(self):
  for ddl in [
   'DROP TRIGGER erp_guard_record ON public.erp_products',
   'ALTER TABLE public.erp_products DISABLE TRIGGER erp_guard_record',
   'DROP TRIGGER erp_guard_record ON public.erp_products; CREATE TRIGGER erp_guard_record BEFORE INSERT ON public.erp_products FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record()',
  ]: self.rejected_resume(ddl,'RECOVERY_UNREVIEWED_SCHEMA')
 def test_no_client_seal_update_or_parameter_change(self):
  for actor in [OWNER,c.MANAGER,EMPLOYEE,f.uuid(5)]:
   for sql in [
    'UPDATE private.erp_recovery_schema_seal SET snapshot=private.erp_recovery_schema_snapshot()',
    'SELECT private.erp_assert_reviewed_definitions()',
    "SET session_replication_role='replica'",
    'GRANT SET ON PARAMETER session_replication_role TO authenticated',
   ]: self.denied(sql,actor)
 def test_stale_pooled_connection_denies_operations_after_safe_resume(self):
  product=r.lifecycle.history.PRODUCT
  version=int(self.good(f"SELECT version FROM public.erp_products WHERE tenant_id='{T}' AND id='{product}'"))
  self.good("ALTER DATABASE postgres SET session_replication_role='replica'")
  try:
   with r.lifecycle.concurrent.futures.ThreadPoolExecutor() as pool:
    pending=pool.submit(self.sql,"SET application_name='seal-stale-pool'; SELECT current_setting('session_replication_role'); SELECT pg_sleep(2);"+f.rpc(product,version,{'price':919}),OWNER)
    self.wait_for('seal-stale-pool')
    self.good('ALTER DATABASE postgres RESET session_replication_role')
    self.good(RESUME)  # new administration connection also has a safe reset value
    result=pending.result();self.assertNotEqual(result.returncode,0);self.assertIn('42501',result.stderr);self.assertIn('replica',result.stdout)
   self.assertEqual(int(self.good(f"SELECT version FROM public.erp_products WHERE tenant_id='{T}' AND id='{product}'")),version)
   self.good(f.rpc(product,version,{'price':100}),OWNER)
   self.denied(f.rpc(product,version,{'price':200}),OWNER,'40001')
  finally:
   self.good('ALTER DATABASE postgres RESET session_replication_role')
   self.good((REC/'phase-2a-enter-maintenance.sql').read_text())
 def test_prepared_command_cannot_cache_safe_mode(self):
  self.good(RESUME)
  product=r.lifecycle.history.PRODUCT
  version=int(self.good(f"SELECT version FROM public.erp_products WHERE tenant_id='{T}' AND id='{product}'"))
  try:
   command=f.rpc(product,version,{'price':313})
   result=self.sql(f"PREPARE cached AS {command}; SET SESSION AUTHORIZATION authenticated; SET request.jwt.claim.sub='{OWNER}'; EXECUTE cached; RESET SESSION AUTHORIZATION; SET session_replication_role='replica'; SET SESSION AUTHORIZATION authenticated; EXECUTE cached;")
   self.assertNotEqual(result.returncode,0);self.assertIn('42501',result.stderr)
   self.assertEqual(int(self.good(f"SELECT version FROM public.erp_products WHERE tenant_id='{T}' AND id='{product}'")),version+1)
  finally: self.good((REC/'phase-2a-enter-maintenance.sql').read_text())
 def test_runtime_fence_blocks_reads_and_privileged_delegation_rpc(self):
  self.good(RESUME)
  try:
   prefix=f"SET session_replication_role='replica'; SET SESSION AUTHORIZATION authenticated; SET request.jwt.claim.sub='{OWNER}';"
   result=self.sql(prefix+'SELECT count(*) FROM public.erp_sale_finance;')
   self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout.strip(),'0')
   result=self.sql(prefix+f"SELECT public.erp_set_role_permissions('{T}','employee',ARRAY[]::text[],0)")
   self.assertNotEqual(result.returncode,0);self.assertIn('55000',result.stderr);self.assertIn('ERP_RUNTIME_UNAVAILABLE',result.stderr)
  finally: self.good((REC/'phase-2a-enter-maintenance.sql').read_text())
 def test_runtime_configuration_repair_and_intact_resume(self):
  self.good("ALTER ROLE authenticated IN DATABASE postgres SET session_replication_role='replica'")
  result=self.sql(RESUME);self.assertNotEqual(result.returncode,0)
  self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'t')
  self.good('ALTER ROLE authenticated IN DATABASE postgres RESET session_replication_role')
  self.good(RESUME);self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'f')
  self.denied('SELECT payload FROM public.tenant_data',OWNER)
  self.good((REC/'phase-2a-enter-maintenance.sql').read_text())

if __name__=='__main__':
 cases=[cls(name) for cls in [BeforeSeal,AfterSeal] for name in cls.__dict__ if name.startswith('test_') and (not sys.argv[1:] or name in sys.argv[1:])]
 result=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(cases))
 sys.exit(not result.wasSuccessful())
