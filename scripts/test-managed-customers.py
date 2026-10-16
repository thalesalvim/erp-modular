"""Real PostgreSQL customer pilot tests. Uses only validated owned local Docker."""
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
import uuid

import managed_customers_release as release
from postgres_harness import LocalDocker, DisposablePostgres

ROOT = release.ROOT
spec = importlib.util.spec_from_file_location('managed_fixture', ROOT/'scripts/test-managed-v6.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
ACK = "SET handyhub.managed_install='pilot-v6-2';"
CLIENT = None


def create_fixture(purpose='customer-pilot'):
    pg = DisposablePostgres(CLIENT, purpose=purpose)
    pg.start()
    try:
        base.fixture(pg)
        base.good(pg, base.ACK + base.release.installation_sql())
        return pg
    except BaseException:
        pg.close()
        raise


def activate(pg):
    # Explicit fixture operation, never an API or hosted activation command.
    base.good(pg, f"BEGIN;LOCK TABLE public.tenant_data IN SHARE ROW EXCLUSIVE MODE;"
              f"INSERT INTO handyhub_private.pilot_tenants VALUES('{base.A}',true),('{base.B}',true);"
              "UPDATE handyhub_private.runtime SET maintenance=false;COMMIT;")


def review():
    roots=[]
    for _ in range(2):
        pg=create_fixture('customer-review')
        try:
            sql=release.source().replace('{{CUSTOMER_ROOT_SHA256}}','0'*64).replace('{{SEAL_AND_POSTFLIGHT}}',
                "SELECT encode(sha256(convert_to(handyhub_private.snapshot()::text,'UTF8')),'hex');")
            sql=sql.removesuffix('COMMIT;\n')+'ROLLBACK;'
            roots.append(base.good(pg,ACK+sql))
        finally:pg.close()
    if roots[0]!=roots[1]:raise AssertionError('Independent roots differ')
    print(json.dumps({'root_sha256':roots[0],'source_sha256':hashlib.sha256(release.source().encode()).hexdigest()}))


class Customers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pg=create_fixture();cls.addClassCleanup(cls.pg.close)
        cls.prior=base.good(cls.pg,'SELECT row_to_json(r) FROM handyhub_private.release r')
        base.good(cls.pg,ACK+release.installation_sql());activate(cls.pg)

    def command(self,data,customer=None,version=None,op=None,reason=None,tenant=base.A):
        q=base.q
        return 'SELECT public.hh_customer_write('+','.join([q(tenant),q(op or str(uuid.uuid4())),q(json.dumps(data))+'::jsonb',q(customer) if customer else 'NULL',str(version) if version else 'NULL',q(reason) if reason else 'NULL'])+');'

    def data(self):
        # Mathematical synthetic CPF; no person identity or external credentials.
        nums=[int(c) for c in str(uuid.uuid4().int)[:9]]
        for length in (9,10):
            v=sum(nums[i]*(length+1-i) for i in range(length))*10%11;nums.append(0 if v==10 else v)
        return {'fullName':'Pessoa Fictícia '+uuid.uuid4().hex[:12].translate(str.maketrans('0123456789','ghijklmnop')),'cpf':''.join(map(str,nums)),'birthDate':'1990-01-02','phone':'+55119'+str(uuid.uuid4().int)[:8]}

    def run_actor(self,sql,user=base.OWNER):return base.actor(self.pg,sql,user)

    def ok(self,sql,user=base.OWNER):
        result=self.run_actor(sql,user);self.assertEqual(result.returncode,0,base.code(result));return json.loads(result.stdout.strip().splitlines()[-1])

    def test_01_create_read_edit(self):
        p=self.data();created=self.ok(self.command(p));self.assertEqual(created['version'],1)
        got=self.ok(f"SELECT public.hh_customer_read('{base.A}','{created['id']}')");self.assertEqual(got['draft']['cpf'],p['cpf'])
        p['fullName']='Nome Editado Fictício'
        edited=self.ok(self.command(p,created['id'],1));self.assertEqual(edited['version'],2)
        self.assertEqual(self.ok(f"SELECT public.hh_customer_read('{base.A}','{created['id']}')")['draft']['fullName'],p['fullName'])

    def test_02_roles_tenant_and_private_dml(self):
        p=self.data()
        for user in [base.MANAGER,base.EMPLOYEE,base.FOREIGN]:self.assertEqual(base.code(self.run_actor(self.command(p),user)),'42501')
        for statement in ['SELECT * FROM handyhub_private.customer_identity','INSERT INTO public.erp_customers(tenant_id,name) VALUES(\''+base.A+'\',\'Forbidden\')','SET ROLE handyhub_customer_writer']:
            self.assertNotEqual(self.run_actor(statement).returncode,0)
        created=self.ok(self.command(p))
        self.assertEqual(base.code(self.run_actor(f"SELECT public.hh_customer_read('{base.B}','{created['id']}')",base.FOREIGN)),'42501')

    def test_03_validation_and_duplicates(self):
        p=self.data();self.ok(self.command(p))
        self.assertEqual(base.code(self.run_actor(self.command(p))),'23505')
        for field,value in [('cpf','11111111111'),('birthDate','2999-01-01'),('birthDate','2026-02-31'),('phone','x'),('fullName','Solo')]:
            self.assertEqual(base.code(self.run_actor(self.command({**self.data(),field:value}))),'22023')
        p2={**self.data(),'fullName':p['fullName']}
        self.assertEqual(base.code(self.run_actor(self.command(p2))),'40001')
        self.ok(self.command(p2,reason='Homônimo revisado pelo responsável'))

    def test_04_retry_version_and_concurrency(self):
        p=self.data();op=str(uuid.uuid4());cmd=self.command(p,op=op)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:self.run_actor(cmd),range(2)))
        self.assertTrue(all(r.returncode==0 for r in results));self.assertEqual(results[0].stdout,results[1].stdout)
        created=json.loads(results[0].stdout.strip().splitlines()[-1]);p['phone']='+5511987654321'
        self.assertEqual(base.code(self.run_actor(self.command(p,op=op))),'40001')
        cmds=[self.command(p,created['id'],1) for _ in range(2)]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(self.run_actor,cmds))
        self.assertEqual(sorted('OK' if r.returncode==0 else base.code(r) for r in results),['40001','OK'])

    def test_05_integrity_history_and_rollback(self):
        self.assertEqual(base.good(self.pg,'SELECT row_to_json(r) FROM handyhub_private.release r'),self.prior)
        result=self.pg.sql('BEGIN;GRANT SELECT ON handyhub_private.customer_identity TO authenticated;SELECT handyhub_private.assert_integrity();ROLLBACK;')
        self.assertEqual(base.code(result),'55000')
        before=base.good(self.pg,'SELECT count(*) FROM public.erp_customers');p=self.data()
        self.assertNotEqual(self.run_actor('BEGIN;'+self.command(p)+'SELECT 1/0;COMMIT;').returncode,0)
        self.assertEqual(base.good(self.pg,'SELECT count(*) FROM public.erp_customers'),before)
        self.assertEqual(base.code(self.run_actor(f"UPDATE public.tenant_data SET payload='{{\"customers\":[{{}}]}}' WHERE tenant_id='{base.A}'")),'42501')

    def test_06_install_failure_and_baseline_preserved(self):
        other=create_fixture('customer-install-rollback')
        try:
            prior=base.good(other,'SELECT row_to_json(r) FROM handyhub_private.release r')
            sql=release.installation_sql().removesuffix('COMMIT;\n')+'SELECT 1/0;COMMIT;'
            self.assertNotEqual(other.sql(ACK+sql).returncode,0)
            self.assertEqual(base.good(other,"SELECT to_regclass('public.erp_customers') IS NULL"),'t')
            self.assertEqual(base.good(other,'SELECT row_to_json(r) FROM handyhub_private.release r'),prior)
            base.good(other,'SELECT handyhub_private.assert_integrity()')
            base.good(other,ACK+release.installation_sql())
            self.assertEqual(base.code(other.sql(ACK+release.installation_sql())),'55000')
        finally:other.close()

    def test_07_revocation_maintenance_and_private_audit(self):
        p=self.data();created=self.ok(self.command(p))
        for change in [f"UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='{base.A}' AND user_id='{base.OWNER}';",'UPDATE handyhub_private.runtime SET maintenance=true;',f"UPDATE public.tenants SET status='Suspenso' WHERE id='{base.A}';"]:
            result=self.pg.sql('BEGIN;'+change+'SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='+base.q(base.OWNER)+';'+self.command(self.data())+'ROLLBACK;')
            self.assertEqual(base.code(result),'42501')
        audit=base.good(self.pg,"SELECT jsonb_agg(to_jsonb(a)) FROM handyhub_private.customer_audit a WHERE customer_id="+base.q(created['id']))
        for personal in [p['cpf'],p['birthDate'],p['phone']]:self.assertNotIn(personal,audit)
        self.assertEqual(base.code(self.run_actor('SELECT * FROM handyhub_private.customer_audit')),'42501')


if __name__=='__main__':
    import sys
    CLIENT=LocalDocker(executable=str(base.CLI));base.CLIENT=CLIENT
    before=base.inventory()
    try:
        if '--review' in sys.argv:review()
        else:
            result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Customers))
            if not result.wasSuccessful():raise SystemExit(1)
    finally:
        CLIENT.assert_same_server()
        if base.inventory()!=before:raise AssertionError('Local Docker inventory changed')
