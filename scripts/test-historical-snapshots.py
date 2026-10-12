#!/usr/bin/env python3
"""M4 execution tests: PostgreSQL 17.11, disposable/networkless, synthetic data.
Run: python3 scripts/test-historical-snapshots.py
"""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('product_fixture', Path(__file__).with_name('test-product-concurrency.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
T, A = fixture.TENANT, fixture.FOREIGN
OWNER, MANAGER, EMPLOYEE, MASTER = fixture.OWNER, fixture.MANAGER, fixture.EMPLOYEE, fixture.ADMIN
PRODUCT, SERVICE, SELLER, CUSTOMER = map(fixture.uuid, [10323, 10324, 10301, 10311])


class HistoricalSnapshots(unittest.TestCase):
    setUpClass = classmethod(fixture.ProductConcurrency.setUpClass.__func__)
    sql = staticmethod(fixture.ProductConcurrency.sql)
    good = fixture.ProductConcurrency.good
    denied = fixture.ProductConcurrency.denied

    def setUp(self):
        self.good(f"""UPDATE public.erp_products SET name='Synthetic product',price=100 WHERE tenant_id='{T}';
          UPDATE public.erp_services SET name='Synthetic service',price=100 WHERE tenant_id='{T}';
          UPDATE public.erp_employees SET name='Same display name' WHERE tenant_id='{T}';
          UPDATE public.erp_customers SET name='Synthetic client 1' WHERE tenant_id='{T}' AND id='{CUSTOMER}';""")
        self.record = self.good('SELECT gen_random_uuid()')
        self.attendance = self.good('SELECT gen_random_uuid()')
        self.product_version = int(self.good(f"SELECT version FROM public.erp_products WHERE tenant_id='{T}' AND id='{PRODUCT}'"))
        self.service_version = int(self.good(f"SELECT version FROM public.erp_services WHERE tenant_id='{T}' AND id='{SERVICE}'"))

    @staticmethod
    def command(name, values):
        return 'SELECT public.' + name + '(' + ','.join('NULL' if v is None else fixture.quote(v) for v in values) + ');'

    def sale(self, **changes):
        args = dict(p_tenant=T, p_record=self.record, p_product=PRODUCT, p_expected_product_version=self.product_version,
                    p_seller=SELLER, p_customer=CUSTOMER, p_occurred_on='2026-10-11', p_quantity=2,
                    p_unit_price='100.00', p_discount='10.00', p_unit_cost='60.00',
                    p_cost_reference='synthetic-valuation-document', p_payment_method='synthetic', p_currency_code='BRL')
        self.assertTrue(set(changes)<=set(args))
        args.update(changes)
        return self.command('erp_post_sale', args.values())

    def service(self, **changes):
        args = dict(p_tenant=T, p_record=self.attendance, p_service=SERVICE, p_expected_service_version=self.service_version,
                    p_professional=SELLER, p_customer=CUSTOMER, p_occurred_on='2026-10-11', p_occurred_at='09:00',
                    p_gross_value='100.00', p_discount='10.00', p_payment_method='synthetic', p_currency_code='BRL')
        self.assertTrue(set(changes)<=set(args))
        args.update(changes)
        return self.command('erp_post_attendance', args.values())

    def sale_state(self):
        return self.good(f"""SELECT s.product_name_snapshot,s.seller_name_snapshot,s.product_version_snapshot,s.quantity,
          sc.client_name_snapshot,f.unit_price,f.gross_total,f.discount,f.total,c.unit_cost,c.total_cost,
          f.total-c.total_cost,f.currency_code,s.history_state
          FROM public.erp_sales s JOIN public.erp_sale_finance f USING(tenant_id,id)
          JOIN public.erp_sale_cmv c USING(tenant_id,id) LEFT JOIN public.erp_sale_customers sc USING(tenant_id,id)
          WHERE s.tenant_id='{T}' AND s.id='{self.record}'""")

    def assert_sale_absent(self):
        for schema, table, col in [('public','erp_sales','id'), ('public','erp_sale_finance','id'),
                                   ('public','erp_sale_cmv','id'), ('public','erp_sale_customers','id'),
                                   ('private','erp_history_postings','sale_id')]:
            self.assertEqual(self.good(f"SELECT count(*) FROM {schema}.{table} WHERE tenant_id='{T}' AND {col}='{self.record}'"), '0')

    def delegate(self, role, grants):
        revision = self.good(f"SELECT coalesce((SELECT revision FROM private.erp_policy_state WHERE tenant_id='{T}'),0)")
        perms = ','.join(fixture.quote(p) for p in grants)
        self.good(f"SELECT public.erp_set_role_permissions('{T}','{role}',ARRAY[{perms}]::text[],{revision})", OWNER)

    def test_sale_revenue_cmv_margin_and_labels_survive_catalog_changes(self):
        self.assertEqual(self.good(self.sale(), OWNER), self.record)
        before = self.sale_state()
        self.assertEqual(before, f'Synthetic product|Same display name|{self.product_version}|2|Synthetic client 1|100.00|200.00|10.00|190.00|60.00|120.00|70.00|BRL|posted')
        self.good(fixture.rpc(PRODUCT, self.product_version, {'name': 'Renamed product', 'price': 150}, {'cost': 80}), OWNER)
        self.good(f"UPDATE public.erp_employees SET name='Renamed seller' WHERE tenant_id='{T}' AND id='{SELLER}'; UPDATE public.erp_customers SET name='Renamed client' WHERE tenant_id='{T}' AND id='{CUSTOMER}'")
        self.assertEqual(self.sale_state(), before)
        self.assertEqual(self.good(f"SELECT name,price FROM public.erp_products WHERE tenant_id='{T}' AND id='{PRODUCT}'"), 'Renamed product|150.00')
        self.assertEqual(self.good(f"SELECT cost FROM public.erp_product_costs WHERE tenant_id='{T}' AND id='{PRODUCT}'"), '80.00')

    def test_attendance_service_professional_and_client_names_are_historical(self):
        self.assertEqual(self.good(self.service(), OWNER), self.attendance)
        query = f"""SELECT a.service_name_snapshot,a.professional_name_snapshot,a.client_name_snapshot,a.service_version_snapshot,
          f.gross_value,f.discount,f.net_value,f.quantity_snapshot,f.currency_code FROM public.erp_attendances a
          JOIN public.erp_attendance_finance f USING(tenant_id,id) WHERE a.tenant_id='{T}' AND a.id='{self.attendance}'"""
        before = self.good(query)
        self.assertEqual(before, f'Synthetic service|Same display name|Synthetic client 1|{self.service_version}|100.00|10.00|90.00|1|BRL')
        self.good(f"""UPDATE public.erp_services SET name='Renamed service',price=300 WHERE tenant_id='{T}' AND id='{SERVICE}';
          UPDATE public.erp_employees SET name='Renamed professional' WHERE tenant_id='{T}' AND id='{SELLER}';
          UPDATE public.erp_customers SET name='Renamed client' WHERE tenant_id='{T}' AND id='{CUSTOMER}';""")
        self.assertEqual(self.good(query), before)

    def test_only_owner_can_post_and_uuid_tenant_relationships_cannot_be_forged(self):
        for user in [MANAGER, EMPLOYEE, MASTER, fixture.uuid(6)]:
            self.denied(self.sale(), user)
            self.denied(self.service(), user)
        self.denied(self.sale(), None, role='anon')
        for changes in [dict(p_tenant=A), dict(p_product=fixture.uuid(10123)),
                        dict(p_seller=fixture.uuid(10101)), dict(p_customer=fixture.uuid(10111))]:
            self.denied(self.sale(**changes), OWNER)
        for changes in [dict(p_service=fixture.uuid(10124)), dict(p_professional=fixture.uuid(10101)), dict(p_customer=fixture.uuid(10111))]:
            self.denied(self.service(**changes), OWNER)
        self.assert_sale_absent()

    def test_own_history_revenue_permission_and_cmv_separation(self):
        self.good(self.sale(), OWNER)
        self.delegate('employee', ['sales.read_own'])
        self.delegate('manager', ['finance.sales.read','finance.products.cost.read'])
        self.assertEqual(self.good(f"SELECT product_name_snapshot FROM public.erp_sales WHERE id='{self.record}'", EMPLOYEE), 'Synthetic product')
        self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_sales WHERE id='{self.record}'", fixture.uuid(4)), '0')
        self.assertEqual(self.good(f"SELECT total FROM public.erp_sale_finance WHERE id='{self.record}'", MANAGER), '190.00')
        for user in [MANAGER, EMPLOYEE, MASTER, fixture.uuid(7)]:
            self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_sale_cmv WHERE id='{self.record}'", user), '0')
        self.assertEqual(self.good(f"SELECT total_cost FROM public.erp_sale_cmv WHERE id='{self.record}'", OWNER), '120.00')
        self.denied('SELECT * FROM private.erp_history_postings', OWNER)
        self.assertEqual(self.good(f"SELECT actor_user_id FROM private.erp_history_postings WHERE sale_id='{self.record}'"), OWNER)

    def test_direct_snapshot_writes_and_cancel_delete_reset_are_denied(self):
        self.good(self.sale(), OWNER)
        before = self.sale_state()
        for user in [OWNER, MANAGER, EMPLOYEE]:
            for statement in [f"UPDATE public.erp_sales SET product_name_snapshot='forged' WHERE id='{self.record}'",
                              f"UPDATE public.erp_sale_finance SET total=0 WHERE id='{self.record}'",
                              f"UPDATE public.erp_sale_cmv SET unit_cost=0 WHERE id='{self.record}'",
                              f"DELETE FROM public.erp_sale_cmv WHERE id='{self.record}'",
                              'SET ROLE handyhub_history_writer']:
                self.denied(statement, user)
        # Defense in depth: even ordinary technical DML cannot edit a posted snapshot.
        for statement in [f"UPDATE public.erp_sales SET status='cancelled' WHERE id='{self.record}'",
                          f"UPDATE public.erp_sales SET history_state='incomplete' WHERE id='{self.record}'",
                          f"UPDATE public.erp_sale_finance SET unit_price=1 WHERE id='{self.record}'",
                          f"UPDATE public.erp_sale_customers SET client_name_snapshot='forged' WHERE id='{self.record}'",
                          f"DELETE FROM public.erp_sales WHERE id='{self.record}'", 'TRUNCATE public.erp_sale_cmv',
                          f"DELETE FROM private.erp_history_postings WHERE sale_id='{self.record}'"]:
            self.denied(statement, None, '55000')
        self.assertEqual(self.sale_state(), before)

    def test_money_precision_bounds_currency_and_unknown_cost_reject_without_partial_writes(self):
        for changes in [dict(p_unit_cost=None), dict(p_cost_reference=' '), dict(p_unit_price='1.001'),
                        dict(p_unit_cost='NaN'), dict(p_unit_cost='Infinity'), dict(p_discount='201'),
                        dict(p_unit_price='-1'), dict(p_currency_code='USD'), dict(p_quantity=0),
                        dict(p_unit_price='999999999999.99'), dict(p_unit_cost='999999999999.99'), dict(p_occurred_on='infinity')]:
            self.denied(self.sale(**changes), OWNER, '22023')
            self.assert_sale_absent()
        for changes in [dict(p_gross_value='1.001'), dict(p_discount='101'), dict(p_currency_code=None), dict(p_occurred_on='-infinity')]:
            self.denied(self.service(**changes), OWNER, '22023')
        self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_attendances WHERE id='{self.attendance}'"), '0')

    def test_snapshot_guard_fails_closed_when_parent_is_hidden_by_rls(self):
        self.good(self.sale(), OWNER)
        self.delegate('manager', ['finance.sales.read'])
        # Local synthetic role/policy simulates a future accidental child-write grant.
        # It can read/write finance but cannot read the parent sale; never applied remotely.
        self.good("""CREATE ROLE synthetic_history_probe NOLOGIN;
          GRANT authenticated TO synthetic_history_probe;
          GRANT UPDATE ON public.erp_sale_finance TO synthetic_history_probe;
          CREATE POLICY synthetic_child_write ON public.erp_sale_finance FOR UPDATE
            TO synthetic_history_probe USING (true) WITH CHECK (true);""")
        result = self.sql(f"""SET SESSION AUTHORIZATION synthetic_history_probe;
          SET request.jwt.claim.sub='{MANAGER}';
          UPDATE public.erp_sale_finance SET payment_method='forged' WHERE id='{self.record}';""")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('55000', result.stderr)
        self.assertEqual(self.good(f"SELECT payment_method FROM public.erp_sale_finance WHERE id='{self.record}'"), 'synthetic')

    def test_optional_customer_cannot_be_attached_after_posting(self):
        self.good(self.sale(p_customer=None), OWNER)
        self.denied(f"""INSERT INTO public.erp_sale_customers(tenant_id,id,customer_id)
          VALUES('{T}','{self.record}','{CUSTOMER}');""", None, '55000')
        self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_sale_customers WHERE id='{self.record}'"), '0')

    def test_posting_inside_savepoint_is_atomic(self):
        self.good('BEGIN; SAVEPOINT history;' + self.sale() + 'RELEASE SAVEPOINT history; COMMIT;', OWNER)
        self.assertIn('190.00|60.00|120.00|70.00', self.sale_state())

    def test_stale_source_version_and_duplicate_id_cannot_overwrite(self):
        self.denied(self.sale(p_expected_product_version=self.product_version-1), OWNER, '40001' if self.product_version>1 else '22023')
        self.denied(self.service(p_expected_service_version=self.service_version+1), OWNER, '40001')
        self.assert_sale_absent()
        self.good(self.sale(), OWNER)
        before = self.sale_state()
        self.denied(self.sale(p_unit_price='200'), OWNER, '23505')
        self.assertEqual(self.sale_state(), before)
        self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_history_postings WHERE sale_id='{self.record}'"), '1')

    def test_transaction_conflict_rolls_back_posting_and_audit(self):
        command = 'BEGIN;' + self.sale() + fixture.rpc(PRODUCT, self.product_version+1, {'price': 101}) + 'COMMIT;'
        self.denied(command, OWNER, '40001')
        self.assert_sale_absent()

    def test_deferred_integrity_rejects_incomplete_or_inconsistent_posting(self):
        root = f"""INSERT INTO public.erp_sales(tenant_id,id,product_id,seller_employee_id,occurred_on,quantity,status,
          history_state,product_name_snapshot,product_version_snapshot,seller_name_snapshot,posted_at)
          VALUES('{T}','{self.record}','{PRODUCT}','{SELLER}','2026-10-11',2,'posted','incomplete','Synthetic product',
          {self.product_version},'Same display name',clock_timestamp());"""
        start = f"SET request.jwt.claim.sub='{OWNER}'; BEGIN;"
        finalize = f"UPDATE public.erp_sales SET history_state='posted' WHERE tenant_id='{T}' AND id='{self.record}';"
        self.denied(start + root + finalize + 'COMMIT;', None, '23514')
        self.assert_sale_absent()
        finance = f"""INSERT INTO public.erp_sale_finance(tenant_id,id,unit_price,total,payment_method,quantity_snapshot,discount,currency_code)
          VALUES('{T}','{self.record}',100,190,'synthetic',2,10,'BRL');"""
        cmv = f"""INSERT INTO public.erp_sale_cmv(tenant_id,id,quantity_snapshot,unit_cost,cost_basis,cost_reference,currency_code)
          VALUES('{T}','{self.record}',3,60,'documented_manual','synthetic','BRL');"""
        audit = f"INSERT INTO private.erp_history_postings(tenant_id,actor_user_id,sale_id) VALUES('{T}','{OWNER}','{self.record}');"
        self.denied(start + root + finance + cmv + audit + finalize + 'COMMIT;', None, '23514')
        self.assert_sale_absent()
        self.denied(start + root + finance + cmv.replace(',3,60', ',2,60') + finalize + 'COMMIT;', None, '23514')
        self.assert_sale_absent()

    def test_existing_incomplete_history_is_not_filled_from_current_catalog(self):
        self.assertEqual(self.good(f"SELECT history_state,product_name_snapshot IS NULL,product_version_snapshot IS NULL FROM public.erp_sales WHERE tenant_id='{T}' AND id='{fixture.uuid(10341)}'"), 'incomplete|t|t')
        self.assertEqual(self.good(f"SELECT quantity_snapshot IS NULL,discount IS NULL,currency_code IS NULL FROM public.erp_sale_finance WHERE tenant_id='{T}' AND id='{fixture.uuid(10341)}'"), 't|t|t')
        self.assertEqual(self.good(f"SELECT count(*) FROM public.erp_sale_cmv WHERE tenant_id='{T}' AND id='{fixture.uuid(10341)}'"), '0')

    def test_capability_role_rpc_search_path_and_permissions_are_minimal(self):
        role = 'handyhub_history_writer'
        self.assertEqual(self.good(f"SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname='{role}'"), 'f|f|f|f')
        self.assertEqual(self.good(f"SELECT count(*) FROM pg_auth_members WHERE roleid='{role}'::regrole"), '0')
        self.assertEqual(self.good(f"SELECT count(*) FROM pg_class WHERE relowner='{role}'::regrole"), '0')
        for schema in ['public','private']:
            self.assertEqual(self.good(f"SELECT has_schema_privilege('{role}','{schema}','CREATE')"), 'f')
        for table in ['erp_products','erp_services','erp_customers','erp_employees','erp_sales','erp_sale_finance','erp_sale_cmv','erp_attendances','erp_attendance_finance']:
            self.assertEqual(self.good(f"SELECT has_table_privilege('{role}','public.{table}','UPDATE,DELETE,TRUNCATE')"), 'f')
            columns = self.good(f"SELECT attname FROM pg_attribute WHERE attrelid='public.{table}'::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege('{role}',attrelid,attnum,'UPDATE')")
            self.assertEqual(columns, 'history_state' if table in ['erp_sales','erp_attendances'] else '')
        for name in ['erp_post_sale','erp_post_attendance','erp_validate_history']:
            self.assertEqual(self.good(f"SELECT count(*) FROM pg_proc WHERE proname='{name}' AND prosecdef AND proowner='{role}'::regrole AND proconfig=ARRAY['search_path=\"\"']"), '1')
            for caller in ['anon','service_role']:
                self.assertEqual(self.good(f"SELECT bool_or(has_function_privilege('{caller}',oid,'EXECUTE')) FROM pg_proc WHERE proname='{name}'"), 'f')


if __name__ == '__main__':
    unittest.main(verbosity=2)
