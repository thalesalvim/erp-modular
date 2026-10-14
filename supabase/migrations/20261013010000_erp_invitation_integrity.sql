-- Reviewed invitation protocol and recovery seal v3. No historical resealing.
BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE private.erp_runtime_control IN ACCESS EXCLUSIVE MODE;
SELECT private.erp_assert_recovery_integrity();
DO $$ DECLARE r record; BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.erp_runtime_control WHERE singleton AND maintenance) THEN
  RAISE EXCEPTION 'MAINTENANCE_REQUIRED' USING ERRCODE='55000'; END IF;
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND ((n.nspname IN ('public','private') AND left(c.relname,4)='erp_'
    AND c.relname<>'erp_runtime_control') OR (n.nspname='public' AND c.relname IN ('tenant_data','tenant_memberships','tenants','platform_admins')))
  ORDER BY n.nspname,c.relname LOOP
  EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',r.nspname,r.relname);
 END LOOP;
 -- Recheck after draining writers; never baseline an unreviewed v2 installation.
 PERFORM private.erp_assert_recovery_integrity();
END $$;

CREATE ROLE handyhub_invitation_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,private,auth TO handyhub_invitation_operator;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT(id,status),UPDATE(id) ON public.tenants TO handyhub_invitation_operator;
GRANT SELECT(tenant_id,user_id,role,is_active),UPDATE(user_id),INSERT(tenant_id,user_id,role,is_active)
 ON public.tenant_memberships TO handyhub_invitation_operator;
GRANT SELECT(singleton,maintenance),UPDATE(revision) ON private.erp_runtime_control TO handyhub_invitation_operator;

-- Trusted read-only helper: no actor parameter, no user-controlled SQL or claims.
CREATE FUNCTION private.erp_invitation_scope(p_tenant uuid,p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND p_role IN ('manager','employee') AND private.erp_runtime_available()
 AND EXISTS(SELECT 1 FROM public.tenants t JOIN public.tenant_memberships m ON m.tenant_id=t.id
  WHERE t.id=p_tenant AND t.status='Ativo' AND m.user_id=auth.uid() AND m.is_active
   AND (m.role='owner' OR (m.role='manager' AND p_role='employee'))
   -- A restored read-only ceiling does not restore invitation authority.
   AND NOT EXISTS(SELECT 1 FROM private.erp_membership_revocations r WHERE r.tenant_id=m.tenant_id AND r.user_id=m.user_id)
   AND NOT EXISTS(SELECT 1 FROM private.erp_employee_auth_links l JOIN private.erp_employee_lifecycle s
    ON (s.tenant_id,s.employee_id)=(l.tenant_id,l.employee_id)
    WHERE l.tenant_id=m.tenant_id AND l.auth_user_id=m.user_id AND NOT s.is_active));
$$;
REVOKE ALL ON FUNCTION private.erp_invitation_scope(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.erp_invitation_scope(uuid,text) TO handyhub_invitation_operator;

CREATE POLICY erp_invitation_tenant_read ON public.tenants FOR SELECT TO handyhub_invitation_operator
 USING(private.erp_invitation_scope(id,'employee'));
CREATE POLICY erp_invitation_tenant_lock ON public.tenants FOR UPDATE TO handyhub_invitation_operator
 USING(private.erp_invitation_scope(id,'employee')) WITH CHECK(false);
CREATE POLICY erp_invitation_actor_read ON public.tenant_memberships FOR SELECT TO handyhub_invitation_operator
 USING(user_id=(SELECT auth.uid()));
CREATE POLICY erp_invitation_actor_lock ON public.tenant_memberships FOR UPDATE TO handyhub_invitation_operator
 USING(user_id=(SELECT auth.uid())) WITH CHECK(false);
CREATE POLICY erp_invitation_runtime_read ON private.erp_runtime_control FOR SELECT TO handyhub_invitation_operator
 USING(singleton);
CREATE POLICY erp_invitation_runtime_lock ON private.erp_runtime_control FOR UPDATE TO handyhub_invitation_operator
 USING(singleton) WITH CHECK(false);

-- This ticket binds an authenticated authorization to the exact Auth-returned UID.
-- Only the server service_role may bind it; authenticated callers cannot invent
-- the recipient, alter the tenant/role, consume another actor's ticket or replay it.
CREATE TABLE private.erp_invitation_authorizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 requested_role text NOT NULL CHECK(requested_role IN ('manager','employee')),
 invited_user_id uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '10 minutes'),
 consumed_at timestamptz,
 CHECK(expires_at>created_at),
 CHECK(consumed_at IS NULL OR (invited_user_id IS NOT NULL AND consumed_at>=created_at)),
 CHECK(invited_user_id IS NULL OR invited_user_id<>actor_user_id)
);
ALTER TABLE private.erp_invitation_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.erp_invitation_authorizations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT(tenant_id,actor_user_id,requested_role),UPDATE(consumed_at)
 ON private.erp_invitation_authorizations TO handyhub_invitation_operator;
