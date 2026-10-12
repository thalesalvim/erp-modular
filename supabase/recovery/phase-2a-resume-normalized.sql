-- OPERATOR RUNBOOK: only normalized SQL access resumes. Legacy JSON stays CLOSED.
-- Run phase-2a-verify.sql and reconcile snapshot/checksum manifests before this step.
-- Hold an exclusive operator/DDL window; never reseal a drifted installation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE private.erp_runtime_control IN ACCESS EXCLUSIVE MODE;
DO $$ DECLARE caller text; r record; BEGIN
  IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
    (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM private.erp_runtime_control WHERE singleton AND maintenance) THEN
    RAISE EXCEPTION 'MAINTENANCE_REQUIRED';
  END IF;
  -- Same order as entering maintenance. Hold relation locks through validation/commit.
  FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND ((n.nspname IN ('public','private') AND c.relname LIKE 'erp_%'
      AND c.relname<>'erp_runtime_control') OR (n.nspname='public' AND c.relname IN ('tenant_data','tenant_memberships','tenants','platform_admins')))
    ORDER BY n.nspname,c.relname LOOP
    EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',r.nspname,r.relname);
  END LOOP;
  PERFORM private.erp_assert_recovery_schema();
  FOREACH caller IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_table_privilege(caller,'public.tenant_data','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_any_column_privilege(caller,'public.tenant_data','SELECT,INSERT,UPDATE') THEN
      RAISE EXCEPTION 'UNSAFE_LEGACY_FALLBACK';
    END IF;
  END LOOP;
  PERFORM private.erp_assert_recovery_integrity();
END $$;
UPDATE private.erp_runtime_control SET maintenance=false,revision=revision+1 WHERE singleton;
INSERT INTO private.erp_recovery_events(maintenance,revision,operator_role)
  SELECT maintenance,revision,current_user FROM private.erp_runtime_control WHERE singleton;
COMMIT;
