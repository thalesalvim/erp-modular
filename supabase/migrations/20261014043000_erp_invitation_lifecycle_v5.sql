-- Reviewed v4 -> v5. Historical migrations and seal rows are never rewritten.
-- Run only under the already reviewed owner/provider profile, in maintenance.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';
LOCK TABLE private.erp_runtime_control IN ACCESS EXCLUSIVE MODE;
SELECT private.erp_assert_recovery_integrity();
DO $$ DECLARE r pg_catalog.record; actual pg_catalog.text; BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_catalog.pg_get_userbyid(relowner)::pg_catalog.text
  FROM pg_catalog.pg_class WHERE oid='private.erp_permission_catalog'::pg_catalog.regclass)
 OR current_user IN ('anon','authenticated','service_role','authenticator')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_METADATA_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF pg_catalog.current_setting('server_version_num')::pg_catalog.int4/10000<>17 THEN
  RAISE EXCEPTION 'RECOVERY_UNREVIEWED_POSTGRES_PROFILE' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.erp_runtime_control WHERE singleton AND maintenance) THEN
  RAISE EXCEPTION 'MAINTENANCE_REQUIRED' USING ERRCODE='55000'; END IF;
 FOR r IN SELECT n.nspname,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND ((n.nspname IN ('public','private') AND pg_catalog.left(c.relname,4)='erp_'
 AND c.relname<>'erp_runtime_control') OR (n.nspname='public' AND c.relname IN ('tenant_data','tenant_memberships','tenants','platform_admins'))
 OR (n.nspname='auth' AND c.relname='users')) ORDER BY n.nspname,c.relname LOOP
  EXECUTE pg_catalog.format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',r.nspname,r.relname);
 END LOOP;
 PERFORM private.erp_assert_recovery_integrity();
 SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(snapshot::pg_catalog.text,'UTF8')),'hex')
 INTO actual FROM private.erp_recovery_schema_seal_v4 WHERE singleton;
 IF actual IS DISTINCT FROM 'd2edcdbeb4d0a02e0e39850842699fd3b7a5736e2c5555900205956f1c32b47e' THEN
  RAISE EXCEPTION 'RECOVERY_HISTORICAL_MANIFEST_DRIFT: erp_recovery_schema_seal_v4' USING ERRCODE='55000'; END IF;
END $$;

-- An internal fence, not a public authorization API. Existing capability owners
-- can lock a tenant but gain no table writes or caller-controlled actor identity.
-- Order: runtime SHARE -> tenant NO KEY UPDATE -> actor -> ticket/employee/member.
CREATE FUNCTION private.erp_lock_invitation_lifecycle(p_tenant pg_catalog.uuid) RETURNS pg_catalog.void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE paused pg_catalog.bool;
BEGIN
 IF p_tenant IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 -- Do not let a public RPC acquire an unrelated company's serialization fence.
 -- The metadata-owner retention procedure can operate without a JWT identity.
 IF auth.uid() IS NULL THEN
  IF session_user IS DISTINCT FROM (SELECT pg_catalog.pg_get_userbyid(relowner)::pg_catalog.text
   FROM pg_catalog.pg_class WHERE oid='private.erp_permission_catalog'::pg_catalog.regclass) THEN
   RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.tenant_memberships WHERE tenant_id=p_tenant
  AND user_id=auth.uid() AND is_active AND role IN ('owner','manager')) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF pg_catalog.current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
  RAISE EXCEPTION 'ERP_RUNTIME_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 SELECT maintenance INTO paused FROM private.erp_runtime_control WHERE singleton FOR SHARE;
 IF NOT FOUND OR paused THEN RAISE EXCEPTION 'ERP_RUNTIME_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=p_tenant FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.erp_lock_invitation_lifecycle(pg_catalog.uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.erp_lock_invitation_lifecycle(pg_catalog.uuid)
 TO handyhub_invitation_operator,handyhub_lifecycle_operator,handyhub_membership_reviewer;

