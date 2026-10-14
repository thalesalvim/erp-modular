-- Reviewed v3 -> v4 transition; historical source files and seal rows stay intact.
-- Unknown owner/provider/ACL profiles FAIL CLOSED. Never substitute live checksums.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL lock_timeout='5s';
-- Legacy helpers override search_path themselves: fence TEMP catalog/type names
-- before invoking them. Installed v4 uses explicit pg_catalog references.
DO $$ DECLARE temp_schema pg_catalog.oid:=pg_catalog.pg_my_temp_schema(); BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class t JOIN pg_catalog.pg_class c ON c.relname=t.relname
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE t.relnamespace=temp_schema AND n.nspname='pg_catalog')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_type c ON c.typname=t.typname
  JOIN pg_catalog.pg_namespace n ON n.oid=c.typnamespace WHERE t.typnamespace=temp_schema AND n.nspname='pg_catalog') THEN
  RAISE EXCEPTION 'RECOVERY_UNSAFE_TEMP_CATALOG' USING ERRCODE='55000'; END IF;
 IF current_user IS DISTINCT FROM (SELECT pg_catalog.pg_get_userbyid(relowner)::pg_catalog.text FROM pg_catalog.pg_class
  WHERE oid='private.erp_permission_catalog'::pg_catalog.regclass) THEN
  RAISE EXCEPTION 'TRUSTED_METADATA_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF pg_catalog.current_setting('server_version_num')::pg_catalog.int4/10000<>17 THEN
  RAISE EXCEPTION 'RECOVERY_UNREVIEWED_POSTGRES_PROFILE' USING ERRCODE='55000'; END IF;
END $$;
LOCK TABLE private.erp_runtime_control IN ACCESS EXCLUSIVE MODE;

DO $$ DECLARE r pg_catalog.record; actual pg_catalog.text;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 FOR r IN SELECT * FROM (VALUES
 ('erp_recovery_schema_seal','2c2cd5840f1e0f472020d51ee13c4b11b0f3a95d355d00017996d3599821fff9'),
 ('erp_recovery_schema_seal_v2','52b1bef63e2f8cec9c68f0015987b85d86ef005ff382c8de62148e4e25b03912'),
 ('erp_recovery_schema_seal_v3','d3cb51800efc910fb2a605cfe094ee84474d90ff82f58de5c85911ce175634d7')
 ) AS manifest(relation_name,expected_sha256) LOOP
  EXECUTE pg_catalog.format($history$SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(snapshot::pg_catalog.text,'UTF8')),'hex') FROM private.%I WHERE singleton$history$,r.relation_name) INTO actual;
  IF actual IS DISTINCT FROM r.expected_sha256 THEN
   RAISE EXCEPTION 'RECOVERY_HISTORICAL_MANIFEST_DRIFT: %',r.relation_name USING ERRCODE='55000'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM private.erp_recovery_schema_seal_v3 s WHERE s.singleton
  AND s.previous_v1_digest=(SELECT pg_catalog.md5(snapshot::pg_catalog.text) FROM private.erp_recovery_schema_seal WHERE singleton)
  AND s.previous_v2_digest=(SELECT pg_catalog.md5(snapshot::pg_catalog.text) FROM private.erp_recovery_schema_seal_v2 WHERE singleton)) THEN
  RAISE EXCEPTION 'RECOVERY_PREVIOUS_REFERENCE_DRIFT' USING ERRCODE='55000'; END IF;
END $$;

SELECT private.erp_assert_recovery_integrity();
DO $$ DECLARE r pg_catalog.record; BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.erp_runtime_control WHERE singleton AND maintenance) THEN
  RAISE EXCEPTION 'MAINTENANCE_REQUIRED' USING ERRCODE='55000'; END IF;
 FOR r IN SELECT n.nspname,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND ((n.nspname IN ('public','private') AND pg_catalog.left(c.relname,4)='erp_'
 AND c.relname<>'erp_runtime_control') OR (n.nspname='public' AND c.relname IN ('tenant_data','tenant_memberships','tenants','platform_admins'))
 OR (n.nspname='auth' AND c.relname='users')) ORDER BY n.nspname,c.relname LOOP
 EXECUTE pg_catalog.format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',r.nspname,r.relname);
 END LOOP;
 PERFORM private.erp_assert_recovery_integrity();
