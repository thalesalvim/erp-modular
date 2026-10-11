-- M3: minimal operational names through an own-scoped, read-only projection.
-- No changes to authenticated base-table policies, legacy JSON or write commands.
BEGIN;

-- Do not silently reuse a pre-existing capability role with unknown privileges.
CREATE ROLE handyhub_own_agenda_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,private,auth TO handyhub_own_agenda_reader;
GRANT EXECUTE ON FUNCTION private.erp_can(uuid,text), private.erp_is_self(uuid,uuid)
  TO handyhub_own_agenda_reader;
GRANT SELECT (tenant_id,id,customer_id,service_id,responsible_employee_id,occurred_on,occurred_at,status)
  ON public.erp_appointments TO handyhub_own_agenda_reader;
GRANT SELECT (tenant_id,id,name) ON public.erp_customers,public.erp_services TO handyhub_own_agenda_reader;

-- All three tables keep FORCE RLS. The role neither owns tables nor bypasses RLS.
-- Customer/service policies depend on appointments; the appointment policy only
-- depends on private identity helpers, so there is no recursive policy join.
CREATE POLICY erp_own_agenda_projection ON public.erp_appointments
  FOR SELECT TO handyhub_own_agenda_reader
  USING (private.erp_can(tenant_id,'appointments.read_own')
    AND private.erp_is_self(tenant_id,responsible_employee_id));

CREATE POLICY erp_own_agenda_customer_name ON public.erp_customers
  FOR SELECT TO handyhub_own_agenda_reader USING (EXISTS (
    SELECT 1 FROM public.erp_appointments a
    WHERE a.tenant_id=erp_customers.tenant_id AND a.customer_id=erp_customers.id
      AND private.erp_can(a.tenant_id,'appointments.read_own')
      AND private.erp_is_self(a.tenant_id,a.responsible_employee_id)
  ));
CREATE POLICY erp_own_agenda_service_name ON public.erp_services
  FOR SELECT TO handyhub_own_agenda_reader USING (EXISTS (
    SELECT 1 FROM public.erp_appointments a
    WHERE a.tenant_id=erp_services.tenant_id AND a.service_id=erp_services.id
      AND private.erp_can(a.tenant_id,'appointments.read_own')
      AND private.erp_is_self(a.tenant_id,a.responsible_employee_id)
  ));

CREATE FUNCTION public.erp_read_own_appointments(p_tenant uuid)
RETURNS TABLE(id uuid, "date" text, "time" text, "clientName" text, "serviceName" text, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_tenant IS NULL OR NOT private.erp_can(p_tenant,'appointments.read_own') THEN
    RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  -- Fixed projection and UUID joins, never SELECT *, caller-supplied user/role,
  -- customer assignment, display names or a privileged operational credential.
  RETURN QUERY SELECT a.id,
    pg_catalog.to_char(a.occurred_on,'YYYY-MM-DD'),
    a.occurred_at::text,c.name,s.name,a.status
  FROM public.erp_appointments a
  JOIN public.erp_customers c ON c.tenant_id=a.tenant_id AND c.id=a.customer_id
  JOIN public.erp_services s ON s.tenant_id=a.tenant_id AND s.id=a.service_id
  WHERE a.tenant_id=p_tenant AND private.erp_is_self(a.tenant_id,a.responsible_employee_id)
  ORDER BY a.occurred_on,a.occurred_at,a.id;
END;
$$;
REVOKE ALL ON FUNCTION public.erp_read_own_appointments(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT CREATE ON SCHEMA public TO handyhub_own_agenda_reader;
ALTER FUNCTION public.erp_read_own_appointments(uuid) OWNER TO handyhub_own_agenda_reader;
REVOKE CREATE ON SCHEMA public FROM handyhub_own_agenda_reader;
GRANT EXECUTE ON FUNCTION public.erp_read_own_appointments(uuid) TO authenticated;
COMMENT ON FUNCTION public.erp_read_own_appointments(uuid) IS
  'Read-only appointments.read_own projection: id,date,time,clientName,serviceName,status. UUID-scoped, no catalog/financial grant implied.';
COMMIT;
