"""Offline regression tests. Docker/SQL actions below are in-memory mocks only.

Run from the checkout: python -B tests/test_postgres_harness.py
"""
import ast
import contextlib
import importlib.util
import io
import json
import stat
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import postgres_harness as harness


class FakeDocker:
    """A Docker-shaped recorder; never starts a process or accesses a socket."""
    def __init__(self, endpoint=harness.WINDOWS_ENDPOINT, context='desktop-linux'):
        self.endpoint, self.context = endpoint, context
        self.server = {'ID': 'local-test-daemon', 'OSType': 'linux'}
        self.calls = []
        self.containers = {}
        self.create_status = 0
        self.create_stdout = None
        self.start_status = 0
        self.remove_status = 0
        self.image_status = 0
        self.ready_status = 0
        self.list_status = 0
        self.inspect_status = 0
        self.context_status = 0
        self.context_json = None
        self.before_inspect = None
        self.counter = 0
        self.removed = []

    def __call__(self, args, **kwargs):
        self.calls.append((list(args), dict(kwargs)))
        # All Docker subprocesses must preserve binary stdin/stdout on Windows.
        assert kwargs['text'] is False
        assert 'encoding' not in kwargs
        if args[1] == '--host':
            assert args[2] == self.endpoint
            cmd = args[3:]
        else:
            cmd = args[1:]
            assert cmd[:1] == ['context']  # Only local CLI metadata may omit --host.
        output, code = b'', 0
        if cmd == ['context', 'show']:
            output, code = (self.context + '\n').encode(), self.context_status
        elif cmd[:2] == ['context', 'inspect']:
            rows = [{'Name': self.context, 'Endpoints': {'docker': {'Host': self.endpoint}}}]
            output = json.dumps(rows if self.context_json is None else self.context_json).encode()
        elif cmd[:1] == ['info']:
            output = json.dumps(self.server).encode()
        elif cmd[:2] == ['image', 'inspect']:
            output = json.dumps([{'Id': 'sha256:' + 'f' * 64,
                                  'Config': {'Env': ['PG_MAJOR=17', 'PGDATA=' + harness.PGDATA]}}]).encode()
            code = self.image_status
        elif cmd[:2] == ['container', 'create']:
            code = self.create_status
            self.counter += 1
            cid = format(self.counter, '064x')
            if not code:
                labels = dict(cmd[i + 1].split('=', 1) for i, v in enumerate(cmd) if v == '--label')
                self.containers[cid] = {
                    'Id': cid, 'Name': '/' + cmd[cmd.index('--name') + 1],
                    'Image': 'sha256:' + 'f' * 64, 'Config': {'Labels': labels},
                    'HostConfig': {'NetworkMode': 'none', 'AutoRemove': True,
                                   'Tmpfs': {harness.PGDATA: ''}, 'Binds': None,
                                   'Mounts': [], 'PortBindings': {}, 'PublishAllPorts': False},
                    'Mounts': []}
            output = self.create_stdout if self.create_stdout is not None else (cid + '\n').encode()
        elif cmd[:2] == ['container', 'inspect']:
            cid = cmd[2]
            if self.before_inspect and cid in self.containers:
                self.before_inspect(self.containers[cid])
            code = self.inspect_status or (0 if cid in self.containers else 1)
            if not code:
                output = json.dumps([self.containers[cid]]).encode()
        elif cmd[:2] == ['container', 'start']:
            code = self.start_status
        elif cmd[:2] == ['container', 'exec']:
            if 'psql' in cmd:
                output = b'synthetic result\n'
            else:
                code = self.ready_status
        elif cmd[:2] == ['container', 'rm']:
            cid = cmd[-1]
            assert cid in self.containers
            code = self.remove_status
            if not code:
                self.removed.append(cid)
                del self.containers[cid]
        elif cmd[:2] == ['container', 'ls']:
            cid = cmd[cmd.index('--filter') + 1].split('=', 1)[1]
            output = ((cid + '\n') if cid in self.containers else '').encode()
            code = self.list_status
        else:
            raise AssertionError('Unexpected mock Docker operation')
        return subprocess.CompletedProcess(args, code, output, b'secret-from-daemon' if code else b'')

    def commands(self, prefix):
        return [a[3:] for a, _ in self.calls if a[1] == '--host' and a[3:3 + len(prefix)] == prefix]


