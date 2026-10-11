#!/usr/bin/env python3
"""M3 tests in disposable, networkless PostgreSQL 17.11; synthetic identities only.
Run: python3 scripts/test-appointment-read.py
Reuses the local-only container/fixture harness, not its product test suite.
"""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('product_fixture', Path(__file__).with_name('test-product-concurrency.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

T, A, B = fixture.TENANT, fixture.FOREIGN, fixture.uuid(102)
OWNER, MANAGER, EMPLOYEE, MASTER = fixture.OWNER, fixture.MANAGER, fixture.EMPLOYEE, fixture.ADMIN
PEER, OUTSIDER = fixture.uuid(4), fixture.uuid(6)


class OwnAgenda(unittest.TestCase):
    setUpClass = classmethod(fixture.ProductConcurrency.setUpClass.__func__)
    sql = staticmethod(fixture.ProductConcurrency.sql)
    good = fixture.ProductConcurrency.good
    denied = fixture.ProductConcurrency.denied

    def delegate(self, role, permissions):
        values = ','.join(fixture.quote(p) for p in permissions)
        revision = self.good(f"SELECT coalesce((SELECT revision FROM private.erp_policy_state WHERE tenant_id='{T}'),0)")
        self.good(f"SELECT public.erp_set_role_permissions('{T}','{role}',ARRAY[{values}]::text[],{revision});", OWNER)

    def setUp(self):
        # Local fixture administrator resets test conditions; never remote data.
        self.good(f"""UPDATE public.tenants SET status='Ativo';
          UPDATE public.tenant_memberships SET is_active=true;
          DELETE FROM private.erp_employee_auth_links WHERE tenant_id='{T}';
          INSERT INTO private.erp_employee_auth_links VALUES
            ('{T}','{fixture.uuid(10301)}','{EMPLOYEE}'),('{T}','{fixture.uuid(10302)}','{PEER}');
          UPDATE public.erp_appointments SET responsible_employee_id='{fixture.uuid(10301)}'
            WHERE tenant_id='{T}' AND id='{fixture.uuid(10331)}';""")
        self.delegate('employee', ['appointments.read_own'])
        self.delegate('manager', [])

    def rows(self, user=EMPLOYEE, tenant=T, suffix=''):
        return json.loads(self.good(f"SELECT coalesce(json_agg(r),'[]'::json) FROM public.erp_read_own_appointments('{tenant}') r {suffix};", user))

    def test_minimal_permission_delivers_exact_phase1_fields_without_catalog_grants(self):
        self.assertEqual(self.rows(), [{
            'id': fixture.uuid(10331), 'date': '2026-10-10', 'time': '09:00:00',
            'clientName': 'Synthetic client 1', 'serviceName': 'Synthetic service', 'status': 'synthetic',
        }])
        # Minimal permission does not unlock direct customer/service catalogs.
        for table in ['erp_customers', 'erp_services']:
            self.assertEqual(self.good(f'SELECT count(*) FROM public.{table};', EMPLOYEE), '0')
        old_join = self.good("""SELECT count(c.name),count(s.name) FROM public.erp_appointments a
          LEFT JOIN public.erp_customers c ON (c.tenant_id,c.id)=(a.tenant_id,a.customer_id)
          LEFT JOIN public.erp_services s ON (s.tenant_id,s.id)=(a.tenant_id,a.service_id);""", EMPLOYEE)
        self.assertEqual(old_join, '0|0')

    def test_uuid_identity_excludes_colleague_and_unassigned_even_with_identical_names(self):
        self.assertEqual([r['id'] for r in self.rows(PEER)], [fixture.uuid(10332)])
        self.assertEqual([r['id'] for r in self.rows()], [fixture.uuid(10331)])
        self.assertEqual(self.rows(suffix=f"WHERE r.id IN ('{fixture.uuid(10332)}','{fixture.uuid(10333)}')"), [])
        # Own appointments need no independent customer assignment permission/link.
        self.good(f"DELETE FROM private.erp_customer_assignments WHERE tenant_id='{T}'")
        self.assertEqual(len(self.rows()), 1)

    def test_foreign_tenants_and_same_ids_do_not_resolve_foreign_labels(self):
        for tenant in [A, B]:
            self.denied(f"SELECT * FROM public.erp_read_own_appointments('{tenant}');", EMPLOYEE)
        # Valid duplicate entity IDs across tenants intentionally stress composite joins.
        self.good(f"""INSERT INTO public.erp_customers(tenant_id,id,name) VALUES
          ('{A}','{fixture.uuid(10311)}','FOREIGN_PRIVATE_LABEL');
          INSERT INTO public.erp_services(tenant_id,id,name,duration_minutes,price) VALUES
          ('{A}','{fixture.uuid(10324)}','FOREIGN_PRIVATE_SERVICE',30,999);
          INSERT INTO public.erp_appointments(tenant_id,id,customer_id,service_id,occurred_on,occurred_at,status)
          VALUES ('{A}','{fixture.uuid(10331)}','{fixture.uuid(10311)}','{fixture.uuid(10324)}','2026-10-10','09:00','foreign');""")
        self.assertEqual(self.rows()[0]['clientName'], 'Synthetic client 1')
        self.assertEqual(self.rows()[0]['serviceName'], 'Synthetic service')

    def test_anonymous_no_identity_no_membership_master_and_no_grant_are_denied(self):
        command = f"SELECT * FROM public.erp_read_own_appointments('{T}');"
        self.denied(command, None, role='anon')
        self.denied('SET SESSION AUTHORIZATION authenticated;' + command, None)
        for user in [OUTSIDER, MASTER, MANAGER]:
            self.denied(command, user)
        self.delegate('employee', [])
        self.denied(command, EMPLOYEE)

    def test_revocation_membership_tenant_and_auth_link_are_rechecked(self):
        command = f"SELECT * FROM public.erp_read_own_appointments('{T}');"
        self.delegate('employee', [])
        self.denied(command, EMPLOYEE)
        self.delegate('employee', ['appointments.read_own'])
        self.good(f"UPDATE public.tenant_memberships SET is_active=false WHERE user_id='{EMPLOYEE}'")
        self.denied(command, EMPLOYEE)
        self.good(f"UPDATE public.tenant_memberships SET is_active=true WHERE user_id='{EMPLOYEE}'")
        self.good(f"UPDATE public.tenants SET status='Bloqueado' WHERE id='{T}'")
        self.denied(command, EMPLOYEE)
        self.good(f"UPDATE public.tenants SET status='Ativo' WHERE id='{T}'")
        self.good(f"DELETE FROM private.erp_employee_auth_links WHERE auth_user_id='{EMPLOYEE}'")
        self.assertEqual(self.rows(), [])

    def test_reassignment_revokes_access_and_scope_stays_own_for_owner_and_manager(self):
        self.good(f"UPDATE public.erp_appointments SET responsible_employee_id='{fixture.uuid(10302)}' WHERE tenant_id='{T}' AND id='{fixture.uuid(10331)}'")
        self.assertEqual(self.rows(), [])
        self.assertEqual(len(self.rows(PEER)), 2)
        # Owner's broad base-table permission does not broaden this personal RPC.
        self.assertEqual(self.rows(OWNER), [])
        self.delegate('manager', ['appointments.read_own'])
        self.assertEqual(self.rows(MANAGER), [])
        self.delegate('manager', ['appointments.read'])
        self.denied(f"SELECT * FROM public.erp_read_own_appointments('{T}');", MANAGER)

    def test_privacy_payload_direct_tables_rpc_filters_and_invoker_views(self):
        for table in ['erp_customer_contacts', 'erp_customer_notes', 'erp_appointment_finance',
                      'erp_appointment_notes', 'erp_expenses', 'erp_employee_private']:
            self.assertEqual(self.good(f'SELECT count(*) FROM public.{table};', EMPLOYEE), '0')
        self.assertEqual(set(self.rows()[0]), {'id', 'date', 'time', 'clientName', 'serviceName', 'status'})
        for field in ['price', 'notes', 'phone', 'cpf', 'professionalName', 'tenant_id', 'responsible_employee_id']:
            self.denied(f'SELECT r."{field}" FROM public.erp_read_own_appointments(\'{T}\') r;', EMPLOYEE, '42703')
        self.good("""CREATE VIEW public.synthetic_own_agenda WITH (security_invoker=true) AS
          SELECT * FROM public.erp_read_own_appointments('00000000-0000-4000-8000-000000000103');
          CREATE VIEW public.synthetic_service_catalog WITH (security_invoker=true) AS
          SELECT * FROM public.erp_services;
          GRANT SELECT ON public.synthetic_own_agenda, public.synthetic_service_catalog TO authenticated;""")
        self.assertEqual(self.good('SELECT count(*) FROM public.synthetic_own_agenda', EMPLOYEE), '1')
        self.assertEqual(self.good('SELECT count(*) FROM public.synthetic_service_catalog', EMPLOYEE), '0')
        self.assertEqual(self.good(f"SELECT count(*) FROM public.synthetic_own_agenda WHERE id='{fixture.uuid(10332)}'", EMPLOYEE), '0')

    def test_role_and_acl_cannot_be_used_to_bypass_projection(self):
        role = 'handyhub_own_agenda_reader'
        self.denied('SET ROLE ' + role, EMPLOYEE)
        self.denied('UPDATE public.erp_appointments SET responsible_employee_id=NULL', EMPLOYEE)
        self.denied('SELECT * FROM private.erp_employee_auth_links', EMPLOYEE)
        self.denied(f"SELECT * FROM public.erp_read_own_appointments('{T}','{PEER}');", EMPLOYEE, '42883')
        self.assertEqual(self.good(f"SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname='{role}'"), 'f|f|f|f')
        self.assertEqual(self.good(f"SELECT count(*) FROM pg_auth_members WHERE roleid='{role}'::regrole"), '0')
        self.assertEqual(self.good(f"SELECT count(*) FROM pg_class WHERE relowner='{role}'::regrole"), '0')
        self.assertEqual(self.good(f"SELECT has_schema_privilege('{role}','public','CREATE')"), 'f')
        self.assertEqual(self.good("SELECT count(*) FROM pg_policies WHERE policyname LIKE 'erp_own_agenda_%' AND roles::text='{handyhub_own_agenda_reader}'"), '3')
        for table, allowed in {
            'erp_customers': {'tenant_id', 'id', 'name'},
            'erp_services': {'tenant_id', 'id', 'name'},
            'erp_appointments': {'tenant_id', 'id', 'customer_id', 'service_id', 'responsible_employee_id', 'occurred_on', 'occurred_at', 'status'},
        }.items():
            columns = self.good(f"SELECT attname FROM pg_attribute WHERE attrelid='public.{table}'::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege('{role}',attrelid,attnum,'SELECT')")
            self.assertEqual(set(columns.splitlines()), allowed)
            self.assertEqual(self.good(f"SELECT has_table_privilege('{role}','public.{table}','INSERT,UPDATE,DELETE,TRUNCATE'),has_any_column_privilege('{role}','public.{table}','INSERT,UPDATE')"), 'f|f')
        self.assertEqual(self.good(f"SELECT has_column_privilege('{role}','public.erp_services','price','SELECT')"), 'f')
        self.assertEqual(self.good("SELECT proconfig::text,provolatile FROM pg_proc WHERE oid='public.erp_read_own_appointments(uuid)'::regprocedure"), '{"search_path=\\"\\""}|s')
        for caller in ['anon', 'service_role']:
            self.assertEqual(self.good(f"SELECT has_function_privilege('{caller}','public.erp_read_own_appointments(uuid)','EXECUTE')"), 'f')


if __name__ == '__main__':
    unittest.main(verbosity=2)