-- Full immutable provenance; archival does not reset creation quotas. No FKs to
-- mutable identity records: retained history must remain readable after offboarding.
CREATE TABLE private.erp_invitation_authorization_archive (
 id pg_catalog.uuid PRIMARY KEY,
 tenant_id pg_catalog.uuid NOT NULL,
 actor_user_id pg_catalog.uuid NOT NULL,
 created_at pg_catalog.timestamptz NOT NULL,
 expires_at pg_catalog.timestamptz NOT NULL,
 snapshot pg_catalog.jsonb NOT NULL CHECK(pg_catalog.jsonb_typeof(snapshot)='object'),
 record_sha256 pg_catalog.text NOT NULL CHECK(pg_catalog.length(record_sha256)=64),
 outcome pg_catalog.text NOT NULL CHECK(outcome IN ('consumed','expired')),
 archived_at pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE private.erp_invitation_authorization_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.erp_invitation_authorization_archive FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX erp_invitation_live_quota ON private.erp_invitation_authorizations(tenant_id,actor_user_id,created_at);
CREATE INDEX erp_invitation_archive_quota ON private.erp_invitation_authorization_archive(tenant_id,actor_user_id,created_at);
CREATE TRIGGER erp_invitation_archive_immutable BEFORE UPDATE OR DELETE ON private.erp_invitation_authorization_archive
 FOR EACH ROW EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();
CREATE TRIGGER erp_invitation_archive_no_truncate BEFORE TRUNCATE ON private.erp_invitation_authorization_archive
 FOR EACH STATEMENT EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();

CREATE FUNCTION private.erp_assert_invitation_administrator() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator')
 OR current_user IS DISTINCT FROM (SELECT pg_catalog.pg_get_userbyid(relowner)::pg_catalog.text
 FROM pg_catalog.pg_class WHERE oid='private.erp_permission_catalog'::pg_catalog.regclass)
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
 OR pg_catalog.current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
  RAISE EXCEPTION 'TRUSTED_METADATA_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.erp_assert_invitation_administrator() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.erp_guard_invitation_creation() RETURNS pg_catalog.trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE instant pg_catalog.timestamptz; actor_total pg_catalog.int8; tenant_total pg_catalog.int8;
 actor_pending pg_catalog.int8; tenant_pending pg_catalog.int8;
 actor_day pg_catalog.int8; tenant_day pg_catalog.int8;
BEGIN
 PERFORM private.erp_lock_invitation_lifecycle(NEW.tenant_id);
 IF NEW.actor_user_id IS DISTINCT FROM auth.uid() OR NOT private.erp_invitation_scope(NEW.tenant_id,NEW.requested_role) THEN
  RAISE EXCEPTION 'INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM private.erp_invitation_authorization_archive WHERE id=NEW.id) THEN
  RAISE EXCEPTION 'INVITATION_HISTORY_REUSE' USING ERRCODE='42501'; END IF;
 instant:=pg_catalog.clock_timestamp();
 SELECT count(*),count(*) FILTER(WHERE actor_user_id=NEW.actor_user_id),
 count(*) FILTER(WHERE created_at>instant-interval '24 hours'),
 count(*) FILTER(WHERE actor_user_id=NEW.actor_user_id AND created_at>instant-interval '24 hours')
 INTO tenant_total,actor_total,tenant_day,actor_day FROM (
  SELECT actor_user_id,created_at FROM private.erp_invitation_authorizations WHERE tenant_id=NEW.tenant_id
  UNION ALL SELECT actor_user_id,created_at FROM private.erp_invitation_authorization_archive WHERE tenant_id=NEW.tenant_id
 ) history;
 SELECT count(*),count(*) FILTER(WHERE actor_user_id=NEW.actor_user_id) INTO tenant_pending,actor_pending
 FROM private.erp_invitation_authorizations WHERE tenant_id=NEW.tenant_id AND consumed_at IS NULL AND expires_at>instant;
 -- These constants are reviewed definitions, not mutable administrator settings.
 IF actor_pending>=50 OR tenant_pending>=200 OR actor_day>=100 OR tenant_day>=500
 OR actor_total>=1024 OR tenant_total>=4096 THEN
  RAISE EXCEPTION 'INVITATION_QUOTA_EXCEEDED' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erp_guard_invitation_creation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER erp_invitation_creation_guard BEFORE INSERT ON private.erp_invitation_authorizations
 FOR EACH ROW EXECUTE FUNCTION private.erp_guard_invitation_creation();

CREATE FUNCTION private.erp_guard_invitation_archive() RETURNS pg_catalog.trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE ticket private.erp_invitation_authorizations%ROWTYPE;
BEGIN
 PERFORM private.erp_assert_invitation_administrator();
 SELECT * INTO ticket FROM private.erp_invitation_authorizations WHERE id=NEW.id FOR UPDATE;
 IF NOT FOUND OR ticket.expires_at>=pg_catalog.clock_timestamp()-interval '30 days'
 OR NEW.snapshot IS DISTINCT FROM pg_catalog.to_jsonb(ticket)
 OR NEW.tenant_id IS DISTINCT FROM ticket.tenant_id OR NEW.actor_user_id IS DISTINCT FROM ticket.actor_user_id
 OR NEW.created_at IS DISTINCT FROM ticket.created_at OR NEW.expires_at IS DISTINCT FROM ticket.expires_at
 OR NEW.record_sha256 IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(NEW.snapshot::pg_catalog.text,'UTF8')),'hex')
 OR NEW.outcome IS DISTINCT FROM (CASE WHEN ticket.consumed_at IS NULL THEN 'expired' ELSE 'consumed' END) THEN
  RAISE EXCEPTION 'INVITATION_ARCHIVE_INVALID' USING ERRCODE='42501'; END IF;
 NEW.archived_at:=pg_catalog.clock_timestamp();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erp_guard_invitation_archive() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER erp_invitation_archive_insert BEFORE INSERT ON private.erp_invitation_authorization_archive
 FOR EACH ROW EXECUTE FUNCTION private.erp_guard_invitation_archive();

CREATE OR REPLACE FUNCTION private.erp_guard_invitation_history() RETURNS pg_catalog.trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE instant pg_catalog.timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN
  PERFORM private.erp_assert_invitation_administrator();
  IF OLD.expires_at>=pg_catalog.clock_timestamp()-interval '30 days' OR NOT EXISTS
   (SELECT 1 FROM private.erp_invitation_authorization_archive a WHERE a.id=OLD.id
    AND a.snapshot=pg_catalog.to_jsonb(OLD)
    AND a.record_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(a.snapshot::pg_catalog.text,'UTF8')),'hex')) THEN
   RAISE EXCEPTION 'INVITATION_HISTORY_IMMUTABLE' USING ERRCODE='42501'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'INVITATION_HISTORY_IMMUTABLE' USING ERRCODE='42501'; END IF;
 IF (NEW.id,NEW.tenant_id,NEW.actor_user_id,NEW.requested_role,NEW.created_at,NEW.expires_at)
  IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.actor_user_id,OLD.requested_role,OLD.created_at,OLD.expires_at)
 OR (OLD.invited_user_id IS NOT NULL AND NEW.invited_user_id IS DISTINCT FROM OLD.invited_user_id)
 OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
 OR (NEW.invited_user_id IS DISTINCT FROM OLD.invited_user_id AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
  RAISE EXCEPTION 'INVITATION_HISTORY_IMMUTABLE' USING ERRCODE='42501'; END IF;
 IF OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL THEN
  -- Authoritative consumption time is assigned *after* the statement's locks,
  -- never transaction_timestamp(), statement_timestamp() or a backdated input.
  instant:=pg_catalog.clock_timestamp();
  IF instant>=OLD.expires_at THEN RAISE EXCEPTION 'INVITATION_EXPIRED' USING ERRCODE='42501'; END IF;
  NEW.consumed_at:=instant;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION private.erp_retain_invitation_authorizations(p_tenant pg_catalog.uuid,p_limit pg_catalog.int4 DEFAULT 500)
RETURNS pg_catalog.int4 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE ticket private.erp_invitation_authorizations%ROWTYPE; document pg_catalog.jsonb; archived pg_catalog.int4:=0;
BEGIN
 PERFORM private.erp_assert_invitation_administrator();
 IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN
  RAISE EXCEPTION 'INVALID_RETENTION_BATCH' USING ERRCODE='22023'; END IF;
 PERFORM private.erp_lock_invitation_lifecycle(p_tenant);
 PERFORM private.erp_assert_recovery_integrity();
 FOR ticket IN SELECT * FROM private.erp_invitation_authorizations
 WHERE tenant_id=p_tenant AND expires_at<pg_catalog.clock_timestamp()-interval '30 days'
 ORDER BY id LIMIT p_limit FOR UPDATE LOOP
  document:=pg_catalog.to_jsonb(ticket);
  INSERT INTO private.erp_invitation_authorization_archive(id,tenant_id,actor_user_id,created_at,expires_at,snapshot,record_sha256,outcome)
  VALUES(ticket.id,ticket.tenant_id,ticket.actor_user_id,ticket.created_at,ticket.expires_at,document,
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(document::pg_catalog.text,'UTF8')),'hex'),
   CASE WHEN ticket.consumed_at IS NULL THEN 'expired' ELSE 'consumed' END);
  DELETE FROM private.erp_invitation_authorizations WHERE id=ticket.id;
  archived:=archived+1;
 END LOOP;
 RETURN archived;
