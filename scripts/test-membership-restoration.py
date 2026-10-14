#!/usr/bin/env python3
"""Owner restoration, synthetic PostgreSQL identities only."""
import importlib.util
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode=True
s=importlib.util.spec_from_file_location('revocation',Path(__file__).with_name('test-membership-revocation.py'))
r=importlib.util.module_from_spec(s); s.loader.exec_module(r)
T,OWNER,EMPLOYEE,MANAGER=r.T,r.OWNER,r.EMPLOYEE,r.MANAGER
class Restoration(r.MembershipRevocation):
 def restore(self,revision=None,permissions="ARRAY['products.read']",confirm='true',employee='NULL',tenant=T,user=None):
  return f"SELECT * FROM public.erp_restore_membership('{tenant}','{user or self.user}',{revision or self.revision()},{confirm},{permissions},{employee})"
 def test_restore_has_explicit_minimum_ceiling_and_no_legacy_json(self):
  self.good(self.revoke(),OWNER); self.good(self.restore(),OWNER)
  self.assertGreater(int(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",self.user)),0)
  self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_sales WHERE tenant_id='{T}'",self.user),'0')
  r.f.assert_legacy_read(self,T,self.user,'0')
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_membership_revocation_audit WHERE user_id='{self.user}' AND action='restore' AND next_active"),'1')
 def test_empty_confirmed_permissions_deny_all_business_reads(self):
  self.good(self.revoke(),OWNER); self.good(self.restore(permissions='ARRAY[]::text[]'),OWNER)
  self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",self.user),'0')
 def test_stale_revision_and_independent_block_cannot_be_restored(self):
  self.good(self.revoke(),OWNER)
  self.denied(self.restore(revision=self.revision()-1),OWNER,'40001')
  self.good(f"UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='{T}' AND user_id='{self.user}'")
  self.denied(self.restore(),OWNER,'40001')
  self.good(self.revoke(),OWNER)
  self.denied(self.restore(),OWNER,'40001')
 def test_block_before_revocation_is_not_erased(self):
  self.good(f"UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='{T}' AND user_id='{self.user}'")
  self.good(self.revoke(),OWNER)
  self.denied(self.restore(),OWNER,'40001')
 def test_inactive_linked_employee_and_link_forgery_are_denied(self):
  self.link(); self.good(f"SELECT * FROM public.erp_set_employee_active('{T}','{self.staff}',1,false,'offboarding')",OWNER)
  self.good(self.revoke(),OWNER)
  self.denied(self.restore(employee=f"'{self.staff}'"),OWNER)
  self.denied(self.restore(),OWNER,'40001')
  self.denied(f"DELETE FROM private.erp_employee_auth_links WHERE tenant_id='{T}' AND auth_user_id='{self.user}'",None)
 def test_linked_active_employee_restores_only_confirmed_uuid(self):
  self.link(); self.good(self.revoke(),OWNER)
  self.denied(self.restore(employee=f"'{r.f.uuid(99999)}'"),OWNER,'40001')
  self.good(self.restore(employee=f"'{self.staff}'"),OWNER)
 def test_manager_employee_anon_and_cross_tenant_are_denied(self):
  self.good(self.revoke(),OWNER)
  for actor in [MANAGER,EMPLOYEE,self.user]: self.denied(self.restore(),actor)
  self.denied(self.restore(),None,role='anon')
  self.denied(self.restore(tenant=r.A),OWNER)
 def test_confirmation_and_privilege_escalation_are_rejected(self):
  self.good(self.revoke(),OWNER)
  self.denied(self.restore(confirm='false'),OWNER,'22023')
  for permissions in ["ARRAY['employees.update']","ARRAY['finance.sales.read']","ARRAY['platform_admin']","ARRAY['services.read']"]:
   self.denied(self.restore(permissions=permissions),OWNER)
  self.denied(self.restore(permissions="ARRAY['products.read','products.read']"),OWNER,'22023')
  self.denied(self.restore(permissions='ARRAY[NULL]::text[]'),OWNER,'22023')
 def test_current_role_grant_revocation_still_applies(self):
  self.good(self.revoke(),OWNER); self.good(self.restore(),OWNER)
  rev=self.good(f"SELECT revision FROM private.erp_policy_state WHERE tenant_id='{T}'")
  self.good(f"SELECT public.erp_set_role_permissions('{T}','employee',ARRAY[]::text[],{rev})",OWNER)
  self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",self.user),'0')
 def test_master_and_auth_are_unchanged(self):
  self.good(f"INSERT INTO public.platform_admins(user_id) VALUES('{self.user}')")
  self.good(self.revoke(),OWNER); self.good(self.restore(),OWNER)
  r.f.assert_legacy_read(self,T,self.user,'1')
  self.assertEqual(self.good(f"SELECT count(*) FROM auth.users WHERE id='{self.user}'"),'1')
 def test_atomic_rollback_preserves_revocation_and_audit(self):
  self.good(self.revoke(),OWNER); revision=self.revision()
  self.denied('BEGIN;'+self.restore(revision=revision)+';'+self.restore(revision=revision)+';COMMIT;',OWNER,'40001')
  self.assertEqual(self.revision(),revision)
  self.assertEqual(self.good(f"SELECT is_revoked FROM private.erp_membership_revocations WHERE tenant_id='{T}' AND user_id='{self.user}'"),'t')
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_membership_revocation_audit WHERE user_id='{self.user}' AND action='restore'"),'0')
 def test_rerevocation_is_enforced_and_direct_permission_edits_fail(self):
  self.good(self.revoke(),OWNER); self.good(self.restore(),OWNER); self.good(self.revoke(),OWNER)
  self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_products WHERE tenant_id='{T}'",self.user),'0')
  self.denied('UPDATE private.erp_membership_revocations SET is_revoked=false',OWNER)
  self.denied("UPDATE private.erp_membership_revocations SET permissions=ARRAY['employees.update']",self.user)
 def test_owner_and_other_owner_remain_protected(self):
  other=r.f.uuid(90001)
  self.good(f"INSERT INTO auth.users(id) VALUES('{other}'); INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES('{T}','{other}','owner');")
  for user in [OWNER,other]:
   self.denied(self.revoke(user=user),OWNER)
   self.denied(self.restore(user=user,revision=self.revision(user)),OWNER)
  self.assertEqual(self.good(f"SELECT count(*) FROM public.tenant_memberships WHERE tenant_id='{T}' AND role='owner' AND is_active"),'2')
 def test_two_connections_restore_once_without_silent_overwrite(self):
  self.good(self.revoke(),OWNER); command=self.restore()
  with r.lifecycle.concurrent.futures.ThreadPoolExecutor() as pool:
   first=pool.submit(self.sql,"SET application_name='membership-restore-first';BEGIN;"+command+';SELECT pg_sleep(1);COMMIT;',OWNER)
   self.wait_for('membership-restore-first')
   second=pool.submit(self.sql,command,OWNER)
   self.assertEqual(first.result().returncode,0)
   result=second.result(); self.assertNotEqual(result.returncode,0); self.assertIn('40001',result.stderr)
  self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_membership_revocation_audit WHERE user_id='{self.user}' AND action='restore'"),'1')

# Run only new restoration scenarios; revocation suite is a separate regression.
if __name__=='__main__':
 names=[n for n in Restoration.__dict__ if n.startswith('test_')]
 result=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(Restoration(n) for n in names))
 sys.exit(not result.wasSuccessful())