GRANT SELECT,UPDATE(invited_user_id) ON private.erp_invitation_authorizations TO service_role;
CREATE POLICY erp_invitation_ticket_read ON private.erp_invitation_authorizations FOR SELECT TO handyhub_invitation_operator
 USING(actor_user_id=(SELECT auth.uid()));
CREATE POLICY erp_invitation_ticket_create ON private.erp_invitation_authorizations FOR INSERT TO handyhub_invitation_operator
 WITH CHECK(actor_user_id=(SELECT auth.uid()) AND private.erp_invitation_scope(tenant_id,requested_role));
CREATE POLICY erp_invitation_ticket_consume ON private.erp_invitation_authorizations FOR UPDATE TO handyhub_invitation_operator
 USING(actor_user_id=(SELECT auth.uid()))
 WITH CHECK(actor_user_id=(SELECT auth.uid()) AND private.erp_invitation_scope(tenant_id,requested_role));
CREATE POLICY erp_invitation_member_insert ON public.tenant_memberships FOR INSERT TO handyhub_invitation_operator
 WITH CHECK(is_active AND user_id<>(SELECT auth.uid()) AND private.erp_invitation_scope(tenant_id,role)
  AND EXISTS(SELECT 1 FROM private.erp_invitation_authorizations a WHERE a.tenant_id=tenant_memberships.tenant_id
   AND a.actor_user_id=(SELECT auth.uid()) AND a.invited_user_id=tenant_memberships.user_id
   AND a.requested_role=tenant_memberships.role AND a.consumed_at IS NULL AND a.expires_at>clock_timestamp()));

