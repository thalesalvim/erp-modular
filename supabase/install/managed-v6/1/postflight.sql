-- Independent check of the root validator body, excluded to avoid self hashing.
DO $validator$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
 WHERE p.oid=pg_catalog.to_regprocedure('handyhub_private.assert_integrity()')
 AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='{{ASSERT_BODY_SHA256}}')
 THEN RAISE EXCEPTION 'MANAGED_V6_VALIDATOR_BODY' USING ERRCODE='55000'; END IF;
END
$validator$;
SELECT handyhub_private.assert_integrity();
DO $postflight$
BEGIN
 IF EXISTS(SELECT 1 FROM handyhub_private.pilot_tenants)
 OR NOT EXISTS(SELECT 1 FROM handyhub_private.runtime WHERE singleton AND maintenance)
 THEN RAISE EXCEPTION 'MANAGED_V6_PILOT_NOT_CLOSED' USING ERRCODE='55000'; END IF;
END
$postflight$;
