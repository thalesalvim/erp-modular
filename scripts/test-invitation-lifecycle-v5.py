"""Invitation lifetime v5: real transactions in owned, networkless tmpfs PostgreSQL.

--baseline reproduces the three audited defects on unchanged v4.
--synchronization-only runs the four-transaction reference and its coordination
failure/timeout regressions, without running the other reference scenarios.
No application credentials, remote DSN, fixture file writes or real Auth calls.

The default validates required reviewed manifests before creating resources, then
runs v5 installation and real defensive regressions. --regressions exercises the
historical lifecycle/revocation/restoration/recovery suites after v5 installation.
Reference modes still execute unchanged v4, not v5. No seal is learned from the
installation under test and no SQL file is normalized by the harness.
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import time
import unittest
from unittest.mock import patch
import uuid

spec = importlib.util.spec_from_file_location('v5_integrity_fixture', Path(__file__).with_name('test-recovery-integrity-v4.py'))
v4 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v4)
a, f = v4.a, v4.f
ROOT = f.ROOT
V5 = ROOT / 'supabase/migrations/20261014043000_erp_invitation_lifecycle_v5.sql'
MANIFEST = ROOT / 'supabase/recovery/reviewed-history-v5.json'


def source():
    return V5.read_bytes().decode('utf-8')


def reviewed_manifest():
    old = v4.reviewed_manifest()
    manifest = json.loads(MANIFEST.read_bytes().decode('utf-8'))
    expected_history = dict(old['snapshot_sha256'], erp_recovery_schema_seal_v4=
                            'd2edcdbeb4d0a02e0e39850842699fd3b7a5736e2c5555900205956f1c32b47e')
    for key in ['profile', 'metadata_owner', 'postgres_major', 'postgres_tested', 'image', 'canonicalization', 'reviewed_definition_md5']:
        if manifest[key] != old[key]:
            raise ValueError('Unreviewed historical profile: ' + key)
    if (manifest['snapshot_sha256'] != expected_history
            or manifest['reviewed_definition_sha256'] != {'v4': old['active_definition_sha256']}
            or manifest['source_sha256'] != dict(old['source_sha256'], v4_sql=hashlib.sha256(v4.V4.read_bytes()).hexdigest())
            or not re.fullmatch('[a-f0-9]{64}', manifest['active_definition_sha256'])):
        raise ValueError('Unreviewed v5 historical provenance or definition anchor')
    if manifest['limits'] != dict(pending_per_actor=50, pending_per_tenant=200, rolling_24h_per_actor=100,
                                 rolling_24h_per_tenant=500, cumulative_per_actor=1024, cumulative_per_tenant=4096,
                                 retention_days_after_expiry=30, maximum_retention_batch=500):
        raise ValueError('Unreviewed invitation limits')
    sql = source()
    if "IF digest IS DISTINCT FROM '" + manifest['active_definition_sha256'] + "'" not in sql:
        raise ValueError('v5 literal definition anchor differs from manifest')
    for fingerprint in expected_history.values():
        if fingerprint not in sql:
            raise ValueError('Independent historical fingerprint missing in v5 source')
    return manifest


def references(case):
    names = list(reviewed_manifest()['snapshot_sha256'])
    return {name: case.good(f"SELECT encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') FROM private.{name} WHERE singleton") for name in names}


def data_manifest(case):
    # Only disposable SQL TEMP metadata; no project files or database dumps.
    value = case.good("""CREATE TEMP TABLE v5_data_manifest(name text, checksum text);
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('public','private','auth') AND c.relname NOT IN ('erp_runtime_control','erp_recovery_events') LOOP
 EXECUTE pg_catalog.format($q$INSERT INTO pg_temp.v5_data_manifest SELECT %L,pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(x)::text,'' ORDER BY pg_catalog.to_jsonb(x)::text),'')) FROM %I.%I x$q$,r.nspname||'.'||r.relname,r.nspname,r.relname);
 END LOOP;END $$;