class DockerDestinationTests(unittest.TestCase):
    def client(self, fake=None, **kwargs):
        fake = fake or FakeDocker()
        return harness.LocalDocker(runner=fake, environment=kwargs.pop('environment', {}),
                                   platform=kwargs.pop('platform', 'win32'), executable='docker', **kwargs)

    def test_connection_environment_overrides_rejected_before_any_command(self):
        for key in harness.OVERRIDES:
            for value in ['tcp://remote.example:2375', 'ssh://secret@remote', '', harness.WINDOWS_ENDPOINT]:
                with self.subTest(key=key, valuePresent=bool(value)):
                    fake = FakeDocker()
                    with self.assertRaises(harness.HarnessSafetyError) as caught:
                        self.client(fake, environment={key: value})
                    self.assertEqual(fake.calls, [])
                    self.assertNotIn('remote.example', str(caught.exception))
                    self.assertNotIn('secret@', str(caught.exception))

    def test_windows_case_insensitive_override_rejected(self):
        with self.assertRaises(harness.HarnessSafetyError):
            self.client(environment={'docker_host': 'tcp://remote:2375'})

    def test_unauthorised_context_even_with_local_endpoint_is_rejected(self):
        fake = FakeDocker(context='production')
        with self.assertRaises(harness.HarnessSafetyError):
            self.client(fake)
        self.assertEqual(len(fake.calls), 1)

    def test_authorised_context_name_does_not_authorise_remote_endpoint(self):
        endpoints = ['tcp://127.0.0.1:2375', 'tcp://remote:2376', 'ssh://remote',
                     'npipe:////remote/pipe/dockerDesktopLinuxEngine',
                     'npipe:////./pipe/docker_engine', 'unix:///tmp/unknown.sock',
                     harness.WINDOWS_ENDPOINT + '?host=remote']
        for endpoint in endpoints:
            with self.subTest(endpointKind=endpoint.split(':')[0]):
                fake = FakeDocker(endpoint=endpoint)
                with self.assertRaises(harness.HarnessSafetyError):
                    self.client(fake)
                self.assertFalse(fake.commands(['info']))

    def test_metadata_failure_or_malformed_endpoint_fails_closed(self):
        for value in [{}, [], [{'Endpoints': {}}], [{'Endpoints': {'docker': {'Host': None}}}]]:
            fake = FakeDocker()
            fake.context_json = value
            with self.assertRaises(harness.HarnessSafetyError):
                self.client(fake)

    def test_cli_metadata_failure_is_sanitised(self):
        fake = FakeDocker()
        fake.context_status = 1
        with self.assertRaises(harness.HarnessSafetyError) as caught:
            self.client(fake)
        self.assertNotIn('secret-from-daemon', str(caught.exception))

    def test_windows_desktop_endpoint_and_linux_daemon_are_validated(self):
        fake = FakeDocker()
        client = self.client(fake)
        self.assertEqual(client.endpoint, harness.WINDOWS_ENDPOINT)
        self.assertEqual(client.server_id, fake.server['ID'])
        self.assertTrue(fake.commands(['info']))

    def test_wrong_daemon_type_or_unproven_identity_is_rejected(self):
        for server in [{'OSType': 'windows', 'ID': 'id'}, {'OSType': 'linux', 'ID': ''},
                       {'OSType': 'linux', 'ID': True}, {}]:
            fake = FakeDocker()
            fake.server = server
            with self.assertRaises(harness.HarnessSafetyError):
                self.client(fake)

    def test_linux_requires_actual_socket_and_exact_endpoint(self):
        fake = FakeDocker(endpoint=harness.LINUX_ENDPOINT, context='default')
        with patch.object(harness.os, 'stat', return_value=SimpleNamespace(st_mode=stat.S_IFSOCK)):
            self.assertEqual(self.client(fake, platform='linux').endpoint, harness.LINUX_ENDPOINT)
        for mode in [stat.S_IFREG, stat.S_IFDIR]:
            with patch.object(harness.os, 'stat', return_value=SimpleNamespace(st_mode=mode)):
                with self.assertRaises(harness.HarnessSafetyError):
                    self.client(fake, platform='linux')

    def test_missing_socket_or_unsupported_platform_fails_closed(self):
        fake = FakeDocker(endpoint=harness.LINUX_ENDPOINT, context='default')
        with patch.object(harness.os, 'stat', side_effect=FileNotFoundError):
            with self.assertRaises(harness.HarnessSafetyError):
                self.client(fake, platform='linux')
        with self.assertRaises(harness.HarnessSafetyError):
            self.client(platform='darwin')

    def test_missing_docker_does_not_start_any_process(self):
        with patch.object(harness.shutil, 'which', return_value=None), patch.object(harness.subprocess, 'run') as run:
            with self.assertRaises(harness.HarnessSafetyError):
                harness.LocalDocker(environment={}, platform='win32')
            run.assert_not_called()

    def test_environment_is_immutable_sanitised_and_does_not_modify_parent(self):
        original = {'PATH': 'local-bin', 'SUPABASE_SERVICE_ROLE_KEY': 'secret-service',
                    'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'secret-public', 'DATABASE_URL': 'secret-dsn',
                    'PGPASSWORD': 'secret-password'}
        fake = FakeDocker()
        client = self.client(fake, environment=original)
        self.assertEqual(dict(client.environment), {'PATH': 'local-bin'})
        self.assertEqual(original['DATABASE_URL'], 'secret-dsn')
        with self.assertRaises(TypeError):
            client.environment['DOCKER_HOST'] = 'remote'
        with self.assertRaises(AttributeError):
            client.endpoint = 'remote'
        for _, options in fake.calls:
            self.assertEqual(options['env'], {'PATH': 'local-bin'})

    def test_sensitive_values_do_not_appear_in_diagnostics_or_logs(self):
        fake = FakeDocker()
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            with self.assertRaises(harness.HarnessSafetyError) as rejected:
                self.client(fake, environment={'DOCKER_HOST': 'ssh://secret-credential@remote'})
            fake.context_status = 1
            with self.assertRaises(harness.HarnessSafetyError) as unavailable:
                self.client(fake)
        logged = output.getvalue() + errors.getvalue() + str(rejected.exception) + str(unavailable.exception)
        self.assertNotIn('secret-credential', logged)
        self.assertNotIn('secret-from-daemon', logged)


class ContainerOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeDocker()
        self.client = harness.LocalDocker(runner=self.fake, environment={}, platform='win32', executable='docker')
        self.cluster = harness.DisposablePostgres(self.client)

    def test_collision_with_existing_name_never_inspects_or_removes_existing_id(self):
        existing = 'e' * 64
        self.fake.containers[existing] = {'preexisting': True}
        self.fake.create_status = 1
        self.fake.create_stdout = (existing + '\n').encode()
        with self.assertRaises(harness.HarnessSafetyError):
            self.cluster.start()
        self.cluster.close()
        self.assertIsNone(self.cluster.container_id)
        self.assertEqual(self.fake.containers[existing], {'preexisting': True})
        self.assertEqual(self.fake.commands(['container', 'inspect']), [])
        self.assertEqual(self.fake.removed, [])

    def test_partial_failed_create_with_id_does_not_establish_ownership(self):
        self.fake.create_status = 1
        self.fake.create_stdout = ('a' * 64).encode()
        with self.assertRaises(harness.HarnessSafetyError):
            self.cluster.start()
        self.cluster.close()
        self.assertEqual(self.fake.removed, [])

    def test_timeout_or_ambiguous_success_never_cleans_up_by_name(self):
        for output in [b'', b'not-an-id', b'a' * 12, b'a' * 64 + b'\n' + b'b' * 64]:
            with self.subTest(outputLength=len(output)):
                self.fake.create_stdout = output
                with self.assertRaises(harness.HarnessSafetyError):
                    self.cluster.start()
                self.cluster.close()
        self.assertEqual(self.fake.removed, [])
        original = self.fake.__call__
        def timed_out(args, **options):
            if 'create' in args:
                raise subprocess.TimeoutExpired(args, 30, stderr=b'secret-timeout')
            return original(args, **options)
        self.client._runner = timed_out
        with self.assertRaises(harness.HarnessSafetyError) as caught:
            self.cluster.start()
        self.assertNotIn('secret-timeout', str(caught.exception))
        self.assertEqual(self.fake.removed, [])

    def test_successful_create_requires_matching_id_name_and_both_labels(self):
        mutations = [lambda r: r.update(Id='e' * 64), lambda r: r.update(Name='/preexisting'),
                     lambda r: r['Config']['Labels'].update({harness.RUN_LABEL: 'other-run'}),
                     lambda r: r['Config']['Labels'].pop(harness.RESOURCE_LABEL)]
        for mutate in mutations:
            with self.subTest(identityField=mutations.index(mutate)):
                self.fake.before_inspect = mutate
                with self.assertRaises(harness.HarnessSafetyError):
                    self.cluster.start()
                self.assertIsNone(self.cluster.container_id)
        self.assertEqual(self.fake.commands(['container', 'start']), [])
        self.assertEqual(self.fake.removed, [])

    def test_confirmed_create_start_failure_cleans_only_owned_id(self):
        self.fake.start_status = 1
        existing = 'e' * 64
        self.fake.containers[existing] = {'preexisting': True}
        with self.assertRaises(harness.HarnessSafetyError):
            self.cluster.start()
        self.assertEqual(len(self.fake.removed), 1)
        self.assertNotIn(existing, self.fake.removed)
        self.assertIn(existing, self.fake.containers)
        self.assertIsNone(self.cluster.container_id)

    def test_missing_image_or_changed_server_prevents_creation(self):
        self.fake.image_status = 1
        with self.assertRaises(harness.HarnessSafetyError):
            self.cluster.start()
        self.assertEqual(self.fake.commands(['container', 'create']), [])
        self.fake.image_status = 0
        self.fake.server['ID'] = 'replacement-server'
        with self.assertRaises(harness.HarnessSafetyError):
            self.cluster.start()
        self.assertEqual(self.fake.commands(['container', 'create']), [])

    def test_post_start_isolation_failure_sends_no_sql_and_cleans_owned_id(self):
        inspections = 0
        def change_after_start(row):
            nonlocal inspections
            inspections += 1
            if inspections >= 2:
                row['HostConfig']['NetworkMode'] = 'bridge'
        self.fake.before_inspect = change_after_start
        with self.assertRaises(harness.HarnessSafetyError):
            self.cluster.start()
        self.assertEqual(self.fake.commands(['container', 'exec']), [])
        self.assertEqual(len(self.fake.removed), 1)

    def test_interrupt_after_confirmed_creation_closes_only_owned_id(self):
        original = self.fake.__call__
        def interrupted(args, **options):
            if args[3:5] == ['container', 'start']:
                raise KeyboardInterrupt()
            return original(args, **options)
        self.client._runner = interrupted
        with self.assertRaises(KeyboardInterrupt):
            self.cluster.start()
        self.assertEqual(len(self.fake.removed), 1)

    def test_failed_isolation_is_removed_only_after_ownership_is_proven(self):
        mutations = [lambda r: r['HostConfig'].update(NetworkMode='bridge'),
                     lambda r: r['HostConfig'].update(Binds=['preexisting:/data']),
                     lambda r: r['HostConfig'].update(PortBindings={'5432/tcp': [{}]}),
                     lambda r: r['HostConfig'].update(Tmpfs={}),
                     lambda r: r['Mounts'].append({'Type': 'volume', 'Destination': harness.PGDATA}),
                     lambda r: r.update(Image='wrong-image')]
        for mutate in mutations:
            with self.subTest(isolationField=mutations.index(mutate)):
                self.fake.before_inspect = mutate
                with self.assertRaises(harness.HarnessSafetyError):
                    self.cluster.start()
                self.assertIsNone(self.cluster.container_id)
        self.assertEqual(len(self.fake.removed), len(mutations))
        self.assertEqual(self.fake.commands(['container', 'start']), [])

    def test_creation_has_unique_identity_no_pull_no_external_network_no_volumes(self):
        other = harness.DisposablePostgres(self.client, purpose='rollback')
        self.assertNotEqual(self.cluster.name, other.name)
        self.assertNotEqual(self.cluster.token, other.token)
        self.cluster.start()
        command = self.fake.commands(['container', 'create'])[0]
        self.assertIn('--pull=never', command)
        self.assertIn('--rm', command)
        self.assertIn('--platform=linux/amd64', command)
        self.assertEqual(command[command.index('--network') + 1], 'none')
        self.assertEqual(command[command.index('--tmpfs') + 1], harness.PGDATA)
        for prohibited in ['--volume', '-v', '--mount', '--publish', '-p', '--env-file']:
            self.assertNotIn(prohibited, command)
        self.cluster.close()

    def test_cleanup_is_by_full_owned_id_and_is_idempotent(self):
        self.cluster.start()
        cid, name = self.cluster.container_id, self.cluster.name
        self.cluster.close()
        self.cluster.close()
        self.assertEqual(self.fake.commands(['container', 'rm']), [['container', 'rm', '-f', cid]])
        self.assertNotEqual(cid, name)

    def test_cleanup_refuses_changed_labels_or_daemon_identity(self):
        self.cluster.start()
        row = self.fake.containers[self.cluster.container_id]
        row['Config']['Labels'][harness.RESOURCE_LABEL] = 'foreign'
        with self.assertRaises(harness.HarnessSafetyError):
            self.cluster.close()
        self.assertEqual(self.fake.removed, [])
        row['Config']['Labels'][harness.RESOURCE_LABEL] = self.cluster.token
        self.fake.server['ID'] = 'different-daemon'
        with self.assertRaises(harness.HarnessSafetyError):
            self.cluster.close()
        self.assertEqual(self.fake.removed, [])

    def test_already_auto_removed_requires_confirmed_absence(self):
        self.cluster.start()
        self.fake.containers.clear()
        self.cluster.close()
        self.assertIsNone(self.cluster.container_id)
        self.assertEqual(self.fake.removed, [])

    def test_inspection_failure_is_not_mistaken_for_absence(self):
        self.cluster.start()
        self.fake.inspect_status = 1
        with self.assertRaises(harness.HarnessSafetyError):
            self.cluster.close()
        self.assertIsNotNone(self.cluster.container_id)
        self.assertEqual(self.fake.removed, [])
        self.fake.containers.clear()
        self.fake.list_status = 1
        with self.assertRaises(harness.HarnessSafetyError):
            self.cluster.close()
        self.assertEqual(self.fake.removed, [])

    def test_cleanup_error_is_sanitised_without_targeting_other_resources(self):
        self.cluster.start()
        self.fake.remove_status = 1
        with self.assertRaises(harness.HarnessSafetyError) as caught:
            self.cluster.close()
        self.assertNotIn('secret-from-daemon', str(caught.exception))
        self.assertIsNotNone(self.cluster.container_id)

    def test_readiness_failure_cleans_owned_id(self):
        self.fake.ready_status = 1
        with patch.object(harness.time, 'sleep'):
            with self.assertRaises(harness.HarnessSafetyError):
                self.cluster.start()
        self.assertEqual(len(self.fake.removed), 1)

    def test_changed_parent_environment_does_not_redirect_operations(self):
        self.cluster.start()
        with patch.dict(harness.os.environ, {'DOCKER_HOST': 'tcp://remote:2375', 'DOCKER_CONTEXT': 'production'}):
            self.cluster.sql('SELECT 1;\n')
            self.cluster.close()
        for args, options in self.fake.calls:
            if args[1] != 'context':
                self.assertEqual(args[1:3], ['--host', harness.WINDOWS_ENDPOINT])
            self.assertNotIn('DOCKER_HOST', options['env'])
            self.assertNotIn('DOCKER_CONTEXT', options['env'])

    def test_body_exception_closes_owned_secondary_cluster(self):
        with self.assertRaisesRegex(RuntimeError, 'synthetic failure'):
            with self.cluster:
                raise RuntimeError('synthetic failure')
        self.assertEqual(len(self.fake.removed), 1)

    def test_auxiliary_cleanup_preserves_primary_resource(self):
        self.cluster.start()
        primary = self.cluster.container_id
        auxiliary = harness.DisposablePostgres(self.client, purpose='rollback')
        auxiliary.start()
        secondary = auxiliary.container_id
        self.assertNotEqual(primary, secondary)
        auxiliary.sql('SELECT 1;\n')
        auxiliary.close()
        self.assertIn(primary, self.fake.containers)
        self.assertEqual(self.fake.removed, [secondary])
        self.cluster.sql('SELECT 2;\n')
        self.cluster.close()
        self.assertEqual(self.fake.removed, [secondary, primary])

    def test_no_sql_without_confirmed_resource(self):
        with self.assertRaises(harness.HarnessSafetyError):
            self.cluster.sql('SELECT 1')
        self.assertEqual(self.fake.commands(['container', 'exec']), [])

    def test_sql_bytes_lf_unicode_and_migration_content_preserved(self):
        self.cluster.start()
        statements = ['SELECT \'ação\';\n', 'SELECT 1;\r\n',
                      (ROOT / 'supabase/migrations/20261012030200_erp_durability_integrity.sql').read_bytes().decode('utf-8')]
        for statement in statements:
            result = self.cluster.sql(statement, database_user='seal_pool_probe')
            args, options = self.fake.calls[-1]
            self.assertEqual(options['input'], statement.encode('utf-8'))
            self.assertIs(options['text'], False)
            self.assertEqual(args[args.index('-U') + 1], 'seal_pool_probe')
            self.assertIsInstance(result.stdout, str)
        self.cluster.close()

    def test_windows_binary_pipe_with_real_local_process_preserves_lf(self):
        # The only real process in this suite is this Python echo: no Docker/SQL/network.
        payload = 'ação\nsegunda linha\n'.encode('utf-8')
        result = subprocess.run([sys.executable, '-c',
                                 'import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())'],
                                input=payload, capture_output=True, text=False, check=True)
        self.assertEqual(result.stdout, payload)
        self.assertNotIn(b'\r\n', result.stdout)


