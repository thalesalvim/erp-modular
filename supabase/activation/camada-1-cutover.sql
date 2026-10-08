-- NOT A MIGRATION: intentionally excluded from automatic `supabase db push`.
-- Apply only after every application/Auth prerequisite in docs/camada-1-cutover.md.
-- The operator must explicitly SET handyhub.cutover_ready = 'yes' in this session.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.tenants, public.tenant_data, public.companies,
  public.tenant_memberships, public.platform_admins IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF current_setting('handyhub.cutover_ready', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Cutover requires an explicit operator readiness acknowledgement';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins a JOIN auth.users u ON u.id = a.user_id) THEN
    RAISE EXCEPTION 'Provision a verified platform administrator before cutover';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tenants t WHERE NOT EXISTS (
      SELECT 1 FROM public.tenant_memberships m JOIN auth.users u ON u.id = m.user_id
      WHERE m.tenant_id = t.id AND m.role = 'owner' AND m.is_active
    )
  ) THEN
    RAISE EXCEPTION 'Every tenant must have an active Auth owner before cutover';
  END IF;
END
$$;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_data FORCE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.tenants, public.tenant_data, public.companies
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.companies_id_seq FROM PUBLIC, anon, authenticated;

-- Legacy credentials and invoices are inaccessible to direct browser queries.
GRANT SELECT (id, slug, company_name, owner_name, owner_email, plan_name, status,
  primary_color, logo_type, logo_icon, logo_url, monthly_fee, due_day,
  allowed_modules, created_at) ON public.tenants TO authenticated;
GRANT INSERT (slug, company_name, owner_name, owner_email, plan_name, status,
  primary_color, logo_type, logo_icon, logo_url, monthly_fee, due_day,
  allowed_modules) ON public.tenants TO authenticated;
-- Even an owner cannot modify platform subscription/status or the tenant identity.
GRANT UPDATE (company_name, owner_name, owner_email, primary_color,
  logo_type, logo_icon, logo_url) ON public.tenants TO authenticated;
GRANT DELETE ON public.tenants TO authenticated;

GRANT SELECT, INSERT, DELETE ON public.tenant_data TO authenticated;
-- Routing columns are included for legacy upsert syntax; the trigger prevents transfer.
GRANT UPDATE (tenant_id, tenant_slug, data_key, payload, updated_at)
  ON public.tenant_data TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT USAGE ON SEQUENCE public.companies_id_seq TO authenticated;

-- New objects must receive deliberate grants in their own reviewed migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
COMMIT;