END $$;
REVOKE ALL ON FUNCTION private.erp_retain_invitation_authorizations(pg_catalog.uuid,pg_catalog.int4) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.erp_assert_invitation_retention_integrity() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 PERFORM private.erp_assert_invitation_administrator();
 IF EXISTS(SELECT 1 FROM private.erp_invitation_authorization_archive a WHERE
 a.record_sha256 IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(a.snapshot::pg_catalog.text,'UTF8')),'hex')
 OR a.id::pg_catalog.text IS DISTINCT FROM a.snapshot->>'id'
 OR a.tenant_id::pg_catalog.text IS DISTINCT FROM a.snapshot->>'tenant_id'
 OR a.actor_user_id::pg_catalog.text IS DISTINCT FROM a.snapshot->>'actor_user_id'
 OR a.created_at IS DISTINCT FROM (a.snapshot->>'created_at')::pg_catalog.timestamptz
 OR a.expires_at IS DISTINCT FROM (a.snapshot->>'expires_at')::pg_catalog.timestamptz
 OR a.outcome IS DISTINCT FROM CASE WHEN a.snapshot->>'consumed_at' IS NULL THEN 'expired' ELSE 'consumed' END
 OR a.archived_at<a.expires_at+interval '30 days'
 OR EXISTS(SELECT 1 FROM private.erp_invitation_authorizations live WHERE live.id=a.id)) THEN
  RAISE EXCEPTION 'INVITATION_RETENTION_INTEGRITY_FAILURE' USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.erp_assert_invitation_retention_integrity() FROM PUBLIC,anon,authenticated,service_role;

-- Explicit reviewed evolution of existing functions and integrity inventory below.

CREATE OR REPLACE FUNCTION public.erp_set_employee_active(p_tenant uuid,p_employee uuid,p_expected_version bigint,
  p_is_active boolean,p_reason text)
