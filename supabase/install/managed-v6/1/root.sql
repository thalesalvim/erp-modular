-- Scoped foundation only. No customers, invitation writer or historic seals.
CREATE SCHEMA handyhub_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA handyhub_private FROM PUBLIC,anon,authenticated,service_role;
CREATE ROLE handyhub_managed_reader NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT handyhub_managed_reader TO postgres WITH INHERIT FALSE,SET TRUE;
GRANT USAGE ON SCHEMA handyhub_private TO handyhub_managed_reader;
-- Existing provider/legacy grants stay unchanged. The pilot-only guard below
-- closes membership DML when a tenant explicitly enters this new lineage.

CREATE TABLE handyhub_private.release (
 singleton boolean PRIMARY KEY CHECK(singleton),
 release_id text NOT NULL CHECK(release_id='managed-customer-foundation-v6-1'),
 baseline_sha256 text NOT NULL CHECK(baseline_sha256='{{BASELINE_SHA256}}'),
 root_sha256 text NOT NULL CHECK(root_sha256 ~ '^[a-f0-9]{64}$'),
 installed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE TABLE handyhub_private.runtime (
 singleton boolean PRIMARY KEY CHECK(singleton),maintenance boolean NOT NULL DEFAULT true
);
INSERT INTO handyhub_private.runtime VALUES(true,true);
CREATE TABLE handyhub_private.pilot_tenants (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL DEFAULT false
);
REVOKE ALL ON handyhub_private.release,handyhub_private.runtime,handyhub_private.pilot_tenants FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE handyhub_private.release ENABLE ROW LEVEL SECURITY;
ALTER TABLE handyhub_private.release FORCE ROW LEVEL SECURITY;
ALTER TABLE handyhub_private.runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE handyhub_private.runtime FORCE ROW LEVEL SECURITY;
ALTER TABLE handyhub_private.pilot_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE handyhub_private.pilot_tenants FORCE ROW LEVEL SECURITY;
GRANT SELECT ON handyhub_private.runtime,handyhub_private.pilot_tenants TO handyhub_managed_reader;
CREATE POLICY runtime_read ON handyhub_private.runtime FOR SELECT TO handyhub_managed_reader USING(true);
CREATE POLICY pilot_read ON handyhub_private.pilot_tenants FOR SELECT TO handyhub_managed_reader USING(true);

-- Only metadata owner already has auth USAGE. No grant/DDL on provider objects.
CREATE FUNCTION handyhub_private.actor() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $actor$ SELECT auth.uid() $actor$;
REVOKE ALL ON FUNCTION handyhub_private.actor() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION handyhub_private.actor() TO handyhub_managed_reader;

-- Narrow boolean projection; no new grants/policies on shared identity tables.
CREATE FUNCTION handyhub_private.owner_active(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $owner$
 SELECT EXISTS(SELECT 1 FROM public.tenants t JOIN public.tenant_memberships m ON m.tenant_id=t.id
 WHERE t.id=p_tenant AND t.status='Ativo' AND m.user_id=auth.uid() AND m.is_active AND m.role='owner')
$owner$;
REVOKE ALL ON FUNCTION handyhub_private.owner_active(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION handyhub_private.owner_active(uuid) TO handyhub_managed_reader;

CREATE FUNCTION handyhub_private.guard_pilot_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $guard$
DECLARE old_tenant uuid;new_tenant uuid;
BEGIN
 IF TG_OP='TRUNCATE' THEN
  IF EXISTS(SELECT 1 FROM handyhub_private.pilot_tenants WHERE enabled)
  AND NOT(session_user='postgres' AND pg_catalog.current_setting('role',true) IN ('none','postgres'))
  THEN RAISE EXCEPTION 'MANAGED_V6_PILOT_IDENTITY_COMMAND_REQUIRED' USING ERRCODE='42501';END IF;
  RETURN NULL;
 END IF;
 IF TG_OP<>'INSERT' THEN old_tenant:=OLD.tenant_id;END IF;
 IF TG_OP<>'DELETE' THEN new_tenant:=NEW.tenant_id;END IF;
 IF EXISTS(SELECT 1 FROM handyhub_private.pilot_tenants p
 WHERE p.enabled AND (p.tenant_id=old_tenant OR p.tenant_id=new_tenant))
 AND NOT(session_user='postgres' AND pg_catalog.current_setting('role',true) IN ('none','postgres'))
 THEN RAISE EXCEPTION 'MANAGED_V6_PILOT_IDENTITY_COMMAND_REQUIRED' USING ERRCODE='42501';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION handyhub_private.guard_pilot_membership() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER handyhub_pilot_membership_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_memberships
 FOR EACH ROW EXECUTE FUNCTION handyhub_private.guard_pilot_membership();
CREATE TRIGGER handyhub_pilot_membership_truncate BEFORE TRUNCATE ON public.tenant_memberships
 FOR EACH STATEMENT EXECUTE FUNCTION handyhub_private.guard_pilot_membership();

CREATE FUNCTION handyhub_private.snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $snapshot$
{{SNAPSHOT}}
$snapshot$;
REVOKE ALL ON FUNCTION handyhub_private.snapshot() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION handyhub_private.assert_integrity() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $assert$
BEGIN
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(handyhub_private.snapshot()::text,'UTF8')),'hex')<>'{{ROOT_SHA256}}'
 OR NOT EXISTS(SELECT 1 FROM handyhub_private.release WHERE singleton
 AND release_id='managed-customer-foundation-v6-1' AND baseline_sha256='{{BASELINE_SHA256}}' AND root_sha256='{{ROOT_SHA256}}')
 THEN RAISE EXCEPTION 'MANAGED_V6_INTEGRITY' USING ERRCODE='55000'; END IF;
END
$assert$;
REVOKE ALL ON FUNCTION handyhub_private.assert_integrity() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION handyhub_private.assert_integrity() TO handyhub_managed_reader;

CREATE FUNCTION handyhub_private.immutable_release() RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $immutable$ BEGIN RAISE EXCEPTION 'MANAGED_V6_IMMUTABLE_RELEASE' USING ERRCODE='55000'; END $immutable$;
REVOKE ALL ON FUNCTION handyhub_private.immutable_release() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_release BEFORE UPDATE OR DELETE ON handyhub_private.release
 FOR EACH ROW EXECUTE FUNCTION handyhub_private.immutable_release();
CREATE TRIGGER immutable_release_truncate BEFORE TRUNCATE ON handyhub_private.release
 FOR EACH STATEMENT EXECUTE FUNCTION handyhub_private.immutable_release();

-- Permission probe for the next release; no customer data or write side effects.
-- Owner-only matches C1 CRUD ceilings. No implicit manager/employee grant.
CREATE FUNCTION public.hh_customer_access(p_tenant uuid,p_permission text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $access$
BEGIN
 PERFORM handyhub_private.assert_integrity();
 RETURN p_permission IN ('customers.read','customers.create','customers.update')
 AND EXISTS(SELECT 1 FROM handyhub_private.runtime WHERE singleton AND NOT maintenance)
 AND EXISTS(SELECT 1 FROM handyhub_private.pilot_tenants WHERE tenant_id=p_tenant AND enabled)
 AND handyhub_private.owner_active(p_tenant);
END
$access$;
REVOKE ALL ON FUNCTION public.hh_customer_access(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hh_customer_access(uuid,text) TO authenticated;
GRANT CREATE ON SCHEMA public TO handyhub_managed_reader;
ALTER FUNCTION public.hh_customer_access(uuid,text) OWNER TO handyhub_managed_reader;
REVOKE CREATE ON SCHEMA public FROM handyhub_managed_reader;

-- REFERENCES and rows of v1-v5 are not created or imported in this lineage.
INSERT INTO handyhub_private.release(singleton,release_id,baseline_sha256,root_sha256)
 VALUES(true,'managed-customer-foundation-v6-1','{{BASELINE_SHA256}}','{{ROOT_SHA256}}');
