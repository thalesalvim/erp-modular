#!/usr/bin/env python3
"""Durability v2: disposable PostgreSQL 17 only; no remote DSN or crash required."""
import importlib.util
from pathlib import Path
import re
import subprocess
import sys
import unittest
from unittest.mock import patch
sys.dont_write_bytecode=True
sp=importlib.util.spec_from_file_location('seal',Path(__file__).with_name('test-recovery-seal-hardening.py'))
b=importlib.util.module_from_spec(sp);sp.loader.exec_module(b)
f=b.f
D=f.ROOT/'supabase/migrations/20261012030200_erp_durability_integrity.sql'

class BeforeFirstSeal(b.BeforeSeal):
 def test_original_acceptance_then_new_preventive_refusal(self):
  for table in ['public.erp_expenses','private.erp_membership_revocations']:
   with self.subTest(table=table):
    prefix='BEGIN;ALTER TABLE '+table+' SET UNLOGGED;'+b.body(b.B.read_bytes().decode('utf-8'))
    # Reproduce the original acceptance, without repeating destructive crashes.
    self.good(prefix+';ROLLBACK;')
    result=self.sql(prefix+';'+b.body(D.read_bytes().decode('utf-8'))+';COMMIT;')
    self.assertNotEqual(result.returncode,0);self.assertIn('DURABILITY_INVARIANT',result.stderr)
    self.assertEqual(self.good("SELECT to_regclass('private.erp_recovery_schema_seal_v2') IS NULL"),'t')

class BeforeUpgrade(b.AfterSeal):
 @classmethod
 def setUpClass(cls):
  original=subprocess.run
  def run(args,*a,**kw):
   if isinstance(args,list) and args[:3]==['node','--input-type=module','-e']:
    args=args.copy();args[3]=args[3].replace('for(const f of additions)',"for(const f of additions.filter(n=>!n.startsWith('202610120302')))")
   return original(args,*a,**kw)
  with patch.object(subprocess,'run',side_effect=run):f.ProductConcurrency.setUpClass.__func__(cls)
 def setUp(self):pass
 def tearDown(self):pass
 def test_unsafe_upgrade_leaves_object_unconverted_and_no_v2(self):
  self.good('ALTER TABLE public.erp_expenses SET UNLOGGED')
  try:
   result=self.sql(D.read_bytes().decode('utf-8'));self.assertNotEqual(result.returncode,0);self.assertIn('DURABILITY_INVARIANT',result.stderr)
   self.assertEqual(self.good("SELECT relpersistence FROM pg_class WHERE oid='public.erp_expenses'::regclass"),'u')
   self.assertEqual(self.good("SELECT to_regclass('private.erp_recovery_schema_seal_v2') IS NULL"),'t')
  finally:self.good('ALTER TABLE public.erp_expenses SET LOGGED')
 def test_upgrade_failure_rolls_back_functions_and_reference(self):
  before=self.good('SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal')
  result=self.sql('BEGIN;'+b.body(D.read_bytes().decode('utf-8'))+';SELECT 1/0;COMMIT;')
  self.assertNotEqual(result.returncode,0);self.assertIn('22012',result.stderr)
  self.assertEqual(self.good("SELECT to_regclass('private.erp_recovery_schema_seal_v2') IS NULL"),'t')
  self.assertEqual(self.good('SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal'),before)
  self.good('SELECT private.erp_assert_recovery_integrity()')
 def test_versioned_upgrade_preserves_old_reference_data_and_ceiling(self):
  T,owner,manager=b.T,b.OWNER,b.c.MANAGER
  rev=self.good(f"SELECT coalesce((SELECT revision FROM private.erp_policy_state WHERE tenant_id='{T}'),0)")
  self.good(f"SELECT public.erp_set_role_permissions('{T}','manager',ARRAY['products.read','finance.sales.read'],{rev})",owner)
  revision=self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{manager}'")
  self.good(f"SELECT * FROM public.erp_revoke_membership('{T}','{manager}',{revision},'identity_review')",owner)
  revision=self.good(f"SELECT activity_revision FROM public.tenant_memberships WHERE tenant_id='{T}' AND user_id='{manager}'")
  self.good(f"SELECT * FROM public.erp_restore_membership('{T}','{manager}',{revision},true,ARRAY['products.read'],NULL)",owner)
  before=self.good('SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal')
  self.good((b.REC/'phase-2a-enter-maintenance.sql').read_bytes().decode('utf-8'))
  self.good(D.read_bytes().decode('utf-8'))
  self.assertEqual(self.good('SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal'),before)
  self.assertEqual(self.good('SELECT count(*) FROM public.erp_expenses'),'3')
  self.good(b.RESUME)
  self.assertEqual(self.good('SELECT count(*) FROM public.erp_sale_finance',manager),'0')
  self.assertEqual(self.good('SELECT count(*) FROM public.erp_products',manager),'1')
  self.assertEqual(self.good(f"SELECT permissions::text FROM private.erp_membership_revocations WHERE tenant_id='{T}' AND user_id='{manager}'"),'{products.read}')
  self.good('SELECT private.erp_assert_recovery_integrity()')

