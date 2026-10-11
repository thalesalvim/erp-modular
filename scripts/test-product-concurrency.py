#!/usr/bin/env python3
"""Disposable PostgreSQL 17 regression tests; no remote DSN, ports or real data.
Run: python3 scripts/test-product-concurrency.py
Requires Docker, the pinned image already downloaded, Node and repo dependencies.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'
CONTAINER = f'handyhub-occ-{os.getpid()}'


def uuid(n):
    return f'00000000-0000-4000-8000-{n:012}'


TENANT, FOREIGN = uuid(103), uuid(101)
OWNER, MANAGER, EMPLOYEE, ADMIN = map(uuid, [1, 2, 3, 5])


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def rpc(product, expected, base=None, cost=None, stock=None, tenant=TENANT):
    patches = ','.join(quote(json.dumps(p if p is not None else {})) + '::jsonb'
                       for p in (base, cost, stock))
    version = 'NULL' if expected is None else str(expected)
    return f"SELECT * FROM public.erp_update_product('{tenant}','{product}',{version},{patches});"


class ProductConcurrency(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run(['docker', 'image', 'inspect', IMAGE], check=True, stdout=subprocess.DEVNULL)
        cls.addClassCleanup(lambda: subprocess.run(['docker', 'rm', '-f', CONTAINER],
                                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        subprocess.run(['docker', 'run', '-d', '--rm', '--name', CONTAINER, '--network', 'none',
                        '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
                        IMAGE], check=True, stdout=subprocess.DEVNULL)
        for _ in range(100):
            # initdb starts a temporary server, then stops it before PID 1 execs
            # the final postgres process. Do not treat that temporary socket as ready.
            if subprocess.run(['docker', 'exec', CONTAINER, 'sh', '-c',
                               'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(.1)
        else:
            raise RuntimeError('Local PostgreSQL did not become ready')
        # Reuse synthetic fixtures through an SQL recorder, not PGlite execution.
        js = """
