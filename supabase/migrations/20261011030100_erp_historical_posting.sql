-- M4 commands: append complete history, never rewrite a posted transaction.
BEGIN;
CREATE FUNCTION private.erp_history_money(v numeric) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF v IS NULL OR v<0 OR v>999999999999.99 OR v<>trunc(v,2) THEN
    RAISE EXCEPTION 'INVALID_HISTORICAL_AMOUNT' USING ERRCODE='22023';
  END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION private.erp_history_money(numeric) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.erp_history_money(numeric) TO handyhub_history_writer;

CREATE FUNCTION public.erp_post_sale(
  p_tenant uuid,p_record uuid,p_product uuid,p_expected_product_version bigint,
  p_seller uuid,p_customer uuid,p_occurred_on date,p_quantity integer,
  p_unit_price numeric,p_discount numeric,p_unit_cost numeric,p_cost_reference text,
  p_payment_method text,p_currency_code text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE product_name text; seller_name text; client_name text; source_version bigint;
  gross numeric; net numeric; recognized_cost numeric;
BEGIN
  IF NOT private.erp_can(p_tenant,'sales.create') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF p_record IS NULL OR p_product IS NULL OR p_seller IS NULL OR p_occurred_on IS NULL OR NOT isfinite(p_occurred_on)
    OR p_quantity IS NULL OR p_quantity<1 OR p_expected_product_version IS NULL
    OR p_expected_product_version<1 OR p_expected_product_version>9007199254740991
    OR p_currency_code IS DISTINCT FROM 'BRL' OR p_payment_method IS NULL
    OR length(btrim(p_payment_method)) NOT BETWEEN 1 AND 80
    OR p_cost_reference IS NULL OR length(btrim(p_cost_reference)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'INVALID_SALE_COMMAND' USING ERRCODE='22023';
  END IF;
  PERFORM private.erp_history_money(p_unit_price),private.erp_history_money(p_discount),private.erp_history_money(p_unit_cost);
  gross:=private.erp_history_money(p_unit_price*p_quantity);
  recognized_cost:=private.erp_history_money(p_unit_cost*p_quantity);
  IF p_discount>gross THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE='22023'; END IF;
  net:=gross-p_discount;
  -- One SQL snapshot for ALL labels/source version. No catalog writes/row locks.
  -- A later catalog edit cannot change these copied, immutable historical values.
  SELECT p.name,e.name,c.name,p.version INTO product_name,seller_name,client_name,source_version
  FROM public.erp_products p JOIN public.erp_employees e ON e.tenant_id=p.tenant_id AND e.id=p_seller
  LEFT JOIN public.erp_customers c ON c.tenant_id=p.tenant_id AND c.id=p_customer
  WHERE p.tenant_id=p_tenant AND p.id=p_product;
  IF NOT FOUND OR (p_customer IS NOT NULL AND client_name IS NULL) THEN
    RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  IF source_version<>p_expected_product_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  INSERT INTO public.erp_sales(tenant_id,id,product_id,seller_employee_id,occurred_on,quantity,status,history_state,
    product_name_snapshot,product_version_snapshot,seller_name_snapshot,posted_at)
  VALUES(p_tenant,p_record,p_product,p_seller,p_occurred_on,p_quantity,'posted','incomplete',
    product_name,source_version,seller_name,clock_timestamp());
  IF p_customer IS NOT NULL THEN
    INSERT INTO public.erp_sale_customers(tenant_id,id,customer_id,client_name_snapshot)
    VALUES(p_tenant,p_record,p_customer,client_name);
  END IF;
  INSERT INTO public.erp_sale_finance(tenant_id,id,unit_price,total,payment_method,quantity_snapshot,discount,currency_code)
    VALUES(p_tenant,p_record,p_unit_price,net,p_payment_method,p_quantity,p_discount,p_currency_code);
  INSERT INTO public.erp_sale_cmv(tenant_id,id,quantity_snapshot,unit_cost,cost_basis,cost_reference,currency_code)
    VALUES(p_tenant,p_record,p_quantity,p_unit_cost,'documented_manual',p_cost_reference,p_currency_code);
  INSERT INTO private.erp_history_postings(tenant_id,actor_user_id,sale_id)
    VALUES(p_tenant,(SELECT auth.uid()),p_record);
  UPDATE public.erp_sales SET history_state='posted'
    WHERE tenant_id=p_tenant AND id=p_record AND history_state='incomplete';
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  RETURN p_record;
END $$;

CREATE FUNCTION public.erp_post_attendance(
  p_tenant uuid,p_record uuid,p_service uuid,p_expected_service_version bigint,
  p_professional uuid,p_customer uuid,p_occurred_on date,p_occurred_at time,
  p_gross_value numeric,p_discount numeric,p_payment_method text,p_currency_code text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE service_name text; professional_name text; client_name text; source_version bigint;
BEGIN
  IF NOT private.erp_can(p_tenant,'attendances.create') THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF p_record IS NULL OR p_service IS NULL OR p_professional IS NULL OR p_customer IS NULL
    OR p_occurred_on IS NULL OR NOT isfinite(p_occurred_on) OR p_occurred_at IS NULL OR p_expected_service_version IS NULL
    OR p_expected_service_version<1 OR p_expected_service_version>9007199254740991
    OR p_currency_code IS DISTINCT FROM 'BRL' OR p_payment_method IS NULL
    OR length(btrim(p_payment_method)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'INVALID_ATTENDANCE_COMMAND' USING ERRCODE='22023';
  END IF;
  PERFORM private.erp_history_money(p_gross_value),private.erp_history_money(p_discount);
  IF p_discount>p_gross_value THEN RAISE EXCEPTION 'INVALID_DISCOUNT' USING ERRCODE='22023'; END IF;
  SELECT s.name,e.name,c.name,s.version INTO service_name,professional_name,client_name,source_version
  FROM public.erp_services s JOIN public.erp_employees e ON e.tenant_id=s.tenant_id AND e.id=p_professional
  JOIN public.erp_customers c ON c.tenant_id=s.tenant_id AND c.id=p_customer
  WHERE s.tenant_id=p_tenant AND s.id=p_service;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF source_version<>p_expected_service_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  INSERT INTO public.erp_attendances(tenant_id,id,customer_id,service_id,responsible_employee_id,occurred_on,occurred_at,
    status,history_state,client_name_snapshot,service_name_snapshot,service_version_snapshot,professional_name_snapshot,posted_at)
  VALUES(p_tenant,p_record,p_customer,p_service,p_professional,p_occurred_on,p_occurred_at,
    'posted','incomplete',client_name,service_name,source_version,professional_name,clock_timestamp());
  INSERT INTO public.erp_attendance_finance(tenant_id,id,gross_value,discount,net_value,payment_method,quantity_snapshot,currency_code)
    VALUES(p_tenant,p_record,p_gross_value,p_discount,p_gross_value-p_discount,p_payment_method,1,p_currency_code);
  INSERT INTO private.erp_history_postings(tenant_id,actor_user_id,attendance_id)
    VALUES(p_tenant,(SELECT auth.uid()),p_record);
  UPDATE public.erp_attendances SET history_state='posted'
    WHERE tenant_id=p_tenant AND id=p_record AND history_state='incomplete';
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  RETURN p_record;
END $$;

REVOKE ALL ON FUNCTION public.erp_post_sale(uuid,uuid,uuid,bigint,uuid,uuid,date,integer,numeric,numeric,numeric,text,text,text),
  public.erp_post_attendance(uuid,uuid,uuid,bigint,uuid,uuid,date,time,numeric,numeric,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT CREATE ON SCHEMA public TO handyhub_history_writer;
ALTER FUNCTION public.erp_post_sale(uuid,uuid,uuid,bigint,uuid,uuid,date,integer,numeric,numeric,numeric,text,text,text) OWNER TO handyhub_history_writer;
ALTER FUNCTION public.erp_post_attendance(uuid,uuid,uuid,bigint,uuid,uuid,date,time,numeric,numeric,text,text) OWNER TO handyhub_history_writer;
REVOKE CREATE ON SCHEMA public FROM handyhub_history_writer;
GRANT EXECUTE ON FUNCTION public.erp_post_sale(uuid,uuid,uuid,bigint,uuid,uuid,date,integer,numeric,numeric,numeric,text,text,text),
  public.erp_post_attendance(uuid,uuid,uuid,bigint,uuid,uuid,date,time,numeric,numeric,text,text) TO authenticated;
COMMENT ON FUNCTION public.erp_post_sale(uuid,uuid,uuid,bigint,uuid,uuid,date,integer,numeric,numeric,numeric,text,text,text)
  IS 'Owner-only append of one historical sale line. Explicit practiced price/discount and documented recognized COGS. BRL only, no inventory valuation or operating expense creation.';
COMMENT ON FUNCTION public.erp_post_attendance(uuid,uuid,uuid,bigint,uuid,uuid,date,time,numeric,numeric,text,text)
  IS 'Owner-only append of one completed service. Immutable labels and practiced financial values; no inferred service/professional cost.';
COMMIT;