RETURNS TABLE(record_id uuid,version bigint,is_active boolean,membership_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_version bigint; v_active boolean; v_user uuid; v_role text; v_member_active boolean;
  v_before_member boolean; v_member_revision bigint; v_saved private.erp_employee_lifecycle%ROWTYPE;
  v_revoked bigint; v_restore_member boolean:=false;
BEGIN
 -- Preserve the original denial/maintenance contract before waiting, and
 -- revalidate the same permission again below after acquiring the tenant fence.
 IF NOT private.erp_can(p_tenant,'employees.update') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM private.erp_lock_invitation_lifecycle(p_tenant);
  IF NOT private.erp_can(p_tenant,'employees.update') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF p_employee IS NULL OR p_is_active IS NULL OR p_expected_version IS NULL
    OR p_expected_version<1 OR p_expected_version>=9007199254740991
    OR p_reason IS NULL OR p_reason NOT IN ('offboarding','temporary_leave','authorized_return','correction')
    OR (p_is_active AND p_reason NOT IN ('authorized_return','correction'))
    OR (NOT p_is_active AND p_reason='authorized_return') THEN
    RAISE EXCEPTION 'INVALID_LIFECYCLE_COMMAND' USING ERRCODE='22023';
  END IF;
  -- Stable order: actor membership, target employee, target membership.
  PERFORM 1 FROM public.tenant_memberships m WHERE m.tenant_id=p_tenant
    AND m.user_id=(SELECT auth.uid()) AND m.role='owner' AND m.is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  SELECT e.version INTO v_version FROM public.erp_employees e WHERE e.tenant_id=p_tenant AND e.id=p_employee FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF v_version<>p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  SELECT l.auth_user_id INTO v_user FROM private.erp_employee_auth_links l WHERE l.tenant_id=p_tenant AND l.employee_id=p_employee;
  IF v_user IS NOT NULL THEN
    SELECT m.role,m.is_active,m.activity_revision INTO v_role,v_member_active,v_member_revision
      FROM public.tenant_memberships m WHERE m.tenant_id=p_tenant AND m.user_id=v_user FOR UPDATE;
    IF NOT FOUND OR v_role NOT IN ('manager','employee') OR v_user=(SELECT auth.uid()) THEN
      RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501';
    END IF;
  END IF;
  SELECT s.* INTO v_saved FROM private.erp_employee_lifecycle s WHERE s.tenant_id=p_tenant AND s.employee_id=p_employee;
  v_active:=coalesce(v_saved.is_active,true);
  IF v_active=p_is_active THEN RETURN QUERY SELECT p_employee,v_version,v_active,v_member_active; RETURN; END IF;
  v_before_member:=v_member_active;
  IF NOT p_is_active THEN
    IF v_member_active THEN
      UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id=p_tenant AND user_id=v_user
        RETURNING activity_revision INTO v_revoked;
      v_member_active:=false;
    END IF;
  ELSE
    IF v_saved.employee_id IS NOT NULL AND v_saved.linked_user_id IS DISTINCT FROM v_user THEN
      RAISE EXCEPTION 'MEMBERSHIP_CONFLICT' USING ERRCODE='40001';
    END IF;
    IF v_saved.revoked_membership_revision IS NOT NULL THEN
      IF v_member_revision IS DISTINCT FROM v_saved.revoked_membership_revision OR v_member_active IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'MEMBERSHIP_CONFLICT' USING ERRCODE='40001';
      END IF;
      v_restore_member:=true;
    END IF;
    -- A membership already independently inactive is never implicitly restored.
  END IF;
  INSERT INTO private.erp_employee_lifecycle(tenant_id,employee_id,is_active,linked_user_id,revoked_membership_revision)
    VALUES(p_tenant,p_employee,p_is_active,v_user,v_revoked)
    ON CONFLICT(tenant_id,employee_id) DO UPDATE SET is_active=EXCLUDED.is_active,
      linked_user_id=EXCLUDED.linked_user_id,revoked_membership_revision=EXCLUDED.revoked_membership_revision;
  IF v_restore_member THEN
    -- The profile and membership change in one transaction. Clear business
    -- inactivity first so the independent membership activation guard can verify it.
    UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id=p_tenant AND user_id=v_user;
    v_member_active:=true;
  END IF;
  UPDATE public.erp_employees e SET version=e.version WHERE e.tenant_id=p_tenant AND e.id=p_employee AND e.version=p_expected_version
    RETURNING e.version INTO v_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  INSERT INTO private.erp_employee_lifecycle_audit(tenant_id,employee_id,actor_user_id,linked_user_id,previous_active,next_active,
    previous_version,next_version,membership_was_active,membership_is_active,reason)
    VALUES(p_tenant,p_employee,(SELECT auth.uid()),v_user,v_active,p_is_active,p_expected_version,v_version,v_before_member,v_member_active,p_reason);
  RETURN QUERY SELECT p_employee,v_version,p_is_active,v_member_active;
END $$;

CREATE OR REPLACE FUNCTION public.erp_revoke_membership(p_tenant uuid,p_user uuid,p_expected_revision bigint,p_reason text)
RETURNS TABLE(user_id uuid,is_active boolean,activity_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_role text; old_active boolean; old_revision bigint; next_revision bigint;
BEGIN
 -- Preserve the original denial/maintenance contract before waiting, and
 -- revalidate the same permission again below after acquiring the tenant fence.
 IF NOT private.erp_can(p_tenant,'employees.update') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM private.erp_lock_invitation_lifecycle(p_tenant);
  IF NOT private.erp_can(p_tenant,'employees.update') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF p_user IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 OR p_expected_revision>=9007199254740991
    OR p_reason IS NULL OR p_reason NOT IN ('identity_review','offboarding','access_removed') THEN
    RAISE EXCEPTION 'INVALID_MEMBERSHIP_COMMAND' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.tenant_memberships m WHERE m.tenant_id=p_tenant AND m.user_id=(SELECT auth.uid())
    AND m.role='owner' AND m.is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  SELECT m.role,m.is_active,m.activity_revision INTO target_role,old_active,old_revision
    FROM public.tenant_memberships m WHERE m.tenant_id=p_tenant AND m.user_id=p_user FOR UPDATE;
  IF NOT FOUND OR target_role NOT IN ('manager','employee') OR p_user=(SELECT auth.uid()) THEN
    RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF old_revision<>p_expected_revision THEN RAISE EXCEPTION 'MEMBERSHIP_CONFLICT' USING ERRCODE='40001'; END IF;
  INSERT INTO private.erp_membership_revocations AS target(tenant_id,user_id,revoked_revision,restore_allowed) VALUES(p_tenant,p_user,old_revision+1,old_active)
    ON CONFLICT ON CONSTRAINT erp_membership_revocations_pkey DO UPDATE SET is_revoked=true,revoked_revision=EXCLUDED.revoked_revision,
      restore_allowed=CASE WHEN target.is_revoked THEN target.restore_allowed AND target.revoked_revision=old_revision ELSE EXCLUDED.restore_allowed END,
      permissions=ARRAY[]::text[];
  UPDATE public.tenant_memberships m SET is_active=false WHERE m.tenant_id=p_tenant AND m.user_id=p_user
    RETURNING m.activity_revision INTO next_revision;
  INSERT INTO private.erp_membership_revocation_audit(tenant_id,user_id,actor_user_id,previous_active,previous_revision,next_revision,reason)
    VALUES(p_tenant,p_user,(SELECT auth.uid()),old_active,old_revision,next_revision,p_reason);
  RETURN QUERY SELECT p_user,false,next_revision;
END $$;

CREATE OR REPLACE FUNCTION public.erp_restore_membership(p_tenant uuid,p_user uuid,p_expected_revision bigint,
 p_confirm boolean,p_permissions text[],p_expected_employee uuid)
RETURNS TABLE(user_id uuid,is_active boolean,activity_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_role text; current_active boolean; current_revision bigint; employee uuid;
 saved_revision bigint; revoked boolean; restore_allowed boolean; next_revision bigint;
BEGIN
 -- Preserve the original denial/maintenance contract before waiting, and
 -- revalidate the same permission again below after acquiring the tenant fence.
 IF NOT private.erp_can(p_tenant,'employees.update') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM private.erp_lock_invitation_lifecycle(p_tenant);
 IF NOT private.erp_can(p_tenant,'employees.update') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p_user IS NULL OR p_confirm IS DISTINCT FROM true OR p_expected_revision IS NULL OR p_expected_revision<1
   OR p_expected_revision>=9007199254740991 OR p_permissions IS NULL OR cardinality(p_permissions)>59
   OR array_position(p_permissions,NULL) IS NOT NULL
   OR cardinality(p_permissions)<>(SELECT count(DISTINCT x) FROM unnest(p_permissions) x) THEN
   RAISE EXCEPTION 'INVALID_RESTORATION_CONFIRMATION' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.tenant_memberships m WHERE m.tenant_id=p_tenant AND m.user_id=(SELECT auth.uid())
   AND m.role='owner' AND m.is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT l.employee_id INTO employee FROM private.erp_employee_auth_links l WHERE l.tenant_id=p_tenant AND l.auth_user_id=p_user;
 IF employee IS DISTINCT FROM p_expected_employee THEN RAISE EXCEPTION 'IDENTITY_CONFLICT' USING ERRCODE='40001'; END IF;
 IF employee IS NOT NULL THEN
   PERFORM 1 FROM public.erp_employees e WHERE e.tenant_id=p_tenant AND e.id=employee FOR SHARE;
   IF NOT FOUND OR NOT private.erp_staff_active(p_tenant,employee) THEN RAISE EXCEPTION 'EMPLOYEE_INACTIVE' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT m.role,m.is_active,m.activity_revision INTO target_role,current_active,current_revision
   FROM public.tenant_memberships m WHERE m.tenant_id=p_tenant AND m.user_id=p_user FOR UPDATE;
 IF NOT FOUND OR target_role NOT IN ('manager','employee') OR p_user=(SELECT auth.uid()) THEN
   RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT r.revoked_revision,r.is_revoked,r.restore_allowed INTO saved_revision,revoked,restore_allowed FROM private.erp_membership_revocations r
   WHERE r.tenant_id=p_tenant AND r.user_id=p_user;
 IF revoked IS DISTINCT FROM true OR restore_allowed IS DISTINCT FROM true OR current_active OR current_revision<>p_expected_revision OR current_revision<>saved_revision THEN
   RAISE EXCEPTION 'MEMBERSHIP_CONFLICT' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_permissions) x WHERE NOT EXISTS(
   SELECT 1 FROM private.erp_permission_catalog c JOIN private.erp_role_permissions g ON g.permission=c.permission
   WHERE c.permission=x AND c.action='read' AND target_role=ANY(c.delegable_to)
     AND g.tenant_id=p_tenant AND g.role=target_role)) THEN
   RAISE EXCEPTION 'INVALID_PERMISSION_SCOPE' USING ERRCODE='42501'; END IF;
 UPDATE private.erp_membership_revocations r SET is_revoked=false,permissions=p_permissions
   WHERE r.tenant_id=p_tenant AND r.user_id=p_user;
 UPDATE public.tenant_memberships m SET is_active=true WHERE m.tenant_id=p_tenant AND m.user_id=p_user
   RETURNING m.activity_revision INTO next_revision;
 INSERT INTO private.erp_membership_revocation_audit(tenant_id,user_id,actor_user_id,previous_active,
   previous_revision,next_revision,reason,action,next_active,permissions)
   VALUES(p_tenant,p_user,(SELECT auth.uid()),false,current_revision,next_revision,'authorized_restore','restore',true,p_permissions);
 RETURN QUERY SELECT p_user,true,next_revision;
END $$;

CREATE OR REPLACE FUNCTION public.erp_recover_employee_membership(p_tenant uuid,p_user uuid,p_employee uuid,
 p_expected_employee_version bigint,p_expected_membership_revision bigint,p_confirm boolean,p_permissions text[])
RETURNS TABLE(employee_id uuid,employee_version bigint,user_id uuid,activity_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_version bigint; v_revision bigint; v_role text; v_active boolean; v_link uuid;
 s private.erp_employee_lifecycle%ROWTYPE; r private.erp_membership_revocations%ROWTYPE;
 a private.erp_employee_lifecycle_audit%ROWTYPE; chain_length bigint;
BEGIN
 -- Preserve the original denial/maintenance contract before waiting, and
 -- revalidate the same permission again below after acquiring the tenant fence.
 IF NOT private.erp_can(p_tenant,'employees.update') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM private.erp_lock_invitation_lifecycle(p_tenant);
 IF NOT private.erp_can(p_tenant,'employees.update') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p_user IS NULL OR p_employee IS NULL OR p_confirm IS DISTINCT FROM true
   OR p_expected_employee_version IS NULL OR p_expected_employee_version<1 OR p_expected_employee_version>=9007199254740991
   OR p_expected_membership_revision IS NULL OR p_expected_membership_revision<1 OR p_expected_membership_revision>=9007199254740991
   OR p_permissions IS NULL OR cardinality(p_permissions)>59 OR array_position(p_permissions,NULL) IS NOT NULL
   OR cardinality(p_permissions)<>(SELECT count(DISTINCT x) FROM unnest(p_permissions) x) THEN
   RAISE EXCEPTION 'INVALID_RECOVERY_CONFIRMATION' USING ERRCODE='22023'; END IF;
 -- Same lock order as lifecycle/restoration. Verified link changes also lock this employee.
 PERFORM 1 FROM public.tenant_memberships m WHERE m.tenant_id=p_tenant AND m.user_id=(SELECT auth.uid())
   AND m.role='owner' AND m.is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT e.version INTO v_version FROM public.erp_employees e WHERE e.tenant_id=p_tenant AND e.id=p_employee FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF v_version<>p_expected_employee_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT l.auth_user_id INTO v_link FROM private.erp_employee_auth_links l WHERE l.tenant_id=p_tenant AND l.employee_id=p_employee;
 IF v_link IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'IDENTITY_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT m.role,m.is_active,m.activity_revision INTO v_role,v_active,v_revision
   FROM public.tenant_memberships m WHERE m.tenant_id=p_tenant AND m.user_id=p_user FOR UPDATE;
 IF NOT FOUND OR v_role NOT IN ('manager','employee') OR p_user=(SELECT auth.uid()) THEN
   RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT x.* INTO s FROM private.erp_employee_lifecycle x WHERE x.tenant_id=p_tenant AND x.employee_id=p_employee;
 SELECT x.* INTO r FROM private.erp_membership_revocations x WHERE x.tenant_id=p_tenant AND x.user_id=p_user;
 IF s.is_active IS DISTINCT FROM false OR s.linked_user_id IS DISTINCT FROM p_user OR r.is_revoked IS DISTINCT FROM true
   OR v_active OR v_revision<>p_expected_membership_revision OR v_revision IS DISTINCT FROM r.revoked_revision THEN
   RAISE EXCEPTION 'RECOVERY_CONFLICT' USING ERRCODE='40001'; END IF;
 -- The last employee transition must itself be a recorded deactivation of this identity.
 SELECT x.* INTO a FROM private.erp_employee_lifecycle_audit x WHERE x.tenant_id=p_tenant AND x.employee_id=p_employee
   AND x.next_version=v_version AND x.linked_user_id=p_user AND x.previous_active AND NOT x.next_active
   AND x.membership_is_active=false;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNPROVEN_RECOVERY_CHAIN' USING ERRCODE='40001'; END IF;
 IF s.revoked_membership_revision IS NOT NULL THEN
   -- Deactivation -> revocation: every intervening revision MUST be an audited revoke.
   -- Any independent update (even false -> false) leaves a gap and cannot be cleared.
   SELECT count(DISTINCT x.next_revision) INTO chain_length FROM private.erp_membership_revocation_audit x
     WHERE x.tenant_id=p_tenant AND x.user_id=p_user AND x.action='revoke' AND NOT x.previous_active AND NOT x.next_active
       AND x.previous_revision>=s.revoked_membership_revision AND x.next_revision<=v_revision;
   IF a.membership_was_active IS DISTINCT FROM true OR v_revision<=s.revoked_membership_revision
      OR chain_length<>v_revision-s.revoked_membership_revision THEN
     RAISE EXCEPTION 'INDEPENDENT_MEMBERSHIP_BLOCK' USING ERRCODE='40001'; END IF;
 ELSE
   -- Revocation -> deactivation: reuse the conservative revocation lease.
   IF a.membership_was_active IS DISTINCT FROM false OR r.restore_allowed IS DISTINCT FROM true THEN
     RAISE EXCEPTION 'INDEPENDENT_MEMBERSHIP_BLOCK' USING ERRCODE='40001'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_permissions) x WHERE NOT EXISTS(
   SELECT 1 FROM private.erp_permission_catalog c JOIN private.erp_role_permissions g ON g.permission=c.permission
    WHERE c.permission=x AND c.action='read' AND v_role=ANY(c.delegable_to) AND g.tenant_id=p_tenant AND g.role=v_role)) THEN
   RAISE EXCEPTION 'INVALID_PERMISSION_SCOPE' USING ERRCODE='42501'; END IF;
 -- Both known blocks are cleared in the same transaction; independent guards still run.
 UPDATE private.erp_employee_lifecycle x SET is_active=true,revoked_membership_revision=NULL
   WHERE x.tenant_id=p_tenant AND x.employee_id=p_employee;
 UPDATE private.erp_membership_revocations x SET is_revoked=false,restore_allowed=false,permissions=p_permissions
   WHERE x.tenant_id=p_tenant AND x.user_id=p_user;
 UPDATE public.tenant_memberships m SET is_active=true WHERE m.tenant_id=p_tenant AND m.user_id=p_user
   RETURNING m.activity_revision INTO v_revision;
 UPDATE public.erp_employees e SET version=e.version WHERE e.tenant_id=p_tenant AND e.id=p_employee
   RETURNING e.version INTO v_version;
 INSERT INTO private.erp_employee_lifecycle_audit(tenant_id,employee_id,actor_user_id,linked_user_id,
   previous_active,next_active,previous_version,next_version,membership_was_active,membership_is_active,reason)
 VALUES(p_tenant,p_employee,(SELECT auth.uid()),p_user,false,true,p_expected_employee_version,v_version,false,true,'authorized_return');
 INSERT INTO private.erp_membership_revocation_audit(tenant_id,user_id,actor_user_id,previous_active,
   previous_revision,next_revision,reason,action,next_active,permissions)
 VALUES(p_tenant,p_user,(SELECT auth.uid()),false,p_expected_membership_revision,v_revision,'authorized_restore','restore',true,p_permissions);
 RETURN QUERY SELECT p_employee,v_version,p_user,v_revision;