SELECT jsonb_object_agg(name,checksum) FROM pg_temp.v5_data_manifest;""")
    return json.loads(value)


class SynchronizationFailure(AssertionError):
    """A worker exited early or the required database barrier was not reached."""


class ConcurrencyTimeout(AssertionError):
    """A SQL/CLI timeout is not evidence of a PostgreSQL deadlock."""


class Transactions(a.InvitationAtomic):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        result = cls.sql(a.MAINTENANCE + v4.V4.read_bytes().decode() + a.RESUME)
        if result.returncode:
            raise RuntimeError(result.stderr)

    def connection(self, name, initial):
        pg = f._postgres
        pg.client.assert_same_server()
        args = [pg.client.executable, '--host', pg.client.endpoint, 'container', 'exec', '-i', pg.container_id,
                'psql', '-X', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
        process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=dict(pg.client.environment))
        def close():
            if process.poll() is None:
                try:
                    process.stdin.write(b'ROLLBACK;\n\\q\n'); process.stdin.flush()
                    process.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    process.kill(); process.wait(timeout=5)  # Our local CLI only.
            for pipe in (process.stdin, process.stdout, process.stderr):
                try:
                    pipe.close()
                except OSError:
                    pass
        self.addCleanup(close)
        process.stdin.write((f"SET application_name='{name}';SET statement_timeout='20s';" + initial + '\n').encode())
        process.stdin.flush()
        return process

    def blocked(self, waiter, holder):
        self.wait(f"EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.application_name='{holder}' "
                  f"WHERE w.application_name='{waiter}' AND h.pid=ANY(pg_blocking_pids(w.pid)))")

    def expiration_wait(self, fixed):
        ticket = self.good(f"SET request.jwt.claim.sub='{a.OWNER}';INSERT INTO private.erp_invitation_authorizations(tenant_id,actor_user_id,requested_role,invited_user_id,expires_at) "
                           f"VALUES ('{a.T}','{a.OWNER}','employee','{self.target}',clock_timestamp()+interval '6 seconds') RETURNING id")
        control, waiter = ['v5-' + uuid.uuid4().hex[:12] for _ in range(2)]
        connection = self.connection(control, f"BEGIN;INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES ('{a.T}','{self.target}','employee');")
        self.wait(f"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{control}' AND state='idle in transaction')")
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.sql, f"SET application_name='{waiter}';SET statement_timeout='18s';" + self.command(ticket), a.OWNER)
            self.blocked(waiter, control)  # Prove the INSERT waits on the unique index transaction.
            self.wait(f"clock_timestamp()>(SELECT expires_at FROM private.erp_invitation_authorizations WHERE id='{ticket}')")
            connection.stdin.write(b'ROLLBACK;\n\\q\n'); connection.stdin.flush(); connection.wait(timeout=5)
            result = future.result(timeout=20)
        if fixed:
            self.assertNotEqual(result.returncode, 0); self.assertIn('INVITATION_EXPIRED', result.stderr)
            self.assertEqual(self.count(), '0')
            self.assertEqual(self.good(f"SELECT consumed_at IS NULL FROM private.erp_invitation_authorizations WHERE id='{ticket}'"), 't')
        else:
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.count(), '1')
            self.assertEqual(self.good(f"SELECT consumed_at>expires_at FROM private.erp_invitation_authorizations WHERE id='{ticket}'"), 't')

    def four_transactions(self, fixed, *, statement_timeout_ms=30000):
        # Real managers and staff records; no mocks, test triggers or mocked authorization.
        users = [str(uuid.uuid4()) for _ in range(2)]
        employees = [str(uuid.uuid4()) for _ in range(2)]
        for user, employee in zip(users, employees):
            self.good(f"INSERT INTO auth.users(id) VALUES ('{user}');INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES ('{a.T}','{user}','manager');"
                      f"INSERT INTO public.erp_employees(tenant_id,id,name) VALUES ('{a.T}','{employee}','Synthetic concurrency');"
                      f"INSERT INTO private.erp_employee_auth_links VALUES ('{a.T}','{employee}','{user}')")
        tickets = [self.prepared(user, target=users[1-i]) for i, user in enumerate(users)]
        control = 'v5-control-' + uuid.uuid4().hex
        names = ['v5-task-' + uuid.uuid4().hex for _ in range(4)]
        # v4 order: actor membership SHARE -> ticket UPDATE -> recipient employee
        # SHARE. Stage invitations on their tickets *before* lifecycle queues an
        # exclusive actor-member lock; a queued row lock would block later SHARE
        # requests and would not reliably stage the intended four-way cycle.
        hold = (f"SELECT 1 FROM public.tenants WHERE id='{a.T}' FOR NO KEY UPDATE" if fixed else
                f"SELECT 1 FROM private.erp_invitation_authorizations WHERE id IN ('{tickets[0]}','{tickets[1]}') ORDER BY id FOR UPDATE")
        versions = [self.good(f"SELECT version FROM public.erp_employees WHERE tenant_id='{a.T}' AND id='{employee}'") for employee in employees]
        commands = [f"SELECT * FROM public.erp_set_employee_active('{a.T}','{employee}',{version},false,'offboarding')" for employee, version in zip(employees, versions)]
        commands += [self.command(tickets[i], users[1-i]) for i in range(2)]
        actors = [a.OWNER, a.OWNER] + users
        sessions = [control] + names
        futures = {}
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
        connection = None
        try:
            connection = self.connection(control, 'BEGIN;' + hold + ';')
            self.four_barrier(sessions, futures, 'controller ready',
                              lambda rows: rows.get(control, {}).get('state') == 'idle in transaction')
            order = [0, 1, 2, 3] if fixed else [2, 3, 0, 1]
            for i in order:
                # deadlock_timeout is a superuser-context setting. Configure only
                # this disposable session BEFORE dropping to authenticated; no
                # GRANT, role attribute, RLS or database default is changed.
                statement = (f"SET application_name='{names[i]}';SET deadlock_timeout='5s';SET statement_timeout='{int(statement_timeout_ms)}ms';"
                             f"SET SESSION AUTHORIZATION authenticated;SET request.jwt.claim.sub='{actors[i]}';"
                             f"BEGIN;{commands[i]};COMMIT;")
                futures[names[i]] = pool.submit(f._postgres.sql, statement, timeout=45)
                holder = control if fixed or i >= 2 else names[i+2]
                self.four_barrier(sessions, futures, f'worker {i} blocked by expected holder',
                                  lambda rows, name=names[i], holder=holder: (self.four_reaches(rows, name, holder)
                                                                           if fixed else self.four_edge(rows, name, holder)))
            self.release_four_controller(connection)
            if not fixed:
                cycle = [(names[0], names[2]), (names[2], names[1]),
                         (names[1], names[3]), (names[3], names[0])]
                self.four_barrier(sessions, futures, 'complete four-transaction wait cycle',
                                  lambda rows: all(self.four_edge(rows, waiter, holder) for waiter, holder in cycle))
                print('Four-transaction cycle observed in one pg_blocking_pids snapshot.', flush=True)
            results = []
            for name in names:
                try:
                    results.append(futures[name].result(timeout=45))
                except concurrent.futures.TimeoutError as error:
                    raise ConcurrencyTimeout('CLI_TIMEOUT: worker did not finish') from error
                except f.HarnessSafetyError as error:
                    raise SynchronizationFailure('WORKER_TRANSPORT_ERROR: local SQL result unavailable') from error
            states = [self.four_sqlstate(result) for result in results]
            if any(state in ('57014', '55P03') for state in states):
                raise ConcurrencyTimeout('SQL_TIMEOUT: ' + repr(states))
            print('Worker SQLSTATEs [lifecycle A, lifecycle B, invitation A, invitation B]:',
                  states, flush=True)
        finally:
            # Release the controller before joining workers, including when a
            # barrier raises. Cancel/terminate only this run's named backends in
            # its owned disposable cluster, never unrelated daemon resources.
            try:
                if connection is not None:
                    self.release_four_controller(connection)
            finally:
                try:
                    self.terminate_four_sessions(sessions)
                finally:
                    pool.shutdown(wait=True, cancel_futures=True)
                    self.terminate_four_sessions(sessions)
                    self.four_barrier(sessions, {}, 'all owned sessions closed', lambda rows: not rows)
        print('All four worker sessions and the controller closed.', flush=True)
        if fixed:
            for result in results:
                self.assertNotIn('40P01', result.stderr); self.assertNotIn('57014', result.stderr)
            for result in results[:2]:
                self.assertEqual(result.returncode, 0, result.stderr)
            for result in results[2:]:
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue('42501' in result.stderr or '23505' in result.stderr, result.stderr)
        else:
            self.assertIn('40P01', states, 'Complete wait cycle was observed but PostgreSQL did not report a deadlock')
            for result, state in zip(results, states):
                self.assertTrue(state in ('00000', '40P01', '42501', '23505'),
                                'UNEXPECTED_WORKER_ERROR: ' + result.stderr)
        self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_invitation_authorizations WHERE id IN ('{tickets[0]}','{tickets[1]}') AND consumed_at IS NOT NULL"), '0')
        self.good('SELECT private.erp_assert_recovery_integrity()')

    @staticmethod
    def four_sqlstate(result):
        if result.returncode == 0:
            return '00000'
        match = re.search(r'ERROR:\s+([A-Z0-9]{5}):', result.stderr)
        return match.group(1) if match else 'CLI_ERROR'

    def four_snapshot(self, names):
        # Only metadata for names generated by this test; never log query text.
        selected = ','.join(f.quote(name) for name in names)
        return {row['name']: row for row in json.loads(self.good(
            "SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backend_start',backend_start::text,"
            "'name',application_name,'state',state,'wait',wait_event,'wait_type',wait_event_type,"
            f"'blockers',pg_blocking_pids(pid))),'[]') FROM pg_stat_activity WHERE application_name IN ({selected})"))}

    @staticmethod
    def four_edge(rows, waiter, holder):
        return (waiter in rows and holder in rows and rows[waiter]['wait_type'] == 'Lock'
                and rows[holder]['pid'] in rows[waiter]['blockers'])

    @staticmethod
    def four_reaches(rows, waiter, holder):
        # PostgreSQL may queue a later tenant lock behind an earlier waiter.
        # Require an actual wait path to the controller, not merely wait_event=Lock.
        if waiter not in rows or holder not in rows or rows[waiter]['wait_type'] != 'Lock':
            return False
        by_pid = {row['pid']: row for row in rows.values()}
        pending, seen = list(rows[waiter]['blockers']), set()
        while pending:
            pid = pending.pop()
            if pid == rows[holder]['pid']:
                return True
            if pid in by_pid and pid not in seen:
                seen.add(pid)
                pending.extend(by_pid[pid]['blockers'])
        return False

    def four_barrier(self, names, futures, label, condition):
        deadline = time.monotonic() + 10
        rows = {}
        while time.monotonic() < deadline:
            # Early exit invalidates staging, even if an expected edge appeared
            # briefly. 40P01 here is a premature deadlock, not the intended proof.
            for name, future in futures.items():
                if future.done():
                    try:
                        result = future.result()
                    except f.HarnessSafetyError as error:
                        raise SynchronizationFailure('WORKER_TRANSPORT_ERROR: ' + label) from error
                    state = self.four_sqlstate(result)
                    error = ConcurrencyTimeout if state in ('57014', '55P03') else SynchronizationFailure
                    reason = 'PREMATURE_DEADLOCK' if state == '40P01' else 'EARLY_WORKER_EXIT'
                    raise error(f'{reason}: {label}; SQLSTATE={state}; ' + result.stderr.strip())
            rows = self.four_snapshot(names)
            if condition(rows):
                return
            time.sleep(.03)  # Poll actual graph; elapsed time never proves order.
        raise SynchronizationFailure(f'BARRIER_TIMEOUT: {label}; graph=' + json.dumps(rows, sort_keys=True))

    @staticmethod
    def release_four_controller(connection):
        if connection.poll() is None:
            try:
                _, stderr = connection.communicate(input=b'ROLLBACK;\n\\q\n', timeout=5)
            except subprocess.TimeoutExpired as error:
                connection.kill(); connection.communicate(timeout=5)
                raise ConcurrencyTimeout('CONTROLLER_TIMEOUT: rollback did not finish') from error
            if connection.returncode:
                raise SynchronizationFailure('CONTROLLER_ERROR: ' + stderr.decode('utf-8', errors='replace'))

    def terminate_four_sessions(self, names):
        rows = self.four_snapshot(names)
        for row in rows.values():
            # Backend start time protects against PID reuse. Both the cluster and
            # random application names belong to this test run.
            self.good("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE "
                      f"pid={row['pid']} AND backend_start={f.quote(row['backend_start'])}::timestamptz "
                      f"AND application_name={f.quote(row['name'])}")


class BeforeV5(Transactions):
    def test_expiry_is_bypassed_after_index_wait(self):
        self.expiration_wait(False)

    def test_four_way_deadlock_is_reproduced(self):
        self.four_transactions(False)

    def test_four_way_failure_cleans_controller_and_workers(self):
        original = self.four_barrier
        observed = {'injected': False, 'cleaned': False}
        def fail_after_staging(names, futures, label, condition):
            original(names, futures, label, condition)
            if label == 'worker 1 blocked by expected holder':
                observed['injected'] = True
                raise SynchronizationFailure('INJECTED_BARRIER_FAILURE')
            if label == 'all owned sessions closed':
                observed['cleaned'] = True
        self.four_barrier = fail_after_staging
        try:
            with self.assertRaisesRegex(SynchronizationFailure, 'INJECTED_BARRIER_FAILURE'):
                self.four_transactions(False)
        finally:
            self.four_barrier = original
        self.assertEqual(observed, {'injected': True, 'cleaned': True})
        self.good('SELECT private.erp_assert_recovery_integrity()')

    def test_four_way_sql_timeout_is_not_deadlock(self):
        # Force a real PostgreSQL statement_timeout while a ticket is held by
        # the controller. This is fault injection, not a timing-based barrier.
        with self.assertRaisesRegex(ConcurrencyTimeout, 'SQLSTATE=57014'):
            self.four_transactions(False, statement_timeout_ms=100)
        self.good('SELECT private.erp_assert_recovery_integrity()')

    def test_unbounded_pending_authorizations(self):
        self.assertEqual(self.good(f"BEGIN;SELECT count(*) FROM (SELECT public.erp_authorize_invitation('{a.T}','employee') FROM generate_series(1,51)) x;ROLLBACK;", a.OWNER), '51')

    def test_independent_v4_snapshot(self):
        digest = self.good("SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(snapshot::pg_catalog.text,'UTF8')),'hex') FROM private.erp_recovery_schema_seal_v4 WHERE singleton")
        print('Reviewed clean v4 snapshot SHA256:', digest)


class AfterV5(Transactions):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        result = cls.sql(a.MAINTENANCE + source() + a.RESUME)
        if result.returncode:
            raise RuntimeError(result.stderr)

    def new_tenant(self, actor=a.OWNER):
        tenant = str(uuid.uuid4())
        self.good(f"INSERT INTO public.tenants(id,slug,company_name,status) VALUES ('{tenant}','synthetic-{tenant}','Synthetic v5','Ativo');"
                  f"INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES ('{tenant}','{actor}','owner')")
        return tenant

    def test_active_anchor_and_history(self):
        manifest = reviewed_manifest()
        self.assertEqual(references(self), manifest['snapshot_sha256'])
        actual = self.good("SELECT encode(sha256(convert_to(jsonb_object_agg(key,value ORDER BY key)::text,'UTF8')),'hex') "
                           "FROM jsonb_each(private.erp_recovery_schema_snapshot()) WHERE key<>'function/private.erp_assert_reviewed_definitions()'")
        self.assertEqual(actual, manifest['active_definition_sha256'])
        self.good('SELECT private.erp_assert_recovery_integrity()')

    def test_missing_manifest_fails_closed(self):
        with patch.dict(globals(), MANIFEST=ROOT / ('missing-v5-' + uuid.uuid4().hex + '.json')):
            with self.assertRaises(FileNotFoundError):
                reviewed_manifest()

    def test_valid_authorization_consumed_before_expiry(self):
        ticket = self.prepared()
        self.assertEqual(self.good(self.command(ticket), a.OWNER), self.target)
        self.assertEqual(self.good(f"SELECT consumed_at<expires_at FROM private.erp_invitation_authorizations WHERE id='{ticket}'"), 't')
        self.denied(self.command(ticket), a.OWNER)

    def test_expiration_after_real_unique_index_wait_rolls_back(self):
        self.expiration_wait(True)

    def test_history_trigger_rejects_backdated_consumption(self):
        ticket = self.good(f"SET request.jwt.claim.sub='{a.OWNER}';INSERT INTO private.erp_invitation_authorizations(tenant_id,actor_user_id,requested_role,invited_user_id,created_at,expires_at) "
                           f"VALUES ('{a.T}','{a.OWNER}','employee','{self.target}',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '10 minutes') RETURNING id")
        result = self.sql(f"UPDATE private.erp_invitation_authorizations SET consumed_at=created_at+interval '1 minute' WHERE id='{ticket}'")
        self.assertNotEqual(result.returncode, 0); self.assertIn('INVITATION_EXPIRED', result.stderr)
        self.assertEqual(self.good(f"SELECT consumed_at IS NULL FROM private.erp_invitation_authorizations WHERE id='{ticket}'"), 't')

    def test_four_way_deadlock_prevented(self):
        self.four_transactions(True)

    test_revocation_wins = a.InvitationAtomic.test_real_revocation_wins_before_association
    test_invitation_wins_before_revocation = a.InvitationAtomic.test_invitation_wins_before_real_revocation
    test_suspension_wins = a.InvitationAtomic.test_suspension_wins
    test_invitation_wins_before_suspension = a.InvitationAtomic.test_invitation_wins_before_suspension
    test_maintenance_wins = a.InvitationAtomic.test_maintenance_wins
    test_invitation_wins_before_maintenance = a.InvitationAtomic.test_invitation_wins_before_maintenance
    test_duplicate_recipient = a.InvitationAtomic.test_duplicate_recipient_serializes_without_promotion
    test_deactivation_both_orders = a.InvitationAtomic.test_lifecycle_deactivation_serializes_in_both_orders

    def test_actor_pending_limit_is_transactional(self):
        tenant = self.new_tenant()
        statement = f"BEGIN;SELECT public.erp_authorize_invitation('{tenant}','employee') FROM generate_series(1,51);COMMIT;"
        result = self.sql(statement, a.OWNER)
        self.assertNotEqual(result.returncode, 0); self.assertIn('INVITATION_QUOTA_EXCEEDED', result.stderr)
        self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_invitation_authorizations WHERE tenant_id='{tenant}'"), '0')
        self.good(f"SELECT public.erp_authorize_invitation('{tenant}','employee') FROM generate_series(1,49)", a.OWNER)
        first, second = self.race(f"SELECT public.erp_authorize_invitation('{tenant}','employee')",
                                  f"SELECT public.erp_authorize_invitation('{tenant}','employee')", a.OWNER, a.OWNER)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertNotEqual(second.returncode, 0); self.assertIn('INVITATION_QUOTA_EXCEEDED', second.stderr)
        self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_invitation_authorizations WHERE tenant_id='{tenant}'"), '50')

    def test_tenant_pending_limit_covers_other_actors(self):
        tenant = self.new_tenant()
        users = [a.OWNER] + [str(uuid.uuid4()) for _ in range(4)]
        for user in users[1:]:
            self.good(f"INSERT INTO auth.users(id) VALUES ('{user}');INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES ('{tenant}','{user}','manager')")
        for user in users[:4]:
            self.good(f"SELECT public.erp_authorize_invitation('{tenant}','employee') FROM generate_series(1,50)", user)
        result = self.sql(f"SELECT public.erp_authorize_invitation('{tenant}','employee')", users[4])
        self.assertNotEqual(result.returncode, 0); self.assertIn('INVITATION_QUOTA_EXCEEDED', result.stderr)
        self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_invitation_authorizations WHERE tenant_id='{tenant}'"), '200')

    def test_private_records_and_retention_are_not_client_apis(self):
        for role in ['anon', 'authenticated', 'service_role']:
            for statement in [f"DELETE FROM private.erp_invitation_authorizations WHERE tenant_id='{a.T}'",
                              'TRUNCATE private.erp_invitation_authorization_archive',
                              f"SELECT private.erp_retain_invitation_authorizations('{a.T}',500)",
                              f"SELECT private.erp_lock_invitation_lifecycle('{a.T}')",
                              "UPDATE private.erp_invitation_authorization_archive SET snapshot='{}'"]:
                with self.subTest(role=role, statement=statement):
                    self.denied(statement, a.OWNER, role=role)
        ticket = self.prepared()
        self.denied(f"DELETE FROM private.erp_invitation_authorizations WHERE id='{ticket}'", None)
        self.assertEqual(self.good(f"SELECT private.erp_retain_invitation_authorizations('{a.T}',500)"), '0')

    def test_new_relations_and_acls_cannot_be_resealed(self):
        for attack in ['ALTER TABLE private.erp_invitation_authorization_archive SET UNLOGGED',
                       'GRANT DELETE ON private.erp_invitation_authorizations TO service_role',
                       'GRANT SELECT ON private.erp_invitation_authorization_archive TO authenticated',
                       "ALTER TABLE private.erp_recovery_schema_seal_v4 DISABLE TRIGGER erp_schema_seal_immutable;"
                       "UPDATE private.erp_recovery_schema_seal_v4 SET snapshot='{}';"
                       'ALTER TABLE private.erp_recovery_schema_seal_v4 ENABLE TRIGGER erp_schema_seal_immutable']:
            result = self.sql('BEGIN;' + attack + ';' + v4.reseal('v5') + 'SELECT private.erp_assert_recovery_integrity();ROLLBACK;')
            self.assertNotEqual(result.returncode, 0); self.assertIn('55000', result.stderr)
            self.good('SELECT private.erp_assert_recovery_integrity()')

    def test_sensitive_v4_acls_still_fail_after_v5_reseal(self):
        for attack in ['GRANT UPDATE(role) ON public.tenant_memberships TO service_role',
                       'GRANT INSERT ON public.tenant_memberships TO authenticated',
                       'GRANT UPDATE(status) ON public.tenants TO service_role',
                       'GRANT INSERT ON public.platform_admins TO authenticated',
                       'GRANT UPDATE(actor_user_id) ON private.erp_invitation_authorizations TO service_role',
                       'GRANT UPDATE(id) ON auth.users TO authenticated',
                       'ALTER TABLE auth.users OWNER TO authenticated',
                       'GRANT SELECT ON public.tenant_data TO authenticated']:
            self.reject(attack + ';' + v4.reseal('v5'), 'RECOVERY_UNREVIEWED_SCHEMA')

    # Run the unchanged real v4 adversarial attacks against active v5 validators.
    reject = v4.AfterV4.reject
    test_v4_catalog_shadows = v4.AfterV4.test_all_catalog_shadow_attacks
    test_v4_benign_type_shadows = v4.AfterV4.test_benign_catalog_and_type_shadows_cannot_change_results


class UpgradeV5(Transactions):
    def test_clean_install_without_seed(self):
        js = """import {setup,additions,read} from './tests/helpers/tenant-domain-fixture.mjs';
