BEGIN;
GRANT SELECT ON private.erp_permission_catalog,private.erp_role_permissions TO handyhub_membership_reviewer;
CREATE POLICY erp_membership_restore_catalog ON private.erp_permission_catalog FOR SELECT TO handyhub_membership_reviewer USING(true);
GRANT EXECUTE ON FUNCTION private.erp_staff_active(uuid,uuid) TO handyhub_membership_reviewer;
CREATE POLICY erp_membership_restore_permissions ON private.erp_role_permissions FOR SELECT TO handyhub_membership_reviewer
 USING(private.erp_can(tenant_id,'employees.update'));
GRANT SELECT(tenant_id,id,version),UPDATE(version) ON public.erp_employees TO handyhub_membership_reviewer;
CREATE POLICY erp_membership_restore_employee ON public.erp_employees FOR SELECT TO handyhub_membership_reviewer
 USING(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_membership_restore_employee_lock ON public.erp_employees FOR UPDATE TO handyhub_membership_reviewer
 USING(private.erp_can(tenant_id,'employees.update')) WITH CHECK(private.erp_can(tenant_id,'employees.update'));

-- A revoked association cannot be silently relinked during Owner review/restoration.
CREATE FUNCTION private.erp_guard_revoked_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM private.erp_membership_revocations r WHERE r.is_revoked AND
   ((r.tenant_id,r.user_id)=(NEW.tenant_id,NEW.auth_user_id) OR
    (TG_OP='UPDATE' AND (r.tenant_id,r.user_id)=(OLD.tenant_id,OLD.auth_user_id)))) THEN
   RAISE EXCEPTION 'MEMBERSHIP_REVOKED' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erp_guard_revoked_link() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER erp_guard_revoked_link BEFORE INSERT OR UPDATE ON private.erp_employee_auth_links
 FOR EACH ROW EXECUTE FUNCTION private.erp_guard_revoked_link();
-- DELETE also must not invalidate a revoked identity review.
CREATE FUNCTION private.erp_guard_revoked_link_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM private.erp_membership_revocations r WHERE r.is_revoked
   AND (r.tenant_id,r.user_id)=(OLD.tenant_id,OLD.auth_user_id)) THEN
   RAISE EXCEPTION 'MEMBERSHIP_REVOKED' USING ERRCODE='42501'; END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.erp_guard_revoked_link_delete() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER erp_guard_revoked_link_delete BEFORE DELETE ON private.erp_employee_auth_links
 FOR EACH ROW EXECUTE FUNCTION private.erp_guard_revoked_link_delete();

CREATE FUNCTION public.erp_restore_membership(p_tenant uuid,p_user uuid,p_expected_revision bigint,
 p_confirm boolean,p_permissions text[],p_expected_employee uuid)
RETURNS TABLE(user_id uuid,is_active boolean,activity_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_role text; current_active boolean; current_revision bigint; employee uuid;
 saved_revision bigint; revoked boolean; restore_allowed boolean; next_revision bigint;
BEGIN
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
REVOKE ALL ON FUNCTION public.erp_restore_membership(uuid,uuid,bigint,boolean,text[],uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT CREATE ON SCHEMA public TO handyhub_membership_reviewer;
ALTER FUNCTION public.erp_restore_membership(uuid,uuid,bigint,boolean,text[],uuid) OWNER TO handyhub_membership_reviewer;
REVOKE CREATE ON SCHEMA public FROM handyhub_membership_reviewer;
GRANT EXECUTE ON FUNCTION public.erp_restore_membership(uuid,uuid,bigint,boolean,text[],uuid) TO authenticated;

-- Explicit restoration ceiling intersects the CURRENT role grants; never revives old grants.
CREATE OR REPLACE FUNCTION private.erp_can(p_tenant uuid,p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.erp_runtime_available() AND EXISTS (
  SELECT 1 FROM public.tenant_memberships m JOIN public.tenants t ON t.id=m.tenant_id
  CROSS JOIN private.erp_permission_catalog c
  WHERE m.tenant_id=p_tenant AND m.user_id=(SELECT auth.uid()) AND m.is_active
   AND t.status='Ativo' AND c.permission=p_permission
   AND NOT EXISTS(SELECT 1 FROM private.erp_membership_revocations r WHERE r.tenant_id=m.tenant_id AND r.user_id=m.user_id
     AND (r.is_revoked OR NOT (p_permission=ANY(r.permissions))))
   AND NOT EXISTS(SELECT 1 FROM private.erp_employee_auth_links l JOIN private.erp_employee_lifecycle s
     ON (s.tenant_id,s.employee_id)=(l.tenant_id,l.employee_id)
     WHERE l.tenant_id=m.tenant_id AND l.auth_user_id=m.user_id AND NOT s.is_active)
   AND (m.role='owner' OR (m.role=ANY(c.delegable_to) AND EXISTS(
    SELECT 1 FROM private.erp_role_permissions g WHERE g.tenant_id=m.tenant_id AND g.role=m.role AND g.permission=c.permission)))
 );
$$;
-- Legacy JSON cannot respect field/permission ceilings. Keep it closed for reviewed targets.
CREATE FUNCTION private.erp_legacy_membership_unrestricted(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.is_platform_admin() OR NOT EXISTS(SELECT 1 FROM private.erp_membership_revocations r
  WHERE r.tenant_id=t AND r.user_id=(SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION private.erp_legacy_membership_unrestricted(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.erp_legacy_membership_unrestricted(uuid) TO authenticated;
CREATE POLICY tenant_data_membership_ceiling ON public.tenant_data AS RESTRICTIVE FOR ALL TO authenticated
 USING(private.erp_legacy_membership_unrestricted(tenant_id)) WITH CHECK(private.erp_legacy_membership_unrestricted(tenant_id));
COMMIT;
