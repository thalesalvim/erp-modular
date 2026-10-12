-- Fail-closed schema seal. Installed once from reviewed migrations, never refreshed at resume.
BEGIN;
-- Session fences do not depend on triggers (origin triggers are skipped in replica).
CREATE OR REPLACE FUNCTION private.erp_runtime_available() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT current_setting('session_replication_role')='origin' AND EXISTS
  (SELECT 1 FROM private.erp_runtime_control r WHERE r.singleton AND NOT r.maintenance);
$$;

-- B3: a versioned role model, never inferred from the initial snapshot.
CREATE FUNCTION private.erp_assert_operational_roles() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE name text; r record; edge record; metadata_owner oid;
 protected text[]:=ARRAY['anon','authenticated','service_role','authenticator',
  'handyhub_product_writer','handyhub_own_agenda_reader','handyhub_history_writer',
  'handyhub_lifecycle_operator','handyhub_membership_reviewer'];
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
REVOKE ALL ON FUNCTION private.erp_assert_operational_roles() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.erp_assert_execution_safety() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE unsafe_role text;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 IF current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
  RAISE EXCEPTION 'RECOVERY_UNSAFE_SESSION_MODE' USING ERRCODE='55000'; END IF;
 -- A safe explicit SET must not hide an unsafe inherited/server reset value.
 IF EXISTS(SELECT 1 FROM pg_settings WHERE name='session_replication_role' AND reset_val<>'origin') THEN
  RAISE EXCEPTION 'RECOVERY_UNSAFE_REPLICATION_DEFAULT' USING ERRCODE='55000'; END IF;
 -- Reject even an unsafe default shadowed by a more specific safe default: it can
 -- become effective after a role/pool/configuration change. Other databases excluded.
 IF EXISTS(SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) v
   WHERE s.setdatabase IN (0,(SELECT oid FROM pg_database WHERE datname=current_database()))
    AND split_part(v,'=',1)='session_replication_role' AND split_part(v,'=',2)<>'origin') THEN
  RAISE EXCEPTION 'RECOVERY_UNSAFE_REPLICATION_DEFAULT' USING ERRCODE='55000'; END IF;
 -- Includes inherited privileges AND NOINHERIT roles reachable through SET ROLE.
 SELECT a.rolname INTO unsafe_role FROM pg_roles a WHERE
  (a.rolname IN ('anon','authenticated','service_role','authenticator') OR a.rolname LIKE 'handyhub\_%' ESCAPE '\')
  AND EXISTS(SELECT 1 FROM pg_roles reachable WHERE pg_has_role(a.oid,reachable.oid,'SET')
    AND (has_parameter_privilege(reachable.oid,'session_replication_role','SET')
     OR has_parameter_privilege(reachable.oid,'session_replication_role','ALTER SYSTEM'))) LIMIT 1;
 IF unsafe_role IS NOT NULL THEN
  RAISE EXCEPTION 'RECOVERY_UNSAFE_PARAMETER_PRIVILEGE: %',unsafe_role USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.erp_assert_execution_safety() FROM PUBLIC,anon,authenticated,service_role;
SELECT private.erp_assert_execution_safety();

-- Explicit versioned list, never inferred from the current set of tables.
CREATE FUNCTION private.erp_assert_security_invariants() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE name text; t record;
BEGIN
 PERFORM private.erp_assert_execution_safety();
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
 'erp_membership_revocations','erp_membership_revocation_audit','erp_recovery_schema_seal'
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
REVOKE ALL ON FUNCTION private.erp_assert_security_invariants() FROM PUBLIC,anon,authenticated,service_role;

-- This existing command bypasses table RLS as metadata owner; fence it explicitly.
CREATE OR REPLACE FUNCTION public.erp_set_role_permissions(
  p_tenant uuid, p_role text, p_permissions text[], p_expected_revision bigint
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text;
  v_revision bigint;
  v_before text[];
  v_next text[];
BEGIN
  IF NOT private.erp_runtime_available() THEN RAISE EXCEPTION 'ERP_RUNTIME_UNAVAILABLE' USING ERRCODE='55000'; END IF;
  -- Lock authoritative tenant and membership before configuring this tenant.
  PERFORM 1 FROM public.tenants WHERE id = p_tenant AND status = 'Ativo' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_role FROM public.tenant_memberships
    WHERE tenant_id = p_tenant AND user_id = (SELECT auth.uid()) AND is_active FOR SHARE;
  IF v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('manager','employee') OR p_permissions IS NULL
    OR p_expected_revision IS NULL OR p_expected_revision < 0
    OR cardinality(p_permissions) > 100 OR array_ndims(p_permissions) > 1 THEN
    RAISE EXCEPTION 'Invalid permission request' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_permissions) p WHERE p IS NULL OR NOT EXISTS (
    SELECT 1 FROM private.erp_permission_catalog c
    WHERE c.permission = p AND p_role = ANY(c.delegable_to)
  )) THEN RAISE EXCEPTION 'Permission exceeds role ceiling' USING ERRCODE = '42501'; END IF;

  INSERT INTO private.erp_policy_state(tenant_id) VALUES (p_tenant) ON CONFLICT DO NOTHING;
  SELECT revision INTO v_revision FROM private.erp_policy_state WHERE tenant_id = p_tenant FOR UPDATE;
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Policy revision conflict' USING ERRCODE = '40001';
  END IF;
  SELECT coalesce(array_agg(permission ORDER BY permission), ARRAY[]::text[]) INTO v_before
    FROM private.erp_role_permissions WHERE tenant_id = p_tenant AND role = p_role;
  SELECT coalesce(array_agg(DISTINCT p ORDER BY p), ARRAY[]::text[]) INTO v_next FROM unnest(p_permissions) p;
  DELETE FROM private.erp_role_permissions WHERE tenant_id = p_tenant AND role = p_role;
  INSERT INTO private.erp_role_permissions(tenant_id, role, permission)
    SELECT p_tenant, p_role, p FROM unnest(v_next) p;
  UPDATE private.erp_policy_state SET revision = revision + 1 WHERE tenant_id = p_tenant
    RETURNING revision INTO v_revision;
  INSERT INTO private.erp_permission_audit(tenant_id, actor_user_id, target_role,
    previous_permissions, next_permissions, revision)
    VALUES (p_tenant, auth.uid(), p_role, v_before, v_next, v_revision);
  RETURN v_revision;