END $$;
-- Recheck the independent historical manifest after draining writers.

DO $$ DECLARE r pg_catalog.record; actual pg_catalog.text;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 FOR r IN SELECT * FROM (VALUES
 ('erp_recovery_schema_seal','2c2cd5840f1e0f472020d51ee13c4b11b0f3a95d355d00017996d3599821fff9'),
 ('erp_recovery_schema_seal_v2','52b1bef63e2f8cec9c68f0015987b85d86ef005ff382c8de62148e4e25b03912'),
 ('erp_recovery_schema_seal_v3','d3cb51800efc910fb2a605cfe094ee84474d90ff82f58de5c85911ce175634d7')
 ) AS manifest(relation_name,expected_sha256) LOOP
  EXECUTE pg_catalog.format($history$SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(snapshot::pg_catalog.text,'UTF8')),'hex') FROM private.%I WHERE singleton$history$,r.relation_name) INTO actual;
  IF actual IS DISTINCT FROM r.expected_sha256 THEN
   RAISE EXCEPTION 'RECOVERY_HISTORICAL_MANIFEST_DRIFT: %',r.relation_name USING ERRCODE='55000'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM private.erp_recovery_schema_seal_v3 s WHERE s.singleton
  AND s.previous_v1_digest=(SELECT pg_catalog.md5(snapshot::pg_catalog.text) FROM private.erp_recovery_schema_seal WHERE singleton)
  AND s.previous_v2_digest=(SELECT pg_catalog.md5(snapshot::pg_catalog.text) FROM private.erp_recovery_schema_seal_v2 WHERE singleton)) THEN
  RAISE EXCEPTION 'RECOVERY_PREVIOUS_REFERENCE_DRIFT' USING ERRCODE='55000'; END IF;
END $$;


CREATE TABLE private.erp_recovery_schema_seal_v4 (
 singleton pg_catalog.bool PRIMARY KEY DEFAULT true CHECK(singleton),
 snapshot pg_catalog.jsonb NOT NULL CHECK(pg_catalog.jsonb_typeof(snapshot)='object'),
 previous_v1_sha256 pg_catalog.text NOT NULL,
 previous_v2_sha256 pg_catalog.text NOT NULL,
 previous_v3_sha256 pg_catalog.text NOT NULL
);
REVOKE ALL ON private.erp_recovery_schema_seal_v4 FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.erp_recovery_schema_seal_v4 ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER erp_schema_seal_immutable BEFORE UPDATE OR DELETE ON private.erp_recovery_schema_seal_v4
 FOR EACH ROW EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();
CREATE TRIGGER erp_schema_seal_no_truncate BEFORE TRUNCATE ON private.erp_recovery_schema_seal_v4
 FOR EACH STATEMENT EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();

