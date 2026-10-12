-- M4: additive historical snapshots. No backfill or guessed legacy values.
BEGIN;
ALTER TABLE public.erp_sales
  ADD COLUMN history_state text NOT NULL DEFAULT 'incomplete' CHECK (history_state IN ('incomplete','posted')),
  ADD COLUMN product_name_snapshot text,
  ADD COLUMN product_version_snapshot bigint CHECK (product_version_snapshot>0),
  ADD COLUMN seller_name_snapshot text,
  ADD COLUMN posted_at timestamptz,
  ADD CONSTRAINT erp_sale_posted_labels CHECK (history_state <> 'posted' OR
    (product_name_snapshot IS NOT NULL AND length(btrim(product_name_snapshot))>0 AND product_version_snapshot IS NOT NULL
     AND seller_employee_id IS NOT NULL AND seller_name_snapshot IS NOT NULL
     AND length(btrim(seller_name_snapshot))>0 AND posted_at IS NOT NULL AND isfinite(occurred_on) AND status='posted'));
ALTER TABLE public.erp_sale_customers ADD COLUMN client_name_snapshot text;
ALTER TABLE public.erp_sale_finance
  ADD COLUMN quantity_snapshot integer CHECK (quantity_snapshot>0),
  ADD COLUMN discount numeric(14,2) CHECK (discount BETWEEN 0 AND 999999999999.99),
  ADD COLUMN currency_code text CHECK (currency_code='BRL'),
  ADD COLUMN gross_total numeric(14,2) GENERATED ALWAYS AS (unit_price*quantity_snapshot) STORED,
  ADD CONSTRAINT erp_sale_historical_amounts CHECK (quantity_snapshot IS NULL OR
    (discount IS NOT NULL AND currency_code IS NOT NULL AND discount<=gross_total
     AND total=gross_total-discount AND length(btrim(payment_method))>0));

ALTER TABLE public.erp_attendances
  ADD COLUMN history_state text NOT NULL DEFAULT 'incomplete' CHECK (history_state IN ('incomplete','posted')),
  ADD COLUMN client_name_snapshot text,
  ADD COLUMN service_name_snapshot text,
  ADD COLUMN service_version_snapshot bigint CHECK (service_version_snapshot>0),
  ADD COLUMN professional_name_snapshot text,
  ADD COLUMN posted_at timestamptz,
  ADD CONSTRAINT erp_attendance_posted_labels CHECK (history_state <> 'posted' OR
    (client_name_snapshot IS NOT NULL AND length(btrim(client_name_snapshot))>0
     AND service_name_snapshot IS NOT NULL AND length(btrim(service_name_snapshot))>0 AND service_version_snapshot IS NOT NULL
     AND responsible_employee_id IS NOT NULL AND professional_name_snapshot IS NOT NULL
     AND length(btrim(professional_name_snapshot))>0 AND posted_at IS NOT NULL AND isfinite(occurred_on) AND status='posted'));
ALTER TABLE public.erp_attendance_finance
  ADD COLUMN quantity_snapshot integer CHECK (quantity_snapshot=1),
  ADD COLUMN currency_code text CHECK (currency_code='BRL');