END;
$$;

CREATE TABLE private.erp_recovery_schema_seal (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object')
);
REVOKE ALL ON private.erp_recovery_schema_seal FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.erp_recovery_schema_seal ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER erp_schema_seal_immutable BEFORE UPDATE OR DELETE ON private.erp_recovery_schema_seal
 FOR EACH ROW EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();
CREATE TRIGGER erp_schema_seal_no_truncate BEFORE TRUNCATE ON private.erp_recovery_schema_seal
 FOR EACH STATEMENT EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();

-- OID-free definitions and ACLs. Legacy JSON ACLs are intentionally handled by the
-- stricter resume script (zero access), since entering maintenance revokes them.
CREATE FUNCTION private.erp_recovery_schema_snapshot() RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH relations AS MATERIALIZED (
  SELECT c.*,n.nspname,format('%I.%I',n.nspname,c.relname) AS name FROM pg_class c
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','private') AND (c.relname LIKE 'erp\_%' ESCAPE '\'
    OR (n.nspname='public' AND c.relname IN ('tenant_memberships','tenant_data','tenants','platform_admins')))
    AND c.relkind IN ('r','p','v','m','f','S')
 ), objects AS (
  SELECT 'relation/'||r.name AS key,jsonb_build_array(r.relkind,r.relrowsecurity,r.relforcerowsecurity,
   pg_get_userbyid(r.relowner),CASE WHEN r.name<>'public.tenant_data' THEN
    (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(coalesce(r.relacl,acldefault(CASE WHEN r.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,r.relowner))) a)
   END) AS value FROM relations r
  UNION ALL
  SELECT 'relation-state/'||r.name,jsonb_build_array(r.relkind,r.relrowsecurity,r.relforcerowsecurity) FROM relations r
  UNION ALL
  SELECT 'column-definition/'||r.name||'/'||a.attname,jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull,
    a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid))
   FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
   WHERE a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'owner/relation/'||r.name,to_jsonb(CASE WHEN r.relowner=(SELECT relowner FROM pg_class WHERE oid='private.erp_permission_catalog'::regclass)
    THEN '@metadata-owner' ELSE pg_get_userbyid(r.relowner)::text END) FROM relations r
  UNION ALL
  SELECT 'column/'||r.name||'/'||a.attname,jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
    pg_get_expr(d.adbin,d.adrelid),CASE WHEN r.name<>'public.tenant_data' THEN
     (SELECT jsonb_agg(x::text ORDER BY x::text) FROM unnest(a.attacl) x) END)
   FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
   WHERE a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'trigger/'||r.name||'/'||t.tgname,jsonb_build_array(pg_get_triggerdef(t.oid,true),t.tgenabled)
   FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'constraint/'||r.name||'/'||c.conname,jsonb_build_array(pg_get_constraintdef(c.oid,true),c.convalidated,c.condeferrable,c.condeferred)
   FROM relations r JOIN pg_constraint c ON c.conrelid=r.oid
  UNION ALL
  SELECT 'index/'||r.name||'/'||i.relname,jsonb_build_array(pg_get_indexdef(i.oid),x.indisvalid,x.indisready,x.indislive)
   FROM relations r JOIN pg_index x ON x.indrelid=r.oid JOIN pg_class i ON i.oid=x.indexrelid
  UNION ALL
  SELECT 'policy/'||r.name||'/'||p.polname,jsonb_build_array(p.polcmd,p.polpermissive,
    (SELECT jsonb_agg(CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x) END ORDER BY x::regrole::text) FROM unnest(p.polroles) x),
    pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
   FROM relations r JOIN pg_policy p ON p.polrelid=r.oid
  UNION ALL
  SELECT 'function/'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',to_jsonb(pg_get_functiondef(p.oid))
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'erp\_%' ESCAPE '\' OR p.proname IN ('has_tenant_role','is_platform_admin'))
  UNION ALL
  SELECT 'owner/function/'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    to_jsonb(CASE WHEN p.proowner=(SELECT relowner FROM pg_class WHERE oid='private.erp_permission_catalog'::regclass)
      THEN '@metadata-owner' ELSE pg_get_userbyid(p.proowner)::text END)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'erp\_%' ESCAPE '\' OR p.proname IN ('has_tenant_role','is_platform_admin'))
  UNION ALL
  SELECT 'function-security/'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
   jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,
    (SELECT jsonb_agg(x::text ORDER BY x::text) FROM unnest(coalesce(p.proacl,acldefault('f',p.proowner))) x))
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'erp\_%' ESCAPE '\' OR p.proname IN ('has_tenant_role','is_platform_admin'))
  UNION ALL
  SELECT 'grant/relation/'||r.name,coalesce((SELECT jsonb_agg(jsonb_build_array(
    CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
    ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
    FROM aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) a WHERE a.grantee<>r.relowner),'[]'::jsonb)
   FROM relations r WHERE r.relname LIKE 'erp\_%' ESCAPE '\'
  UNION ALL
  SELECT 'grant/column/'||r.name||'/'||c.attname,coalesce((SELECT jsonb_agg(jsonb_build_array(
    CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
    ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
    FROM aclexplode(c.attacl) a WHERE a.grantee<>r.relowner),'[]'::jsonb)
   FROM relations r JOIN pg_attribute c ON c.attrelid=r.oid WHERE r.relname LIKE 'erp\_%' ESCAPE '\' AND c.attnum>0 AND NOT c.attisdropped
  UNION ALL
  SELECT 'grant/function/'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
   coalesce((SELECT jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
     a.privilege_type,a.is_grantable) ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
     FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner),'[]'::jsonb)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','private') AND p.proname LIKE 'erp\_%' ESCAPE '\'
  UNION ALL
  SELECT 'role/'||rolname,jsonb_build_array(rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls)
   FROM pg_roles WHERE rolname LIKE 'handyhub\_%' ESCAPE '\' OR rolname IN ('anon','authenticated','service_role')
  UNION ALL
  SELECT 'role-member/'||pg_get_userbyid(m.roleid)||'/'||pg_get_userbyid(m.member),jsonb_build_array(m.admin_option,m.inherit_option,m.set_option)
   FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member
   WHERE r.rolname LIKE 'handyhub\_%' ESCAPE '\' OR u.rolname LIKE 'handyhub\_%' ESCAPE '\'
    OR r.rolname IN ('anon','authenticated','service_role') OR u.rolname IN ('anon','authenticated','service_role')
  UNION ALL
  SELECT 'schema/'||n.nspname,jsonb_build_array(pg_get_userbyid(n.nspowner),
   (SELECT jsonb_agg(x::text ORDER BY x::text) FROM unnest(coalesce(n.nspacl,acldefault('n',n.nspowner))) x))
   FROM pg_namespace n WHERE n.nspname IN ('public','private')
  UNION ALL
  SELECT 'default-acl/'||pg_get_userbyid(d.defaclrole)||'/'||coalesce(n.nspname,'*')||'/'||d.defaclobjtype::text,
   (SELECT jsonb_agg(x::text ORDER BY x::text) FROM unnest(d.defaclacl) x)
   FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR n.nspname IN ('public','private')
  UNION ALL
  SELECT 'catalog/permissions',jsonb_agg(to_jsonb(c) ORDER BY c.permission) FROM private.erp_permission_catalog c
 ) SELECT jsonb_object_agg(key,md5(value::text) ORDER BY key) FROM objects;
$$;
REVOKE ALL ON FUNCTION private.erp_recovery_schema_snapshot() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.erp_assert_recovery_schema() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE expected jsonb; actual jsonb; mismatch text;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM private.erp_assert_reviewed_definitions();
 SELECT snapshot INTO expected FROM private.erp_recovery_schema_seal WHERE singleton;
 IF expected IS NULL THEN RAISE EXCEPTION 'RECOVERY_SCHEMA_SEAL_MISSING' USING ERRCODE='55000'; END IF;
 actual:=private.erp_recovery_schema_snapshot();
 SELECT coalesce(e.key,a.key) INTO mismatch FROM jsonb_each_text(expected) e FULL JOIN jsonb_each_text(actual) a USING(key)
  WHERE e.value IS DISTINCT FROM a.value ORDER BY coalesce(e.key,a.key) LIMIT 1;
 IF mismatch IS NOT NULL THEN
  RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: %',mismatch USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.erp_assert_recovery_schema() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.erp_assert_recovery_integrity() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
    (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501';
  END IF;
  PERFORM private.erp_assert_recovery_schema();
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relname LIKE 'erp_%' AND NOT c.convalidated) OR EXISTS
    (SELECT 1 FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid
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
REVOKE ALL ON FUNCTION private.erp_assert_recovery_integrity() FROM PUBLIC,anon,authenticated,service_role;

-- Versioned trust anchor: not learned from the live seal. Exclude ONLY this
-- function's own body from its digest to avoid a self-referential hash; its actual
-- definition/owner/ACL remain covered by the full immutable snapshot. A DBA that
-- replaces the verifier itself is outside this mechanism's trust boundary.
CREATE FUNCTION private.erp_assert_reviewed_definitions() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE digest text;
BEGIN
 PERFORM private.erp_assert_security_invariants();
 SELECT md5(jsonb_object_agg(key,value ORDER BY key)::text) INTO digest
 FROM jsonb_each(private.erp_recovery_schema_snapshot())
 WHERE (key ~ '^(trigger|constraint|index|policy|function|grant|relation-state|column-definition|owner)/|^role/handyhub_|^role-member/.*handyhub_|^catalog/permissions$')
  AND key<>'function/private.erp_assert_reviewed_definitions()';
 IF digest IS DISTINCT FROM '3a17fd541f024fdb24f6012e9a839b6d' THEN
  RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: RECOVERY_UNREVIEWED_SCHEMA' USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.erp_assert_reviewed_definitions() FROM PUBLIC,anon,authenticated,service_role;
-- BEGIN_EXPECTED_DEFINITIONS
DO $$ BEGIN PERFORM private.erp_assert_reviewed_definitions(); END $$;
-- END_EXPECTED_DEFINITIONS
INSERT INTO private.erp_recovery_schema_seal(snapshot) SELECT private.erp_recovery_schema_snapshot();
COMMIT;
