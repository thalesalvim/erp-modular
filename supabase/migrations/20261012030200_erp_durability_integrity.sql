-- Durability reference v2. Preserve v1; no reseal API or automatic SET LOGGED.
-- Apply under the same exclusive operator/DDL window as recovery. Transactional.
BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE private.erp_runtime_control IN ACCESS EXCLUSIVE MODE;
-- Refuse pre-existing drift against v1 before evolving reviewed definitions.
SELECT private.erp_assert_recovery_integrity();

CREATE TABLE private.erp_recovery_schema_seal_v2 (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object')
);
REVOKE ALL ON private.erp_recovery_schema_seal_v2 FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.erp_recovery_schema_seal_v2 ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER erp_schema_seal_immutable BEFORE UPDATE OR DELETE ON private.erp_recovery_schema_seal_v2
 FOR EACH ROW EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();
CREATE TRIGGER erp_schema_seal_no_truncate BEFORE TRUNCATE ON private.erp_recovery_schema_seal_v2
 FOR EACH STATEMENT EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();

CREATE FUNCTION private.erp_assert_durable_relations() RETURNS void
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
REVOKE ALL ON FUNCTION private.erp_assert_durable_relations() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.erp_recovery_schema_snapshot() RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH relations AS MATERIALIZED (
  SELECT c.*,n.nspname,format('%I.%I',n.nspname,c.relname) AS name FROM pg_class c
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','private') AND (c.relname LIKE 'erp\_%' ESCAPE '\'
    OR (n.nspname='public' AND c.relname IN ('tenant_memberships','tenant_data','tenants','platform_admins')))
    AND c.relkind IN ('r','p','v','m','f','S')
 ), objects AS (
  SELECT 'relation/'||r.name AS key,jsonb_build_array(r.relkind,r.relpersistence,r.relrowsecurity,r.relforcerowsecurity,
   pg_get_userbyid(r.relowner),CASE WHEN r.name<>'public.tenant_data' THEN
    (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(coalesce(r.relacl,acldefault(CASE WHEN r.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,r.relowner))) a)
   END) AS value FROM relations r
  UNION ALL
  SELECT 'relation-state/'||r.name,jsonb_build_array(r.relkind,r.relpersistence,r.relrowsecurity,r.relforcerowsecurity) FROM relations r
  UNION ALL
  SELECT 'relation-state/auth.users',jsonb_build_array(c.relkind,c.relpersistence)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users'
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

CREATE OR REPLACE FUNCTION private.erp_assert_recovery_schema() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE expected jsonb; actual jsonb; mismatch text;
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
  (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM private.erp_assert_reviewed_definitions();
 SELECT snapshot INTO expected FROM private.erp_recovery_schema_seal_v2 WHERE singleton;
 IF expected IS NULL THEN RAISE EXCEPTION 'RECOVERY_SCHEMA_SEAL_MISSING' USING ERRCODE='55000'; END IF;
 actual:=private.erp_recovery_schema_snapshot();
 SELECT coalesce(e.key,a.key) INTO mismatch FROM jsonb_each_text(expected) e FULL JOIN jsonb_each_text(actual) a USING(key)
  WHERE e.value IS DISTINCT FROM a.value ORDER BY coalesce(e.key,a.key) LIMIT 1;
 IF mismatch IS NOT NULL THEN
  RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: %',mismatch USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.erp_assert_recovery_schema() FROM PUBLIC,anon,authenticated,service_role;

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
 IF digest IS DISTINCT FROM '7d695927c797983162323c428e392491' THEN
  RAISE EXCEPTION 'RECOVERY_SCHEMA_DRIFT: RECOVERY_UNREVIEWED_SCHEMA' USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.erp_assert_reviewed_definitions() FROM PUBLIC,anon,authenticated,service_role;
-- BEGIN_EXPECTED_DEFINITIONS
DO $$ BEGIN PERFORM private.erp_assert_reviewed_definitions(); END $$;
-- END_EXPECTED_DEFINITIONS
INSERT INTO private.erp_recovery_schema_seal_v2(snapshot) SELECT private.erp_recovery_schema_snapshot();
SELECT private.erp_assert_recovery_integrity();
COMMIT;
