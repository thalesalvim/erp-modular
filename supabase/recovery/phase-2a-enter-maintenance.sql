-- OPERATOR RUNBOOK, not an automatic migration. Drain application writes first.
-- Never execute remotely without a separately approved recovery operation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ DECLARE r record; BEGIN
  IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
    (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501';
  END IF;
  -- Fail/rollback on contention; never switch partially or discard an active transaction.
  LOCK TABLE private.erp_runtime_control IN ACCESS EXCLUSIVE MODE;
  FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND ((n.nspname IN ('public','private') AND c.relname LIKE 'erp_%'
      AND c.relname<>'erp_runtime_control') OR (n.nspname='public' AND c.relname IN ('tenant_data','tenant_memberships')))
    ORDER BY n.nspname,c.relname LOOP
    EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',r.nspname,r.relname);
  END LOOP;
END $$;
UPDATE private.erp_runtime_control SET maintenance=true,revision=revision+1 WHERE singleton;
-- Close the unsafe fallback. Table revocation alone leaves column grants behind.
REVOKE ALL ON public.tenant_data FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE cols text; BEGIN
  SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO cols FROM pg_attribute
    WHERE attrelid='public.tenant_data'::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s) ON public.tenant_data FROM PUBLIC,anon,authenticated,service_role',cols,cols,cols);
END $$;
INSERT INTO private.erp_recovery_events(maintenance,revision,operator_role)
  SELECT maintenance,revision,current_user FROM private.erp_runtime_control WHERE singleton;
COMMIT;