CREATE FUNCTION private.erp_assert_historical_seals() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE r pg_catalog.record; actual pg_catalog.text;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 FOR r IN SELECT * FROM (VALUES
 ('erp_recovery_schema_seal','2c2cd5840f1e0f472020d51ee13c4b11b0f3a95d355d00017996d3599821fff9'),
 ('erp_recovery_schema_seal_v2','52b1bef63e2f8cec9c68f0015987b85d86ef005ff382c8de62148e4e25b03912'),
 ('erp_recovery_schema_seal_v3','d3cb51800efc910fb2a605cfe094ee84474d90ff82f58de5c85911ce175634d7')
 ) AS manifest(relation_name,expected_sha256) LOOP
  EXECUTE pg_catalog.format($history$SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(snapshot::pg_catalog.text,'UTF8')),'hex') FROM private.%I WHERE singleton$history$,r.relation_name) INTO actual;
  IF actual IS DISTINCT FROM r.expected_sha256 THEN
   RAISE EXCEPTION 'RECOVERY_HISTORICAL_MANIFEST_DRIFT: %',r.relation_name USING ERRCODE='55000'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM private.erp_recovery_schema_seal_v3 s WHERE s.singleton
  AND s.previous_v1_digest=(SELECT pg_catalog.md5(snapshot::pg_catalog.text) FROM private.erp_recovery_schema_seal WHERE singleton)
  AND s.previous_v2_digest=(SELECT pg_catalog.md5(snapshot::pg_catalog.text) FROM private.erp_recovery_schema_seal_v2 WHERE singleton)) THEN
  RAISE EXCEPTION 'RECOVERY_PREVIOUS_REFERENCE_DRIFT' USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.erp_assert_historical_seals() FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION private.erp_assert_execution_safety() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE unsafe_role pg_catalog.text;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 IF pg_catalog.current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
  RAISE EXCEPTION 'RECOVERY_UNSAFE_SESSION_MODE' USING ERRCODE='55000'; END IF;
 -- A safe explicit SET must not hide an unsafe inherited/server reset value.
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_settings WHERE name='session_replication_role' AND reset_val<>'origin') THEN
  RAISE EXCEPTION 'RECOVERY_UNSAFE_REPLICATION_DEFAULT' USING ERRCODE='55000'; END IF;
 -- Reject even an unsafe default shadowed by a more specific safe default: it can
 -- become effective after a role/pool/configuration change. Other databases excluded.
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting s CROSS JOIN LATERAL pg_catalog.unnest(s.setconfig) v
   WHERE s.setdatabase IN (0,(SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()))
    AND pg_catalog.split_part(v,'=',1)='session_replication_role' AND pg_catalog.split_part(v,'=',2)<>'origin') THEN
  RAISE EXCEPTION 'RECOVERY_UNSAFE_REPLICATION_DEFAULT' USING ERRCODE='55000'; END IF;
 -- Includes inherited privileges AND NOINHERIT roles reachable through SET ROLE.
 SELECT a.rolname INTO unsafe_role FROM pg_catalog.pg_roles a WHERE
  (a.rolname IN ('anon','authenticated','service_role','authenticator') OR a.rolname LIKE 'handyhub\_%' ESCAPE '\')
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles reachable WHERE pg_catalog.pg_has_role(a.oid,reachable.oid,'SET')
    AND (pg_catalog.has_parameter_privilege(reachable.oid,'session_replication_role','SET')
     OR pg_catalog.has_parameter_privilege(reachable.oid,'session_replication_role','ALTER SYSTEM'))) LIMIT 1;
 IF unsafe_role IS NOT NULL THEN
  RAISE EXCEPTION 'RECOVERY_UNSAFE_PARAMETER_PRIVILEGE: %',unsafe_role USING ERRCODE='55000'; END IF;
END $$;


