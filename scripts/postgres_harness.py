"""Local-only disposable PostgreSQL infrastructure; no work is done at import.

The Docker CLI/local daemon are trusted installations. Remote transports,
connection overrides and unrecognised contexts fail closed before daemon access.
"""
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path
from types import MappingProxyType

IMAGE = 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'
PGDATA = '/var/lib/postgresql/data'
RUN_LABEL = 'io.handyhub.pg-tests.run'
RESOURCE_LABEL = 'io.handyhub.pg-tests.resource'
WINDOWS_ENDPOINT = 'npipe:////./pipe/dockerDesktopLinuxEngine'
LINUX_ENDPOINT = 'unix:///var/run/docker.sock'
OVERRIDES = ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY',
             'DOCKER_CERT_PATH', 'DOCKER_CUSTOM_HEADERS', 'DOCKER_API_VERSION')


class HarnessSafetyError(RuntimeError):
    """Messages intentionally omit endpoint values, daemon stderr and credentials."""


def _decode(result):
    return subprocess.CompletedProcess(result.args, result.returncode,
                                       result.stdout.decode('utf-8'),
                                       result.stderr.decode('utf-8', errors='replace'))


class LocalDocker:
    def __init__(self, *, runner=None, environment=None, platform=None, executable=None):
        environment = dict(os.environ if environment is None else environment)
        for key in OVERRIDES:
            if key in {k.upper() for k in environment}:
                raise HarnessSafetyError('Docker connection override is not permitted: ' + key)
        # Do not pass application/database credentials to Docker or the recorder.
        self.environment = MappingProxyType({k: v for k, v in environment.items()
                                            if not k.upper().startswith(('DOCKER_', 'SUPABASE_', 'NEXT_PUBLIC_', 'PG'))
                                            and k.upper() not in ('DATABASE_URL', 'DB_URL')})
        self._runner = runner
        self.executable = executable or shutil.which('docker')
        if not self.executable:
            raise HarnessSafetyError('Docker CLI is not installed; no resources were created')
        platform = sys.platform if platform is None else platform
        if platform == 'win32':
            allowed = {'default': WINDOWS_ENDPOINT, 'desktop-linux': WINDOWS_ENDPOINT}
        elif platform == 'linux':
            allowed = {'default': LINUX_ENDPOINT,
                       'desktop-linux': 'unix://' + str(Path.home() / '.docker/desktop/docker.sock')}
        else:
            raise HarnessSafetyError('Host platform has no authorised local Docker endpoint')

        # These two commands read CLI context metadata, not a Docker daemon.
        context = self._metadata(['context', 'show']).strip()
        if context not in allowed:
            raise HarnessSafetyError('Docker context is not authorised')
        try:
            metadata = json.loads(self._metadata(['context', 'inspect', context]))
            if len(metadata) != 1:
                raise ValueError()
            endpoint = metadata[0]['Endpoints']['docker']['Host']
        except (ValueError, KeyError, TypeError):
            raise HarnessSafetyError('Docker context endpoint could not be verified') from None
        if endpoint != allowed[context]:
            raise HarnessSafetyError('Docker context does not resolve to the authorised local endpoint')
        if endpoint.startswith('unix://'):
            try:
                if not stat.S_ISSOCK(os.stat(endpoint[7:]).st_mode):
                    raise OSError()
            except OSError:
                raise HarnessSafetyError('Authorised Unix endpoint is not an available local socket') from None
        self._endpoint = endpoint
        self.run_id = uuid.uuid4().hex
        self.server_id = self._server()['ID']
        self.image_id = None

    @property
    def endpoint(self):
        return self._endpoint

    def _spawn(self, args, *, data=None, timeout=30):
        try:
            result = (self._runner or subprocess.run)(
                args, input=data, capture_output=True, text=False,
                env=dict(self.environment), timeout=timeout)
            return _decode(result)
        except (OSError, subprocess.SubprocessError, UnicodeError):
            raise HarnessSafetyError('Local Docker command failed; sensitive diagnostics withheld') from None

    def _metadata(self, args):
        result = self._spawn([self.executable, *args])
        if result.returncode:
            raise HarnessSafetyError('Docker context metadata is unavailable')
        return result.stdout

    def _command(self, args, **kwargs):
        # Every daemon operation pins this endpoint, independent of later context changes.
        return self._spawn([self.executable, '--host', self.endpoint, *args], **kwargs)

    def _server(self):
        result = self._command(['info', '--format', '{{json .}}'])
        try:
            info = json.loads(result.stdout)
            if (result.returncode or info['OSType'] != 'linux'
                    or not isinstance(info['ID'], str) or not info['ID'].strip()):
                raise ValueError()
            return info
        except (ValueError, KeyError, TypeError):
            raise HarnessSafetyError('Authorised endpoint has no verifiable Linux Docker daemon') from None

    def assert_same_server(self):
        if self._server()['ID'] != self.server_id:
            raise HarnessSafetyError('Local Docker daemon identity changed; operation refused')

    def inspect_image(self):
        self.assert_same_server()
        result = self._command(['image', 'inspect', IMAGE])
        try:
            image = json.loads(result.stdout)[0]
            env = dict(item.split('=', 1) for item in image['Config']['Env'])
            if (result.returncode or not re.fullmatch(r'sha256:[a-f0-9]{64}', image['Id'])
                    or env.get('PGDATA') != PGDATA or env.get('PG_MAJOR') != '17'):
                raise ValueError()
            self.image_id = image['Id']
        except (ValueError, KeyError, TypeError, IndexError):
            raise HarnessSafetyError('Pinned PostgreSQL image is unavailable or incompatible; no pull attempted') from None


