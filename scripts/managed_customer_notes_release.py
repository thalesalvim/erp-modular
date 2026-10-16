"""Offline v6/3 assembler. Never derives a seal from an installation target."""
import hashlib
import json
import re
from pathlib import Path

import managed_customers_release as previous

ROOT = previous.ROOT
DIRECTORY = ROOT / 'supabase/install/managed-v6/3'
RELEASE_ID = 'managed-customer-notes-v6-3'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source():
    return (DIRECTORY / 'customers-notes.sql').read_bytes().decode('utf-8')


def manifest():
    prior = previous.manifest()
    value = json.loads((DIRECTORY / 'reviewed.json').read_text(encoding='utf-8'))
    if (value['release_id'] != RELEASE_ID or value.get('hosted_certified') is not False
            or value['prior_root_sha256'] != prior['root_sha256']
            or value['source_sha256'] != digest(source().encode('utf-8'))
            or not re.fullmatch('[a-f0-9]{64}', value['root_sha256'])):
        raise ValueError('Unreviewed v6/3 source, lineage or root')
    return value


def render(root, *, seal=True):
    # Used by the isolated review harness too; it never persists a new reference.
    prior = previous.manifest()
    old_body = previous.installation_sql().split('$assert$')[1]
    rendered = source().replace('{{PRIOR_CUSTOMER_ROOT_SHA256}}', prior['root_sha256'])
    rendered = rendered.replace('{{PRIOR_VERIFIER_BODY_SHA256}}', digest(old_body.encode('utf-8')))
    rendered = rendered.replace('{{NOTES_ROOT_SHA256}}', root)
    if seal:
        body = rendered.split('$assert$')[1]
        postflight = (
            "INSERT INTO handyhub_private.customer_notes_release VALUES(true,"
            f"'{RELEASE_ID}','{prior['root_sha256']}','{root}');"
            "SELECT handyhub_private.assert_integrity();"
            "DO $body$ BEGIN IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') "
            "FROM pg_catalog.pg_proc WHERE oid='handyhub_private.assert_integrity()'::regprocedure)"
            f" IS DISTINCT FROM '{digest(body.encode('utf-8'))}'"
            " THEN RAISE EXCEPTION 'CUSTOMER_NOTES_VERIFIER_BODY_DRIFT';END IF;END $body$;"
        )
    else:
        postflight = "SELECT encode(sha256(convert_to(handyhub_private.snapshot()::text,'UTF8')),'hex');"
    rendered = rendered.replace('{{SEAL_AND_POSTFLIGHT}}', postflight)
    if '{{' in rendered:
        raise ValueError('Unresolved v6/3 token')
    return rendered


def installation_sql():
    return render(manifest()['root_sha256'])


def verification_sql():
    """Read-only postflight, including the separately pinned active verifier body."""
    body = installation_sql().split('$assert$')[1]
    return (
        "DO $verify$ BEGIN IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') "
        "FROM pg_catalog.pg_proc WHERE oid='handyhub_private.assert_integrity()'::regprocedure)"
        f" IS DISTINCT FROM '{digest(body.encode('utf-8'))}'"
        " THEN RAISE EXCEPTION 'CUSTOMER_NOTES_VERIFIER_BODY_DRIFT' USING ERRCODE='55000';END IF;"
        "PERFORM handyhub_private.assert_integrity();END $verify$;"
    )


if __name__ == '__main__':
    manifest()
    print('Managed customer notes v6/3 sources verified. No database connection performed.')