CREATE OR REPLACE FUNCTION private.erp_assert_invitation_privileges() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE r pg_catalog.record; capability pg_catalog.oid:='handyhub_invitation_operator'::pg_catalog.regrole;
 allowed pg_catalog.text[]:=ARRAY[
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
  (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 -- Temporary schemas are session-local and inherit the database TEMP privilege;
 -- qualified helpers cannot be shadowed by them. Forbid CREATE in every permanent schema.
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_(temp|toast_temp)_[0-9]+$'
  AND pg_catalog.has_schema_privilege(capability,n.oid,'CREATE')) THEN
  RAISE EXCEPTION 'RECOVERY_UNSAFE_INVITATION_PRIVILEGE' USING ERRCODE='55000'; END IF;
 FOR r IN SELECT n.nspname||'.'||c.relname AS name,a.privilege_type,a.is_grantable FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
  WHERE a.grantee=capability LOOP
  IF r.name<>'private.erp_invitation_authorizations' OR r.privilege_type<>'SELECT' OR r.is_grantable THEN
   RAISE EXCEPTION 'RECOVERY_UNSAFE_INVITATION_PRIVILEGE' USING ERRCODE='55000'; END IF;
 END LOOP;
 FOR r IN SELECT n.nspname||'.'||c.relname||'/'||x.attname||'/'||a.privilege_type AS permission,a.is_grantable
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute x ON x.attrelid=c.oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(x.attacl) a WHERE a.grantee=capability LOOP
  IF NOT r.permission=ANY(allowed) OR r.is_grantable THEN
   RAISE EXCEPTION 'RECOVERY_UNSAFE_INVITATION_PRIVILEGE' USING ERRCODE='55000'; END IF;
 END LOOP;
 -- Also inspect effective privileges, including PUBLIC (not merely direct ACLs).
 FOR r IN SELECT c.oid,n.nspname||'.'||c.relname AS name FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname||'.'||c.relname) IN
   ('public.tenants','public.tenant_memberships','private.erp_runtime_control','private.erp_invitation_authorizations') LOOP
  IF pg_catalog.has_table_privilege(capability,r.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
   RAISE EXCEPTION 'RECOVERY_UNSAFE_INVITATION_PRIVILEGE' USING ERRCODE='55000'; END IF;
 END LOOP;
 FOR r IN SELECT c.oid,x.attnum,n.nspname||'.'||c.relname AS name,x.attname,p.privilege
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute x ON x.attrelid=c.oid
  CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p(privilege)
  WHERE x.attnum>0 AND NOT x.attisdropped AND (n.nspname||'.'||c.relname) IN
   ('public.tenants','public.tenant_memberships','private.erp_runtime_control','private.erp_invitation_authorizations') LOOP
  IF r.name='private.erp_invitation_authorizations' AND r.privilege='SELECT' THEN CONTINUE; END IF;
  IF pg_catalog.has_column_privilege(capability,r.oid,r.attnum,r.privilege)
   AND NOT (r.name||'/'||r.attname||'/'||r.privilege)=ANY(allowed) THEN
   RAISE EXCEPTION 'RECOVERY_UNSAFE_INVITATION_PRIVILEGE' USING ERRCODE='55000'; END IF;
 END LOOP;
END $$;


CREATE OR REPLACE FUNCTION private.erp_assert_operational_roles() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE name pg_catalog.text; r pg_catalog.record; edge pg_catalog.record; metadata_owner pg_catalog.oid;
 protected pg_catalog.text[]:=ARRAY['anon','authenticated','service_role','authenticator',
  'handyhub_product_writer','handyhub_own_agenda_reader','handyhub_history_writer',
  'handyhub_lifecycle_operator','handyhub_membership_reviewer','handyhub_invitation_operator'];
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 FOREACH name IN ARRAY protected LOOP
  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname=name;
  -- The local fixture has no PostgREST connection role. When present it is checked.
  IF NOT FOUND THEN
   IF name='authenticator' THEN CONTINUE; END IF;
   RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: RECOVERY_UNSAFE_OPERATIONAL_ROLE: missing %',name USING ERRCODE='55000';
  END IF;
  IF r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
    OR (name<>'service_role' AND r.rolbypassrls)
    OR (name<>'authenticator' AND r.rolcanlogin)
    OR ((name='authenticator' OR pg_catalog.left(name,9)='handyhub_') AND r.rolinherit) THEN
   RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: RECOVERY_UNSAFE_OPERATIONAL_ROLE: %',name USING ERRCODE='55000'; END IF;
 END LOOP;
 SELECT c.relowner INTO metadata_owner FROM pg_catalog.pg_class c WHERE c.oid='private.erp_permission_catalog'::pg_catalog.regclass;
 -- Check both directions. Otherwise an unknown LOGIN/BYPASSRLS role could inherit
 -- authenticated's SELECT grants and bypass its policies. Closed edges also rule
 -- out indirect paths via an innocuous intermediate role, independent of INHERIT.
 FOR edge IN SELECT p.rolname AS parent,c.rolname AS child,c.oid AS child_oid,c.rolsuper AS child_super,
   m.admin_option,m.inherit_option,m.set_option
  FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles p ON p.oid=m.roleid JOIN pg_catalog.pg_roles c ON c.oid=m.member
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
 'erp_recovery_schema_seal_v2','erp_recovery_schema_seal_v3','erp_recovery_schema_seal_v4','erp_invitation_authorizations'
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


-- All relation/column ACLs, including identity and the closed legacy table.
CREATE OR REPLACE FUNCTION private.erp_recovery_schema_snapshot() RETURNS pg_catalog.jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 WITH relations AS MATERIALIZED (
  SELECT c.*,n.nspname,pg_catalog.format('%I.%I',n.nspname,c.relname) AS name FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','private') AND (c.relname LIKE 'erp\_%' ESCAPE '\'
    OR (n.nspname='public' AND c.relname IN ('tenant_memberships','tenant_data','tenants','platform_admins')))
    AND c.relkind IN ('r','p','v','m','f','S')
 ), objects AS (
  SELECT 'relation/'||r.name AS key,pg_catalog.jsonb_build_array(r.relkind,r.relpersistence,r.relrowsecurity,r.relforcerowsecurity,
   pg_catalog.pg_get_userbyid(r.relowner),CASE WHEN r.name<>'public.tenant_data' THEN
    (SELECT pg_catalog.jsonb_agg(a::pg_catalog.text ORDER BY a::pg_catalog.text) FROM pg_catalog.unnest(coalesce(r.relacl,pg_catalog.acldefault(CASE WHEN r.relkind='S' THEN 'S'::pg_catalog."char" ELSE 'r'::pg_catalog."char" END,r.relowner))) a)
   END) AS value FROM relations r
  UNION ALL
  SELECT 'relation-state/'||r.name,pg_catalog.jsonb_build_array(r.relkind,r.relpersistence,r.relrowsecurity,r.relforcerowsecurity) FROM relations r
  UNION ALL
  SELECT 'relation-state/auth.users',pg_catalog.jsonb_build_array(c.relkind,c.relpersistence)
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users'
  UNION ALL
  SELECT 'column-definition/'||r.name||'/'||a.attname,pg_catalog.jsonb_build_array(pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
    a.attidentity,a.attgenerated,pg_catalog.pg_get_expr(d.adbin,d.adrelid))
   FROM relations r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
   WHERE a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'owner/relation/'||r.name,pg_catalog.to_jsonb(CASE WHEN r.relowner=(SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid='private.erp_permission_catalog'::pg_catalog.regclass)
    THEN '@metadata-owner' ELSE pg_catalog.pg_get_userbyid(r.relowner)::pg_catalog.text END) FROM relations r
  UNION ALL
  SELECT 'column/'||r.name||'/'||a.attname,pg_catalog.jsonb_build_array(pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid),CASE WHEN r.name<>'public.tenant_data' THEN
     (SELECT pg_catalog.jsonb_agg(x::pg_catalog.text ORDER BY x::pg_catalog.text) FROM pg_catalog.unnest(a.attacl) x) END)
   FROM relations r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
   WHERE a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'trigger/'||r.name||'/'||t.tgname,pg_catalog.jsonb_build_array(pg_catalog.pg_get_triggerdef(t.oid,true),t.tgenabled)
   FROM relations r JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'constraint/'||r.name||'/'||c.conname,pg_catalog.jsonb_build_array(pg_catalog.pg_get_constraintdef(c.oid,true),c.convalidated,c.condeferrable,c.condeferred)
   FROM relations r JOIN pg_catalog.pg_constraint c ON c.conrelid=r.oid
  UNION ALL
  SELECT 'index/'||r.name||'/'||i.relname,pg_catalog.jsonb_build_array(pg_catalog.pg_get_indexdef(i.oid),x.indisvalid,x.indisready,x.indislive)
   FROM relations r JOIN pg_catalog.pg_index x ON x.indrelid=r.oid JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid
  UNION ALL
  SELECT 'policy/'||r.name||'/'||p.polname,pg_catalog.jsonb_build_array(p.polcmd,p.polpermissive,
    (SELECT pg_catalog.jsonb_agg(CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x) END ORDER BY x::pg_catalog.regrole::pg_catalog.text) FROM pg_catalog.unnest(p.polroles) x),
    pg_catalog.pg_get_expr(p.polqual,p.polrelid),pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
   FROM relations r JOIN pg_catalog.pg_policy p ON p.polrelid=r.oid
  UNION ALL
  SELECT 'function/'||n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',pg_catalog.to_jsonb(pg_catalog.pg_get_functiondef(p.oid))
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'erp\_%' ESCAPE '\' OR p.proname IN ('has_tenant_role','is_platform_admin'))
  UNION ALL
  SELECT 'owner/function/'||n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
    pg_catalog.to_jsonb(CASE WHEN p.proowner=(SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid='private.erp_permission_catalog'::pg_catalog.regclass)
      THEN '@metadata-owner' ELSE pg_catalog.pg_get_userbyid(p.proowner)::pg_catalog.text END)
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'erp\_%' ESCAPE '\' OR p.proname IN ('has_tenant_role','is_platform_admin'))
  UNION ALL
  SELECT 'function-security/'||n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
   pg_catalog.jsonb_build_array(pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,
    (SELECT pg_catalog.jsonb_agg(x::pg_catalog.text ORDER BY x::pg_catalog.text) FROM pg_catalog.unnest(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) x))
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'erp\_%' ESCAPE '\' OR p.proname IN ('has_tenant_role','is_platform_admin'))
  UNION ALL
  SELECT 'grant/relation/'||r.name,coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
    ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
    FROM pg_catalog.aclexplode(coalesce(r.relacl,pg_catalog.acldefault('r',r.relowner))) a WHERE a.grantee<>r.relowner),'[]'::pg_catalog.jsonb)
   FROM relations r
  UNION ALL
  SELECT 'grant/column/'||r.name||'/'||c.attname,coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
    ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
    FROM pg_catalog.aclexplode(c.attacl) a WHERE a.grantee<>r.relowner),'[]'::pg_catalog.jsonb)
   FROM relations r JOIN pg_catalog.pg_attribute c ON c.attrelid=r.oid WHERE c.attnum>0 AND NOT c.attisdropped
  UNION ALL
  SELECT 'grant/function/'||n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
   coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
     a.privilege_type,a.is_grantable) ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
     FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner),'[]'::pg_catalog.jsonb)
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','private') AND p.proname LIKE 'erp\_%' ESCAPE '\'
  UNION ALL
  SELECT 'role/'||rolname,pg_catalog.jsonb_build_array(rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls)
   FROM pg_catalog.pg_roles WHERE rolname LIKE 'handyhub\_%' ESCAPE '\' OR rolname IN ('anon','authenticated','service_role')
  UNION ALL
  SELECT 'role-member/'||pg_catalog.pg_get_userbyid(m.roleid)||'/'||pg_catalog.pg_get_userbyid(m.member),pg_catalog.jsonb_build_array(m.admin_option,m.inherit_option,m.set_option)
   FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid JOIN pg_catalog.pg_roles u ON u.oid=m.member
   WHERE r.rolname LIKE 'handyhub\_%' ESCAPE '\' OR u.rolname LIKE 'handyhub\_%' ESCAPE '\'
    OR r.rolname IN ('anon','authenticated','service_role') OR u.rolname IN ('anon','authenticated','service_role')
  UNION ALL
  SELECT 'schema/'||n.nspname,pg_catalog.jsonb_build_array(pg_catalog.pg_get_userbyid(n.nspowner),
   (SELECT pg_catalog.jsonb_agg(x::pg_catalog.text ORDER BY x::pg_catalog.text) FROM pg_catalog.unnest(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) x))
   FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('public','private')
  UNION ALL
  SELECT 'default-acl/'||pg_catalog.pg_get_userbyid(d.defaclrole)||'/'||coalesce(n.nspname,'*')||'/'||d.defaclobjtype::pg_catalog.text,
   (SELECT pg_catalog.jsonb_agg(x::pg_catalog.text ORDER BY x::pg_catalog.text) FROM pg_catalog.unnest(d.defaclacl) x)
   FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR n.nspname IN ('public','private')
  UNION ALL
 SELECT 'owner/relation/auth.users',pg_catalog.to_jsonb(pg_catalog.pg_get_userbyid(r.relowner)::pg_catalog.text)
 FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
 WHERE n.nspname='auth' AND r.relname='users'
 UNION ALL
 SELECT 'grant/relation/auth.users',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
 ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
 FROM pg_catalog.aclexplode(coalesce(r.relacl,pg_catalog.acldefault('r',r.relowner))) a WHERE a.grantee<>r.relowner),'[]'::pg_catalog.jsonb)
 FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='auth' AND r.relname='users'
 UNION ALL
 SELECT 'grant/column/auth.users/'||c.attname,coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
 ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
 FROM pg_catalog.aclexplode(c.attacl) a WHERE a.grantee<>r.relowner),'[]'::pg_catalog.jsonb)
 FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace JOIN pg_catalog.pg_attribute c ON c.attrelid=r.oid
 WHERE n.nspname='auth' AND r.relname='users' AND c.attnum>0 AND NOT c.attisdropped
  AND EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.attacl) g WHERE g.grantee<>r.relowner)
 UNION ALL
 SELECT 'catalog/permissions',pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) ORDER BY c.permission) FROM private.erp_permission_catalog c
 ) SELECT pg_catalog.jsonb_object_agg(key,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(value::pg_catalog.text,'UTF8')),'hex') ORDER BY key) FROM objects;