const statements=[];const q=v=>v===null?'NULL':typeof v==='boolean'?(v?'true':'false'):typeof v==='number'?String(v):"'"+v.replaceAll("'","''")+"'";
class Recorder{async exec(s){statements.push(s+';')}async query(s,a=[]){statements.push(s.replace(/\\$(\\d+)/g,(_,n)=>q(a[Number(n)-1]))+';');return{rows:[]}}}
const db=await setup(()=>new Recorder());for(const file of additions)await db.exec(await read('supabase/migrations/'+file));process.stdout.write(statements.join('\\n'));"""
        with f.disposable_postgres('v-five-clean') as clean:
            result = clean.sql(f.record_fixture(js) + a.MAINTENANCE + a.MIGRATION.read_bytes().decode() + a.RESUME
                               + a.MAINTENANCE + v4.V4.read_bytes().decode() + a.RESUME + a.MAINTENANCE + source() + a.RESUME
                               + 'SELECT private.erp_assert_recovery_integrity();')
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_late_failure_rolls_back_all_ddl_and_history(self):
        self.good(a.MAINTENANCE)
        before = self.good('SELECT private.erp_recovery_schema_snapshot()::text')
        old = references(self)
        try:
            result = self.sql(source().removesuffix('COMMIT;\n') + 'SELECT 1/0;COMMIT;')
            self.assertNotEqual(result.returncode, 0); self.assertIn('22012', result.stderr)
            self.assertEqual(self.good('SELECT private.erp_recovery_schema_snapshot()::text'), before)
            self.assertEqual(references(self), old)
            self.assertEqual(self.good("SELECT to_regclass('private.erp_recovery_schema_seal_v5') IS NULL AND to_regclass('private.erp_invitation_authorization_archive') IS NULL"), 't')
        finally:
            self.good(a.RESUME)

    def test_corrupted_v4_refused_before_upgrade(self):
        result = self.sql("BEGIN;ALTER TABLE private.erp_recovery_schema_seal_v4 DISABLE TRIGGER erp_schema_seal_immutable;"
                          "UPDATE private.erp_recovery_schema_seal_v4 SET snapshot='{}';"
                          'ALTER TABLE private.erp_recovery_schema_seal_v4 ENABLE TRIGGER erp_schema_seal_immutable;'
                          + v4.body(a.MAINTENANCE) + v4.body(source()) + 'ROLLBACK;')
        self.assertNotEqual(result.returncode, 0); self.assertIn('55000', result.stderr)
        self.assertEqual(self.good("SELECT to_regclass('private.erp_recovery_schema_seal_v5') IS NULL"), 't')

    def test_upgrade_preserves_records_and_retention_is_atomic(self):
        self.good(f"INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES ('{a.T}','{self.target}','employee')")
        ticket = self.good(f"INSERT INTO private.erp_invitation_authorizations(tenant_id,actor_user_id,requested_role,invited_user_id,created_at,expires_at,consumed_at) "
                           f"VALUES ('{a.T}','{a.OWNER}','employee','{self.target}',clock_timestamp()-interval '41 days',clock_timestamp()-interval '40 days',clock_timestamp()-interval '39 days') RETURNING id")
        old_row = self.good(f"SELECT to_jsonb(x)::text FROM private.erp_invitation_authorizations x WHERE id='{ticket}'")
        old = references(self)
        old_data = data_manifest(self)
        self.good(a.MAINTENANCE + source() + a.RESUME)
        try:
            self.assertEqual(references(self), old)
            new_data = data_manifest(self)
            self.assertEqual({name: new_data[name] for name in old_data}, old_data)
            self.assertEqual(self.good(f"SELECT to_jsonb(x)::text FROM private.erp_invitation_authorizations x WHERE id='{ticket}'"), old_row)
            result = self.sql(f"BEGIN;SELECT private.erp_retain_invitation_authorizations('{a.T}',500);SELECT 1/0;COMMIT;")
            self.assertNotEqual(result.returncode, 0); self.assertIn('22012', result.stderr)
            self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_invitation_authorizations WHERE id='{ticket}'"), '1')
            self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_invitation_authorization_archive WHERE id='{ticket}'"), '0')
            self.assertEqual(self.good(f"SELECT private.erp_retain_invitation_authorizations('{a.T}',500)"), '1')
            self.assertEqual(self.good(f"SELECT snapshot::text FROM private.erp_invitation_authorization_archive WHERE id='{ticket}'"), old_row)
            self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_invitation_authorizations WHERE id='{ticket}'"), '0')
            self.assertEqual(self.good(f"SELECT private.erp_retain_invitation_authorizations('{a.T}',500)"), '0')
            for statement, code in [(f"UPDATE private.erp_invitation_authorization_archive SET outcome='expired' WHERE id='{ticket}'", '55000'),
                                    (f"DELETE FROM private.erp_invitation_authorization_archive WHERE id='{ticket}'", '55000'),
                                    (f"SET request.jwt.claim.sub='{a.OWNER}';INSERT INTO private.erp_invitation_authorizations(id,tenant_id,actor_user_id,requested_role) VALUES ('{ticket}','{a.T}','{a.OWNER}','employee')", '42501')]:
                result = self.sql(statement)
                self.assertNotEqual(result.returncode, 0); self.assertIn(code, result.stderr)
            self.denied(self.command(ticket), a.OWNER)
            self.assertEqual(references(self), old)
            self.good('SELECT private.erp_assert_recovery_integrity()')
        finally:
            # This fixture will be closed, but keep the other UpgradeV5 cases on v4.
            # Reverting DDL by running an old migration would reseal an arbitrary
            # state, so subsequent tests get a separate class (see runner below).
            pass

    def historical_quota_fixture(self, actor_counts, age):
        tenant = AfterV5.new_tenant(self)
        users = [a.OWNER] + [str(uuid.uuid4()) for _ in actor_counts[1:]]
        for user in users[1:]:
            self.good(f"INSERT INTO auth.users(id) VALUES ('{user}');INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES ('{tenant}','{user}','manager')")
        for user, count in zip(users, actor_counts):
            self.good(f"INSERT INTO private.erp_invitation_authorizations(tenant_id,actor_user_id,requested_role,created_at,expires_at) "
                      f"SELECT '{tenant}','{user}','employee',clock_timestamp()-interval '{age}',clock_timestamp()-interval '{age}'+interval '10 minutes' FROM generate_series(1,{count})")
        return tenant, users

    def test_rolling_actor_and_tenant_limits_include_expired_records(self):
        actor_tenant, actors = self.historical_quota_fixture([100], '2 hours')
        tenant_tenant, tenant_actors = self.historical_quota_fixture([100]*5, '2 hours')
        # A sixth administrator has zero personal history; only the tenant cap
        # prevents issuance. The original five each have exactly 100 records.
        sixth = str(uuid.uuid4())
        self.good(f"INSERT INTO auth.users(id) VALUES ('{sixth}');INSERT INTO public.tenant_memberships(tenant_id,user_id,role) VALUES ('{tenant_tenant}','{sixth}','manager')")
        self.good(a.MAINTENANCE + source() + a.RESUME)
        for tenant, actor in [(actor_tenant, actors[0]), (tenant_tenant, sixth)]:
            result = self.sql(f"SELECT public.erp_authorize_invitation('{tenant}','employee')", actor)
            self.assertNotEqual(result.returncode, 0); self.assertIn('INVITATION_QUOTA_EXCEEDED', result.stderr)
            self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_invitation_authorizations WHERE tenant_id='{tenant}' AND expires_at>clock_timestamp()"), '0')

    def test_cumulative_actor_limit_survives_retention(self):
        tenant, actors = self.historical_quota_fixture([1024], '40 days')
        self.good(a.MAINTENANCE + source() + a.RESUME)
        for expected_archived in [500, 500, 24]:
            self.assertEqual(self.good(f"SELECT private.erp_retain_invitation_authorizations('{tenant}',500)"), str(expected_archived))
        self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_invitation_authorization_archive WHERE tenant_id='{tenant}'"), '1024')
        result = self.sql(f"SELECT public.erp_authorize_invitation('{tenant}','employee')", actors[0])
        self.assertNotEqual(result.returncode, 0); self.assertIn('INVITATION_QUOTA_EXCEEDED', result.stderr)
        self.good('SELECT private.erp_assert_recovery_integrity()')

    def test_cumulative_tenant_limit_does_not_discard_existing_data(self):
        tenant, actors = self.historical_quota_fixture([0, 1024, 1024, 1024, 1024], '40 days')
        self.good(a.MAINTENANCE + source() + a.RESUME)
        self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_invitation_authorizations WHERE tenant_id='{tenant}'"), '4096')
        result = self.sql(f"SELECT public.erp_authorize_invitation('{tenant}','employee')", actors[0])
        self.assertNotEqual(result.returncode, 0); self.assertIn('INVITATION_QUOTA_EXCEEDED', result.stderr)
        self.assertEqual(self.good(f"SELECT private.erp_retain_invitation_authorizations('{tenant}',500)"), '500')
        self.assertEqual(self.good(f"SELECT count(*) FROM private.erp_invitation_authorizations WHERE tenant_id='{tenant}'"), '3596')
        result = self.sql(f"SELECT public.erp_authorize_invitation('{tenant}','employee')", actors[0])
        self.assertNotEqual(result.returncode, 0); self.assertIn('INVITATION_QUOTA_EXCEEDED', result.stderr)
        self.good('SELECT private.erp_assert_recovery_integrity()')


def historical_v5_regressions():
    cases = v4.existing_v4_regressions()
    seen = set()
    for test in cases:
        cls = type(test)
        if cls in seen:
            continue
        seen.add(cls)
        original = cls.setUpClass
        def upgraded(original):
            def setup(cls):
                original()
                result = cls.sql(a.MAINTENANCE + source() + a.RESUME)
                if result.returncode:
                    raise RuntimeError(result.stderr)
            return classmethod(setup)
        cls.setUpClass = upgraded(original)
    return cases


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--baseline', action='store_true')
    modes.add_argument('--synchronization-only', action='store_true')
    modes.add_argument('--fixed-synchronization-only', action='store_true')
    modes.add_argument('--regressions', action='store_true')
    args = parser.parse_args()
    reviewed_manifest()  # Missing/malformed input is fatal before Docker access.
    if args.regressions:
        cases = historical_v5_regressions()
    elif args.synchronization_only:
        cases = [BeforeV5(name) for name in sorted(BeforeV5.__dict__) if name.startswith('test_four_way_')]
    elif args.fixed_synchronization_only:
        cases = [AfterV5('test_four_way_deadlock_prevented')]
    elif args.baseline:
        cases = [BeforeV5(name) for name in sorted(BeforeV5.__dict__) if name.startswith('test_')]
    else:
        # Every installation case owns a fresh v4 fixture; no installed v5 state
        # leaks into a later rollback/upgrade case or requires reverse migrations.
        cases = [type('Isolated_' + name, (UpgradeV5,), {'__module__': __name__})(name)
                 for name in sorted(UpgradeV5.__dict__) if name.startswith('test_')]
        cases += [AfterV5(name) for name in sorted(AfterV5.__dict__) if name.startswith('test_')]
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(cases))
    raise SystemExit(not result.wasSuccessful())
