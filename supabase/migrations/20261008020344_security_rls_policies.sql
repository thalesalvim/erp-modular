-- Prepare the eventual tenant isolation boundary.
-- Existing app-facing tables keep RLS disabled until the Camada 1 cutover;
-- policies on them are deliberately dormant. New identity tables are closed.
BEGIN;

CREATE FUNCTION private.has_tenant_role(
  requested_tenant_id uuid,
  allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships AS m
    WHERE m.tenant_id = requested_tenant_id
      AND m.user_id = (SELECT auth.uid())
      AND m.is_active
      AND m.role = ANY (allowed_roles)
  );
$function$;

CREATE FUNCTION private.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins AS a
    WHERE a.user_id = (SELECT auth.uid())
      AND a.role = 'platform_admin'
  );
$function$;

REVOKE ALL ON FUNCTION private.has_tenant_role(uuid, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_platform_admin()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_tenant_role(uuid, text[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_platform_admin()
  TO authenticated;

-- RLS is enabled on the new role tables, but not forced. The SECURITY DEFINER
-- helpers are owned by the migration role and must read memberships/admins
-- without invoking the same RLS policy recursively. Client roles still obey
-- these policies; the table owner is a trusted database role.
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_memberships_read_related
  ON public.tenant_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT private.has_tenant_role(tenant_id, ARRAY['owner']::text[]))
    OR (SELECT private.is_platform_admin())
  );

-- Policies for current public tables are ready but dormant until cutover.
CREATE POLICY tenants_read_members
  ON public.tenants
  FOR SELECT TO authenticated
  USING (
    (SELECT private.has_tenant_role(id, ARRAY['owner','manager','employee']::text[]))
    OR (SELECT private.is_platform_admin())
  );

CREATE POLICY tenants_insert_platform_admin
  ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_platform_admin()));

CREATE POLICY tenants_update_owner
  ON public.tenants
  FOR UPDATE TO authenticated
  USING (
    (SELECT private.has_tenant_role(id, ARRAY['owner']::text[]))
    OR (SELECT private.is_platform_admin())
  )
  WITH CHECK (
    (SELECT private.has_tenant_role(id, ARRAY['owner']::text[]))
    OR (SELECT private.is_platform_admin())
  );

CREATE POLICY tenants_delete_platform_admin
  ON public.tenants
  FOR DELETE TO authenticated
  USING ((SELECT private.is_platform_admin()));

CREATE POLICY tenant_data_read_members
  ON public.tenant_data
  FOR SELECT TO authenticated
  USING (
    (SELECT private.has_tenant_role(tenant_id, ARRAY['owner','manager','employee']::text[]))
    OR (SELECT private.is_platform_admin())
  );

CREATE POLICY tenant_data_insert_managers
  ON public.tenant_data
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.has_tenant_role(tenant_id, ARRAY['owner','manager']::text[]))
    OR (SELECT private.is_platform_admin())
  );

CREATE POLICY tenant_data_update_managers
  ON public.tenant_data
  FOR UPDATE TO authenticated
  USING (
    (SELECT private.has_tenant_role(tenant_id, ARRAY['owner','manager']::text[]))
    OR (SELECT private.is_platform_admin())
  )
  WITH CHECK (
    (SELECT private.has_tenant_role(tenant_id, ARRAY['owner','manager']::text[]))
    OR (SELECT private.is_platform_admin())
  );

CREATE POLICY tenant_data_delete_managers
  ON public.tenant_data
  FOR DELETE TO authenticated
  USING (
    (SELECT private.has_tenant_role(tenant_id, ARRAY['owner','manager']::text[]))
    OR (SELECT private.is_platform_admin())
  );

CREATE POLICY companies_read_members
  ON public.companies
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND (
      (SELECT private.has_tenant_role(tenant_id, ARRAY['owner','manager','employee']::text[]))
      OR (SELECT private.is_platform_admin())
    )
  );

CREATE POLICY companies_insert_managers
  ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IS NOT NULL
    AND (
      (SELECT private.has_tenant_role(tenant_id, ARRAY['owner','manager']::text[]))
      OR (SELECT private.is_platform_admin())
    )
  );

CREATE POLICY companies_update_managers
  ON public.companies
  FOR UPDATE TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND (
      (SELECT private.has_tenant_role(tenant_id, ARRAY['owner','manager']::text[]))
      OR (SELECT private.is_platform_admin())
    )
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND (
      (SELECT private.has_tenant_role(tenant_id, ARRAY['owner','manager']::text[]))
      OR (SELECT private.is_platform_admin())
    )
  );

CREATE POLICY companies_delete_managers
  ON public.companies
  FOR DELETE TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND (
      (SELECT private.has_tenant_role(tenant_id, ARRAY['owner','manager']::text[]))
      OR (SELECT private.is_platform_admin())
    )
  );

COMMIT;