CREATE FUNCTION private.erp_guard_invitation_history() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'INVITATION_HISTORY_IMMUTABLE' USING ERRCODE='42501'; END IF;
 IF (NEW.id,NEW.tenant_id,NEW.actor_user_id,NEW.requested_role,NEW.created_at,NEW.expires_at)
   IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.actor_user_id,OLD.requested_role,OLD.created_at,OLD.expires_at)
  OR (OLD.invited_user_id IS NOT NULL AND NEW.invited_user_id IS DISTINCT FROM OLD.invited_user_id)
  OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
  OR (NEW.invited_user_id IS DISTINCT FROM OLD.invited_user_id AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
  RAISE EXCEPTION 'INVITATION_HISTORY_IMMUTABLE' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erp_guard_invitation_history() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER erp_invitation_history_immutable BEFORE UPDATE OR DELETE ON private.erp_invitation_authorizations
 FOR EACH ROW EXECUTE FUNCTION private.erp_guard_invitation_history();
CREATE TRIGGER erp_invitation_history_no_truncate BEFORE TRUNCATE ON private.erp_invitation_authorizations
 FOR EACH STATEMENT EXECUTE FUNCTION private.erp_guard_invitation_history();

CREATE FUNCTION private.erp_lock_invitation_actor(p_tenant uuid,p_role text) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); paused boolean; status text; actor_role text;
BEGIN
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
 -- Lifecycle revocation cannot commit its actor-membership update while this
 -- SHARE lock is held. Do not invert lifecycle's employee -> target-member order.
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION private.erp_lock_invitation_actor(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.erp_authorize_invitation(p_tenant uuid,p_role text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; ticket uuid;
BEGIN
 actor:=private.erp_lock_invitation_actor(p_tenant,p_role);
 INSERT INTO private.erp_invitation_authorizations(tenant_id,actor_user_id,requested_role)
  VALUES(p_tenant,actor,p_role) RETURNING id INTO ticket;
 RETURN ticket;
END $$;

-- INVOKER: only service_role is allowed, with UPDATE of this single column.
CREATE FUNCTION public.erp_bind_invited_membership(p_authorization uuid,p_invited_user uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE affected integer;
BEGIN
 IF current_user<>'service_role' OR p_invited_user IS NULL THEN
  RAISE EXCEPTION 'INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 UPDATE private.erp_invitation_authorizations SET invited_user_id=p_invited_user
  WHERE id=p_authorization AND invited_user_id IS NULL AND consumed_at IS NULL AND expires_at>clock_timestamp();
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'INVITATION_CONFLICT' USING ERRCODE='40001'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.erp_bind_invited_membership(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.erp_bind_invited_membership(uuid,uuid) TO service_role;

-- Trusted metadata lookup, not exposed: lock a recipient's staff record before
-- inserting its membership, matching lifecycle's employee -> target-member order.
CREATE FUNCTION private.erp_check_invitation_target(p_tenant uuid,p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE employee uuid;
BEGIN
 IF NOT private.erp_invitation_scope(p_tenant,'employee') THEN
  RAISE EXCEPTION 'INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM private.erp_membership_revocations r WHERE r.tenant_id=p_tenant AND r.user_id=p_user) THEN
  RAISE EXCEPTION 'INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT l.employee_id INTO employee FROM private.erp_employee_auth_links l WHERE l.tenant_id=p_tenant AND l.auth_user_id=p_user;
 IF employee IS NOT NULL THEN
  PERFORM 1 FROM public.erp_employees e WHERE e.tenant_id=p_tenant AND e.id=employee FOR SHARE;
  IF NOT private.erp_staff_active(p_tenant,employee) THEN
   RAISE EXCEPTION 'EMPLOYEE_INACTIVE' USING ERRCODE='42501'; END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.erp_check_invitation_target(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.erp_check_invitation_target(uuid,uuid) TO handyhub_invitation_operator;

CREATE FUNCTION public.erp_create_invited_membership(p_tenant uuid,p_invited_user uuid,p_role text,p_authorization uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; ticket private.erp_invitation_authorizations%ROWTYPE;
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
 UPDATE private.erp_invitation_authorizations SET consumed_at=clock_timestamp() WHERE id=p_authorization;
 RETURN p_invited_user;
END $$;

REVOKE ALL ON FUNCTION public.erp_authorize_invitation(uuid,text),
 public.erp_create_invited_membership(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT CREATE ON SCHEMA public,private TO handyhub_invitation_operator;
ALTER FUNCTION private.erp_lock_invitation_actor(uuid,text) OWNER TO handyhub_invitation_operator;
ALTER FUNCTION public.erp_authorize_invitation(uuid,text) OWNER TO handyhub_invitation_operator;
ALTER FUNCTION public.erp_create_invited_membership(uuid,uuid,text,uuid) OWNER TO handyhub_invitation_operator;
REVOKE CREATE ON SCHEMA public,private FROM handyhub_invitation_operator;
GRANT EXECUTE ON FUNCTION public.erp_authorize_invitation(uuid,text),
 public.erp_create_invited_membership(uuid,uuid,text,uuid) TO authenticated;

CREATE TABLE private.erp_recovery_schema_seal_v3 (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 previous_v1_digest text NOT NULL,
 previous_v2_digest text NOT NULL
);
REVOKE ALL ON private.erp_recovery_schema_seal_v3 FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.erp_recovery_schema_seal_v3 ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER erp_schema_seal_immutable BEFORE UPDATE OR DELETE ON private.erp_recovery_schema_seal_v3
 FOR EACH ROW EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();
CREATE TRIGGER erp_schema_seal_no_truncate BEFORE TRUNCATE ON private.erp_recovery_schema_seal_v3
 FOR EACH STATEMENT EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();

-- Versioned invariant evolution follows. The snapshot helper itself is unchanged.
CREATE FUNCTION private.erp_assert_invitation_privileges() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r record; capability oid:='handyhub_invitation_operator'::regrole;
 allowed text[]:=ARRAY[
  'public.tenants/id/SELECT','public.tenants/status/SELECT','public.tenants/id/UPDATE',
  'public.tenant_memberships/tenant_id/SELECT','public.tenant_memberships/user_id/SELECT',
  'public.tenant_memberships/role/SELECT','public.tenant_memberships/is_active/SELECT',
  'public.tenant_memberships/user_id/UPDATE','public.tenant_memberships/tenant_id/INSERT',
  'public.tenant_memberships/user_id/INSERT','public.tenant_memberships/role/INSERT','public.tenant_memberships/is_active/INSERT',
  'private.erp_runtime_control/singleton/SELECT','private.erp_runtime_control/maintenance/SELECT',
  'private.erp_runtime_control/revision/UPDATE',
  'private.erp_invitation_authorizations/tenant_id/INSERT','private.erp_invitation_authorizations/actor_user_id/INSERT',
  'private.erp_invitation_authorizations/requested_role/INSERT','private.erp_invitation_authorizations/consumed_at/UPDATE'];
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 -- Temporary schemas are session-local and inherit the database TEMP privilege;
 -- qualified helpers cannot be shadowed by them. Forbid CREATE in every permanent schema.
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
  AND has_schema_privilege(capability,oid,'CREATE')) THEN
  RAISE EXCEPTION 'RECOVERY_UNSAFE_INVITATION_PRIVILEGE' USING ERRCODE='55000'; END IF;
 FOR r IN SELECT n.nspname||'.'||c.relname AS name,a.privilege_type,a.is_grantable FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a
  WHERE a.grantee=capability LOOP
  IF r.name<>'private.erp_invitation_authorizations' OR r.privilege_type<>'SELECT' OR r.is_grantable THEN
   RAISE EXCEPTION 'RECOVERY_UNSAFE_INVITATION_PRIVILEGE' USING ERRCODE='55000'; END IF;
 END LOOP;
 FOR r IN SELECT n.nspname||'.'||c.relname||'/'||x.attname||'/'||a.privilege_type AS permission,a.is_grantable
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute x ON x.attrelid=c.oid
  CROSS JOIN LATERAL aclexplode(x.attacl) a WHERE a.grantee=capability LOOP
  IF NOT r.permission=ANY(allowed) OR r.is_grantable THEN
   RAISE EXCEPTION 'RECOVERY_UNSAFE_INVITATION_PRIVILEGE' USING ERRCODE='55000'; END IF;
 END LOOP;
 -- Also inspect effective privileges, including PUBLIC (not merely direct ACLs).
 FOR r IN SELECT c.oid,n.nspname||'.'||c.relname AS name FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname||'.'||c.relname) IN
   ('public.tenants','public.tenant_memberships','private.erp_runtime_control','private.erp_invitation_authorizations') LOOP
  IF has_table_privilege(capability,r.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
   RAISE EXCEPTION 'RECOVERY_UNSAFE_INVITATION_PRIVILEGE' USING ERRCODE='55000'; END IF;
 END LOOP;
 FOR r IN SELECT c.oid,x.attnum,n.nspname||'.'||c.relname AS name,x.attname,p.privilege
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute x ON x.attrelid=c.oid
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p(privilege)
  WHERE x.attnum>0 AND NOT x.attisdropped AND (n.nspname||'.'||c.relname) IN
   ('public.tenants','public.tenant_memberships','private.erp_runtime_control','private.erp_invitation_authorizations') LOOP
  IF r.name='private.erp_invitation_authorizations' AND r.privilege='SELECT' THEN CONTINUE; END IF;
  IF has_column_privilege(capability,r.oid,r.attnum,r.privilege)
   AND NOT (r.name||'/'||r.attname||'/'||r.privilege)=ANY(allowed) THEN
   RAISE EXCEPTION 'RECOVERY_UNSAFE_INVITATION_PRIVILEGE' USING ERRCODE='55000'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.erp_assert_invitation_privileges() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.erp_assert_operational_roles() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE name text; r record; edge record; metadata_owner oid;
 protected text[]:=ARRAY['anon','authenticated','service_role','authenticator',
  'handyhub_product_writer','handyhub_own_agenda_reader','handyhub_history_writer',
  'handyhub_lifecycle_operator','handyhub_membership_reviewer','handyhub_invitation_operator'];
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 FOREACH name IN ARRAY protected LOOP
  SELECT * INTO r FROM pg_roles WHERE rolname=name;
  -- The local fixture has no PostgREST connection role. When present it is checked.
  IF NOT FOUND THEN
   IF name='authenticator' THEN CONTINUE; END IF;
   RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: RECOVERY_UNSAFE_OPERATIONAL_ROLE: missing %',name USING ERRCODE='55000';
  END IF;
  IF r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
    OR (name<>'service_role' AND r.rolbypassrls)
    OR (name<>'authenticator' AND r.rolcanlogin)
    OR ((name='authenticator' OR left(name,9)='handyhub_') AND r.rolinherit) THEN
   RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: RECOVERY_UNSAFE_OPERATIONAL_ROLE: %',name USING ERRCODE='55000'; END IF;
 END LOOP;
 SELECT relowner INTO metadata_owner FROM pg_class WHERE oid='private.erp_permission_catalog'::regclass;
 -- Check both directions. Otherwise an unknown LOGIN/BYPASSRLS role could inherit
 -- authenticated's SELECT grants and bypass its policies. Closed edges also rule
 -- out indirect paths via an innocuous intermediate role, independent of INHERIT.
 FOR edge IN SELECT p.rolname AS parent,c.rolname AS child,c.oid AS child_oid,c.rolsuper AS child_super,
   m.admin_option,m.inherit_option,m.set_option
  FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid JOIN pg_roles c ON c.oid=m.member
  WHERE p.rolname=ANY(protected) OR c.rolname=ANY(protected) LOOP
  IF edge.child='authenticator' AND edge.parent IN ('anon','authenticated','service_role')
    AND NOT edge.admin_option AND NOT edge.inherit_option AND edge.set_option THEN CONTINUE; END IF;
  -- Trusted installer/fully privileged DBA may hold standard provider roles. This
  -- exception grants nothing and cannot be reached by an operational role above.
  IF edge.parent IN ('anon','authenticated','service_role','authenticator')
    AND (edge.child_oid=metadata_owner OR edge.child_super)
    AND NOT edge.child=ANY(protected) THEN CONTINUE; END IF;
  RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: RECOVERY_UNSAFE_ROLE_MEMBERSHIP: % -> %',edge.child,edge.parent USING ERRCODE='55000';
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.erp_assert_security_invariants() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE name text; t record;
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
  SELECT c.relkind,c.relrowsecurity,c.relforcerowsecurity INTO t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
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
 'erp_recovery_schema_seal_v2','erp_recovery_schema_seal_v3','erp_invitation_authorizations'
 ] LOOP
  SELECT c.relkind,c.relrowsecurity,c.relforcerowsecurity INTO t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='private' AND c.relname=name;
  IF NOT FOUND OR t.relkind<>'r' OR NOT t.relrowsecurity OR t.relforcerowsecurity IS DISTINCT FROM (name='erp_history_postings') THEN
   RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: METADATA_RLS_INVARIANT: private.%',name USING ERRCODE='55000'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles o ON o.oid=c.relowner
   WHERE n.nspname IN ('public','private') AND c.relname LIKE 'erp\_%' ESCAPE '\' AND c.relkind='r'
    AND (o.rolname IN ('anon','authenticated','service_role','authenticator') OR o.rolname LIKE 'handyhub\_%' ESCAPE '\')) THEN
  RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: UNTRUSTED_TABLE_OWNER' USING ERRCODE='55000'; END IF;
END $$;

CREATE OR REPLACE FUNCTION private.erp_assert_durable_relations() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE name text; t record;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
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
 'private.erp_invitation_authorizations',
 'public.tenants',
 'public.tenant_memberships',
 'public.platform_admins',
 'public.tenant_data',
 'auth.users'
 ] LOOP
  SELECT c.relkind,c.relpersistence INTO t FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=split_part(name,'.',1) AND c.relname=split_part(name,'.',2);
  IF NOT FOUND OR t.relkind<>'r' OR t.relpersistence<>'p' THEN
   RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: DURABILITY_INVARIANT: %',name USING ERRCODE='55000'; END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.erp_assert_recovery_schema() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE expected jsonb; actual jsonb; mismatch text;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM private.erp_assert_reviewed_definitions();
 SELECT snapshot INTO expected FROM private.erp_recovery_schema_seal_v3 WHERE singleton;
 IF expected IS NULL THEN RAISE EXCEPTION 'RECOVERY_SCHEMA_SEAL_MISSING' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.erp_recovery_schema_seal_v3 s
   WHERE s.singleton AND s.previous_v1_digest=(SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal WHERE singleton)
    AND s.previous_v2_digest=(SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal_v2 WHERE singleton)) THEN
  RAISE EXCEPTION 'RECOVERY_PREVIOUS_REFERENCE_DRIFT' USING ERRCODE='55000'; END IF;
 actual:=private.erp_recovery_schema_snapshot();
 SELECT coalesce(e.key,a.key) INTO mismatch FROM jsonb_each_text(expected) e FULL JOIN jsonb_each_text(actual) a USING(key)
  WHERE e.value IS DISTINCT FROM a.value ORDER BY coalesce(e.key,a.key) LIMIT 1;
 IF mismatch IS NOT NULL THEN
  RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: %',mismatch USING ERRCODE='55000'; END IF;
END $$;

CREATE OR REPLACE FUNCTION private.erp_assert_reviewed_definitions() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE digest text;
BEGIN
 PERFORM private.erp_assert_security_invariants();
 PERFORM private.erp_assert_durable_relations();
 SELECT md5(jsonb_object_agg(key,value ORDER BY key)::text) INTO digest
 FROM jsonb_each(private.erp_recovery_schema_snapshot())
 WHERE (key ~ '^(trigger|constraint|index|policy|function|grant|relation-state|column-definition|owner)/|^role/handyhub_|^role-member/.*handyhub_|^catalog/permissions$')
  AND key<>'function/private.erp_assert_reviewed_definitions()';
 IF digest IS DISTINCT FROM 'ba9386b07b1048f02d35781d5edbae9c' THEN
  RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: RECOVERY_UNREVIEWED_SCHEMA' USING ERRCODE='55000'; END IF;
END $$;
-- BEGIN_EXPECTED_DEFINITIONS
DO $$ BEGIN PERFORM private.erp_assert_reviewed_definitions(); END $$;
-- END_EXPECTED_DEFINITIONS
INSERT INTO private.erp_recovery_schema_seal_v3(snapshot,previous_v1_digest,previous_v2_digest)
 SELECT private.erp_recovery_schema_snapshot(),
  (SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal WHERE singleton),
  (SELECT md5(snapshot::text) FROM private.erp_recovery_schema_seal_v2 WHERE singleton);
SELECT private.erp_assert_recovery_integrity();
COMMIT;