-- Historical COGS is NOT operational expense and NOT the current catalog cost.
-- Its separate RLS avoids granting cost data through revenue-only permissions.
CREATE TABLE public.erp_sale_cmv (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  quantity_snapshot integer NOT NULL CHECK (quantity_snapshot>0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost BETWEEN 0 AND 999999999999.99),
  total_cost numeric(14,2) GENERATED ALWAYS AS (unit_cost*quantity_snapshot) STORED,
  cost_basis text NOT NULL CHECK (cost_basis='documented_manual'),
  cost_reference text NOT NULL CHECK (length(btrim(cost_reference)) BETWEEN 1 AND 500),
  currency_code text NOT NULL CHECK (currency_code='BRL'),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,id) REFERENCES public.erp_sales(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,id) REFERENCES public.erp_sale_finance(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.erp_sale_cmv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sale_cmv FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_sale_cmv FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.erp_sale_cmv TO authenticated;
-- Owner only pending approval of a dedicated historical-cost delegation rule.
CREATE POLICY erp_read ON public.erp_sale_cmv FOR SELECT TO authenticated
  USING (private.erp_can(tenant_id,'sales.create'));

CREATE TABLE private.erp_history_postings (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  sale_id uuid,
  attendance_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,sale_id), UNIQUE (tenant_id,attendance_id),
  CHECK (num_nonnulls(sale_id,attendance_id)=1),
  FOREIGN KEY (tenant_id,actor_user_id) REFERENCES public.tenant_memberships(tenant_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,sale_id) REFERENCES public.erp_sales(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,attendance_id) REFERENCES public.erp_attendances(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE private.erp_history_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.erp_history_postings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.erp_history_postings FROM PUBLIC,anon,authenticated,service_role;

CREATE ROLE handyhub_history_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,private,auth TO handyhub_history_writer;
GRANT EXECUTE ON FUNCTION private.erp_can(uuid,text) TO handyhub_history_writer;
GRANT SELECT (tenant_id,id,name,version) ON public.erp_products,public.erp_services TO handyhub_history_writer;
GRANT SELECT (tenant_id,id,name) ON public.erp_customers,public.erp_employees TO handyhub_history_writer;
GRANT SELECT ON public.erp_sales,public.erp_sale_customers,public.erp_sale_finance,
  public.erp_sale_cmv,public.erp_attendances,public.erp_attendance_finance TO handyhub_history_writer;
GRANT INSERT (tenant_id,id,product_id,seller_employee_id,occurred_on,quantity,status,history_state,
  product_name_snapshot,product_version_snapshot,seller_name_snapshot,posted_at) ON public.erp_sales TO handyhub_history_writer;
GRANT INSERT (tenant_id,id,customer_id,client_name_snapshot) ON public.erp_sale_customers TO handyhub_history_writer;
GRANT INSERT (tenant_id,id,unit_price,total,payment_method,quantity_snapshot,discount,currency_code)
  ON public.erp_sale_finance TO handyhub_history_writer;
GRANT INSERT (tenant_id,id,quantity_snapshot,unit_cost,cost_basis,cost_reference,currency_code)
  ON public.erp_sale_cmv TO handyhub_history_writer;
GRANT INSERT (tenant_id,id,customer_id,service_id,responsible_employee_id,occurred_on,occurred_at,status,
  history_state,client_name_snapshot,service_name_snapshot,service_version_snapshot,professional_name_snapshot,posted_at)
  ON public.erp_attendances TO handyhub_history_writer;
GRANT INSERT (tenant_id,id,gross_value,discount,net_value,payment_method,quantity_snapshot,currency_code)
  ON public.erp_attendance_finance TO handyhub_history_writer;
GRANT INSERT (tenant_id,actor_user_id,sale_id,attendance_id) ON private.erp_history_postings TO handyhub_history_writer;
GRANT SELECT ON private.erp_history_postings TO handyhub_history_writer;
GRANT UPDATE (history_state) ON public.erp_sales,public.erp_attendances TO handyhub_history_writer;

CREATE POLICY erp_history_catalog ON public.erp_products FOR SELECT TO handyhub_history_writer
  USING (private.erp_can(tenant_id,'sales.create'));
CREATE POLICY erp_history_catalog ON public.erp_services FOR SELECT TO handyhub_history_writer
  USING (private.erp_can(tenant_id,'attendances.create'));
CREATE POLICY erp_history_catalog ON public.erp_customers FOR SELECT TO handyhub_history_writer
  USING (private.erp_can(tenant_id,'sales.create') OR private.erp_can(tenant_id,'attendances.create'));
CREATE POLICY erp_history_catalog ON public.erp_employees FOR SELECT TO handyhub_history_writer
  USING (private.erp_can(tenant_id,'sales.create') OR private.erp_can(tenant_id,'attendances.create'));
DO $$ DECLARE t text; p text; BEGIN
  FOREACH t IN ARRAY ARRAY['erp_sales','erp_sale_customers','erp_sale_finance','erp_sale_cmv','erp_attendances','erp_attendance_finance'] LOOP
    p:=CASE WHEN t LIKE 'erp_attendance%' THEN 'attendances.create' ELSE 'sales.create' END;
    EXECUTE format('CREATE POLICY erp_history_writer_read ON public.%I FOR SELECT TO handyhub_history_writer USING (private.erp_can(tenant_id,%L))',t,p);
    EXECUTE format('CREATE POLICY erp_history_writer_insert ON public.%I FOR INSERT TO handyhub_history_writer WITH CHECK (private.erp_can(tenant_id,%L))',t,p);
  END LOOP;
END $$;
CREATE POLICY erp_history_finalize ON public.erp_sales FOR UPDATE TO handyhub_history_writer
  USING (history_state='incomplete' AND private.erp_can(tenant_id,'sales.create'))
  WITH CHECK (history_state='posted' AND private.erp_can(tenant_id,'sales.create'));
CREATE POLICY erp_history_finalize ON public.erp_attendances FOR UPDATE TO handyhub_history_writer
  USING (history_state='incomplete' AND private.erp_can(tenant_id,'attendances.create'))
  WITH CHECK (history_state='posted' AND private.erp_can(tenant_id,'attendances.create'));
CREATE POLICY erp_history_writer_insert ON private.erp_history_postings FOR INSERT TO handyhub_history_writer
  WITH CHECK (actor_user_id=(SELECT auth.uid()) AND
    ((sale_id IS NOT NULL AND private.erp_can(tenant_id,'sales.create')) OR
     (attendance_id IS NOT NULL AND private.erp_can(tenant_id,'attendances.create'))));
CREATE POLICY erp_history_writer_read ON private.erp_history_postings FOR SELECT TO handyhub_history_writer
  USING (private.erp_can(tenant_id,'sales.create') OR private.erp_can(tenant_id,'attendances.create'));

CREATE FUNCTION private.erp_history_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE posted boolean;
BEGIN
  IF TG_OP='TRUNCATE' OR TG_TABLE_NAME IN ('erp_sale_cmv','erp_history_postings') THEN posted:=true;
  ELSIF TG_TABLE_NAME IN ('erp_sales','erp_attendances') THEN posted:=OLD.history_state='posted';
  ELSIF TG_TABLE_NAME LIKE 'erp_sale_%' THEN
    SELECT s.history_state='posted' INTO posted FROM public.erp_sales s WHERE s.tenant_id=OLD.tenant_id AND s.id=OLD.id;
  ELSE
    SELECT a.history_state='posted' INTO posted FROM public.erp_attendances a WHERE a.tenant_id=OLD.tenant_id AND a.id=OLD.id;
  END IF;
  -- A hidden/missing parent must never be treated as an editable incomplete row.
  IF posted IS NULL OR posted THEN RAISE EXCEPTION 'HISTORY_IMMUTABLE' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erp_history_immutable() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; s text; BEGIN
  FOREACH t IN ARRAY ARRAY['erp_sales','erp_sale_customers','erp_sale_finance','erp_sale_cmv','erp_attendances','erp_attendance_finance','erp_history_postings'] LOOP
    s:=CASE WHEN t='erp_history_postings' THEN 'private' ELSE 'public' END;
    EXECUTE format('CREATE TRIGGER erp_history_immutable BEFORE UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION private.erp_history_immutable()',s,t);
    EXECUTE format('CREATE TRIGGER erp_history_no_truncate BEFORE TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION private.erp_history_immutable()',s,t);
  END LOOP;
END $$;

-- Optional fragments must not be appended after finalization, even in the same
-- transaction. Commands insert fragments first, then finalize the fresh root.
CREATE FUNCTION private.erp_history_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE posted boolean;
BEGIN
  IF TG_TABLE_NAME IN ('erp_sale_finance','erp_attendance_finance') THEN
    IF NEW.quantity_snapshot IS NULL THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='erp_history_postings' THEN
    IF NEW.sale_id IS NOT NULL THEN
      SELECT s.history_state='posted' INTO posted FROM public.erp_sales s
        WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.sale_id;
    ELSE
      SELECT a.history_state='posted' INTO posted FROM public.erp_attendances a
        WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.attendance_id;
    END IF;
  ELSIF TG_TABLE_NAME LIKE 'erp_sale_%' THEN
    SELECT s.history_state='posted' INTO posted FROM public.erp_sales s
      WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.id;
  ELSE
    SELECT a.history_state='posted' INTO posted FROM public.erp_attendances a
      WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.id;
  END IF;
  IF posted IS NULL OR posted THEN
    RAISE EXCEPTION 'HISTORY_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.erp_history_insert_guard() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; s text; BEGIN
  FOREACH t IN ARRAY ARRAY['erp_sale_customers','erp_sale_finance','erp_sale_cmv','erp_attendance_finance','erp_history_postings'] LOOP
    s:=CASE WHEN t='erp_history_postings' THEN 'private' ELSE 'public' END;
    EXECUTE format('CREATE TRIGGER erp_history_insert_guard BEFORE INSERT ON %I.%I FOR EACH ROW EXECUTE FUNCTION private.erp_history_insert_guard()',s,t);
  END LOOP;
END $$;

-- Deferred: a posted root cannot commit without its complete monetary fragments.
-- Narrow definer role can verify private posting audit without exposing it to callers.
CREATE FUNCTION private.erp_validate_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.erp_sales%ROWTYPE; f public.erp_sale_finance%ROWTYPE;
  c public.erp_sale_cmv%ROWTYPE; a public.erp_attendances%ROWTYPE; af public.erp_attendance_finance%ROWTYPE;
BEGIN
  -- Legacy/incomplete fragments are preserved, not upgraded by inference.
  IF TG_TABLE_NAME IN ('erp_sales','erp_attendances') THEN
    IF NEW.history_state='incomplete' THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME IN ('erp_sale_finance','erp_attendance_finance') THEN
    IF NEW.quantity_snapshot IS NULL THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME='erp_sale_customers' THEN
    IF NEW.client_name_snapshot IS NULL THEN RETURN NULL; END IF;
  END IF;
  IF TG_TABLE_NAME LIKE 'erp_sale%' THEN
    SELECT r.* INTO s FROM public.erp_sales r WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'HISTORY_ROOT_REQUIRED' USING ERRCODE='23514'; END IF;
    IF s.history_state<>'posted' THEN
      IF TG_TABLE_NAME='erp_sale_cmv' THEN
        RAISE EXCEPTION 'POSTED_HISTORY_REQUIRED' USING ERRCODE='23514';
      END IF;
      IF TG_TABLE_NAME='erp_sale_finance' THEN
        IF NEW.quantity_snapshot IS NOT NULL THEN RAISE EXCEPTION 'POSTED_HISTORY_REQUIRED' USING ERRCODE='23514'; END IF;
      END IF;
      RETURN NULL;
    END IF;
    SELECT r.* INTO f FROM public.erp_sale_finance r WHERE r.tenant_id=s.tenant_id AND r.id=s.id;
    SELECT r.* INTO c FROM public.erp_sale_cmv r WHERE r.tenant_id=s.tenant_id AND r.id=s.id;
    IF f.id IS NULL OR c.id IS NULL OR f.quantity_snapshot IS DISTINCT FROM s.quantity
      OR c.quantity_snapshot IS DISTINCT FROM s.quantity OR f.currency_code IS DISTINCT FROM c.currency_code
      OR NOT EXISTS (SELECT 1 FROM private.erp_history_postings h WHERE h.tenant_id=s.tenant_id AND h.sale_id=s.id)
      OR EXISTS (SELECT 1 FROM public.erp_sale_customers r WHERE r.tenant_id=s.tenant_id AND r.id=s.id
        AND (r.client_name_snapshot IS NULL OR length(btrim(r.client_name_snapshot))=0)) THEN
      RAISE EXCEPTION 'INCOMPLETE_SALE_HISTORY' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT r.* INTO a FROM public.erp_attendances r WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'HISTORY_ROOT_REQUIRED' USING ERRCODE='23514'; END IF;
    IF a.history_state<>'posted' THEN
      IF TG_TABLE_NAME='erp_attendance_finance' THEN
        IF NEW.quantity_snapshot IS NOT NULL THEN RAISE EXCEPTION 'POSTED_HISTORY_REQUIRED' USING ERRCODE='23514'; END IF;
      END IF;
      RETURN NULL;
    END IF;
    SELECT r.* INTO af FROM public.erp_attendance_finance r WHERE r.tenant_id=a.tenant_id AND r.id=a.id;
    IF af.id IS NULL OR af.quantity_snapshot IS DISTINCT FROM 1 OR af.currency_code IS DISTINCT FROM 'BRL'
      OR length(btrim(af.payment_method))=0
      OR NOT EXISTS (SELECT 1 FROM private.erp_history_postings h WHERE h.tenant_id=a.tenant_id AND h.attendance_id=a.id) THEN
      RAISE EXCEPTION 'INCOMPLETE_ATTENDANCE_HISTORY' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.erp_validate_history() FROM PUBLIC,anon,authenticated,service_role;
GRANT CREATE ON SCHEMA private TO handyhub_history_writer;
ALTER FUNCTION private.erp_validate_history() OWNER TO handyhub_history_writer;
REVOKE CREATE ON SCHEMA private FROM handyhub_history_writer;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['erp_sales','erp_sale_finance','erp_sale_customers','erp_sale_cmv','erp_attendances','erp_attendance_finance'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER erp_validate_history AFTER INSERT OR UPDATE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.erp_validate_history()',t);
  END LOOP;
END $$;
COMMENT ON TABLE public.erp_sale_cmv IS 'Immutable recognized goods cost, explicitly documented, not catalog replacement cost or operating expense. No FIFO/weighted-average calculation is assumed.';
COMMIT;