class DisposablePostgres:
    def __init__(self, client=None, *, purpose='occ'):
        if not re.fullmatch(r'[a-z-]+', purpose):
            raise HarnessSafetyError('Invalid disposable resource purpose')
        self.client = client or LocalDocker()
        self.token = uuid.uuid4().hex
        self.name = 'handyhub-' + purpose + '-' + self.token
        self.container_id = None

    def _inspect(self, container_id):
        result = self.client._command(['container', 'inspect', container_id])
        if result.returncode:
            return None
        try:
            rows = json.loads(result.stdout)
            if len(rows) != 1:
                raise ValueError()
            return rows[0]
        except (ValueError, TypeError):
            raise HarnessSafetyError('Container identity could not be verified') from None

    def _assert_owner(self, row, container_id):
        try:
            labels = row['Config']['Labels']
            valid = (row['Id'] == container_id and row['Name'] == '/' + self.name
                     and labels[RUN_LABEL] == self.client.run_id
                     and labels[RESOURCE_LABEL] == self.token)
        except (KeyError, TypeError):
            valid = False
        if not valid:
            raise HarnessSafetyError('Container ownership not proven; no start, execution or removal allowed')

    def _assert_isolation(self, row):
        try:
            host = row['HostConfig']
            valid = (row['Image'] == self.client.image_id
                     and host['NetworkMode'] == 'none' and host['AutoRemove'] is True
                     and not host.get('Binds') and not host.get('Mounts')
                     and not host.get('PortBindings') and not host.get('PublishAllPorts')
                     and set(host['Tmpfs']) == {PGDATA}
                     and all(m['Type'] == 'tmpfs' and m['Destination'] == PGDATA
                             for m in row['Mounts']))
        except (KeyError, TypeError):
            valid = False
        if not valid:
            raise HarnessSafetyError('Disposable container isolation was not verified')

    def start(self):
        if self.container_id:
            raise HarnessSafetyError('Disposable resource was already created')
        self.client.inspect_image()
        result = self.client._command([
            'container', 'create', '--pull=never', '--rm', '--platform=linux/amd64',
            '--name', self.name, '--label', RUN_LABEL + '=' + self.client.run_id,
            '--label', RESOURCE_LABEL + '=' + self.token, '--network', 'none',
            '--tmpfs', PGDATA, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE])
        candidate = result.stdout.strip()
        if result.returncode or not re.fullmatch(r'[a-f0-9]{64}', candidate):
            # Failure/collision/ambiguous stdout cannot establish ownership.
            raise HarnessSafetyError('Container creation was not confirmed; no cleanup by name attempted')
        row = self._inspect(candidate)
        self._assert_owner(row, candidate)
        self.container_id = candidate  # Only successful creation + matching labels/ID prove ownership.
        try:
            self._assert_isolation(row)
            result = self.client._command(['container', 'start', self.container_id])
            if result.returncode:
                raise HarnessSafetyError('Owned disposable container did not start')
            # Inspect again after startup, before executing a program or sending SQL.
            row = self._inspect(self.container_id)
            self._assert_owner(row, self.container_id)
            self._assert_isolation(row)
            for _ in range(100):
                ready = self.exec(['sh', '-c',
                                   'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres'])
                if ready.returncode == 0:
                    return self
                time.sleep(.1)
            raise HarnessSafetyError('Owned local PostgreSQL did not become ready')
        except BaseException:
            self.close()
            raise

    def exec(self, command, *, data=None, timeout=20):
        if not self.container_id:
            raise HarnessSafetyError('No confirmed disposable container is available')
        return self.client._command(['container', 'exec', '-i', self.container_id, *command],
                                    data=data, timeout=timeout)

    def sql(self, statement, *, database_user='postgres', timeout=20):
        # Binary stdin is essential on Windows: text=True translates LF to CRLF.
        return self.exec(['psql', '-X', '-U', database_user, '-d', 'postgres', '-Atq',
                          '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
                         data=statement.encode('utf-8'), timeout=timeout)

    def close(self):
        if not self.container_id:
            return
        self.client.assert_same_server()
        row = self._inspect(self.container_id)
        if row is None:
            # --rm may have already removed our resource. Do not interpret every
            # inspect failure as absence; prove absence with a successful ID listing.
            result = self.client._command(['container', 'ls', '--all', '--no-trunc',
                                           '--filter', 'id=' + self.container_id, '--format', '{{.ID}}'])
            if result.returncode or result.stdout.strip():
                raise HarnessSafetyError('Owned container state unavailable; removal refused')
            self.container_id = None
            return
        self._assert_owner(row, self.container_id)
        result = self.client._command(['container', 'rm', '-f', self.container_id])
        if result.returncode:
            raise HarnessSafetyError('Owned container cleanup failed; no other resource was targeted')
        self.container_id = None

    def __enter__(self):
        return self.start()

    def __exit__(self, *_):
        self.close()
