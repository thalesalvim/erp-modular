-- Local Phase 2A lifecycle metadata. No Auth deletion, history rewrite or backfill.
BEGIN;
ALTER TABLE public.tenant_memberships ADD COLUMN activity_revision bigint NOT NULL DEFAULT 1 CHECK (activity_revision>0);
CREATE FUNCTION private.erp_membership_activity_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  NEW.activity_revision:=OLD.activity_revision+1;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erp_membership_activity_revision() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER erp_membership_activity_revision BEFORE UPDATE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION private.erp_membership_activity_revision();

CREATE TABLE private.erp_runtime_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  maintenance boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0)
);
INSERT INTO private.erp_runtime_control(singleton) VALUES(true);
CREATE TABLE private.erp_employee_lifecycle (
  tenant_id uuid NOT NULL, employee_id uuid NOT NULL,
  is_active boolean NOT NULL,
  linked_user_id uuid,
  revoked_membership_revision bigint CHECK (revoked_membership_revision>0),
  PRIMARY KEY(tenant_id,employee_id),
  FOREIGN KEY(tenant_id,employee_id) REFERENCES public.erp_employees(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,linked_user_id) REFERENCES public.tenant_memberships(tenant_id,user_id) ON DELETE RESTRICT,
  CHECK (revoked_membership_revision IS NULL OR (NOT is_active AND linked_user_id IS NOT NULL))
);
CREATE TABLE private.erp_employee_lifecycle_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, employee_id uuid NOT NULL,
  actor_user_id uuid NOT NULL, linked_user_id uuid,
  previous_active boolean NOT NULL, next_active boolean NOT NULL,
  previous_version bigint NOT NULL, next_version bigint NOT NULL CHECK (next_version=previous_version+1),
  membership_was_active boolean, membership_is_active boolean,
  reason text NOT NULL CHECK(reason IN ('offboarding','temporary_leave','authorized_return','correction')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,employee_id) REFERENCES public.erp_employees(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,actor_user_id) REFERENCES public.tenant_memberships(tenant_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,linked_user_id) REFERENCES public.tenant_memberships(tenant_id,user_id) ON DELETE RESTRICT
);
CREATE TABLE private.erp_recovery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), maintenance boolean NOT NULL,
  revision bigint NOT NULL CHECK(revision>=0), operator_role text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON private.erp_runtime_control,private.erp_employee_lifecycle,
  private.erp_employee_lifecycle_audit,private.erp_recovery_events FROM PUBLIC,anon,authenticated,service_role;
