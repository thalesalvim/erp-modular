"""Native v6/3 certification. Only validated local, owned disposable PostgreSQL.

--review prints two independently reconstructed candidates and rolls both back.
It never writes a manifest or installs a candidate reference.
"""
import concurrent.futures
import importlib.util
import json
import subprocess
import sys
import time
import unittest
import uuid
from unittest.mock import patch

import managed_customer_notes_release as release
from postgres_harness import LocalDocker

spec = importlib.util.spec_from_file_location('original_customers', release.ROOT / 'scripts/test-managed-customers.py')
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)
base = old.base
ACK = "SET handyhub.managed_install='pilot-v6-3';"


def fixture(purpose='customer-notes'):
    pg = old.create_fixture(purpose)
    try:
        base.good(pg, old.ACK + old.release.installation_sql())
        return pg
    except BaseException:
        pg.close()
        raise


def references(pg):
    return base.good(pg, "SELECT jsonb_build_array((SELECT to_jsonb(r) FROM handyhub_private.release r),"
                     "(SELECT to_jsonb(r) FROM handyhub_private.customer_release r))")


def quiesce(pg):
    # Explicit fixture operation, not performed by the installer or HTTP API.
    base.good(pg, 'BEGIN;UPDATE handyhub_private.runtime SET maintenance=true;'
              'UPDATE handyhub_private.pilot_tenants SET enabled=false;COMMIT;')


def review():
    roots = []
    for _ in range(2):
        pg = fixture('customer-notes-review')
        try:
            before = base.snapshot(pg)
            sql = release.render('0' * 64, seal=False).removesuffix('COMMIT;\n') + 'ROLLBACK;'
            roots.append(base.good(pg, ACK + sql))
            if base.snapshot(pg) != before:
                raise AssertionError('Review changed prior state')
            base.good(pg, 'SELECT handyhub_private.assert_integrity()')
        finally:
            pg.close()
    if roots[0] != roots[1]:
        raise AssertionError('Independent v6/3 roots differ')
    print(json.dumps({'independent_roots': roots, 'source_sha256': release.digest(release.source().encode('utf-8')),
                      'review_transactions_rolled_back': True}))