END $$;

CREATE OR REPLACE FUNCTION private.erp_lock_invitation_actor(p_tenant uuid,p_role text) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); paused boolean; status text; actor_role text;
BEGIN
 PERFORM private.erp_lock_invitation_lifecycle(p_tenant);
 IF actor IS NULL OR p_tenant IS NULL OR p_role IS NULL OR p_role NOT IN ('manager','employee') THEN
  RAISE EXCEPTION 'INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 IF current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
  RAISE EXCEPTION 'ERP_RUNTIME_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 -- Maintenance locks runtime first. SHARE (not KEY SHARE) conflicts with updates.
 SELECT r.maintenance INTO paused FROM private.erp_runtime_control r WHERE singleton FOR SHARE;
 IF NOT FOUND OR paused THEN RAISE EXCEPTION 'ERP_RUNTIME_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 SELECT t.status INTO status FROM public.tenants t WHERE t.id=p_tenant FOR SHARE;
 IF NOT FOUND OR status IS DISTINCT FROM 'Ativo' THEN RAISE EXCEPTION 'INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT m.role INTO actor_role FROM public.tenant_memberships m
  WHERE m.tenant_id=p_tenant AND m.user_id=actor AND m.is_active FOR SHARE;
 IF NOT FOUND OR NOT (actor_role='owner' OR (actor_role='manager' AND p_role='employee'))
  OR NOT private.erp_invitation_scope(p_tenant,p_role) THEN
  RAISE EXCEPTION 'INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 -- The tenant fence precedes actor/target locks; keep actor SHARE and all rechecks.
 RETURN actor;
