-- Create stable user-to-tenant and platform-admin identities.
-- RLS is enabled for these new tables in migration 003; no legacy app query
-- references either table.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE public.tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'employee')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT tenant_memberships_tenant_user_key UNIQUE (tenant_id, user_id)
);

CREATE INDEX tenant_memberships_user_active_idx
  ON public.tenant_memberships (user_id, tenant_id)
  WHERE is_active;
CREATE INDEX tenant_memberships_tenant_role_active_idx
  ON public.tenant_memberships (tenant_id, role)
  WHERE is_active;

COMMENT ON TABLE public.tenant_memberships IS
  'Trusted Auth user to tenant association. Populate only from a trusted onboarding path.';
COMMENT ON COLUMN public.tenant_memberships.role IS
  'Tenant role: owner, manager, or employee. Platform privileges live separately.';

CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'platform_admin'
    CHECK (role = 'platform_admin'),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.platform_admins IS
  'Platform administrators. Provision only from a trusted server-side operation.';

-- The current migration connection can alter defaults owned by postgres, but
-- cannot alter supabase_admin defaults. Revoke defaults for the role that
-- applies application migrations; explicit grants below protect these tables.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

REVOKE ALL ON public.tenant_memberships, public.platform_admins
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.tenant_memberships, public.platform_admins TO service_role;

COMMIT;
