-- M1/M2: close unversioned client writes; product is the aggregate version root.
-- Additive migration only. No legacy JSON, data backfill, API or Auth changes.
BEGIN;

-- REVOKE at table level does NOT remove existing column-level INSERT/UPDATE.
-- Include columns explicitly; DELETE+INSERT must not allow an ABA/version reset.
DO $$
DECLARE t record; cols text;
BEGIN
  FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname = ANY(ARRAY[
      'erp_customers','erp_customer_contacts','erp_customer_notes','erp_employees',
      'erp_employee_private','erp_employee_schedules','erp_professional_roles','erp_employee_roles',
      'erp_products','erp_product_costs','erp_product_stock','erp_services','erp_promotions',
      'erp_promotion_targets','erp_appointments','erp_attendances','erp_appointment_finance',
      'erp_appointment_notes','erp_attendance_finance','erp_attendance_notes','erp_sales',
      'erp_sale_customers','erp_sale_finance','erp_sale_notes','erp_stock_moves','erp_expenses'])
  LOOP
    SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO cols
      FROM pg_attribute WHERE attrelid=t.oid AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated, service_role',t.relname);
    EXECUTE format('REVOKE INSERT (%s), UPDATE (%s) ON public.%I FROM PUBLIC, anon, authenticated, service_role',cols,cols,t.relname);
  END LOOP;
END;
$$;

-- Dedicated capability role, never granted to API roles. It owns no data tables,
-- cannot log in/bypass RLS and receives only the privileges used by this function.
-- A pre-existing name is a migration error, not a role to trust or silently reuse.
CREATE ROLE handyhub_product_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,private,auth TO handyhub_product_writer;
GRANT EXECUTE ON FUNCTION private.erp_can(uuid,text) TO handyhub_product_writer;
GRANT SELECT ON public.erp_products,public.erp_product_costs,public.erp_product_stock TO handyhub_product_writer;
GRANT UPDATE (name,category,price) ON public.erp_products TO handyhub_product_writer;
GRANT INSERT (tenant_id,id,cost), UPDATE (cost) ON public.erp_product_costs TO handyhub_product_writer;
GRANT INSERT (tenant_id,id,initial_stock,min_stock), UPDATE (initial_stock,min_stock)
  ON public.erp_product_stock TO handyhub_product_writer;

CREATE POLICY erp_versioned_writer ON public.erp_products FOR ALL TO handyhub_product_writer
  USING (private.erp_can(tenant_id,'products.update')) WITH CHECK (private.erp_can(tenant_id,'products.update'));
CREATE POLICY erp_versioned_writer ON public.erp_product_costs FOR ALL TO handyhub_product_writer
  USING (private.erp_can(tenant_id,'products.update')) WITH CHECK (private.erp_can(tenant_id,'products.update'));
CREATE POLICY erp_versioned_writer ON public.erp_product_stock FOR ALL TO handyhub_product_writer
  USING (private.erp_can(tenant_id,'products.update')) WITH CHECK (private.erp_can(tenant_id,'products.update'));