END $$;

CREATE OR REPLACE FUNCTION public.erp_create_invited_membership(p_tenant uuid,p_invited_user uuid,p_role text,p_authorization uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; ticket private.erp_invitation_authorizations%ROWTYPE;
 consumed pg_catalog.timestamptz; affected pg_catalog.int4;
BEGIN
 actor:=private.erp_lock_invitation_actor(p_tenant,p_role);
 IF p_invited_user IS NULL OR p_invited_user=actor OR p_authorization IS NULL THEN
  RAISE EXCEPTION 'INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT a.* INTO ticket FROM private.erp_invitation_authorizations a WHERE a.id=p_authorization FOR UPDATE;
 IF NOT FOUND OR ticket.actor_user_id<>actor OR ticket.tenant_id<>p_tenant OR ticket.requested_role<>p_role
  OR ticket.invited_user_id IS DISTINCT FROM p_invited_user OR ticket.consumed_at IS NOT NULL
  OR ticket.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM private.erp_check_invitation_target(p_tenant,p_invited_user);
 INSERT INTO public.tenant_memberships(tenant_id,user_id,role,is_active) VALUES(p_tenant,p_invited_user,p_role,true);
 consumed:=pg_catalog.clock_timestamp();
 IF consumed>=ticket.expires_at THEN RAISE EXCEPTION 'INVITATION_EXPIRED' USING ERRCODE='42501'; END IF;
 UPDATE private.erp_invitation_authorizations SET consumed_at=consumed
 WHERE id=p_authorization AND consumed_at IS NULL AND expires_at>consumed;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'INVITATION_CONFLICT' USING ERRCODE='40001'; END IF;
 RETURN p_invited_user;
END $$;

CREATE TABLE private.erp_recovery_schema_seal_v5 (
 singleton pg_catalog.bool PRIMARY KEY DEFAULT true CHECK(singleton),
 snapshot pg_catalog.jsonb NOT NULL CHECK(pg_catalog.jsonb_typeof(snapshot)='object'),
 previous_v1_sha256 pg_catalog.text NOT NULL,
 previous_v2_sha256 pg_catalog.text NOT NULL,
 previous_v3_sha256 pg_catalog.text NOT NULL,
 previous_v4_sha256 pg_catalog.text NOT NULL
);
REVOKE ALL ON private.erp_recovery_schema_seal_v5 FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.erp_recovery_schema_seal_v5 ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER erp_schema_seal_immutable BEFORE UPDATE OR DELETE ON private.erp_recovery_schema_seal_v5
 FOR EACH ROW EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();
CREATE TRIGGER erp_schema_seal_no_truncate BEFORE TRUNCATE ON private.erp_recovery_schema_seal_v5
 FOR EACH STATEMENT EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();

CREATE OR REPLACE FUNCTION private.erp_assert_historical_seals() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE r pg_catalog.record; actual pg_catalog.text;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 FOR r IN SELECT * FROM (VALUES
 ('erp_recovery_schema_seal','2c2cd5840f1e0f472020d51ee13c4b11b0f3a95d355d00017996d3599821fff9'),
 ('erp_recovery_schema_seal_v2','52b1bef63e2f8cec9c68f0015987b85d86ef005ff382c8de62148e4e25b03912'),
 ('erp_recovery_schema_seal_v3','d3cb51800efc910fb2a605cfe094ee84474d90ff82f58de5c85911ce175634d7'),
 ('erp_recovery_schema_seal_v4','d2edcdbeb4d0a02e0e39850842699fd3b7a5736e2c5555900205956f1c32b47e')
 ) AS manifest(relation_name,expected_sha256) LOOP
  EXECUTE pg_catalog.format($history$SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(snapshot::pg_catalog.text,'UTF8')),'hex') FROM private.%I WHERE singleton$history$,r.relation_name) INTO actual;
  IF actual IS DISTINCT FROM r.expected_sha256 THEN
   RAISE EXCEPTION 'RECOVERY_HISTORICAL_MANIFEST_DRIFT: %',r.relation_name USING ERRCODE='55000'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM private.erp_recovery_schema_seal_v3 s WHERE s.singleton
  AND s.previous_v1_digest=(SELECT pg_catalog.md5(snapshot::pg_catalog.text) FROM private.erp_recovery_schema_seal WHERE singleton)
  AND s.previous_v2_digest=(SELECT pg_catalog.md5(snapshot::pg_catalog.text) FROM private.erp_recovery_schema_seal_v2 WHERE singleton)) THEN
  RAISE EXCEPTION 'RECOVERY_PREVIOUS_REFERENCE_DRIFT' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.erp_recovery_schema_seal_v4 WHERE singleton
 AND previous_v1_sha256='2c2cd5840f1e0f472020d51ee13c4b11b0f3a95d355d00017996d3599821fff9'
 AND previous_v2_sha256='52b1bef63e2f8cec9c68f0015987b85d86ef005ff382c8de62148e4e25b03912'
 AND previous_v3_sha256='d3cb51800efc910fb2a605cfe094ee84474d90ff82f58de5c85911ce175634d7') THEN
 RAISE EXCEPTION 'RECOVERY_PREVIOUS_REFERENCE_DRIFT' USING ERRCODE='55000'; END IF;
