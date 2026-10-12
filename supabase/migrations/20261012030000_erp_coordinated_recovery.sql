-- Explicit joint recovery; no Auth changes, guessed links, or administrative unblock.
BEGIN;
GRANT SELECT,UPDATE(is_active,revoked_membership_revision) ON private.erp_employee_lifecycle TO handyhub_membership_reviewer;
GRANT SELECT,INSERT ON private.erp_employee_lifecycle_audit TO handyhub_membership_reviewer;
GRANT SELECT ON private.erp_membership_revocation_audit TO handyhub_membership_reviewer;
CREATE POLICY erp_coordinated_lifecycle ON private.erp_employee_lifecycle FOR ALL TO handyhub_membership_reviewer
 USING(private.erp_can(tenant_id,'employees.update')) WITH CHECK(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_coordinated_lifecycle_read ON private.erp_employee_lifecycle_audit FOR SELECT TO handyhub_membership_reviewer
 USING(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_coordinated_lifecycle_audit ON private.erp_employee_lifecycle_audit FOR INSERT TO handyhub_membership_reviewer
 WITH CHECK(actor_user_id=(SELECT auth.uid()) AND private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_coordinated_revocation_read ON private.erp_membership_revocation_audit FOR SELECT TO handyhub_membership_reviewer
 USING(private.erp_can(tenant_id,'employees.update'));

CREATE FUNCTION public.erp_recover_employee_membership(p_tenant uuid,p_user uuid,p_employee uuid,
 p_expected_employee_version bigint,p_expected_membership_revision bigint,p_confirm boolean,p_permissions text[])
RETURNS TABLE(employee_id uuid,employee_version bigint,user_id uuid,activity_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_version bigint; v_revision bigint; v_role text; v_active boolean; v_link uuid;
 s private.erp_employee_lifecycle%ROWTYPE; r private.erp_membership_revocations%ROWTYPE;
 a private.erp_employee_lifecycle_audit%ROWTYPE; chain_length bigint;
BEGIN
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
REVOKE ALL ON FUNCTION public.erp_recover_employee_membership(uuid,uuid,uuid,bigint,bigint,boolean,text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT CREATE ON SCHEMA public TO handyhub_membership_reviewer;
ALTER FUNCTION public.erp_recover_employee_membership(uuid,uuid,uuid,bigint,bigint,boolean,text[]) OWNER TO handyhub_membership_reviewer;
REVOKE CREATE ON SCHEMA public FROM handyhub_membership_reviewer;
GRANT EXECUTE ON FUNCTION public.erp_recover_employee_membership(uuid,uuid,uuid,bigint,bigint,boolean,text[]) TO authenticated;
COMMIT;