CREATE FUNCTION public.erp_update_product(
  p_tenant uuid, p_product uuid, p_expected_version bigint,
  p_product_patch jsonb DEFAULT '{}'::jsonb,
  p_cost_patch jsonb DEFAULT '{}'::jsonb,
  p_stock_patch jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(record_id uuid, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_current bigint; v_next bigint; v_stock public.erp_product_stock%ROWTYPE;
BEGIN
  IF NOT private.erp_can(p_tenant,'products.update') THEN
    RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 OR p_expected_version >= 9007199254740991
    OR p_tenant IS NULL OR p_product IS NULL
    OR jsonb_typeof(p_product_patch) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_cost_patch) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_stock_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_COMMAND' USING ERRCODE='22023';
  END IF;
  IF p_product_patch='{}'::jsonb AND p_cost_patch='{}'::jsonb AND p_stock_patch='{}'::jsonb THEN
    RAISE EXCEPTION 'EMPTY_PRODUCT_COMMAND' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_product_patch) k WHERE k NOT IN ('name','category','price'))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_cost_patch) k WHERE k <> 'cost')
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_stock_patch) k WHERE k NOT IN ('initial_stock','min_stock')) THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_FIELDS' USING ERRCODE='22023';
  END IF;
  IF (p_product_patch ? 'name' AND (jsonb_typeof(p_product_patch->'name') <> 'string' OR length(p_product_patch->>'name')=0))
    OR (p_product_patch ? 'category' AND jsonb_typeof(p_product_patch->'category') NOT IN ('string','null'))
    OR (p_product_patch ? 'price' AND jsonb_typeof(p_product_patch->'price') <> 'number')
    OR (p_cost_patch ? 'cost' AND jsonb_typeof(p_cost_patch->'cost') <> 'number')
    OR (p_stock_patch ? 'initial_stock' AND (jsonb_typeof(p_stock_patch->'initial_stock') <> 'number'
      OR (p_stock_patch->>'initial_stock')::numeric <> trunc((p_stock_patch->>'initial_stock')::numeric)))
    OR (p_stock_patch ? 'min_stock' AND (jsonb_typeof(p_stock_patch->'min_stock') <> 'number'
      OR (p_stock_patch->>'min_stock')::numeric <> trunc((p_stock_patch->>'min_stock')::numeric))) THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_VALUES' USING ERRCODE='22023';
  END IF;

  -- One root row, then cost, then stock: deterministic lock order. Different
  -- products never share this lock. No client-controlled GUC or trigger bypass.
  SELECT p.version INTO v_current FROM public.erp_products p
    WHERE p.tenant_id=p_tenant AND p.id=p_product FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF v_current <> p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001';
  END IF;
  UPDATE public.erp_products p SET
    name=CASE WHEN p_product_patch ? 'name' THEN p_product_patch->>'name' ELSE p.name END,
    category=CASE WHEN p_product_patch ? 'category' THEN p_product_patch->>'category' ELSE p.category END,
    price=CASE WHEN p_product_patch ? 'price' THEN (p_product_patch->>'price')::numeric ELSE p.price END
    WHERE p.tenant_id=p_tenant AND p.id=p_product AND p.version=p_expected_version
    RETURNING p.version INTO v_next;
  -- Existing guard increments the ROOT once, even for cost/stock-only commands.
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;

  IF p_cost_patch ? 'cost' THEN
    INSERT INTO public.erp_product_costs(tenant_id,id,cost)
      VALUES (p_tenant,p_product,(p_cost_patch->>'cost')::numeric)
      ON CONFLICT (tenant_id,id) DO UPDATE SET cost=EXCLUDED.cost;
  END IF;
  IF p_stock_patch <> '{}'::jsonb THEN
    SELECT s.* INTO v_stock FROM public.erp_product_stock s WHERE s.tenant_id=p_tenant AND s.id=p_product;
    IF NOT FOUND AND NOT (p_stock_patch ? 'initial_stock' AND p_stock_patch ? 'min_stock') THEN
      RAISE EXCEPTION 'INITIAL_STOCK_FIELDS_REQUIRED' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.erp_product_stock(tenant_id,id,initial_stock,min_stock) VALUES (
      p_tenant,p_product,
      CASE WHEN p_stock_patch ? 'initial_stock' THEN (p_stock_patch->>'initial_stock')::numeric::integer ELSE v_stock.initial_stock END,
      CASE WHEN p_stock_patch ? 'min_stock' THEN (p_stock_patch->>'min_stock')::numeric::integer ELSE v_stock.min_stock END
    ) ON CONFLICT (tenant_id,id) DO UPDATE SET initial_stock=EXCLUDED.initial_stock,min_stock=EXCLUDED.min_stock;
  END IF;
  RETURN QUERY SELECT p_product,v_next;
END;
$$;
REVOKE ALL ON FUNCTION public.erp_update_product(uuid,uuid,bigint,jsonb,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
-- Grant CREATE only for ownership transfer; leave no permanent schema DDL power.
GRANT CREATE ON SCHEMA public TO handyhub_product_writer;
ALTER FUNCTION public.erp_update_product(uuid,uuid,bigint,jsonb,jsonb,jsonb) OWNER TO handyhub_product_writer;
REVOKE CREATE ON SCHEMA public FROM handyhub_product_writer;
GRANT EXECUTE ON FUNCTION public.erp_update_product(uuid,uuid,bigint,jsonb,jsonb,jsonb) TO authenticated;
COMMENT ON FUNCTION public.erp_update_product(uuid,uuid,bigint,jsonb,jsonb,jsonb) IS
  'Owner-only RLS-bound atomic product/cost/stock command. Root expectedVersion required; 40001 VERSION_CONFLICT. No automatic retry.';
COMMIT;