END $$;

CREATE OR REPLACE FUNCTION private.erp_assert_security_invariants() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE name pg_catalog.text; t pg_catalog.record;
BEGIN
 PERFORM private.erp_assert_execution_safety();
 PERFORM private.erp_assert_invitation_privileges();
 PERFORM private.erp_assert_operational_roles();
 FOREACH name IN ARRAY ARRAY[
 'erp_customers','erp_customer_contacts','erp_customer_notes','erp_employees','erp_employee_private',
 'erp_employee_schedules','erp_professional_roles','erp_employee_roles','erp_products','erp_product_costs',
 'erp_product_stock','erp_services','erp_promotions','erp_promotion_targets','erp_appointments','erp_attendances',
 'erp_appointment_finance','erp_appointment_notes','erp_attendance_finance','erp_attendance_notes',
 'erp_sales','erp_sale_customers','erp_sale_finance','erp_sale_notes','erp_stock_moves','erp_expenses','erp_sale_cmv'
 ] LOOP
  SELECT c.relkind,c.relrowsecurity,c.relforcerowsecurity INTO t FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname=name;
  IF NOT FOUND OR t.relkind<>'r' OR NOT t.relrowsecurity OR NOT t.relforcerowsecurity THEN
   RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: RLS_INVARIANT: public.%',name USING ERRCODE='55000'; END IF;
 END LOOP;
 -- Metadata is deliberately owned/read by trusted helpers; FORCE would break that
 -- design. The existing history-posting audit is the explicit FORCE exception.
 -- These expectations are also pinned in the reviewed definition seal.
 FOREACH name IN ARRAY ARRAY[
 'erp_permission_catalog','erp_policy_state','erp_role_permissions','erp_permission_audit',
 'erp_employee_auth_links','erp_customer_assignments','erp_history_postings','erp_runtime_control',
 'erp_employee_lifecycle','erp_employee_lifecycle_audit','erp_recovery_events',
 'erp_membership_revocations','erp_membership_revocation_audit','erp_recovery_schema_seal',
 'erp_recovery_schema_seal_v2','erp_recovery_schema_seal_v3','erp_recovery_schema_seal_v4','erp_recovery_schema_seal_v5','erp_invitation_authorizations','erp_invitation_authorization_archive'
 ] LOOP
  SELECT c.relkind,c.relrowsecurity,c.relforcerowsecurity INTO t FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='private' AND c.relname=name;
  IF NOT FOUND OR t.relkind<>'r' OR NOT t.relrowsecurity OR t.relforcerowsecurity IS DISTINCT FROM (name='erp_history_postings') THEN
   RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: METADATA_RLS_INVARIANT: private.%',name USING ERRCODE='55000'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles o ON o.oid=c.relowner
   WHERE n.nspname IN ('public','private') AND c.relname LIKE 'erp\_%' ESCAPE '\' AND c.relkind='r'
    AND (o.rolname IN ('anon','authenticated','service_role','authenticator') OR o.rolname LIKE 'handyhub\_%' ESCAPE '\')) THEN
  RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: UNTRUSTED_TABLE_OWNER' USING ERRCODE='55000'; END IF;
END $$;

CREATE OR REPLACE FUNCTION private.erp_assert_durable_relations() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE name pg_catalog.text; t pg_catalog.record;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 -- Versioned explicit inventory; never trust the live seal to define durability.
 FOREACH name IN ARRAY ARRAY[
 'public.erp_customers',
 'public.erp_customer_contacts',
 'public.erp_customer_notes',
 'public.erp_employees',
 'public.erp_employee_private',
 'public.erp_employee_schedules',
 'public.erp_professional_roles',
 'public.erp_employee_roles',
 'public.erp_products',
 'public.erp_product_costs',
 'public.erp_product_stock',
 'public.erp_services',
 'public.erp_promotions',
 'public.erp_promotion_targets',
 'public.erp_appointments',
 'public.erp_attendances',
 'public.erp_appointment_finance',
 'public.erp_appointment_notes',
 'public.erp_attendance_finance',
 'public.erp_attendance_notes',
 'public.erp_sales',
 'public.erp_sale_customers',
 'public.erp_sale_finance',
 'public.erp_sale_notes',
 'public.erp_stock_moves',
 'public.erp_expenses',
 'public.erp_sale_cmv',
 'private.erp_permission_catalog',
 'private.erp_policy_state',
 'private.erp_role_permissions',
 'private.erp_permission_audit',
 'private.erp_employee_auth_links',
 'private.erp_customer_assignments',
 'private.erp_history_postings',
 'private.erp_runtime_control',
 'private.erp_employee_lifecycle',
 'private.erp_employee_lifecycle_audit',
 'private.erp_recovery_events',
 'private.erp_membership_revocations',
 'private.erp_membership_revocation_audit',
 'private.erp_recovery_schema_seal',
 'private.erp_recovery_schema_seal_v2',
 'private.erp_recovery_schema_seal_v3',
 'private.erp_recovery_schema_seal_v4',
 'private.erp_recovery_schema_seal_v5',
 'private.erp_invitation_authorization_archive',
 'private.erp_invitation_authorizations',
 'public.tenants',
 'public.tenant_memberships',
 'public.platform_admins',
 'public.tenant_data',
 'auth.users'
 ] LOOP
  SELECT c.relkind,c.relpersistence INTO t FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=pg_catalog.split_part(name,'.',1) AND c.relname=pg_catalog.split_part(name,'.',2);
  IF NOT FOUND OR t.relkind<>'r' OR t.relpersistence<>'p' THEN
   RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: DURABILITY_INVARIANT: %',name USING ERRCODE='55000'; END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.erp_assert_recovery_integrity() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
    (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501';
  END IF;
  PERFORM private.erp_assert_recovery_schema();
  PERFORM private.erp_assert_invitation_retention_integrity();
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
    WHERE t.relname LIKE 'erp_%' AND NOT c.convalidated) OR EXISTS
    (SELECT 1 FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_class t ON t.oid=g.tgrelid
      WHERE (t.relname LIKE 'erp_%' OR t.relname='tenant_memberships') AND g.tgenabled NOT IN ('O','A')) THEN
    RAISE EXCEPTION 'RECOVERY_SCHEMA_INTEGRITY_FAILURE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.erp_sales s
    LEFT JOIN public.erp_sale_finance f USING(tenant_id,id) LEFT JOIN public.erp_sale_cmv c USING(tenant_id,id)
    WHERE s.history_state='posted' AND (f.id IS NULL OR c.id IS NULL
      OR f.quantity_snapshot IS DISTINCT FROM s.quantity OR c.quantity_snapshot IS DISTINCT FROM s.quantity
      OR f.currency_code IS DISTINCT FROM c.currency_code OR f.total IS DISTINCT FROM f.gross_total-f.discount
      OR NOT EXISTS(SELECT 1 FROM private.erp_history_postings a WHERE a.tenant_id=s.tenant_id AND a.sale_id=s.id))) OR EXISTS
    (SELECT 1 FROM public.erp_attendances a LEFT JOIN public.erp_attendance_finance f USING(tenant_id,id)
      WHERE a.history_state='posted' AND (f.id IS NULL OR f.quantity_snapshot IS DISTINCT FROM 1
        OR f.net_value IS DISTINCT FROM f.gross_value-f.discount OR f.currency_code IS DISTINCT FROM 'BRL'
        OR NOT EXISTS(SELECT 1 FROM private.erp_history_postings p WHERE p.tenant_id=a.tenant_id AND p.attendance_id=a.id))) THEN
    RAISE EXCEPTION 'RECOVERY_FINANCIAL_INTEGRITY_FAILURE';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.erp_assert_recovery_schema() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE expected pg_catalog.jsonb; actual pg_catalog.jsonb; mismatch pg_catalog.text;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM private.erp_assert_historical_seals();
 PERFORM private.erp_assert_reviewed_definitions();
 SELECT snapshot INTO expected FROM private.erp_recovery_schema_seal_v5 WHERE singleton;
 IF expected IS NULL THEN RAISE EXCEPTION 'RECOVERY_SCHEMA_SEAL_MISSING' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.erp_recovery_schema_seal_v5 WHERE singleton
 AND previous_v1_sha256='2c2cd5840f1e0f472020d51ee13c4b11b0f3a95d355d00017996d3599821fff9'
 AND previous_v2_sha256='52b1bef63e2f8cec9c68f0015987b85d86ef005ff382c8de62148e4e25b03912'
 AND previous_v3_sha256='d3cb51800efc910fb2a605cfe094ee84474d90ff82f58de5c85911ce175634d7'
 AND previous_v4_sha256='d2edcdbeb4d0a02e0e39850842699fd3b7a5736e2c5555900205956f1c32b47e') THEN
  RAISE EXCEPTION 'RECOVERY_PREVIOUS_REFERENCE_DRIFT' USING ERRCODE='55000'; END IF;
 actual:=private.erp_recovery_schema_snapshot();
 SELECT coalesce(e.key,a.key) INTO mismatch FROM pg_catalog.jsonb_each_text(expected) e
 FULL JOIN pg_catalog.jsonb_each_text(actual) a USING(key) WHERE e.value IS DISTINCT FROM a.value
 ORDER BY coalesce(e.key,a.key) LIMIT 1;
 IF mismatch IS NOT NULL THEN RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: %',mismatch USING ERRCODE='55000'; END IF;