$$;

CREATE OR REPLACE FUNCTION private.erp_assert_recovery_integrity() RETURNS pg_catalog.void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
  IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
    (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501';
  END IF;
  PERFORM private.erp_assert_recovery_schema();
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
 SELECT snapshot INTO expected FROM private.erp_recovery_schema_seal_v4 WHERE singleton;
 IF expected IS NULL THEN RAISE EXCEPTION 'RECOVERY_SCHEMA_SEAL_MISSING' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.erp_recovery_schema_seal_v4 WHERE singleton
 AND previous_v1_sha256='2c2cd5840f1e0f472020d51ee13c4b11b0f3a95d355d00017996d3599821fff9'
 AND previous_v2_sha256='52b1bef63e2f8cec9c68f0015987b85d86ef005ff382c8de62148e4e25b03912'
 AND previous_v3_sha256='d3cb51800efc910fb2a605cfe094ee84474d90ff82f58de5c85911ce175634d7') THEN
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
 IF digest IS DISTINCT FROM 'de1ef206612099cc770f0719d3e4e442df474a3b96868f537f2e7bfddfd3183f' THEN
  RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: RECOVERY_UNREVIEWED_SCHEMA' USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.erp_assert_execution_safety(),private.erp_assert_invitation_privileges(),
 private.erp_assert_operational_roles(),private.erp_assert_security_invariants(),private.erp_assert_durable_relations(),
 private.erp_recovery_schema_snapshot(),private.erp_assert_recovery_integrity(),private.erp_assert_recovery_schema(),
 private.erp_assert_reviewed_definitions() FROM PUBLIC,anon,authenticated,service_role;
-- END_REVIEWED_V4_DDL
-- Fail before inserting a new reference if any reviewed definition differs.
SELECT private.erp_assert_reviewed_definitions();
INSERT INTO private.erp_recovery_schema_seal_v4(snapshot,previous_v1_sha256,previous_v2_sha256,previous_v3_sha256)
 SELECT private.erp_recovery_schema_snapshot(),'2c2cd5840f1e0f472020d51ee13c4b11b0f3a95d355d00017996d3599821fff9',
 '52b1bef63e2f8cec9c68f0015987b85d86ef005ff382c8de62148e4e25b03912','d3cb51800efc910fb2a605cfe094ee84474d90ff82f58de5c85911ce175634d7';
SELECT private.erp_assert_recovery_integrity();
COMMIT;