-- Trusted metadata helpers deliberately own these tables; no FORCE/recursive policies.
ALTER TABLE private.erp_runtime_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.erp_employee_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.erp_employee_lifecycle_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.erp_recovery_events ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION private.erp_runtime_available() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM private.erp_runtime_control r WHERE r.singleton AND NOT r.maintenance);
$$;
CREATE FUNCTION private.erp_staff_active(t uuid,e uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT t IS NOT NULL AND e IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM private.erp_employee_lifecycle s WHERE s.tenant_id=t AND s.employee_id=e AND NOT s.is_active);
$$;
REVOKE ALL ON FUNCTION private.erp_runtime_available(),private.erp_staff_active(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.erp_can(p_tenant uuid,p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.erp_runtime_available() AND EXISTS (
    SELECT 1 FROM public.tenant_memberships m JOIN public.tenants t ON t.id=m.tenant_id
    CROSS JOIN private.erp_permission_catalog c
    WHERE m.tenant_id=p_tenant AND m.user_id=(SELECT auth.uid()) AND m.is_active
      AND t.status='Ativo' AND c.permission=p_permission
      AND NOT EXISTS (SELECT 1 FROM private.erp_employee_auth_links l
        JOIN private.erp_employee_lifecycle s ON (s.tenant_id,s.employee_id)=(l.tenant_id,l.employee_id)
        WHERE l.tenant_id=m.tenant_id AND l.auth_user_id=m.user_id AND NOT s.is_active)
      AND (m.role='owner' OR (m.role=ANY(c.delegable_to) AND EXISTS
        (SELECT 1 FROM private.erp_role_permissions g WHERE g.tenant_id=m.tenant_id AND g.role=m.role AND g.permission=c.permission)))
  );
$$;
CREATE OR REPLACE FUNCTION private.erp_is_self(p_tenant uuid,p_employee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.erp_runtime_available() AND private.erp_staff_active(p_tenant,p_employee) AND EXISTS (
    SELECT 1 FROM private.erp_employee_auth_links l
    JOIN public.tenant_memberships m ON m.tenant_id=l.tenant_id AND m.user_id=l.auth_user_id
    JOIN public.tenants t ON t.id=m.tenant_id
    WHERE l.tenant_id=p_tenant AND l.employee_id=p_employee AND l.auth_user_id=(SELECT auth.uid())
      AND m.is_active AND t.status='Ativo'
  );
$$;
CREATE OR REPLACE FUNCTION private.has_tenant_role(requested_tenant_id uuid,allowed_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.erp_runtime_available() AND EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.tenant_id=requested_tenant_id AND m.user_id=(SELECT auth.uid()) AND m.is_active AND m.role=ANY(allowed_roles)
      AND NOT EXISTS (SELECT 1 FROM private.erp_employee_auth_links l
        JOIN private.erp_employee_lifecycle s ON (s.tenant_id,s.employee_id)=(l.tenant_id,l.employee_id)
        WHERE l.tenant_id=m.tenant_id AND l.auth_user_id=m.user_id AND NOT s.is_active)
  );
$$;

CREATE ROLE handyhub_lifecycle_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,private,auth TO handyhub_lifecycle_operator;
GRANT EXECUTE ON FUNCTION private.erp_can(uuid,text),private.erp_staff_active(uuid,uuid) TO handyhub_lifecycle_operator;
GRANT SELECT (tenant_id,id,version), UPDATE(version) ON public.erp_employees TO handyhub_lifecycle_operator;
GRANT SELECT (tenant_id,user_id,role,is_active,activity_revision), UPDATE(is_active)
  ON public.tenant_memberships TO handyhub_lifecycle_operator;
GRANT SELECT ON private.erp_employee_auth_links,private.erp_employee_lifecycle TO handyhub_lifecycle_operator;
GRANT INSERT,UPDATE ON private.erp_employee_lifecycle TO handyhub_lifecycle_operator;
GRANT INSERT ON private.erp_employee_lifecycle_audit TO handyhub_lifecycle_operator;
CREATE POLICY erp_lifecycle_read ON public.erp_employees FOR SELECT TO handyhub_lifecycle_operator
  USING(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_lifecycle_update ON public.erp_employees FOR UPDATE TO handyhub_lifecycle_operator
  USING(private.erp_can(tenant_id,'employees.update')) WITH CHECK(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_lifecycle_read ON public.tenant_memberships FOR SELECT TO handyhub_lifecycle_operator
  USING(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_lifecycle_update ON public.tenant_memberships FOR UPDATE TO handyhub_lifecycle_operator
  USING(private.erp_can(tenant_id,'employees.update')) WITH CHECK(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_lifecycle_read ON private.erp_employee_auth_links FOR SELECT TO handyhub_lifecycle_operator
  USING(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_lifecycle_owner ON private.erp_employee_lifecycle FOR ALL TO handyhub_lifecycle_operator
  USING(private.erp_can(tenant_id,'employees.update')) WITH CHECK(private.erp_can(tenant_id,'employees.update'));
CREATE POLICY erp_lifecycle_audit_insert ON private.erp_employee_lifecycle_audit FOR INSERT TO handyhub_lifecycle_operator
  WITH CHECK(actor_user_id=(SELECT auth.uid()) AND private.erp_can(tenant_id,'employees.update'));
COMMIT;
