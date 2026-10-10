-- Phase 2A: additive permission storage. No legacy data or policies changed.
BEGIN;
CREATE TABLE private.erp_permission_catalog (
  permission text PRIMARY KEY,
  domain text NOT NULL,
  action text NOT NULL CHECK (action IN ('read','create','update','delete')),
  scope text NOT NULL CHECK (scope IN ('tenant','own','assigned')),
  fields text[] NOT NULL,
  delegable_to text[] NOT NULL CHECK (delegable_to <@ ARRAY['manager','employee']::text[])
);
INSERT INTO private.erp_permission_catalog VALUES
('customers.read', 'customers', 'read', 'tenant', ARRAY['id','name','phone']::text[], ARRAY['manager']::text[]),
('customers.read_assigned', 'customers', 'read', 'assigned', ARRAY['id','name']::text[], ARRAY['manager','employee']::text[]),
('customers.private_notes.read', 'customers', 'read', 'tenant', ARRAY['id','notes']::text[], ARRAY[]::text[]),
('employees.read', 'employees', 'read', 'tenant', ARRAY['id','name']::text[], ARRAY['manager']::text[]),
('employees.read_own', 'employees', 'read', 'own', ARRAY['id','name']::text[], ARRAY['manager','employee']::text[]),
('employees.private.read', 'employees', 'read', 'tenant', ARRAY['id','phone','email','authUserId']::text[], ARRAY[]::text[]),
('appointments.read', 'appointments', 'read', 'tenant', ARRAY['id','date','time','clientName','serviceName','professionalName','status']::text[], ARRAY['manager']::text[]),
('appointments.read_own', 'appointments', 'read', 'own', ARRAY['id','date','time','clientName','serviceName','status']::text[], ARRAY['manager','employee']::text[]),
('finance.appointments.read', 'appointments', 'read', 'tenant', ARRAY['id','price']::text[], ARRAY['manager']::text[]),
('appointments.private_notes.read', 'appointments', 'read', 'tenant', ARRAY['id','notes']::text[], ARRAY[]::text[]),
('attendances.read', 'attendances', 'read', 'tenant', ARRAY['id','date','time','clientName','serviceName','professionalName','status']::text[], ARRAY['manager']::text[]),
('attendances.read_own', 'attendances', 'read', 'own', ARRAY['id','date','time','clientName','serviceName','status']::text[], ARRAY['manager','employee']::text[]),
('attendances.private_notes.read', 'attendances', 'read', 'tenant', ARRAY['id','notes']::text[], ARRAY[]::text[]),
('finance.attendances.read', 'attendances', 'read', 'tenant', ARRAY['id','grossValue','discount','netValue','paymentMethod']::text[], ARRAY['manager']::text[]),
('sales.read', 'sales', 'read', 'tenant', ARRAY['id','date','clientName','productName','sellerName','quantity','status']::text[], ARRAY['manager']::text[]),
('sales.read_own', 'sales', 'read', 'own', ARRAY['id','date','productName','quantity','status']::text[], ARRAY['manager','employee']::text[]),
('sales.private_notes.read', 'sales', 'read', 'tenant', ARRAY['id','notes']::text[], ARRAY[]::text[]),
('finance.sales.read', 'sales', 'read', 'tenant', ARRAY['id','unitPrice','total','paymentMethod']::text[], ARRAY['manager']::text[]),
('products.read', 'products', 'read', 'tenant', ARRAY['id','name','category','price']::text[], ARRAY['manager','employee']::text[]),
('finance.products.cost.read', 'products', 'read', 'tenant', ARRAY['id','cost']::text[], ARRAY['manager']::text[]),
('products.stock.read', 'products', 'read', 'tenant', ARRAY['id','initialStock','minStock']::text[], ARRAY['manager']::text[]),
('stockMoves.read', 'stockMoves', 'read', 'tenant', ARRAY['id','productName','type','quantity']::text[], ARRAY['manager']::text[]),
('services.read', 'services', 'read', 'tenant', ARRAY['id','name','category','duration','price','assignedRole']::text[], ARRAY['manager','employee']::text[]),
('promotions.read', 'promotions', 'read', 'tenant', ARRAY['id','title','duration','discountPercent','isAllPromo','active']::text[], ARRAY['manager','employee']::text[]),
('finance.expenses.read', 'expenses', 'read', 'tenant', ARRAY['id','date','description','amount','category','isRecurrent','status']::text[], ARRAY['manager']::text[]),
('rolesList.read', 'rolesList', 'read', 'tenant', ARRAY['id','name']::text[], ARRAY['manager']::text[]),
('customers.create', 'customers', 'create', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('customers.update', 'customers', 'update', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('customers.delete', 'customers', 'delete', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('employees.create', 'employees', 'create', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('employees.update', 'employees', 'update', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('employees.delete', 'employees', 'delete', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('appointments.create', 'appointments', 'create', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('appointments.update', 'appointments', 'update', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('appointments.delete', 'appointments', 'delete', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('attendances.create', 'attendances', 'create', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('attendances.update', 'attendances', 'update', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('attendances.delete', 'attendances', 'delete', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('sales.create', 'sales', 'create', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('sales.update', 'sales', 'update', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('sales.delete', 'sales', 'delete', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('products.create', 'products', 'create', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('products.update', 'products', 'update', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('products.delete', 'products', 'delete', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('stockMoves.create', 'stockMoves', 'create', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('stockMoves.update', 'stockMoves', 'update', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('stockMoves.delete', 'stockMoves', 'delete', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('services.create', 'services', 'create', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('services.update', 'services', 'update', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('services.delete', 'services', 'delete', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('promotions.create', 'promotions', 'create', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('promotions.update', 'promotions', 'update', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('promotions.delete', 'promotions', 'delete', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('finance.expenses.create', 'expenses', 'create', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('finance.expenses.update', 'expenses', 'update', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('finance.expenses.delete', 'expenses', 'delete', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('rolesList.create', 'rolesList', 'create', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('rolesList.update', 'rolesList', 'update', 'tenant', ARRAY[]::text[], ARRAY[]::text[]),
('rolesList.delete', 'rolesList', 'delete', 'tenant', ARRAY[]::text[], ARRAY[]::text[]);

CREATE TABLE private.erp_policy_state (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE private.erp_role_permissions (
  tenant_id uuid NOT NULL REFERENCES private.erp_policy_state(tenant_id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('manager','employee')),
  permission text NOT NULL REFERENCES private.erp_permission_catalog(permission) ON DELETE RESTRICT,
  PRIMARY KEY (tenant_id, role, permission)
);
CREATE TABLE private.erp_permission_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES private.erp_policy_state(tenant_id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  target_role text NOT NULL CHECK (target_role IN ('manager','employee')),
  previous_permissions text[] NOT NULL,
  next_permissions text[] NOT NULL,
  revision bigint NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, revision)
);
CREATE INDEX erp_permission_audit_tenant_time ON private.erp_permission_audit(tenant_id, recorded_at);
REVOKE ALL ON private.erp_permission_catalog, private.erp_policy_state,
  private.erp_role_permissions, private.erp_permission_audit FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE private.erp_permission_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.erp_policy_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.erp_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.erp_permission_audit ENABLE ROW LEVEL SECURITY;

-- A permission is never inferred from modules, metadata, or platform_admin.
-- Authenticated has EXECUTE only; caller identity is always auth.uid().
CREATE FUNCTION private.erp_can(p_tenant uuid, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    JOIN public.tenants t ON t.id = m.tenant_id
    CROSS JOIN private.erp_permission_catalog c
    WHERE m.tenant_id = p_tenant AND m.user_id = (SELECT auth.uid())
      AND m.is_active AND t.status = 'Ativo' AND c.permission = p_permission
      AND (m.role = 'owner' OR (
        m.role = ANY(c.delegable_to) AND EXISTS (
          SELECT 1 FROM private.erp_role_permissions g
          WHERE g.tenant_id = m.tenant_id AND g.role = m.role AND g.permission = c.permission
        )
      ))
  );
$$;
REVOKE ALL ON FUNCTION private.erp_can(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.erp_can(uuid,text) TO authenticated;

-- Defense in depth: even trusted import code cannot store grants beyond ceilings.
CREATE FUNCTION private.erp_check_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.erp_permission_catalog c
    WHERE c.permission = NEW.permission AND NEW.role = ANY(c.delegable_to)) THEN
    RAISE EXCEPTION 'Permission exceeds role ceiling' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.erp_check_grant() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER erp_role_permissions_ceiling BEFORE INSERT OR UPDATE ON private.erp_role_permissions
  FOR EACH ROW EXECUTE FUNCTION private.erp_check_grant();

CREATE FUNCTION public.erp_set_role_permissions(
  p_tenant uuid, p_role text, p_permissions text[], p_expected_revision bigint
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text;
  v_revision bigint;
  v_before text[];
  v_next text[];
BEGIN
  -- Lock authoritative tenant and membership before configuring this tenant.
  PERFORM 1 FROM public.tenants WHERE id = p_tenant AND status = 'Ativo' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_role FROM public.tenant_memberships
    WHERE tenant_id = p_tenant AND user_id = (SELECT auth.uid()) AND is_active FOR SHARE;
  IF v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('manager','employee') OR p_permissions IS NULL
    OR p_expected_revision IS NULL OR p_expected_revision < 0
    OR cardinality(p_permissions) > 100 OR array_ndims(p_permissions) > 1 THEN
    RAISE EXCEPTION 'Invalid permission request' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_permissions) p WHERE p IS NULL OR NOT EXISTS (
    SELECT 1 FROM private.erp_permission_catalog c
    WHERE c.permission = p AND p_role = ANY(c.delegable_to)
  )) THEN RAISE EXCEPTION 'Permission exceeds role ceiling' USING ERRCODE = '42501'; END IF;

  INSERT INTO private.erp_policy_state(tenant_id) VALUES (p_tenant) ON CONFLICT DO NOTHING;
  SELECT revision INTO v_revision FROM private.erp_policy_state WHERE tenant_id = p_tenant FOR UPDATE;
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Policy revision conflict' USING ERRCODE = '40001';
  END IF;
  SELECT coalesce(array_agg(permission ORDER BY permission), ARRAY[]::text[]) INTO v_before
    FROM private.erp_role_permissions WHERE tenant_id = p_tenant AND role = p_role;
  SELECT coalesce(array_agg(DISTINCT p ORDER BY p), ARRAY[]::text[]) INTO v_next FROM unnest(p_permissions) p;
  DELETE FROM private.erp_role_permissions WHERE tenant_id = p_tenant AND role = p_role;
  INSERT INTO private.erp_role_permissions(tenant_id, role, permission)
    SELECT p_tenant, p_role, p FROM unnest(v_next) p;
  UPDATE private.erp_policy_state SET revision = revision + 1 WHERE tenant_id = p_tenant
    RETURNING revision INTO v_revision;
  INSERT INTO private.erp_permission_audit(tenant_id, actor_user_id, target_role,
    previous_permissions, next_permissions, revision)
    VALUES (p_tenant, auth.uid(), p_role, v_before, v_next, v_revision);
  RETURN v_revision;
END;
$$;
REVOKE ALL ON FUNCTION public.erp_set_role_permissions(uuid,text,text[],bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.erp_set_role_permissions(uuid,text,text[],bigint) TO authenticated;
COMMENT ON FUNCTION public.erp_set_role_permissions(uuid,text,text[],bigint) IS
  'Owner-only atomic role grant replacement, optimistic revision and secret-free audit. No membership/identity mutation.';
COMMIT;
