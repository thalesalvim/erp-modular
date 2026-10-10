-- Phase 2A: empty normalized domain tables; NO legacy copy, deletion or cutover.
BEGIN;

CREATE TABLE public.erp_customers (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE public.erp_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_customers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_customers FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_customer_contacts (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  phone text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_customers(tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_customer_contacts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_customer_contacts FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_customer_notes (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_customers(tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_customer_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_customer_notes FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_employees (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE public.erp_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_employees FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_employees FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_employee_private (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  phone text, email text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_employees(tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_employee_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_employee_private FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_employee_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_employee_schedules (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  employee_id uuid NOT NULL, day_index smallint NOT NULL CHECK (day_index BETWEEN 0 AND 6), is_working boolean NOT NULL, open_time time, close_time time, UNIQUE (tenant_id, employee_id, day_index), CHECK (NOT is_working OR (open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time)),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES public.erp_employees(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX erp_employee_schedules_employee_id_idx ON public.erp_employee_schedules(tenant_id, employee_id);
ALTER TABLE public.erp_employee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_employee_schedules FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_employee_schedules FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_professional_roles (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE public.erp_professional_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_professional_roles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_professional_roles FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_employee_roles (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  employee_id uuid NOT NULL, role_id uuid NOT NULL, UNIQUE (tenant_id, employee_id, role_id),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES public.erp_employees(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, role_id) REFERENCES public.erp_professional_roles(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX erp_employee_roles_employee_id_idx ON public.erp_employee_roles(tenant_id, employee_id);
CREATE INDEX erp_employee_roles_role_id_idx ON public.erp_employee_roles(tenant_id, role_id);
ALTER TABLE public.erp_employee_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_employee_roles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_employee_roles FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_products (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL, category text, price numeric(14,2) NOT NULL CHECK (price BETWEEN 0 AND 999999999999.99),
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE public.erp_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_products FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_products FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_product_costs (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  cost numeric(14,2) NOT NULL CHECK (cost BETWEEN 0 AND 999999999999.99),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_products(tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_product_costs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_product_costs FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_product_stock (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  initial_stock integer NOT NULL CHECK (initial_stock >= 0), min_stock integer NOT NULL CHECK (min_stock >= 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_products(tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_product_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_product_stock FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_product_stock FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_services (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL, category text, duration_minutes integer NOT NULL CHECK (duration_minutes > 0), price numeric(14,2) NOT NULL CHECK (price BETWEEN 0 AND 999999999999.99), assigned_role_id uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, assigned_role_id) REFERENCES public.erp_professional_roles(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX erp_services_assigned_role_id_idx ON public.erp_services(tenant_id, assigned_role_id);
ALTER TABLE public.erp_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_services FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_services FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_promotions (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL, duration text, discount_percent numeric(5,2) NOT NULL CHECK (discount_percent BETWEEN 0 AND 100), is_all_promo boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE public.erp_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_promotions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_promotions FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_promotion_targets (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  promotion_id uuid NOT NULL, product_id uuid, service_id uuid, CHECK ((product_id IS NULL) <> (service_id IS NULL)), UNIQUE (tenant_id, promotion_id, product_id), UNIQUE (tenant_id, promotion_id, service_id),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, promotion_id) REFERENCES public.erp_promotions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, product_id) REFERENCES public.erp_products(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, service_id) REFERENCES public.erp_services(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX erp_promotion_targets_promotion_id_idx ON public.erp_promotion_targets(tenant_id, promotion_id);
CREATE INDEX erp_promotion_targets_product_id_idx ON public.erp_promotion_targets(tenant_id, product_id);
CREATE INDEX erp_promotion_targets_service_id_idx ON public.erp_promotion_targets(tenant_id, service_id);
ALTER TABLE public.erp_promotion_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_promotion_targets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_promotion_targets FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_appointments (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  customer_id uuid NOT NULL, service_id uuid NOT NULL, responsible_employee_id uuid, occurred_on date NOT NULL, occurred_at time NOT NULL, status text NOT NULL CHECK (length(status) BETWEEN 1 AND 80),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES public.erp_customers(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, service_id) REFERENCES public.erp_services(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, responsible_employee_id) REFERENCES public.erp_employees(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX erp_appointments_customer_id_idx ON public.erp_appointments(tenant_id, customer_id);
CREATE INDEX erp_appointments_service_id_idx ON public.erp_appointments(tenant_id, service_id);
CREATE INDEX erp_appointments_responsible_employee_id_idx ON public.erp_appointments(tenant_id, responsible_employee_id);
ALTER TABLE public.erp_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_appointments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_appointments FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_attendances (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  customer_id uuid NOT NULL, service_id uuid NOT NULL, responsible_employee_id uuid, occurred_on date NOT NULL, occurred_at time NOT NULL, status text NOT NULL CHECK (length(status) BETWEEN 1 AND 80),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES public.erp_customers(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, service_id) REFERENCES public.erp_services(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, responsible_employee_id) REFERENCES public.erp_employees(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX erp_attendances_customer_id_idx ON public.erp_attendances(tenant_id, customer_id);
CREATE INDEX erp_attendances_service_id_idx ON public.erp_attendances(tenant_id, service_id);
CREATE INDEX erp_attendances_responsible_employee_id_idx ON public.erp_attendances(tenant_id, responsible_employee_id);
ALTER TABLE public.erp_attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_attendances FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_attendances FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_appointment_finance (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  price numeric(14,2) NOT NULL CHECK (price BETWEEN 0 AND 999999999999.99),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_appointments(tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_appointment_finance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_appointment_finance FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_appointment_finance FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_appointment_notes (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_appointments(tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_appointment_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_appointment_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_appointment_notes FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_attendance_finance (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  gross_value numeric(14,2) NOT NULL CHECK (gross_value BETWEEN 0 AND 999999999999.99), discount numeric(14,2) NOT NULL CHECK (discount BETWEEN 0 AND 999999999999.99), net_value numeric(14,2) NOT NULL CHECK (net_value BETWEEN 0 AND 999999999999.99), payment_method text NOT NULL, CHECK (discount <= gross_value AND net_value = gross_value - discount),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_attendances(tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_attendance_finance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_attendance_finance FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_attendance_finance FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_attendance_notes (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_attendances(tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_attendance_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_attendance_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_attendance_notes FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_sales (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  product_id uuid NOT NULL, seller_employee_id uuid, occurred_on date NOT NULL, quantity integer NOT NULL CHECK (quantity > 0), status text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES public.erp_products(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, seller_employee_id) REFERENCES public.erp_employees(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX erp_sales_product_id_idx ON public.erp_sales(tenant_id, product_id);
CREATE INDEX erp_sales_seller_employee_id_idx ON public.erp_sales(tenant_id, seller_employee_id);
ALTER TABLE public.erp_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sales FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_sales FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_sale_customers (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  customer_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_sales(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES public.erp_customers(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX erp_sale_customers_customer_id_idx ON public.erp_sale_customers(tenant_id, customer_id);
ALTER TABLE public.erp_sale_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sale_customers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_sale_customers FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_sale_finance (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price BETWEEN 0 AND 999999999999.99), total numeric(14,2) NOT NULL CHECK (total BETWEEN 0 AND 999999999999.99), payment_method text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_sales(tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_sale_finance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sale_finance FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_sale_finance FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_sale_notes (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, id) REFERENCES public.erp_sales(tenant_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_sale_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sale_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_sale_notes FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_stock_moves (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  product_id uuid NOT NULL, type text NOT NULL CHECK (type IN ('Entrada','Perda')), quantity integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES public.erp_products(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX erp_stock_moves_product_id_idx ON public.erp_stock_moves(tenant_id, product_id);
ALTER TABLE public.erp_stock_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_stock_moves FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_stock_moves FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.erp_expenses (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  occurred_on date NOT NULL, description text NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount BETWEEN 0 AND 999999999999.99), category text NOT NULL, is_recurrent boolean NOT NULL DEFAULT false, status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE public.erp_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_expenses FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_expenses FROM PUBLIC, anon, authenticated, service_role;

-- No public access to identity links or assignment edges. A missing link means
-- an employee has no Auth identity; names are never used to infer ownership.
CREATE TABLE private.erp_employee_auth_links (
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  auth_user_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, employee_id),
  UNIQUE (tenant_id, auth_user_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES public.erp_employees(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, auth_user_id) REFERENCES public.tenant_memberships(tenant_id,user_id) ON DELETE RESTRICT
);
CREATE TABLE private.erp_customer_assignments (
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, customer_id, employee_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES public.erp_customers(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, employee_id) REFERENCES public.erp_employees(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX erp_customer_assignments_employee_idx ON private.erp_customer_assignments(tenant_id,employee_id);
REVOKE ALL ON private.erp_employee_auth_links, private.erp_customer_assignments FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE private.erp_employee_auth_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.erp_customer_assignments ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE private.erp_employee_auth_links IS 'No client writes, including Owner. Trusted, separately authorized provisioning only. Null/unlinked employees never acquire personal access.';
COMMIT;
