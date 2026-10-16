"""Local customer release assembler; no connection, no hosted executor, no reseal."""
import hashlib
import json
import re
from pathlib import Path

import managed_v6_release as foundation

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'supabase/install/managed-v6/2'


def source():
    return (DIRECTORY / 'customers.sql').read_bytes().decode('utf-8')


def manifest():
    foundation.manifest()
    value = json.loads((DIRECTORY / 'reviewed.json').read_text(encoding='utf-8'))
    if value['source_sha256'] != hashlib.sha256(source().encode()).hexdigest():
        raise ValueError('Customer source differs from reviewed bytes')
    if value['release_id'] != 'managed-customer-pilot-v6-2-local' or not re.fullmatch('[a-f0-9]{64}', value['root_sha256']):
        raise ValueError('Missing independently reviewed customer root')
    return value


def installation_sql():
    value = manifest()
    root = value['root_sha256']
    seal = ("INSERT INTO handyhub_private.customer_release VALUES(true,"
            "'4c6b61962c9401cce052bf037544d68997e14c89aa6e23b165546cf93f907a3d',"
            f"'{root}');SELECT handyhub_private.assert_integrity();")
    rendered = source().replace('{{CUSTOMER_ROOT_SHA256}}', root)
    # The snapshot excludes the active verifier body to avoid a hash cycle.
    # Check those exact source bytes independently at installation, as in v6/1.
    body = rendered.split('$assert$')[1]
    body_hash = hashlib.sha256(body.encode('utf-8')).hexdigest()
    seal += ("DO $body$ BEGIN IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') "
             "FROM pg_catalog.pg_proc WHERE oid='handyhub_private.assert_integrity()'::regprocedure)<>"
             f"'{body_hash}' THEN RAISE EXCEPTION 'CUSTOMER_VERIFIER_BODY_DRIFT';END IF;END $body$;")
    return rendered.replace('{{SEAL_AND_POSTFLIGHT}}', seal)


if __name__ == '__main__':
    manifest()
    print('Local customer release verified. No database connection performed.')
