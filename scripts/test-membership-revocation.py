#!/usr/bin/env python3
"""Synthetic identities, disposable PostgreSQL only; no remote Auth or DSN."""
import importlib.util
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('lifecycle',Path(__file__).with_name('test-employee-lifecycle.py'))
lifecycle=importlib.util.module_from_spec(spec); spec.loader.exec_module(lifecycle)
f=lifecycle.fixture
T, A, OWNER, MANAGER, EMPLOYEE=lifecycle.T,lifecycle.A,lifecycle.OWNER,lifecycle.MANAGER,lifecycle.EMPLOYEE

class MembershipRevocation(unittest.TestCase):
 sql=staticmethod(f.ProductConcurrency.sql)
 good=f.ProductConcurrency.good
 denied=f.ProductConcurrency.denied
 wait_for=f.ProductConcurrency.wait_for
 counter=1000
 @classmethod
 def setUpClass(cls):
  f.ProductConcurrency.setUpClass.__func__(cls)
  result=cls.sql('ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz;')
  if result.returncode: raise RuntimeError(result.stderr)
 def setUp(self):
  type(self).counter+=1
  self.user=f.uuid(type(self).counter)
  self.staff=f.uuid(type(self).counter+10000)
  self.good(f"INSERT INTO auth.users(id,email_confirmed_at) VALUES('{self.user}',now()); INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES('{T}','{self.user}','employee');")
  rev=self.good(f"SELECT coalesce((SELECT revision FROM private.erp_policy_state WHERE tenant_id='{T}'),0)")
  self.good(f"SELECT public.erp_set_role_permissions('{T}','employee',ARRAY['products.read','appointments.read_own','sales.read_own'],{rev})",OWNER)
 def revision(self,user=None):
  return int(self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{user or self.user}'"))
 def revoke(self,user=None,tenant=T,revision=None):
  return f"SELECT * FROM public.erp_revoke_membership('{tenant}','{user or self.user}',{revision or self.revision(user)},'identity_review')"
 def link(self):
  self.good(f"INSERT INTO public.erp_employees(tenant_id,id,name) VALUES('{T}','{self.staff}','Synthetic'); INSERT INTO private.erp_employee_auth_links VALUES('{T}','{self.staff}','{self.user}');")
 def test_owner_review_uses_uuid_and_shows_missing_link(self):
  self.assertEqual(self.good(f"SELECT employee_id IS NULL AND NOT is_revoked FROM public.erp_review_memberships('{T}') WHERE user_id='{self.user}'",OWNER),'t')
  self.denied(f"SELECT * FROM public.erp_review_memberships('{T}')",MANAGER)
  self.denied(f"SELECT * FROM public.erp_review_memberships('{T}')",EMPLOYEE)
  self.denied(f"SELECT * FROM public.erp_review_memberships('{A}')",OWNER)
 def test_unlinked_membership_keeps_access_until_explicit_revocation(self):
  self.assertGreater(int(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",self.user)),0)
  self.good(self.revoke(),OWNER)
  self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",self.user),'0')
  self.assertEqual(self.good(f"SELECT count(*) FROM public.tenant_data WHERE tenant_id='{T}'",self.user),'0')
 def test_linked_deactivated_member_explicit_revoke_prevents_lifecycle_restore(self):
  self.link()
  self.good(f"SELECT * FROM public.erp_set_employee_active('{T}','{self.staff}',1,false,'offboarding')",OWNER)
  self.good(self.revoke(),OWNER)
  self.denied(f"SELECT * FROM public.erp_set_employee_active('{T}','{self.staff}',2,true,'authorized_return')",OWNER,'40001')
  self.assertEqual(self.good(f"SELECT is_active FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{self.user}'"),'f')
 def test_manager_employee_anonymous_cannot_revoke(self):
  for actor in [MANAGER,EMPLOYEE,self.user]: self.denied(self.revoke(),actor)
  self.denied(self.revoke(),None,role='anon')
 def test_foreign_tenant_and_forged_uuid_are_denied(self):
  self.denied(self.revoke(tenant=A),OWNER)
  self.denied(self.revoke(user=f.uuid(999999),revision=1),OWNER)
  self.denied(f"UPDATE public.tenant_memberships SET user_id='{EMPLOYEE}' WHERE user_id='{self.user}'",OWNER)
 def test_owner_without_operational_profile_is_preserved(self):
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_employee_auth_links WHERE tenant_id='{T}' AND auth_user_id='{OWNER}'"),'0')
  self.denied(self.revoke(user=OWNER),OWNER)
  self.assertGreater(int(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",OWNER)),0)
 def test_pending_activation_is_not_automatically_revoked(self):
  self.good(f"UPDATE auth.users SET email_confirmed_at=NULL WHERE id='{self.user}'; UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='{T}' AND user_id='{self.user}';")
  self.good(f"SELECT * FROM public.erp_review_memberships('{T}')",OWNER)
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_membership_revocations WHERE tenant_id='{T}' AND user_id='{self.user}'"),'0')
  self.good(f"UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{self.user}'")
  self.assertEqual(self.good(f"SELECT email_confirmed_at IS NULL FROM auth.users WHERE id='{self.user}'"),'t')
 def test_master_is_independent_of_business_revocation(self):
  self.good(f"INSERT INTO public.platform_admins(user_id) VALUES('{self.user}')")
  self.good(self.revoke(),OWNER)
  self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",self.user),'0')
  self.assertEqual(self.good(f"SELECT count(*) FROM public.tenant_data WHERE tenant_id='{T}'",self.user),'1')
  self.assertEqual(self.good(f"SELECT count(*) FROM public.platform_admins WHERE user_id='{self.user}'"),'1')
 def test_direct_reactivation_and_delete_recreate_are_blocked(self):
  self.good(self.revoke(),OWNER)
  self.denied(f"UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{self.user}'",None)
  self.denied(f"UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{T}' AND user_id='{self.user}'",self.user,role='service_role')
  self.denied(f"INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES('{T}','{self.user}','employee') ON CONFLICT(tenant_id,user_id) DO UPDATE SET is_active=true",None)
  self.denied(f"DELETE FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{self.user}'",None,'23503')
  replacement=f.uuid(100000+type(self).counter)
  self.good(f"INSERT INTO auth.users(id) VALUES('{replacement}')")
  self.denied(f"UPDATE public.tenant_memberships SET user_id='{replacement}' WHERE tenant_id='{T}' AND user_id='{self.user}'",None,'23503')
  self.denied(f"UPDATE public.tenant_memberships SET tenant_id='{A}' WHERE tenant_id='{T}' AND user_id='{self.user}'",None,'23503')
  self.denied('DELETE FROM private.erp_membership_revocations',OWNER)
  self.denied('SET ROLE handyhub_membership_reviewer',OWNER)
 def test_all_normalized_reads_and_operations_are_revoked(self):
  self.good(self.revoke(),OWNER)
  tables=self.good("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'erp_%'").splitlines()
  self.assertEqual(len(tables),27)
  for table in tables:
   self.assertEqual(self.good(f"SELECT count(*) FROM public.{table} WHERE tenant_id='{T}'",self.user),'0')
   self.denied(f"DELETE FROM public.{table} WHERE tenant_id='{T}'",self.user)
  self.denied(f"SELECT * FROM public.erp_read_own_appointments('{T}')",self.user)
  self.denied(f.rpc(lifecycle.history.PRODUCT,1,{'price':100}),self.user)
  self.denied(f"SELECT public.erp_set_role_permissions('{T}','employee',ARRAY['products.read'],0)",self.user)
 def test_stale_revision_and_atomic_rollback_preserve_state(self):
  revision=self.revision()
  self.denied(self.revoke(revision=revision+1),OWNER,'40001')
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_membership_revocations WHERE user_id='{self.user}'"),'0')
  self.denied('BEGIN;'+self.revoke(revision=revision)+';'+self.revoke(revision=revision)+';COMMIT;',OWNER,'40001')
  self.assertEqual(self.revision(),revision)
  self.assertEqual(self.good(f"SELECT is_active FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{self.user}'"),'t')
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_membership_revocation_audit WHERE user_id='{self.user}'"),'0')
 def test_audit_retains_uuid_identity_and_is_immutable(self):
  self.good(self.revoke(),OWNER)
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_membership_revocation_audit WHERE user_id='{self.user}' AND actor_user_id='{OWNER}'"),'1')
  self.assertEqual(self.good(f"SELECT count(*) FROM auth.users WHERE id='{self.user}'"),'1')
  self.denied('DELETE FROM private.erp_membership_revocation_audit',None,'55000')
  self.denied('TRUNCATE private.erp_membership_revocation_audit',None,'55000')
 def test_two_connections_reject_duplicate_stale_revocation(self):
  command=self.revoke()
  with lifecycle.concurrent.futures.ThreadPoolExecutor() as pool:
   first=pool.submit(self.sql,"SET application_name='membership-revoke-first'; BEGIN;"+command+';SELECT pg_sleep(1);COMMIT;',OWNER)
   self.wait_for('membership-revoke-first')
   second=pool.submit(self.sql,command,OWNER)
   self.assertEqual(first.result().returncode,0)
   result=second.result(); self.assertNotEqual(result.returncode,0); self.assertIn('40001',result.stderr)
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_membership_revocation_audit WHERE user_id='{self.user}'"),'1')
 def test_z_maintenance_blocks_review_and_revocation(self):
  self.good((lifecycle.RECOVERY/'phase-2a-enter-maintenance.sql').read_bytes().decode('utf-8'))
  self.denied(self.revoke(),OWNER)
  self.denied(f"SELECT * FROM public.erp_review_memberships('{T}')",OWNER)
  self.good((lifecycle.RECOVERY/'phase-2a-resume-normalized.sql').read_bytes().decode('utf-8'))
  self.assertEqual(self.good(f"SELECT is_active FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{self.user}'"),'t')

if __name__=='__main__': unittest.main(verbosity=2)