END $$;

CREATE OR REPLACE FUNCTION private.erp_assert_reviewed_definitions() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE digest pg_catalog.text;
BEGIN
 PERFORM private.erp_assert_security_invariants();
 PERFORM private.erp_assert_durable_relations();
 PERFORM private.erp_assert_historical_seals();
 -- All keys participate. Only this function's body is excluded to avoid a
 -- self-referential hash; its owner/ACL/config are pinned here and body in full seal.
 SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
 pg_catalog.jsonb_object_agg(key,value ORDER BY key)::pg_catalog.text,'UTF8')),'hex') INTO digest
 FROM pg_catalog.jsonb_each(private.erp_recovery_schema_snapshot())
 WHERE key<>'function/private.erp_assert_reviewed_definitions()';
 IF digest IS DISTINCT FROM '236f9df1aedbaefdfcd9982b5209e1c3c45e2dbb1dce785a6af628fe63aba146' THEN
  RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: RECOVERY_UNREVIEWED_SCHEMA' USING ERRCODE='55000'; END IF;
END $$;

-- END_REVIEWED_V5_DDL
-- The literal anchor is checked BEFORE any new seal is inserted.
SELECT private.erp_assert_reviewed_definitions();
INSERT INTO private.erp_recovery_schema_seal_v5(snapshot,previous_v1_sha256,previous_v2_sha256,previous_v3_sha256,previous_v4_sha256)
 SELECT private.erp_recovery_schema_snapshot(),
 '2c2cd5840f1e0f472020d51ee13c4b11b0f3a95d355d00017996d3599821fff9',
 '52b1bef63e2f8cec9c68f0015987b85d86ef005ff382c8de62148e4e25b03912',
 'd3cb51800efc910fb2a605cfe094ee84474d90ff82f58de5c85911ce175634d7',
 'd2edcdbeb4d0a02e0e39850842699fd3b7a5736e2c5555900205956f1c32b47e';
SELECT private.erp_assert_recovery_integrity();
COMMIT;