import { setup, seed, additions, read } from './tests/helpers/tenant-domain-fixture.mjs';
const statements=[];
const q=v=>v===null?'NULL':typeof v==='boolean'?(v?'true':'false'):typeof v==='number'?String(v):"'"+v.replaceAll("'","''")+"'";
class Recorder {
  async exec(sql) { statements.push(sql+';'); }
  async query(sql,args=[]) { statements.push(sql.replace(/\\$(\\d+)/g,(_,n)=>q(args[Number(n)-1]))+';'); return {rows:[]}; }
}
const db=await setup(()=>new Recorder());
for(const f of additions) await db.exec(await read('supabase/migrations/'+f));
await seed(db);
process.stdout.write(statements.join('\\n'));
"""
        fixture = subprocess.run(['node', '--input-type=module', '-e', js], cwd=ROOT,
                                 capture_output=True, text=True, check=True).stdout
        result = cls.sql(fixture)
        if result.returncode:
            raise RuntimeError(result.stderr)
        print(cls.sql('SELECT version();').stdout.strip(), flush=True)

    @staticmethod
    def sql(statement, user=None, role='authenticated'):
        if user or role == 'anon':
            statement = f"SET SESSION AUTHORIZATION {role}; SET request.jwt.claim.sub='{user or ''}';\n" + statement
        return subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres',
                               '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
                              input=statement, capture_output=True, text=True, timeout=20)

    def good(self, statement, user=None):
        result = self.sql(statement, user)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def denied(self, statement, user, code='42501', role='authenticated'):
        result = self.sql(statement, user, role)
        self.assertNotEqual(result.returncode, 0, statement)
        self.assertIn(code, result.stderr)
        return result

    def setUp(self):
        # Only the local fixture administrator provisions initial records.
        self.product = self.good(f"INSERT INTO public.erp_products(tenant_id,name,price) VALUES ('{TENANT}','Synthetic',100) RETURNING id;")
        self.good(f"INSERT INTO public.erp_product_costs(tenant_id,id,cost) VALUES ('{TENANT}','{self.product}',50);")
        self.good(f"INSERT INTO public.erp_product_stock(tenant_id,id,initial_stock,min_stock) VALUES ('{TENANT}','{self.product}',10,2);")

    def state(self, product=None):
        return self.good(f"""SELECT p.version,p.name,p.price,c.cost,s.initial_stock,s.min_stock
            FROM public.erp_products p JOIN public.erp_product_costs c USING(tenant_id,id)
            JOIN public.erp_product_stock s USING(tenant_id,id) WHERE p.id='{product or self.product}';""")

    def wait_for(self, app, event_type=None):
        condition = "wait_event='PgSleep'" if event_type is None else f"wait_event_type='{event_type}'"
        for _ in range(80):
            if self.good(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND {condition};") == '1':
                return
            time.sleep(.05)
        self.fail('Concurrent test did not reach the expected barrier')

    def race(self, first, second):
        with concurrent.futures.ThreadPoolExecutor() as pool:
            winner = pool.submit(self.sql, "SET application_name='occ-winner'; BEGIN;" + first + 'SELECT pg_sleep(2); COMMIT;', OWNER)
            self.wait_for('occ-winner')
            loser = pool.submit(self.sql, "SET application_name='occ-loser';" + second, OWNER)
            self.wait_for('occ-loser', 'Lock')
            a, b = winner.result(), loser.result()
        self.assertEqual(a.returncode, 0, a.stderr)
        self.assertNotEqual(b.returncode, 0)
        self.assertIn('40001', b.stderr)
        self.assertIn('VERSION_CONFLICT', b.stderr)

    def test_correct_version_and_atomic_combined_patch(self):
        output = self.good(rpc(self.product, 1, {'price': 110}, {'cost': 60}, {'min_stock': 3}), OWNER)
        self.assertEqual(output, self.product + '|2')
        self.assertEqual(self.state(), '2|Synthetic|110.00|60.00|10|3')

    def test_wrong_missing_and_future_versions_change_nothing(self):
        before = self.state()
        for version, code in [(None, '22023'), (0, '22023'), (-1, '22023'), (2, '40001')]:
            self.denied(rpc(self.product, version, {'price': 111}), OWNER, code)
            self.assertEqual(self.state(), before)

    def test_two_connections_same_product(self):
        self.race(rpc(self.product, 1, {'price': 110}), rpc(self.product, 1, {'price': 120}))
        self.assertEqual(self.state(), '2|Synthetic|110.00|50.00|10|2')

    def test_cost_competes_with_product_on_root_version(self):
        self.race(rpc(self.product, 1, cost={'cost': 70}), rpc(self.product, 1, {'price': 120}, {'cost': 80}))
        self.assertEqual(self.state(), '2|Synthetic|100.00|70.00|10|2')

    def test_stock_competes_with_cost_on_root_version(self):
        self.race(rpc(self.product, 1, stock={'initial_stock': 9}), rpc(self.product, 1, cost={'cost': 80}))
        self.assertEqual(self.state(), '2|Synthetic|100.00|50.00|9|2')

    def test_different_products_do_not_share_the_lock(self):
        other = self.good(f"INSERT INTO public.erp_products(tenant_id,name,price) VALUES ('{TENANT}','Other',1) RETURNING id;")
        with concurrent.futures.ThreadPoolExecutor() as pool:
            holding = pool.submit(self.sql, "SET application_name='occ-other'; BEGIN;" + rpc(self.product, 1, {'price': 101}) + 'SELECT pg_sleep(2); COMMIT;', OWNER)
            self.wait_for('occ-other')
            result = self.sql("SET statement_timeout='700ms';" + rpc(other, 1, {'price': 2}), OWNER)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(holding.result().returncode, 0)

    def test_no_direct_write_delete_reinsert_upsert_or_role_bypass(self):
        statements = [
            'UPDATE public.erp_products SET price=0',
            'UPDATE public.erp_product_costs SET cost=0',
            'UPDATE public.erp_product_stock SET initial_stock=0',
            'DELETE FROM public.erp_products', 'DELETE FROM public.erp_product_costs',
            f"INSERT INTO public.erp_products(tenant_id,id,name,price) VALUES ('{TENANT}','{self.product}','x',0) ON CONFLICT(tenant_id,id) DO UPDATE SET price=0",
            f"INSERT INTO public.erp_product_costs(tenant_id,id,cost) VALUES ('{TENANT}','{self.product}',0) ON CONFLICT(tenant_id,id) DO UPDATE SET cost=0",
            'TRUNCATE public.erp_products', 'SET ROLE handyhub_product_writer',
            "SET handyhub.expected_version='1'; UPDATE public.erp_products SET price=0",
        ]
        before = self.state()
        for statement in statements:
            self.denied(statement, OWNER)
        self.assertEqual(self.state(), before)
        # Table AND column grants must be absent on ALL new business tables.
        self.assertEqual(self.good("""SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'erp_%'
          AND (has_table_privilege('authenticated',quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE,TRUNCATE')
          OR has_any_column_privilege('authenticated',quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE'));"""), '0')

    def test_tenant_identity_and_roles_cannot_be_forged(self):
        for user in [MANAGER, EMPLOYEE, ADMIN]:
            self.denied(rpc(self.product, 1, {'price': 111}), user)
        self.denied(rpc(self.product, 1, {'price': 111}), None, role='anon')
        self.denied(rpc(self.product, 1, {'price': 111}, tenant=FOREIGN), OWNER)
        self.denied(rpc(uuid(10123), 1, {'price': 111}), OWNER)
        for patch in [{'tenant_id': FOREIGN}, {'version': 1}, {'id': uuid(999)}, {'owner_id': OWNER}]:
            self.denied(rpc(self.product, 1, patch), OWNER, '22023')
        self.assertEqual(self.state(), '1|Synthetic|100.00|50.00|10|2')

    def test_conflict_rolls_back_preceding_changes_in_the_transaction(self):
        statement = 'BEGIN;' + rpc(self.product, 1, {'name': 'Must rollback'}) + rpc(self.product, 1, cost={'cost': 90}) + 'COMMIT;'
        self.denied(statement, OWNER, '40001')
        self.assertEqual(self.state(), '1|Synthetic|100.00|50.00|10|2')

    def test_invalid_child_rolls_back_parent_and_other_child(self):
        self.denied(rpc(self.product, 1, {'price': 111}, {'cost': 60}, {'min_stock': -1}), OWNER, '23514')
        self.assertEqual(self.state(), '1|Synthetic|100.00|50.00|10|2')

    def test_child_creation_and_validation_are_versioned(self):
        other = self.good(f"INSERT INTO public.erp_products(tenant_id,name,price) VALUES ('{TENANT}','Other',1) RETURNING id;")
        self.denied(rpc(other, 1, stock={'min_stock': 3}), OWNER, '22023')
        self.good(rpc(other, 1, cost={'cost': 2}, stock={'initial_stock': 3, 'min_stock': 1}), OWNER)
        self.assertEqual(self.state(other), '2|Other|1.00|2.00|3|1')
        for stock in [{'initial_stock': 1.5}, {'min_stock': None}]:
            self.denied(rpc(other, 2, stock=stock), OWNER, '22023')

    def test_capability_role_has_no_login_bypass_membership_or_table_ownership(self):
        self.assertEqual(self.good("SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='handyhub_product_writer'"), 'f|f|f')
        self.assertEqual(self.good("SELECT count(*) FROM pg_auth_members WHERE roleid='handyhub_product_writer'::regrole"), '0')
        self.assertEqual(self.good("SELECT count(*) FROM pg_class WHERE relowner='handyhub_product_writer'::regrole"), '0')
        self.assertEqual(self.good("SELECT has_schema_privilege('handyhub_product_writer','public','CREATE')"), 'f')
        self.assertEqual(self.good("SELECT count(*) FROM pg_class WHERE relname IN ('erp_products','erp_product_costs','erp_product_stock') AND relrowsecurity AND relforcerowsecurity"), '3')


if __name__ == '__main__':
    unittest.main(verbosity=2)
