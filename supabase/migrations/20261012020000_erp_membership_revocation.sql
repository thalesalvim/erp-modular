-- Explicit Owner review/revocation; no automatic association, activation or backfill.
BEGIN;
CREATE TABLE private.erp_membership_revocations (
  tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  is_revoked boolean NOT NULL DEFAULT true,
  restore_allowed boolean NOT NULL DEFAULT false,
  revoked_revision bigint NOT NULL CHECK(revoked_revision>0),
  permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  PRIMARY KEY(tenant_id,user_id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES public.tenant_memberships(tenant_id,user_id) ON DELETE RESTRICT
);
CREATE TABLE private.erp_membership_revocation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  actor_user_id uuid NOT NULL, previous_active boolean NOT NULL,
  action text NOT NULL DEFAULT 'revoke' CHECK(action IN ('revoke','restore')),
  next_active boolean NOT NULL DEFAULT false,
  permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  CHECK ((action='revoke' AND NOT next_active) OR (action='restore' AND next_active)),
  previous_revision bigint NOT NULL, next_revision bigint NOT NULL CHECK(next_revision=previous_revision+1),
  reason text NOT NULL CHECK(reason IN ('identity_review','offboarding','access_removed','authorized_restore')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,user_id) REFERENCES public.tenant_memberships(tenant_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,actor_user_id) REFERENCES public.tenant_memberships(tenant_id,user_id) ON DELETE RESTRICT
);
REVOKE ALL ON private.erp_membership_revocations,private.erp_membership_revocation_audit FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.erp_membership_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.erp_membership_revocation_audit ENABLE ROW LEVEL SECURITY;
CREATE ROLE handyhub_membership_reviewer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,private,auth TO handyhub_membership_reviewer;
GRANT EXECUTE ON FUNCTION private.erp_can(uuid,text) TO handyhub_membership_reviewer;
GRANT SELECT(tenant_id,user_id,role,is_active,activity_revision),UPDATE(is_active) ON public.tenant_memberships TO handyhub_membership_reviewer;
GRANT SELECT ON private.erp_employee_auth_links TO handyhub_membership_reviewer;
GRANT SELECT,INSERT,UPDATE(is_revoked,revoked_revision,restore_allowed,permissions) ON private.erp_membership_revocations TO handyhub_membership_reviewer;
GRANT INSERT ON private.erp_membership_revocation_audit TO handyhub_membership_reviewer;
CREATE POLICY erp_membership_review ON public.tenant_memberships FOR SELECT TO handyhub_membership_reviewer
  USING(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_membership_revoke ON public.tenant_memberships FOR UPDATE TO handyhub_membership_reviewer
  USING(private.erp_can(tenant_id,'employees.update')) WITH CHECK(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_membership_review ON private.erp_employee_auth_links FOR SELECT TO handyhub_membership_reviewer
  USING(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_membership_revoke ON private.erp_membership_revocations FOR ALL TO handyhub_membership_reviewer
  USING(private.erp_can(tenant_id,'employees.update')) WITH CHECK(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_membership_audit ON private.erp_membership_revocation_audit FOR INSERT TO handyhub_membership_reviewer
  WITH CHECK(actor_user_id=(SELECT auth.uid()) AND private.erp_can(tenant_id,'employees.update'));

CREATE FUNCTION public.erp_review_memberships(p_tenant uuid)
RETURNS TABLE(user_id uuid,role text,is_active boolean,activity_revision bigint,employee_id uuid,is_revoked boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF NOT private.erp_can(p_tenant,'employees.update') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT m.user_id,m.role,m.is_active,m.activity_revision,l.employee_id,coalesce(r.is_revoked,false)
    FROM public.tenant_memberships m LEFT JOIN private.erp_employee_auth_links l
      ON (l.tenant_id,l.auth_user_id)=(m.tenant_id,m.user_id)
    LEFT JOIN private.erp_membership_revocations r ON (r.tenant_id,r.user_id)=(m.tenant_id,m.user_id)
    WHERE m.tenant_id=p_tenant ORDER BY m.user_id;
END $$;
CREATE FUNCTION public.erp_revoke_membership(p_tenant uuid,p_user uuid,p_expected_revision bigint,p_reason text)
RETURNS TABLE(user_id uuid,is_active boolean,activity_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_role text; old_active boolean; old_revision bigint; next_revision bigint;
BEGIN
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
REVOKE ALL ON FUNCTION public.erp_review_memberships(uuid),public.erp_revoke_membership(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT CREATE ON SCHEMA public TO handyhub_membership_reviewer;
ALTER FUNCTION public.erp_review_memberships(uuid) OWNER TO handyhub_membership_reviewer;
ALTER FUNCTION public.erp_revoke_membership(uuid,uuid,bigint,text) OWNER TO handyhub_membership_reviewer;
REVOKE CREATE ON SCHEMA public FROM handyhub_membership_reviewer;
GRANT EXECUTE ON FUNCTION public.erp_review_memberships(uuid),public.erp_revoke_membership(uuid,uuid,bigint,text) TO authenticated;

-- Trusted upserts and lifecycle restoration cannot silently undo explicit revocation.
CREATE FUNCTION private.erp_guard_revoked_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF NEW.is_active AND EXISTS(SELECT 1 FROM private.erp_membership_revocations r
    WHERE (r.tenant_id,r.user_id)=(NEW.tenant_id,NEW.user_id) AND r.is_revoked) THEN
    RAISE EXCEPTION 'MEMBERSHIP_REVOKED' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erp_guard_revoked_membership() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER erp_guard_revoked_membership BEFORE INSERT OR UPDATE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_revoked_membership();
CREATE TRIGGER erp_require_runtime BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON private.erp_membership_revocations
  FOR EACH STATEMENT EXECUTE FUNCTION private.erp_require_runtime();
CREATE TRIGGER erp_require_runtime BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON private.erp_membership_revocation_audit
  FOR EACH STATEMENT EXECUTE FUNCTION private.erp_require_runtime();
CREATE TRIGGER erp_membership_audit_immutable BEFORE UPDATE OR DELETE ON private.erp_membership_revocation_audit
  FOR EACH ROW EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();
CREATE TRIGGER erp_membership_audit_no_truncate BEFORE TRUNCATE ON private.erp_membership_revocation_audit
  FOR EACH STATEMENT EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();
COMMIT;