class Notes(old.Customers):
    @classmethod
    def setUpClass(cls):
        cls.pg = fixture()
        cls.addClassCleanup(cls.pg.close)
        cls.prior = base.good(cls.pg, 'SELECT row_to_json(r) FROM handyhub_private.release r')
        cls.prior_references = references(cls.pg)
        base.good(cls.pg, ACK + release.installation_sql())
        old.activate(cls.pg)

    def detail(self, customer):
        return self.ok(f"SELECT public.hh_customer_read('{base.A}','{customer['id']}')")

    def test_06_install_rollback_upgrade_and_preflight(self):
        pg = fixture('customer-notes-upgrade')
        try:
            previous = references(pg)
            before = base.snapshot(pg)
            sql = release.installation_sql().removesuffix('COMMIT;\n') + 'SELECT 1/0;COMMIT;'
            self.assertEqual(base.code(pg.sql(ACK + sql)), '22012')
            self.assertEqual(base.snapshot(pg), before)
            self.assertEqual(references(pg), previous)
            base.good(pg, 'SELECT handyhub_private.assert_integrity()')
            for drift in [
                'GRANT SELECT ON handyhub_private.customer_identity TO authenticated;',
                'CREATE OR REPLACE FUNCTION handyhub_private.assert_integrity() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=\'\' AS $$BEGIN RETURN;END$$;',
            ]:
                candidate = release.installation_sql().replace('BEGIN;', 'BEGIN;' + drift, 1)
                self.assertEqual(base.code(pg.sql(ACK + candidate)), '55000')
                self.assertEqual(base.snapshot(pg), before)
            base.good(pg, ACK + release.installation_sql())
            self.assertEqual(references(pg), previous)
            self.assertEqual(base.code(pg.sql(ACK + release.installation_sql())), '55000')
        finally:
            pg.close()

    def test_08_create_with_without_and_validate_notes(self):
        without = self.ok(self.command(self.data()))
        self.assertEqual(self.detail(without)['draft']['notes'], '')
        p = {**self.data(), 'notes': 'Synthetic observation\nwith a second line.'}
        with_notes = self.ok(self.command(p))
        self.assertEqual(self.detail(with_notes)['draft']['notes'], p['notes'])
        for value in [None, 9, {}, 'x' * 2001]:
            self.assertEqual(base.code(self.run_actor(self.command({**self.data(), 'notes': value}))), '22023')
        self.assertEqual(base.code(self.run_actor(self.command({**self.data(), 'unknown': ''}))), '22023')

    def test_09_edit_omission_preserves_explicit_empty_clears(self):
        p = {**self.data(), 'notes': 'Must survive old client'}
        created = self.ok(self.command(p))
        legacy = {k: v for k, v in p.items() if k != 'notes'}
        legacy['fullName'] = 'Synthetic Legacy Edited'
        updated = self.ok(self.command(legacy, created['id'], 1))
        self.assertEqual(self.detail(updated)['draft']['notes'], p['notes'])
        edited = self.ok(self.command({**legacy, 'notes': 'Explicit new note'}, created['id'], 2))
        self.assertEqual(self.detail(edited)['draft']['notes'], 'Explicit new note')
        cleared = self.ok(self.command({**legacy, 'notes': ''}, created['id'], 3))
        self.assertEqual(self.detail(cleared)['draft']['notes'], '')

    def test_10_upgrade_preserves_rows_old_receipts_and_retry_semantics(self):
        pg = fixture('customer-notes-receipts')
        try:
            old.activate(pg)
            actor = old.Customers(); actor.pg = pg
            p = actor.data(); create_cmd = actor.command(p)
            created = actor.ok(create_cmd)
            p['fullName'] = 'Historical Updated Person'
            update_operation = str(uuid.uuid4())
            update_cmd = actor.command(p, created['id'], 1, op=update_operation)
            updated = actor.ok(update_cmd)
            prior = references(pg)
            receipt_sql = 'SELECT jsonb_agg(to_jsonb(r) ORDER BY operation_id) FROM handyhub_private.customer_receipts r'
            receipts = base.good(pg, receipt_sql)
            audit = base.good(pg, 'SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM handyhub_private.customer_audit r')
            records = base.good(pg, 'SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.erp_customers r')
            identity = base.good(pg, 'SELECT jsonb_agg(to_jsonb(r) ORDER BY customer_id) FROM handyhub_private.customer_identity r')
            quiesce(pg); base.good(pg, ACK + release.installation_sql())
            base.good(pg, 'BEGIN;UPDATE handyhub_private.runtime SET maintenance=false;UPDATE handyhub_private.pilot_tenants SET enabled=true;COMMIT;')
            self.assertEqual(references(pg), prior)
            self.assertEqual(base.good(pg, receipt_sql), receipts)
            self.assertEqual(base.good(pg, 'SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM handyhub_private.customer_audit r'), audit)
            self.assertEqual(base.good(pg, 'SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.erp_customers r'), records)
            self.assertEqual(base.good(pg, "SELECT jsonb_agg(to_jsonb(r)-'notes' ORDER BY customer_id) FROM handyhub_private.customer_identity r"), identity)
            self.assertEqual(actor.ok(create_cmd), created)
            self.assertEqual(actor.ok(update_cmd), updated)
            self.assertEqual(base.good(pg, receipt_sql), receipts)
            noted = actor.ok(actor.command({**p, 'notes': 'Created after upgrade'}, created['id'], 2))
            self.assertEqual(noted['version'], 3)
            self.assertEqual(actor.ok(update_cmd), updated)
            actual = actor.ok(f"SELECT public.hh_customer_read('{base.A}','{created['id']}')")
            self.assertEqual(actual['version'], 3)
            self.assertEqual(actual['draft']['notes'], 'Created after upgrade')
            # Explicit notes uses its own fingerprint domain, even when empty.
            self.assertEqual(base.code(actor.run_actor(actor.command({**p, 'notes': ''}, created['id'], 1, op=update_operation))), '40001')
        finally:
            pg.close()

    def test_11_explicit_notes_idempotency_and_concurrent_retry(self):
        p = {**self.data(), 'notes': 'One operation only'}
        operation = str(uuid.uuid4()); command = self.command(p, op=operation)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results = list(pool.map(self.run_actor, [command, command]))
        self.assertTrue(all(r.returncode == 0 for r in results))
        self.assertEqual(results[0].stdout, results[1].stdout)
        self.assertEqual(base.code(self.run_actor(self.command({**p, 'notes': 'Changed'}, op=operation))), '40001')
        self.assertEqual(base.good(self.pg, f"SELECT count(*) FROM handyhub_private.customer_receipts WHERE operation_id='{operation}'"), '1')

    def test_12_notes_version_race_and_cpf_constraint(self):
        p = {**self.data(), 'notes': 'Initial'}; created = self.ok(self.command(p))
        commands = [self.command({**p, 'notes': value}, created['id'], 1) for value in ['First', 'Second']]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results = list(pool.map(self.run_actor, commands))
        self.assertEqual(sorted('OK' if r.returncode == 0 else base.code(r) for r in results), ['40001', 'OK'])
        actual = self.detail(created)
        self.assertEqual(actual['version'], 2); self.assertIn(actual['draft']['notes'], ['First', 'Second'])
        p = self.data(); commands = [self.command({**p, 'notes': value}) for value in ['A', 'B']]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results = list(pool.map(self.run_actor, commands))
        self.assertEqual(sorted('OK' if r.returncode == 0 else base.code(r) for r in results), ['23505', 'OK'])

    def test_13_data_receipts_and_audit_rollback_together(self):
        p = {**self.data(), 'notes': 'Before rollback'}; created = self.ok(self.command(p))
        before = self.detail(created)
        query = "SELECT jsonb_build_array((SELECT count(*) FROM handyhub_private.customer_receipts),(SELECT count(*) FROM handyhub_private.customer_audit))"
        counts = base.good(self.pg, query)
        command = self.command({**p, 'notes': 'Must roll back'}, created['id'], 1)
        self.assertEqual(base.code(self.run_actor('BEGIN;' + command + 'SELECT 1/0;COMMIT;')), '22012')
        self.assertEqual(self.detail(created), before)
        self.assertEqual(base.good(self.pg, query), counts)

    def test_14_notes_tenant_profiles_and_private_access(self):
        p = {**self.data(), 'notes': 'Synthetic private note'}; created = self.ok(self.command(p))
        for user in [base.MANAGER, base.EMPLOYEE, base.FOREIGN]:
            self.assertEqual(base.code(self.run_actor(self.command(p), user)), '42501')
            self.assertEqual(base.code(self.run_actor(f"SELECT public.hh_customer_read('{base.A}','{created['id']}')", user)), '42501')
        other = self.ok(self.command(p, tenant=base.B), base.FOREIGN)
        self.assertNotEqual(other['id'], created['id'])  # CPF is not a global identity.
        for role in ['anon', 'service_role']:
            self.assertEqual(base.code(base.actor(self.pg, self.command(p), role=role)), '42501')
        for sql in ['SELECT notes FROM handyhub_private.customer_identity', "UPDATE handyhub_private.customer_identity SET notes=''", 'SELECT * FROM handyhub_private.customer_notes_release']:
            self.assertEqual(base.code(self.run_actor(sql)), '42501')
        audit = base.good(self.pg, "SELECT jsonb_agg(to_jsonb(a)) FROM handyhub_private.customer_audit a WHERE customer_id=" + base.q(created['id']))
        self.assertNotIn(p['notes'], audit)

    def test_15_new_anchor_prior_references_and_tampering(self):
        self.assertEqual(references(self.pg), self.prior_references)
        for sql in ['ALTER TABLE handyhub_private.customer_identity DISABLE ROW LEVEL SECURITY;',
                    'GRANT SELECT(notes) ON handyhub_private.customer_identity TO authenticated;',
                    "SET LOCAL ROLE handyhub_customer_writer;ALTER FUNCTION public.hh_customer_write(uuid,uuid,jsonb,uuid,bigint,text) SET search_path=public;SET LOCAL ROLE postgres;"]:
            result = self.pg.sql('BEGIN;' + sql + 'SELECT handyhub_private.assert_integrity();ROLLBACK;')
            self.assertEqual(base.code(result), '55000')
        for table in ['release', 'customer_release', 'customer_notes_release']:
            self.assertEqual(base.code(self.pg.sql(f"BEGIN;UPDATE handyhub_private.{table} SET root_sha256=repeat('0',64);ROLLBACK;")), '55000')
        base.good(self.pg, 'SELECT handyhub_private.assert_integrity()')

    def test_16_revocation_after_observed_lock_wait(self):
        holder, waiter = ['notes-' + uuid.uuid4().hex for _ in range(2)]
        client = old.CLIENT
        args = [client.executable, '--host', client.endpoint, 'container', 'exec', '-i', self.pg.container_id,
                'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1']
        child = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=dict(client.environment))
        pool = concurrent.futures.ThreadPoolExecutor(1)
        def wait(condition):
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                if child.poll() is not None:
                    raise AssertionError('SYNCHRONIZATION_FAILURE: holder exited')
                if base.good(self.pg, 'SELECT (' + condition + ')::int') == '1':
                    return
                time.sleep(.03)
            raise AssertionError('SYNCHRONIZATION_TIMEOUT: required lock edge absent')
        try:
            child.stdin.write((f"SET application_name='{holder}';BEGIN;SELECT id FROM public.tenants WHERE id='{base.A}' FOR NO KEY UPDATE;\n").encode()); child.stdin.flush()
            wait(f"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{holder}' AND state='idle in transaction')")
            command = f"SET application_name='{waiter}';SET statement_timeout='18s';" + self.command({**self.data(), 'notes': 'Denied after wait'})
            future = pool.submit(self.run_actor, command)
            wait(f"EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.application_name='{holder}' WHERE w.application_name='{waiter}' AND h.pid=ANY(pg_blocking_pids(w.pid)))")
            child.stdin.write((f"UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='{base.A}' AND user_id='{base.OWNER}';COMMIT;\\q\n").encode()); child.stdin.flush()
            result = future.result(timeout=22)
            self.assertEqual(base.code(result), '42501')
        finally:
            if child.poll() is None:
                child.kill(); child.wait(timeout=5)
            base.good(self.pg, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name IN ("
                      + base.q(waiter) + ',' + base.q(holder) + ')')
            pool.shutdown(wait=True, cancel_futures=True)
            for stream in [child.stdin, child.stdout, child.stderr]:
                stream.close()
            base.good(self.pg, f"UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='{base.A}' AND user_id='{base.OWNER}';")

    def test_17_assembler_requires_real_manifest_and_unchanged_prior_sources(self):
        current = release.source()
        with patch.object(release, 'source', lambda: current + '\n-- drift'):
            with self.assertRaises(ValueError):
                release.installation_sql()
        prior = release.previous.source()
        with patch.object(release.previous, 'source', lambda: prior + '\n-- drift'):
            with self.assertRaises(ValueError):
                release.installation_sql()
        with patch.object(release, 'DIRECTORY', release.ROOT / 'nonexistent-v6-3-review-fixture'):
            with self.assertRaises(FileNotFoundError):
                release.installation_sql()

    def test_18_readonly_postflight_detects_replaced_verifier(self):
        base.good(self.pg, 'BEGIN READ ONLY;' + release.verification_sql() + 'ROLLBACK;')
        result = self.pg.sql("BEGIN;CREATE OR REPLACE FUNCTION handyhub_private.assert_integrity() RETURNS void "
                             "LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN RETURN;END$$;"
                             + release.verification_sql() + 'ROLLBACK;')
        self.assertEqual(base.code(result), '55000')
        base.good(self.pg, release.verification_sql())

    def test_19_install_requires_maintenance_and_disabled_pilots(self):
        pg = fixture('customer-notes-offline')
        try:
            old.activate(pg)
            before = base.snapshot(pg)
            for state in [
                '',
                'UPDATE handyhub_private.pilot_tenants SET enabled=false;',
                'UPDATE handyhub_private.runtime SET maintenance=true;UPDATE handyhub_private.pilot_tenants SET enabled=true;',
            ]:
                base.good(pg, state)
                self.assertEqual(base.code(pg.sql(ACK + release.installation_sql())), '55000')
                self.assertEqual(base.snapshot(pg), before)
            quiesce(pg)
            base.good(pg, ACK + release.installation_sql())
            self.assertEqual(base.good(pg, 'SELECT maintenance FROM handyhub_private.runtime'), 't')
            self.assertEqual(base.good(pg, 'SELECT count(*) FROM handyhub_private.pilot_tenants WHERE enabled'), '0')
        finally:
            pg.close()


if __name__ == '__main__':
    old.CLIENT = LocalDocker(executable=str(base.CLI)); base.CLIENT = old.CLIENT
    before = base.inventory()
    try:
        if '--review' in sys.argv:
            review()
        else:
            release.manifest()
            result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Notes))
            if not result.wasSuccessful():
                raise SystemExit(1)
    finally:
        old.CLIENT.assert_same_server()
        if base.inventory() != before:
            raise AssertionError('Local Docker inventory changed')
        print('DOCKER_INVENTORY_PRESERVED=True')
