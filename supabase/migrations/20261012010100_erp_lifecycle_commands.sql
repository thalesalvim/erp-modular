BEGIN;
CREATE FUNCTION public.erp_set_employee_active(p_tenant uuid,p_employee uuid,p_expected_version bigint,
  p_is_active boolean,p_reason text)
RETURNS TABLE(record_id uuid,version bigint,is_active boolean,membership_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_version bigint; v_active boolean; v_user uuid; v_role text; v_member_active boolean;
  v_before_member boolean; v_member_revision bigint; v_saved private.erp_employee_lifecycle%ROWTYPE;
  v_revoked bigint; v_restore_member boolean:=false;
BEGIN
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
REVOKE ALL ON FUNCTION public.erp_set_employee_active(uuid,uuid,bigint,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT CREATE ON SCHEMA public TO handyhub_lifecycle_operator;
ALTER FUNCTION public.erp_set_employee_active(uuid,uuid,bigint,boolean,text) OWNER TO handyhub_lifecycle_operator;
REVOKE CREATE ON SCHEMA public FROM handyhub_lifecycle_operator;
GRANT EXECUTE ON FUNCTION public.erp_set_employee_active(uuid,uuid,bigint,boolean,text) TO authenticated;

-- Existing trusted membership upserts/invite paths must not reopen a disabled
-- collaborator. No API changes or bypass parameter; metadata is authoritative.
CREATE FUNCTION private.erp_guard_member_activation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF NEW.is_active AND EXISTS (
    SELECT 1 FROM private.erp_employee_auth_links l JOIN private.erp_employee_lifecycle s
      ON (s.tenant_id,s.employee_id)=(l.tenant_id,l.employee_id)
    WHERE l.tenant_id=NEW.tenant_id AND l.auth_user_id=NEW.user_id AND NOT s.is_active
  ) THEN RAISE EXCEPTION 'EMPLOYEE_INACTIVE' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erp_guard_member_activation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER erp_guard_member_activation BEFORE INSERT OR UPDATE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_member_activation();

CREATE FUNCTION private.erp_guard_new_staff_operation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE staff uuid;
BEGIN
  IF TG_TABLE_NAME='erp_sales' THEN staff:=NEW.seller_employee_id;
  ELSE staff:=NEW.responsible_employee_id; END IF;
  IF staff IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.erp_employees e WHERE e.tenant_id=NEW.tenant_id AND e.id=staff FOR SHARE;
  IF NOT FOUND OR NOT private.erp_staff_active(NEW.tenant_id,staff) THEN
    RAISE EXCEPTION 'EMPLOYEE_INACTIVE_OR_UNAUTHORIZED' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erp_guard_new_staff_operation() FROM PUBLIC,anon,authenticated,service_role;
GRANT CREATE ON SCHEMA private TO handyhub_lifecycle_operator;
ALTER FUNCTION private.erp_guard_new_staff_operation() OWNER TO handyhub_lifecycle_operator;
REVOKE CREATE ON SCHEMA private FROM handyhub_lifecycle_operator;
CREATE TRIGGER erp_guard_new_staff_operation BEFORE INSERT ON public.erp_sales
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_new_staff_operation();
CREATE TRIGGER erp_guard_new_staff_operation BEFORE INSERT ON public.erp_attendances
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_new_staff_operation();
CREATE TRIGGER erp_guard_new_staff_operation BEFORE INSERT ON public.erp_appointments
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_new_staff_operation();

CREATE FUNCTION private.erp_guard_staff_link() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  -- Trusted provisioning must serialize with lifecycle changes, including a moved link.
  IF TG_OP='UPDATE' THEN
    PERFORM e.id FROM public.erp_employees e WHERE (e.tenant_id,e.id) IN
      ((OLD.tenant_id,OLD.employee_id),(NEW.tenant_id,NEW.employee_id)) ORDER BY e.tenant_id,e.id FOR SHARE;
  ELSE
    PERFORM 1 FROM public.erp_employees e WHERE e.tenant_id=NEW.tenant_id AND e.id=NEW.employee_id FOR SHARE;
  END IF;
  IF NOT private.erp_staff_active(NEW.tenant_id,NEW.employee_id) THEN
    RAISE EXCEPTION 'EMPLOYEE_INACTIVE' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erp_guard_staff_link() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER erp_guard_staff_link BEFORE INSERT OR UPDATE ON private.erp_employee_auth_links
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_staff_link();

CREATE FUNCTION private.erp_require_runtime() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT private.erp_runtime_available() THEN RAISE EXCEPTION 'ERP_MAINTENANCE' USING ERRCODE='55000'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.erp_require_runtime() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND ((n.nspname='public' AND c.relname LIKE 'erp_%') OR
      (n.nspname='private' AND c.relname=ANY(ARRAY['erp_policy_state','erp_role_permissions','erp_permission_audit',
        'erp_employee_lifecycle','erp_employee_lifecycle_audit','erp_history_postings','erp_employee_auth_links','erp_customer_assignments'])))
  LOOP
    EXECUTE format('CREATE TRIGGER erp_require_runtime BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION private.erp_require_runtime()',t.nspname,t.relname);
  END LOOP;
END $$;
CREATE FUNCTION private.erp_lifecycle_audit_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE' USING ERRCODE='55000';
END $$;
REVOKE ALL ON FUNCTION private.erp_lifecycle_audit_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER erp_lifecycle_audit_immutable BEFORE UPDATE OR DELETE ON private.erp_employee_lifecycle_audit
  FOR EACH ROW EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();
CREATE TRIGGER erp_lifecycle_audit_no_truncate BEFORE TRUNCATE ON private.erp_employee_lifecycle_audit
  FOR EACH STATEMENT EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();
CREATE TRIGGER erp_recovery_events_immutable BEFORE UPDATE OR DELETE ON private.erp_recovery_events
  FOR EACH ROW EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();
CREATE TRIGGER erp_recovery_events_no_truncate BEFORE TRUNCATE ON private.erp_recovery_events
  FOR EACH STATEMENT EXECUTE FUNCTION private.erp_lifecycle_audit_immutable();

CREATE FUNCTION private.erp_assert_recovery_integrity() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF current_user IN ('anon','authenticated','service_role','authenticator') OR NOT EXISTS
    (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'TRUSTED_DATABASE_OPERATOR_REQUIRED' USING ERRCODE='42501';
  END IF;
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
COMMIT;
