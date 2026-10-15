-- Rendered by managed_v6_release.py from immutable reviewed release literals.
DO $preflight$
DECLARE actual pg_catalog.jsonb;
BEGIN
 PERFORM pg_catalog.set_config('search_path','',true);
 IF session_user<>'postgres' OR current_user<>'postgres'
 OR pg_catalog.current_setting('handyhub.managed_install',true) IS DISTINCT FROM 'pilot-v6-1'
 THEN RAISE EXCEPTION 'MANAGED_V6_EXECUTOR_OR_ACK' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND rolcreaterole AND NOT rolsuper)
 OR NOT pg_catalog.has_database_privilege(current_user,pg_catalog.current_database(),'CREATE')
 OR NOT pg_catalog.has_schema_privilege(current_user,'public','CREATE')
 OR NOT pg_catalog.has_schema_privilege(current_user,'private','CREATE')
 OR NOT pg_catalog.has_schema_privilege(current_user,'auth','USAGE')
 OR NOT pg_catalog.has_function_privilege(current_user,'auth.uid()','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','S') AND pg_catalog.pg_get_userbyid(c.relowner)<>current_user)
 THEN RAISE EXCEPTION 'MANAGED_V6_PRIVILEGES' USING ERRCODE='42501'; END IF;
 IF pg_catalog.to_regnamespace('handyhub_private') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='handyhub_managed_reader')
 THEN RAISE EXCEPTION 'MANAGED_V6_NOT_FRESH' USING ERRCODE='55000'; END IF;
 SELECT s.snapshot INTO actual FROM ({{SNAPSHOT}}) s;
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(actual::text,'UTF8')),'hex')<>'{{BASELINE_SHA256}}'
 THEN RAISE EXCEPTION 'MANAGED_V6_BASELINE_PROFILE_MISMATCH' USING ERRCODE='55000'; END IF;
END
$preflight$;