class Installed(b.AfterSeal):
 def test_complete_explicit_inventory_and_snapshot(self):
  names=re.findall(r"'((?:public|private|auth)\.[a-z0-9_]+)'",D.read_bytes().decode('utf-8').split(' ] LOOP')[0])
  self.assertEqual(len(names),47);self.assertEqual(len(set(names)),47)
  for name in names:
   with self.subTest(table=name):
    self.assertEqual(self.good(f"SELECT relkind='r' AND relpersistence='p' FROM pg_class WHERE oid='{name}'::regclass"),'t')
    self.assertEqual(self.good(f"SELECT private.erp_recovery_schema_snapshot() ? 'relation-state/{name}'"),'t')
  # Discover domain tables independently, detecting a forgotten ERP relation.
  actual=self.good("SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND left(c.relname,4)='erp_' AND c.relkind='r'").splitlines()
  self.assertEqual(set(actual),{n for n in names if '.erp_' in n})
 def test_unlogged_after_seal_finance_security_audit_and_references(self):
  for table in ['public.erp_expenses','private.erp_membership_revocations',
                'private.erp_membership_revocation_audit','private.erp_employee_lifecycle_audit',
                'private.erp_permission_audit','private.erp_recovery_events','private.erp_runtime_control',
                'private.erp_employee_auth_links','private.erp_customer_assignments',
                'private.erp_recovery_schema_seal','private.erp_recovery_schema_seal_v2']:
   with self.subTest(table=table):
    self.rejected_resume('ALTER TABLE '+table+' SET UNLOGGED','DURABILITY_INVARIANT')
 def test_temporary_shadow_cannot_replace_required_permanent_relation(self):
  result=self.sql("BEGIN;ALTER TABLE public.erp_expenses RENAME TO expenses_missing;CREATE TEMP TABLE erp_expenses(id uuid);SELECT private.erp_assert_durable_relations();ROLLBACK;")
  self.assertNotEqual(result.returncode,0);self.assertIn('DURABILITY_INVARIANT',result.stderr)
  # PostgreSQL itself forbids a temporary table inside permanent public schema.
  result=self.sql('BEGIN;DROP TABLE public.erp_expenses;CREATE TEMP TABLE public.erp_expenses(id uuid);ROLLBACK;')
  self.assertNotEqual(result.returncode,0);self.assertIn('42P16',result.stderr)
 def test_replacing_snapshot_cannot_approve_unlogged(self):
  self.rejected_resume("ALTER TABLE public.erp_expenses SET UNLOGGED;SET LOCAL session_replication_role='replica';UPDATE private.erp_recovery_schema_seal_v2 SET snapshot=private.erp_recovery_schema_snapshot();SET LOCAL session_replication_role='origin'",'DURABILITY_INVARIANT')
 def test_nonadministrators_cannot_change_durability_or_new_reference(self):
  for actor in [b.OWNER,b.c.MANAGER,b.EMPLOYEE,f.uuid(5)]:
   for sql in ['ALTER TABLE public.erp_expenses SET UNLOGGED',
               'ALTER TABLE private.erp_membership_revocations SET UNLOGGED',
               'SELECT private.erp_assert_durable_relations()',
               'DELETE FROM private.erp_recovery_schema_seal_v2']:
    self.denied(sql,actor)
 def test_intact_resume_and_no_legacy_grants(self):
  self.good(b.RESUME)
  self.assertEqual(self.good('SELECT maintenance FROM private.erp_runtime_control'),'f')
  self.denied('SELECT payload FROM public.tenant_data',b.OWNER)
  self.good((b.REC/'phase-2a-enter-maintenance.sql').read_bytes().decode('utf-8'))

if __name__=='__main__':
 classes=[BeforeFirstSeal,BeforeUpgrade,Installed]
 cases=[cls(n) for cls in classes for n in cls.__dict__ if n.startswith('test_') and (not sys.argv[1:] or n in sys.argv[1:])]
 result=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(cases));sys.exit(not result.wasSuccessful())
