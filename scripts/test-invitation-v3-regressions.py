"""Run existing functional/security suites after the explicit v2 -> v3 upgrade.
Historical v1/v2 bootstrap suites remain separately executable and unchanged.
No remote DSN, environment file or unowned cleanup. Same safe disposable harness.
"""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
UPGRADE = ''.join((ROOT / p).read_bytes().decode('utf-8') for p in [
    'supabase/recovery/phase-2a-enter-maintenance.sql',
    'supabase/migrations/20261013010000_erp_invitation_integrity.sql',
    'supabase/recovery/phase-2a-resume-normalized.sql'])
ENTRIES = ['test-appointment-read.py', 'test-product-concurrency.py',
           'test-historical-snapshots.py', 'test-employee-lifecycle.py',
           'test-membership-revocation.py', 'test-membership-restoration.py',
           'test-coordinated-recovery.py']


def upgrade_fixture(case):
    original = case.setUpClass

    def setup(cls):
        original()
        result = cls.sql(UPGRADE)
        if result.returncode:
            raise RuntimeError(result.stderr)
        cls.legacy_closed = True

    case.setUpClass = classmethod(setup)


if __name__ == '__main__':
    suite = unittest.TestSuite()
    for filename in ENTRIES:
        spec = importlib.util.spec_from_file_location('v3_' + filename.replace('-', '_').removesuffix('.py'), Path(__file__).with_name(filename))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for case in vars(module).values():
            if isinstance(case, type) and issubclass(case, unittest.TestCase) and case.__module__ == module.__name__:
                upgrade_fixture(case)
                # Match the original entrypoint: restoration/coordinated suites
                # explicitly run only newly defined cases, not inherited duplicates.
                suite.addTests(case(name) for name in sorted(case.__dict__) if name.startswith('test_'))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