class HarnessIntegrationTests(unittest.TestCase):
    def test_all_ten_entrypoints_import_offline_and_use_shared_sql_transport(self):
        paths = sorted((ROOT / 'scripts').glob('test-*.py'))
        self.assertEqual(len(paths), 10)
        with patch.object(subprocess, 'run', side_effect=AssertionError('No subprocess permitted during import')):
            for path in paths:
                with self.subTest(script=path.name):
                    spec = importlib.util.spec_from_file_location('offline_' + path.stem, path)
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                    tree = ast.parse(path.read_text(encoding='utf-8'))
                    for node in ast.walk(tree):
                        if isinstance(node, ast.Constant) and node.value == 'docker':
                            self.fail('Docker bypass outside shared infrastructure: ' + path.name)
                        if isinstance(node, ast.Attribute) and node.attr == 'read_text':
                            self.fail('Locale/newline-dependent SQL reader: ' + path.name)

    def test_primary_fixture_and_auxiliary_paths_preserve_binary_utf8(self):
        spec = importlib.util.spec_from_file_location('offline_product', ROOT / 'scripts/test-product-concurrency.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cluster = SimpleNamespace(client=SimpleNamespace(environment={'PATH': 'local'}))
        received = []
        def query(statement, **kwargs):
            received.append((statement.encode('utf-8'), kwargs))
            return SimpleNamespace(returncode=0, stdout='ok\n', stderr='')
        cluster.sql = query
        module._postgres = cluster
        payload = 'SELECT \'ação\';\n'
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, payload.encode('utf-8'), b'')) as run:
            self.assertEqual(module.record_fixture('recorder'), payload)
            self.assertIs(run.call_args.kwargs['text'], False)
            self.assertEqual(run.call_args.kwargs['env'], {'PATH': 'local'})
        module.ProductConcurrency.sql(payload, database_user='seal_pool_probe')
        self.assertEqual(received, [(payload.encode('utf-8'), {'database_user': 'seal_pool_probe'})])
        with patch.object(module, 'DisposablePostgres') as resource:
            module.disposable_postgres('rollback')
            resource.assert_called_once_with(cluster.client, purpose='rollback')

    def test_historical_bootstrap_filters_still_apply_with_binary_recorder(self):
        # Exercise the actual historical setUpClass wrappers without a daemon,
        # migrations, or test SQL execution: both resource and recorder are mocks.
        for filename, class_name, expected, absent in [
            ('test-recovery-seal-hardening.py', 'BeforeSeal',
             "!n.startsWith('202610120301')&&!n.startsWith('202610120302')", None),
            ('test-recovery-durability.py', 'BeforeUpgrade',
             "!n.startsWith('202610120302')", "!n.startsWith('202610120301')")]:
            with self.subTest(preparation=class_name):
                spec = importlib.util.spec_from_file_location('bootstrap_' + class_name, ROOT / 'scripts' / filename)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                fixture = module.f
                resource = SimpleNamespace(client=SimpleNamespace(environment={'PATH': 'local'}),
                                           start=lambda: None, close=lambda: None,
                                           sql=lambda *_a, **_k: SimpleNamespace(
                                               returncode=0, stdout='offline fixture\n', stderr=''))
                javascript = []
                def recorder(args, **options):
                    self.assertEqual(args[:3], ['node', '--input-type=module', '-e'])
                    self.assertIs(options['text'], False)
                    javascript.append(args[3])
                    return subprocess.CompletedProcess(args, 0, b'synthetic fixture\n', b'')
                case = getattr(module, class_name)
                with patch.object(fixture, 'DisposablePostgres', return_value=resource), \
                     patch.object(subprocess, 'run', side_effect=recorder), \
                     contextlib.redirect_stdout(io.StringIO()):
                    try:
                        case.setUpClass()
                    finally:
                        case.doClassCleanups()
                self.assertEqual(len(javascript), 1)
                self.assertIn(expected, javascript[0])
                if absent:
                    self.assertNotIn(absent, javascript[0])


if __name__ == '__main__':
    unittest.main(verbosity=2)
