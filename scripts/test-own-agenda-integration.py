"""Own agenda after v5, native disposable PostgreSQL and loopback API tests.

Auth transport is controlled. Does not certify real GoTrue/JWT or PostgREST.
--docker-cli selects an installed CLI; LocalDocker still proves the local endpoint.
No env files, persistent DB, image pull, published DB port or external volume.
"""
import argparse
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest

from postgres_harness import DisposablePostgres, LocalDocker

ROOT = Path(__file__).resolve().parents[1]

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

agenda = load('own_agenda_reference', 'test-appointment-read.py')
v5 = load('own_agenda_v5', 'test-invitation-lifecycle-v5.py')

class OwnAgendaAfterV5(agenda.OwnAgenda):
    @classmethod
    def setUpClass(cls):
        v5.reviewed_manifest()
        super().setUpClass()
        cls.created_id = agenda.fixture._postgres.container_id
        print('OWNED_RESOURCE=' + cls.created_id, flush=True)
        for migration in [v5.a.MIGRATION, v5.v4.V4, v5.V5]:
            result = cls.sql(v5.a.MAINTENANCE + migration.read_bytes().decode('utf-8') + v5.a.RESUME)
            if result.returncode:
                raise RuntimeError(result.stderr)
        cls.references_before = v5.references(cls())
        cls().good('SELECT private.erp_assert_recovery_integrity()')

    def test_authorized_empty_agenda(self):
        self.good(f"UPDATE public.erp_appointments SET responsible_employee_id=NULL WHERE tenant_id='{agenda.T}' AND id='{agenda.fixture.uuid(10331)}'")
        self.assertEqual(self.rows(), [])

    def test_http_handler_with_real_sql_authorization(self):
        pg = agenda.fixture._postgres
        pg.client.assert_same_server()
        result = subprocess.run(['node', str(ROOT / 'tests/helpers/own-agenda-postgres.mjs'),
                                 pg.client.executable, pg.client.endpoint, pg.container_id,
                                 pg.client.run_id, pg.token, pg.client.server_id, pg.client.image_id],
                                cwd=ROOT, env=dict(pg.client.environment), capture_output=True,
                                text=False, timeout=90)
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
        print(result.stdout.decode('utf-8').strip(), flush=True)

    def test_v5_integrity_and_history(self):
        self.good('SELECT private.erp_assert_recovery_integrity()')
        self.assertEqual(v5.references(self), self.references_before)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-cli', help='Absolute path of the trusted installed Docker CLI')
    args = parser.parse_args()
    v5.reviewed_manifest()  # Before daemon access or resource creation.
    client = LocalDocker(executable=args.docker_cli)
    agenda.fixture.DisposablePostgres = lambda: DisposablePostgres(client, purpose='own-agenda')
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(OwnAgendaAfterV5))
    pg = agenda.fixture._postgres
    print('OWNED_RESOURCE_REMOVED=' + str(pg is not None and pg.container_id is None), flush=True)
    sys.exit(not result.wasSuccessful())
