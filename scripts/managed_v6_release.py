"""Offline release assembler. No network, database drivers, DSN or installation.

Prints reviewed SQL only. It never derives an anchor from the installation target.
An operator must separately authorize/execute a hosted installation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / 'supabase/install/managed-v6/1'
FILES = ('snapshot.sql', 'preflight.sql', 'root.sql', 'postflight.sql')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def manifest():
    value = json.loads((RELEASE / 'reviewed.json').read_text(encoding='utf-8'))
    if value['release_id'] != 'managed-customer-foundation-v6-1':
        raise ValueError('Unrecognised managed release')
    for key in ('baseline_sha256', 'root_sha256'):
        if not re.fullmatch('[a-f0-9]{64}', value[key]):
            raise ValueError('Missing independently reviewed anchor')
    for name, expected in value['sources'].items():
        if digest((ROOT / name).read_bytes()) != expected:
            raise ValueError('Release source differs from reviewed bytes: ' + name)
    required = {str((RELEASE / name).relative_to(ROOT)).replace('\\', '/') for name in FILES}
    required.add('scripts/managed_v6_release.py')
    if not required.issubset(value['sources']):
        raise ValueError('Incomplete release manifest')
    return value


def render(name, reviewed):
    source = (RELEASE / name).read_bytes().decode('utf-8')
    if name == 'postflight.sql':
        body = render('root.sql', reviewed).split('$assert$')[1]
        source = source.replace('{{ASSERT_BODY_SHA256}}', digest(body.encode('utf-8')))
    for token, value in {
        'SNAPSHOT': (RELEASE / 'snapshot.sql').read_bytes().decode('utf-8').strip().rstrip(';'),
        'BASELINE_SHA256': reviewed['baseline_sha256'],
        'ROOT_SHA256': reviewed['root_sha256'],
    }.items():
        source = source.replace('{{' + token + '}}', value)
    if '{{' in source:
        raise ValueError('Unresolved release token')
    return source


def installation_sql(reviewed=None):
    reviewed = manifest() if reviewed is None else reviewed
    return ("BEGIN;SET LOCAL search_path='';SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';"
            "SELECT pg_catalog.pg_advisory_xact_lock(731904610140001);"
            "LOCK TABLE public.tenants,public.tenant_memberships,public.platform_admins,"
            "public.tenant_data,public.companies IN SHARE UPDATE EXCLUSIVE MODE;"
            "LOCK TABLE auth.users IN ACCESS SHARE MODE;\n"
            + render('preflight.sql', reviewed) + render('root.sql', reviewed)
            + render('postflight.sql', reviewed) + '\nCOMMIT;\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--print-sql', action='store_true')
    parser.add_argument('--preflight-only', action='store_true')
    args = parser.parse_args()
    reviewed = manifest()
    if args.preflight_only:
        sys.stdout.buffer.write(('BEGIN READ ONLY;\n' + render('preflight.sql', reviewed) + '\nROLLBACK;\n').encode('utf-8'))
    elif args.print_sql:
        # Windows TextIO would translate LF to CRLF and invalidate SQL anchors.
        sys.stdout.buffer.write(installation_sql(reviewed).encode('utf-8'))
    else:
        print('Managed foundation release sources verified; no connection performed.')


if __name__ == '__main__':
    main()
