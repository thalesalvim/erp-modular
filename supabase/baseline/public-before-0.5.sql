-- Public application schema observed on handyhub-db, 2026-10-07.
-- LOCAL RECONSTRUCTION ONLY. Never apply this baseline to the existing project.
-- Supabase-managed schemas, secrets and business rows are deliberately excluded.
CREATE TABLE public.companies (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  company_name text NOT NULL,
  owner_name text,
  owner_email text,
  plan_name text DEFAULT 'Pro',
  status text DEFAULT 'Ativo',
  primary_color text DEFAULT 'pink',
  logo_type text DEFAULT 'icon',
  logo_icon text DEFAULT 'scissors',
  logo_url text,
  monthly_fee numeric DEFAULT 149.90,
  due_day integer DEFAULT 10,
  logins jsonb DEFAULT '[]'::jsonb,
  allowed_modules jsonb DEFAULT '{}'::jsonb,
  invoices jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.tenant_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_slug text NOT NULL,
  data_key text NOT NULL,
  payload jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT tenant_data_tenant_slug_data_key_key UNIQUE (tenant_slug, data_key)
);

-- Reproduce the unsafe starting grants for meaningful before/after tests.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.tenants, public.tenant_data, public.companies
  TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.companies_id_seq TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES
  TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS
  TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES
  TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
