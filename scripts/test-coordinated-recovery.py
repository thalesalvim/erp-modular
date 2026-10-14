#!/usr/bin/env python3
"""Consolidated A/B regression: synthetic identities, isolated PostgreSQL 17 only."""
import importlib.util
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('restoration',Path(__file__).with_name('test-membership-restoration.py'))
s=importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
r=s.r
T,OWNER,EMPLOYEE,MANAGER=s.T,s.OWNER,s.EMPLOYEE,s.MANAGER
RECOVERY=r.lifecycle.RECOVERY

class CoordinatedRecovery(s.Restoration):
 def disable(self,version=1):
  return f"SELECT * FROM public.erp_set_employee_active('{T}','{self.staff}',{version},false,'offboarding')"
 def prepare(self,reverse=False):
  self.link()
  if reverse: self.good(self.revoke(),OWNER)
  self.good(self.disable(),OWNER)
  if not reverse: self.good(self.revoke(),OWNER)
 def recover(self,ev=2,mv=None,confirm='true',permissions="ARRAY['products.read']",tenant=T,staff=None,user=None):
  return f"SELECT * FROM public.erp_recover_employee_membership('{tenant}','{user or self.user}','{staff or self.staff}',{ev},{mv or self.revision()},{confirm},{permissions})"
 def blocked(self):
  self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",self.user),'0')
  self.assertEqual(self.good(f"SELECT is_active FROM private.erp_employee_lifecycle WHERE tenant_id='{T}' AND employee_id='{self.staff}'"),'f')
 def test_disable_then_revoke_then_joint_recovery(self):
  self.prepare(); self.blocked(); old=self.revision()
  self.good(self.recover(),OWNER)
  self.assertEqual(self.revision(),old+1)
  self.assertEqual(self.good(f"SELECT version FROM public.erp_employees WHERE tenant_id='{T}' AND id='{self.staff}'"),'3')
  self.assertGreater(int(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",self.user)),0)
  for table in ['erp_sale_finance','erp_product_costs','tenant_data']:
   if table=='tenant_data': r.f.assert_legacy_read(self,T,self.user,'0')
   else: self.assertEqual(self.good(f"SELECT count(*) FROM public.{table} WHERE tenant_id='{T}'",self.user),'0')
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_membership_revocation_audit WHERE user_id='{self.user}' AND action='restore'"),'1')
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_employee_lifecycle_audit WHERE employee_id='{self.staff}' AND next_active"),'1')
 def test_revoke_then_disable_then_joint_recovery(self):
  self.prepare(reverse=True); self.good(self.recover(),OWNER)
  self.assertGreater(int(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",self.user)),0)
 def test_repeated_revokes_with_proven_chain(self):
  self.prepare(); self.good(self.revoke(),OWNER); self.good(self.recover(),OWNER)
 def test_stale_versions_confirmation_and_escalation(self):
  self.prepare()
  self.denied(self.recover(ev=1),OWNER,'40001')
  self.denied(self.recover(mv=self.revision()-1),OWNER,'40001')
  self.denied(self.recover(confirm='false'),OWNER,'22023')
  for permissions in ["ARRAY['employees.update']","ARRAY['finance.sales.read']","ARRAY['platform_admin']","ARRAY['services.read']"]:
   self.denied(self.recover(permissions=permissions),OWNER)
  self.denied(self.recover(permissions="ARRAY['products.read','products.read']"),OWNER,'22023')
  self.blocked()
 def test_manager_employee_anon_foreign_tenant_and_uuid_denied(self):
  self.prepare()
  for actor in [MANAGER,EMPLOYEE,self.user]: self.denied(self.recover(),actor)
  self.denied(self.recover(),None,role='anon')
  self.denied(self.recover(tenant=r.A),OWNER)
  self.denied(self.recover(user=EMPLOYEE),OWNER,'40001')
  self.denied(self.recover(staff=r.f.uuid(99999)),OWNER)
  self.blocked()
 def test_owner_cannot_be_recovered_as_employee(self):
  self.prepare()
  self.denied(self.recover(user=OWNER),OWNER,'40001')
  self.assertEqual(self.good(f"SELECT is_active FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{OWNER}'"),'t')
 def admin_block(self):
  self.good(f"UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='{T}' AND user_id='{self.user}'")
 def test_independent_block_before_both_operations(self):
  self.link(); self.admin_block(); self.good(self.disable(),OWNER); self.good(self.revoke(),OWNER)
  self.denied(self.recover(),OWNER,'40001'); self.blocked()
 def test_independent_block_between_disable_and_revoke(self):
  self.link(); self.good(self.disable(),OWNER); self.admin_block(); self.good(self.revoke(),OWNER)
  self.denied(self.recover(),OWNER,'40001'); self.blocked()
 def test_independent_block_after_both_survives_rerevocation(self):
  self.prepare(); self.admin_block(); self.denied(self.recover(),OWNER,'40001')
  self.good(self.revoke(),OWNER); self.denied(self.recover(),OWNER,'40001'); self.blocked()
 def test_reverse_order_independent_block_survives(self):
  self.link(); self.good(self.revoke(),OWNER); self.admin_block(); self.good(self.disable(),OWNER)
  self.good(self.revoke(),OWNER); self.denied(self.recover(),OWNER,'40001'); self.blocked()
 def test_empty_confirmed_ceiling(self):
  self.prepare(); self.good(self.recover(permissions='ARRAY[]::text[]'),OWNER)
  self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",self.user),'0')
 def test_current_grant_removal_cannot_be_recovered(self):
  self.prepare()
  rev=self.good(f"SELECT revision FROM private.erp_policy_state WHERE tenant_id='{T}'")
  self.good(f"SELECT public.erp_set_role_permissions('{T}','employee',ARRAY[]::text[],{rev})",OWNER)
  self.denied(self.recover(),OWNER); self.blocked()
  self.good(self.recover(permissions='ARRAY[]::text[]'),OWNER)
 def test_direct_upsert_and_private_state_manipulation_denied(self):
  self.prepare()
  self.denied(f"UPDATE public.tenant_memberships SET is_active=true WHERE user_id='{self.user}'",OWNER)
  self.denied(f"INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES('{T}','{self.user}','employee') ON CONFLICT(tenant_id,user_id) DO UPDATE SET is_active=true",OWNER,role='service_role')
  self.denied('UPDATE private.erp_employee_lifecycle SET is_active=true',OWNER)
  self.denied('UPDATE private.erp_membership_revocations SET is_revoked=false',self.user)
  self.blocked()
 def test_rollback_audits_and_both_states(self):
  self.prepare(); cmd=self.recover(); rev=self.revision()
  self.denied('BEGIN;'+cmd+';'+cmd+';COMMIT;',OWNER,'40001')
  self.assertEqual(self.revision(),rev); self.blocked()
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_employee_lifecycle_audit WHERE employee_id='{self.staff}' AND next_active"),'0')
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_membership_revocation_audit WHERE user_id='{self.user}' AND action='restore'"),'0')
 def test_independent_activation_trigger_failure_rolls_back(self):
  self.prepare()
  self.good("CREATE FUNCTION public.test_admin_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.is_active THEN RAISE EXCEPTION 'ADMIN_BLOCK' USING ERRCODE='42501'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_admin_block BEFORE UPDATE ON public.tenant_memberships FOR EACH ROW EXECUTE FUNCTION public.test_admin_block();")
  try:
   self.denied(self.recover(),OWNER); self.blocked()
  finally:
   self.good('DROP TRIGGER test_admin_block ON public.tenant_memberships; DROP FUNCTION public.test_admin_block();')
 def test_two_connections_recovery_then_stale_deactivation_conflicts(self):
  self.prepare(); cmd=self.recover()
  with r.lifecycle.concurrent.futures.ThreadPoolExecutor() as pool:
   first=pool.submit(self.sql,"SET application_name='joint-recover';BEGIN;"+cmd+';SELECT pg_sleep(1);COMMIT;',OWNER)
   self.wait_for('joint-recover')
   second=pool.submit(self.sql,self.disable(version=2),OWNER)
   result=first.result(); self.assertEqual(result.returncode,0,result.stderr)
   result=second.result(); self.assertNotEqual(result.returncode,0); self.assertIn('40001',result.stderr)
  self.good(self.disable(version=3),OWNER); self.blocked()
 def test_two_connections_deactivation_serializes_before_recovery(self):
  self.link(); self.good(self.revoke(),OWNER); mv=self.revision()
  with r.lifecycle.concurrent.futures.ThreadPoolExecutor() as pool:
   first=pool.submit(self.sql,"SET application_name='joint-disable';BEGIN;"+self.disable()+';SELECT pg_sleep(1);COMMIT;',OWNER)
   self.wait_for('joint-disable')
   second=pool.submit(self.sql,self.recover(ev=1,mv=mv),OWNER)
   result=first.result(); self.assertEqual(result.returncode,0,result.stderr)
   result=second.result(); self.assertNotEqual(result.returncode,0); self.assertIn('40001',result.stderr)
  self.blocked(); self.good(self.recover(),OWNER)
 def test_auth_master_history_and_snapshots_unchanged(self):
  history=r.lifecycle.history.HistoricalSnapshots(); history.setUp()
  self.link(); self.good(history.sale(p_seller=self.staff),OWNER); historical=history.sale_state()
  self.good(self.disable(),OWNER); self.good(self.revoke(),OWNER)
  self.good(f"INSERT INTO public.platform_admins(user_id) VALUES('{self.user}')")
  before=self.good("SELECT md5(string_agg(to_jsonb(s)::text,'' ORDER BY tenant_id,id)) FROM public.erp_sale_finance s")
  self.good(self.recover(),OWNER)
  self.assertEqual(self.good("SELECT md5(string_agg(to_jsonb(s)::text,'' ORDER BY tenant_id,id)) FROM public.erp_sale_finance s"),before)
  self.assertEqual(history.sale_state(),historical)
  self.assertEqual(self.good(f"SELECT count(*) FROM auth.users WHERE id='{self.user}'"),'1')
  self.assertEqual(self.good(f"SELECT count(*) FROM public.platform_admins WHERE user_id='{self.user}'"),'1')

class RecoveryIntegrity(unittest.TestCase):
 sql=staticmethod(r.f.ProductConcurrency.sql)
 good=r.f.ProductConcurrency.good
 denied=r.f.ProductConcurrency.denied
 @classmethod
 def setUpClass(cls): r.f.ProductConcurrency.setUpClass.__func__(cls)
 def setUp(self): self.good((RECOVERY/'phase-2a-enter-maintenance.sql').read_bytes().decode('utf-8'))
 def tearDown(self): self.good((RECOVERY/'phase-2a-resume-normalized.sql').read_bytes().decode('utf-8'))
 def attack(self,ddl):
  resume=(RECOVERY/'phase-2a-resume-normalized.sql').read_bytes().decode('utf-8').replace('BEGIN;','').replace('COMMIT;','')
  result=self.sql('BEGIN;'+ddl+';'+resume+';COMMIT;')
  self.assertNotEqual(result.returncode,0,result.stdout)
  self.assertIn('RECOVERY_SCHEMA_DRIFT',result.stderr)
  # DDL was synthetic and rolled back; maintenance entered BEFORE this transaction stays on.
  self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'t')
 def test_missing_critical_trigger(self):
  definition=self.good("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.erp_products'::regclass AND tgname='erp_guard_record'")
  self.good('DROP TRIGGER erp_guard_record ON public.erp_products')
  try:
   result=self.sql((RECOVERY/'phase-2a-resume-normalized.sql').read_bytes().decode('utf-8'))
   self.assertNotEqual(result.returncode,0); self.assertIn('RECOVERY_SCHEMA_DRIFT',result.stderr)
   self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'t')
   self.assertEqual(self.good("SELECT count(*) FROM pg_trigger WHERE tgrelid='public.erp_products'::regclass AND tgname='erp_guard_record'"),'0')
   self.denied(r.f.rpc(r.lifecycle.history.PRODUCT,1,{'price':222}),OWNER)
  finally:
   # Restore only the disposable fixture, never as part of the recovery command.
   self.good(definition)

 def test_disabled_trigger(self): self.attack('ALTER TABLE public.erp_products DISABLE TRIGGER erp_guard_record')
 def test_same_name_changed_trigger_definition(self):
  self.attack('DROP TRIGGER erp_guard_record ON public.erp_products; CREATE TRIGGER erp_guard_record BEFORE INSERT ON public.erp_products FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record()')
 def test_changed_trigger_function(self):
  self.attack("CREATE OR REPLACE FUNCTION private.erp_guard_record() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RETURN NEW; END $$")
 def test_changed_policy(self):
  name=self.good("SELECT polname FROM pg_policy WHERE polrelid='public.erp_products'::regclass AND polcmd='r' ORDER BY polname LIMIT 1")
  self.attack(f'ALTER POLICY "{name}" ON public.erp_products USING(true)')
 def test_extra_policy(self): self.attack('CREATE POLICY forged ON public.erp_products FOR SELECT TO authenticated USING(true)')
 def test_changed_table_grant(self): self.attack('GRANT UPDATE ON public.erp_products TO authenticated')
 def test_changed_column_grant(self): self.attack('GRANT UPDATE(price) ON public.erp_products TO authenticated')
 def test_changed_rpc_grant(self): self.attack('GRANT EXECUTE ON FUNCTION public.erp_recover_employee_membership(uuid,uuid,uuid,bigint,bigint,boolean,text[]) TO anon')
 def test_disabled_rls(self): self.attack('ALTER TABLE public.erp_products DISABLE ROW LEVEL SECURITY')
 def test_dropped_constraint(self):
  name=self.good("SELECT conname FROM pg_constraint WHERE conrelid='public.erp_products'::regclass AND contype='c' ORDER BY conname LIMIT 1")
  self.attack(f'ALTER TABLE public.erp_products DROP CONSTRAINT "{name}"')
 def test_capability_role_and_membership_drift(self):
  self.attack('ALTER ROLE handyhub_membership_reviewer BYPASSRLS')
  self.attack('GRANT handyhub_membership_reviewer TO authenticated')
 def test_changed_rpc_search_path(self):
  self.attack("ALTER FUNCTION public.erp_recover_employee_membership(uuid,uuid,uuid,bigint,bigint,boolean,text[]) SET search_path=public")
 def test_bootstrap_refuses_preexisting_drift(self):
  source=(Path(__file__).resolve().parents[1]/'supabase/migrations/20261012030100_erp_recovery_integrity.sql').read_bytes().decode('utf-8')
  check=source.split('-- BEGIN_EXPECTED_DEFINITIONS')[1].split('-- END_EXPECTED_DEFINITIONS')[0]
  for ddl in ['DROP TRIGGER erp_guard_record ON public.erp_products','GRANT UPDATE(price) ON public.erp_products TO authenticated']:
   result=self.sql('BEGIN;'+ddl+';'+check+';ROLLBACK;')
   self.assertNotEqual(result.returncode,0); self.assertIn('RECOVERY_UNREVIEWED_SCHEMA',result.stderr)
  self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'t')
 def test_schema_seal_immutable_and_unexposed(self):
  self.denied("UPDATE private.erp_recovery_schema_seal SET snapshot='{}'",None,'55000')
  self.denied('SELECT * FROM private.erp_recovery_schema_seal',OWNER)
  self.denied('SELECT private.erp_recovery_schema_snapshot()',OWNER)
 def test_intact_schema_allows_resume_preserving_data(self):
  before=self.good("SELECT md5(string_agg(to_jsonb(s)::text,'' ORDER BY tenant_id,id)) FROM public.erp_sales s")
  self.good((RECOVERY/'phase-2a-verify.sql').read_bytes().decode('utf-8'))
  self.good((RECOVERY/'phase-2a-resume-normalized.sql').read_bytes().decode('utf-8'))
  self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'f')
  self.assertEqual(self.good("SELECT md5(string_agg(to_jsonb(s)::text,'' ORDER BY tenant_id,id)) FROM public.erp_sales s"),before)
  self.denied('SELECT payload FROM public.tenant_data',OWNER)
  self.good((RECOVERY/'phase-2a-enter-maintenance.sql').read_bytes().decode('utf-8'))

if __name__=='__main__':
 classes=[CoordinatedRecovery,RecoveryIntegrity]
 cases=[c(n) for c in classes for n in c.__dict__ if n.startswith('test_') and (not sys.argv[1:] or n in sys.argv[1:])]
 result=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(cases))
 sys.exit(not result.wasSuccessful())
