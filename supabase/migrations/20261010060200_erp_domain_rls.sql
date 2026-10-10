-- Phase 2A: empty normalized domain tables; NO legacy copy, deletion or cutover.
BEGIN;

CREATE FUNCTION private.erp_is_self(p_tenant uuid, p_employee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM private.erp_employee_auth_links l
    JOIN public.tenant_memberships m ON m.tenant_id = l.tenant_id AND m.user_id = l.auth_user_id
    JOIN public.tenants t ON t.id = m.tenant_id
    WHERE l.tenant_id = p_tenant AND l.employee_id = p_employee
      AND l.auth_user_id = (SELECT auth.uid()) AND m.is_active AND t.status = 'Ativo');
$$;
CREATE FUNCTION private.erp_is_assigned(p_tenant uuid, p_customer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM private.erp_customer_assignments a
    WHERE a.tenant_id = p_tenant AND a.customer_id = p_customer
      AND private.erp_is_self(a.tenant_id, a.employee_id));
$$;
REVOKE ALL ON FUNCTION private.erp_is_self(uuid,uuid), private.erp_is_assigned(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.erp_is_self(uuid,uuid), private.erp_is_assigned(uuid,uuid) TO authenticated;

CREATE FUNCTION private.erp_guard_record() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Record identity is immutable' USING ERRCODE = '23514';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.erp_guard_record() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_customers
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_customers TO authenticated;
CREATE POLICY erp_read ON public.erp_customers FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'customers.read') OR (private.erp_can(tenant_id, 'customers.read_assigned') AND private.erp_is_assigned(tenant_id, id)));
GRANT INSERT (tenant_id, id, name) ON public.erp_customers TO authenticated;
GRANT DELETE ON public.erp_customers TO authenticated;
CREATE POLICY erp_create ON public.erp_customers FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'customers.create'));
CREATE POLICY erp_delete ON public.erp_customers FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'customers.delete'));
GRANT UPDATE (name) ON public.erp_customers TO authenticated;
CREATE POLICY erp_update ON public.erp_customers FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'customers.update')) WITH CHECK (private.erp_can(tenant_id, 'customers.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_customer_contacts
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_customer_contacts TO authenticated;
CREATE POLICY erp_read ON public.erp_customer_contacts FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'customers.read'));
GRANT INSERT (tenant_id, id, phone) ON public.erp_customer_contacts TO authenticated;
GRANT DELETE ON public.erp_customer_contacts TO authenticated;
CREATE POLICY erp_create ON public.erp_customer_contacts FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'customers.create'));
CREATE POLICY erp_delete ON public.erp_customer_contacts FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'customers.delete'));
GRANT UPDATE (phone) ON public.erp_customer_contacts TO authenticated;
CREATE POLICY erp_update ON public.erp_customer_contacts FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'customers.update')) WITH CHECK (private.erp_can(tenant_id, 'customers.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_customer_notes
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_customer_notes TO authenticated;
CREATE POLICY erp_read ON public.erp_customer_notes FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'customers.private_notes.read'));
GRANT INSERT (tenant_id, id, notes) ON public.erp_customer_notes TO authenticated;
GRANT DELETE ON public.erp_customer_notes TO authenticated;
CREATE POLICY erp_create ON public.erp_customer_notes FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'customers.create'));
CREATE POLICY erp_delete ON public.erp_customer_notes FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'customers.delete'));
GRANT UPDATE (notes) ON public.erp_customer_notes TO authenticated;
CREATE POLICY erp_update ON public.erp_customer_notes FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'customers.update')) WITH CHECK (private.erp_can(tenant_id, 'customers.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_employees
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_employees TO authenticated;
CREATE POLICY erp_read ON public.erp_employees FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'employees.read') OR (private.erp_can(tenant_id, 'employees.read_own') AND private.erp_is_self(tenant_id, id)));
GRANT INSERT (tenant_id, id, name) ON public.erp_employees TO authenticated;
GRANT DELETE ON public.erp_employees TO authenticated;
CREATE POLICY erp_create ON public.erp_employees FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'employees.create'));
CREATE POLICY erp_delete ON public.erp_employees FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'employees.delete'));
GRANT UPDATE (name) ON public.erp_employees TO authenticated;
CREATE POLICY erp_update ON public.erp_employees FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'employees.update')) WITH CHECK (private.erp_can(tenant_id, 'employees.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_employee_private
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_employee_private TO authenticated;
CREATE POLICY erp_read ON public.erp_employee_private FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'employees.private.read'));
GRANT INSERT (tenant_id, id, phone, email) ON public.erp_employee_private TO authenticated;
GRANT DELETE ON public.erp_employee_private TO authenticated;
CREATE POLICY erp_create ON public.erp_employee_private FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'employees.create'));
CREATE POLICY erp_delete ON public.erp_employee_private FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'employees.delete'));
GRANT UPDATE (phone, email) ON public.erp_employee_private TO authenticated;
CREATE POLICY erp_update ON public.erp_employee_private FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'employees.update')) WITH CHECK (private.erp_can(tenant_id, 'employees.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_employee_schedules
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_employee_schedules TO authenticated;
CREATE POLICY erp_read ON public.erp_employee_schedules FOR SELECT TO authenticated USING (false); -- structured contract pending: deny every client role

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_professional_roles
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_professional_roles TO authenticated;
CREATE POLICY erp_read ON public.erp_professional_roles FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'rolesList.read'));
GRANT INSERT (tenant_id, id, name) ON public.erp_professional_roles TO authenticated;
GRANT DELETE ON public.erp_professional_roles TO authenticated;
CREATE POLICY erp_create ON public.erp_professional_roles FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'rolesList.create'));
CREATE POLICY erp_delete ON public.erp_professional_roles FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'rolesList.delete'));
GRANT UPDATE (name) ON public.erp_professional_roles TO authenticated;
CREATE POLICY erp_update ON public.erp_professional_roles FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'rolesList.update')) WITH CHECK (private.erp_can(tenant_id, 'rolesList.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_employee_roles
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_employee_roles TO authenticated;
CREATE POLICY erp_read ON public.erp_employee_roles FOR SELECT TO authenticated USING (false); -- structured contract pending: deny every client role

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_products
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_products TO authenticated;
CREATE POLICY erp_read ON public.erp_products FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'products.read'));
GRANT INSERT (tenant_id, id, name, category, price) ON public.erp_products TO authenticated;
GRANT DELETE ON public.erp_products TO authenticated;
CREATE POLICY erp_create ON public.erp_products FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'products.create'));
CREATE POLICY erp_delete ON public.erp_products FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'products.delete'));
GRANT UPDATE (name, category, price) ON public.erp_products TO authenticated;
CREATE POLICY erp_update ON public.erp_products FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'products.update')) WITH CHECK (private.erp_can(tenant_id, 'products.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_product_costs
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_product_costs TO authenticated;
CREATE POLICY erp_read ON public.erp_product_costs FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'finance.products.cost.read'));
GRANT INSERT (tenant_id, id, cost) ON public.erp_product_costs TO authenticated;
GRANT DELETE ON public.erp_product_costs TO authenticated;
CREATE POLICY erp_create ON public.erp_product_costs FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'products.create'));
CREATE POLICY erp_delete ON public.erp_product_costs FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'products.delete'));
GRANT UPDATE (cost) ON public.erp_product_costs TO authenticated;
CREATE POLICY erp_update ON public.erp_product_costs FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'products.update')) WITH CHECK (private.erp_can(tenant_id, 'products.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_product_stock
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_product_stock TO authenticated;
CREATE POLICY erp_read ON public.erp_product_stock FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'products.stock.read'));
GRANT INSERT (tenant_id, id, initial_stock, min_stock) ON public.erp_product_stock TO authenticated;
GRANT DELETE ON public.erp_product_stock TO authenticated;
CREATE POLICY erp_create ON public.erp_product_stock FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'products.create'));
CREATE POLICY erp_delete ON public.erp_product_stock FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'products.delete'));
GRANT UPDATE (initial_stock, min_stock) ON public.erp_product_stock TO authenticated;
CREATE POLICY erp_update ON public.erp_product_stock FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'products.update')) WITH CHECK (private.erp_can(tenant_id, 'products.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_services
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_services TO authenticated;
CREATE POLICY erp_read ON public.erp_services FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'services.read'));
GRANT INSERT (tenant_id, id, name, category, duration_minutes, price, assigned_role_id) ON public.erp_services TO authenticated;
GRANT DELETE ON public.erp_services TO authenticated;
CREATE POLICY erp_create ON public.erp_services FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'services.create'));
CREATE POLICY erp_delete ON public.erp_services FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'services.delete'));
GRANT UPDATE (name, category, duration_minutes, price) ON public.erp_services TO authenticated;
CREATE POLICY erp_update ON public.erp_services FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'services.update')) WITH CHECK (private.erp_can(tenant_id, 'services.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_promotions
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_promotions TO authenticated;
CREATE POLICY erp_read ON public.erp_promotions FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'promotions.read'));
GRANT INSERT (tenant_id, id, title, duration, discount_percent, is_all_promo, active) ON public.erp_promotions TO authenticated;
GRANT DELETE ON public.erp_promotions TO authenticated;
CREATE POLICY erp_create ON public.erp_promotions FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'promotions.create'));
CREATE POLICY erp_delete ON public.erp_promotions FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'promotions.delete'));
GRANT UPDATE (title, duration, discount_percent, is_all_promo, active) ON public.erp_promotions TO authenticated;
CREATE POLICY erp_update ON public.erp_promotions FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'promotions.update')) WITH CHECK (private.erp_can(tenant_id, 'promotions.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_promotion_targets
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_promotion_targets TO authenticated;
CREATE POLICY erp_read ON public.erp_promotion_targets FOR SELECT TO authenticated USING (false); -- structured contract pending: deny every client role

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_appointments
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_appointments TO authenticated;
CREATE POLICY erp_read ON public.erp_appointments FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'appointments.read') OR (private.erp_can(tenant_id, 'appointments.read_own') AND private.erp_is_self(tenant_id, responsible_employee_id)));
GRANT INSERT (tenant_id, id, occurred_on, occurred_at, status, customer_id, service_id) ON public.erp_appointments TO authenticated;
GRANT DELETE ON public.erp_appointments TO authenticated;
CREATE POLICY erp_create ON public.erp_appointments FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'appointments.create'));
CREATE POLICY erp_delete ON public.erp_appointments FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'appointments.delete'));
GRANT UPDATE (occurred_on, occurred_at, status) ON public.erp_appointments TO authenticated;
CREATE POLICY erp_update ON public.erp_appointments FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'appointments.update')) WITH CHECK (private.erp_can(tenant_id, 'appointments.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_attendances
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_attendances TO authenticated;
CREATE POLICY erp_read ON public.erp_attendances FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'attendances.read') OR (private.erp_can(tenant_id, 'attendances.read_own') AND private.erp_is_self(tenant_id, responsible_employee_id)));
GRANT INSERT (tenant_id, id, occurred_on, occurred_at, status, customer_id, service_id) ON public.erp_attendances TO authenticated;
GRANT DELETE ON public.erp_attendances TO authenticated;
CREATE POLICY erp_create ON public.erp_attendances FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'attendances.create'));
CREATE POLICY erp_delete ON public.erp_attendances FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'attendances.delete'));
GRANT UPDATE (occurred_on, occurred_at, status) ON public.erp_attendances TO authenticated;
CREATE POLICY erp_update ON public.erp_attendances FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'attendances.update')) WITH CHECK (private.erp_can(tenant_id, 'attendances.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_appointment_finance
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_appointment_finance TO authenticated;
CREATE POLICY erp_read ON public.erp_appointment_finance FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'finance.appointments.read'));
GRANT INSERT (tenant_id, id, price) ON public.erp_appointment_finance TO authenticated;
GRANT DELETE ON public.erp_appointment_finance TO authenticated;
CREATE POLICY erp_create ON public.erp_appointment_finance FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'appointments.create'));
CREATE POLICY erp_delete ON public.erp_appointment_finance FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'appointments.delete'));
GRANT UPDATE (price) ON public.erp_appointment_finance TO authenticated;
CREATE POLICY erp_update ON public.erp_appointment_finance FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'appointments.update')) WITH CHECK (private.erp_can(tenant_id, 'appointments.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_appointment_notes
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_appointment_notes TO authenticated;
CREATE POLICY erp_read ON public.erp_appointment_notes FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'appointments.private_notes.read'));
GRANT INSERT (tenant_id, id, notes) ON public.erp_appointment_notes TO authenticated;
GRANT DELETE ON public.erp_appointment_notes TO authenticated;
CREATE POLICY erp_create ON public.erp_appointment_notes FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'appointments.create'));
CREATE POLICY erp_delete ON public.erp_appointment_notes FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'appointments.delete'));
GRANT UPDATE (notes) ON public.erp_appointment_notes TO authenticated;
CREATE POLICY erp_update ON public.erp_appointment_notes FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'appointments.update')) WITH CHECK (private.erp_can(tenant_id, 'appointments.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_attendance_finance
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_attendance_finance TO authenticated;
CREATE POLICY erp_read ON public.erp_attendance_finance FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'finance.attendances.read'));
GRANT INSERT (tenant_id, id, gross_value, discount, net_value, payment_method) ON public.erp_attendance_finance TO authenticated;
GRANT DELETE ON public.erp_attendance_finance TO authenticated;
CREATE POLICY erp_create ON public.erp_attendance_finance FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'attendances.create'));
CREATE POLICY erp_delete ON public.erp_attendance_finance FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'attendances.delete'));
GRANT UPDATE (gross_value, discount, net_value, payment_method) ON public.erp_attendance_finance TO authenticated;
CREATE POLICY erp_update ON public.erp_attendance_finance FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'attendances.update')) WITH CHECK (private.erp_can(tenant_id, 'attendances.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_attendance_notes
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_attendance_notes TO authenticated;
CREATE POLICY erp_read ON public.erp_attendance_notes FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'attendances.private_notes.read'));
GRANT INSERT (tenant_id, id, notes) ON public.erp_attendance_notes TO authenticated;
GRANT DELETE ON public.erp_attendance_notes TO authenticated;
CREATE POLICY erp_create ON public.erp_attendance_notes FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'attendances.create'));
CREATE POLICY erp_delete ON public.erp_attendance_notes FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'attendances.delete'));
GRANT UPDATE (notes) ON public.erp_attendance_notes TO authenticated;
CREATE POLICY erp_update ON public.erp_attendance_notes FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'attendances.update')) WITH CHECK (private.erp_can(tenant_id, 'attendances.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_sales
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_sales TO authenticated;
CREATE POLICY erp_read ON public.erp_sales FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'sales.read') OR (private.erp_can(tenant_id, 'sales.read_own') AND private.erp_is_self(tenant_id, seller_employee_id)));
GRANT INSERT (tenant_id, id, occurred_on, quantity, status, product_id) ON public.erp_sales TO authenticated;
GRANT DELETE ON public.erp_sales TO authenticated;
CREATE POLICY erp_create ON public.erp_sales FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'sales.create'));
CREATE POLICY erp_delete ON public.erp_sales FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'sales.delete'));
GRANT UPDATE (occurred_on, quantity, status) ON public.erp_sales TO authenticated;
CREATE POLICY erp_update ON public.erp_sales FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'sales.update')) WITH CHECK (private.erp_can(tenant_id, 'sales.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_sale_customers
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_sale_customers TO authenticated;
CREATE POLICY erp_read ON public.erp_sale_customers FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'sales.read'));
GRANT INSERT (tenant_id, id, customer_id) ON public.erp_sale_customers TO authenticated;
GRANT DELETE ON public.erp_sale_customers TO authenticated;
CREATE POLICY erp_create ON public.erp_sale_customers FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'sales.create'));
CREATE POLICY erp_delete ON public.erp_sale_customers FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'sales.delete'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_sale_finance
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_sale_finance TO authenticated;
CREATE POLICY erp_read ON public.erp_sale_finance FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'finance.sales.read'));
GRANT INSERT (tenant_id, id, unit_price, total, payment_method) ON public.erp_sale_finance TO authenticated;
GRANT DELETE ON public.erp_sale_finance TO authenticated;
CREATE POLICY erp_create ON public.erp_sale_finance FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'sales.create'));
CREATE POLICY erp_delete ON public.erp_sale_finance FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'sales.delete'));
GRANT UPDATE (unit_price, total, payment_method) ON public.erp_sale_finance TO authenticated;
CREATE POLICY erp_update ON public.erp_sale_finance FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'sales.update')) WITH CHECK (private.erp_can(tenant_id, 'sales.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_sale_notes
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_sale_notes TO authenticated;
CREATE POLICY erp_read ON public.erp_sale_notes FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'sales.private_notes.read'));
GRANT INSERT (tenant_id, id, notes) ON public.erp_sale_notes TO authenticated;
GRANT DELETE ON public.erp_sale_notes TO authenticated;
CREATE POLICY erp_create ON public.erp_sale_notes FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'sales.create'));
CREATE POLICY erp_delete ON public.erp_sale_notes FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'sales.delete'));
GRANT UPDATE (notes) ON public.erp_sale_notes TO authenticated;
CREATE POLICY erp_update ON public.erp_sale_notes FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'sales.update')) WITH CHECK (private.erp_can(tenant_id, 'sales.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_stock_moves
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_stock_moves TO authenticated;
CREATE POLICY erp_read ON public.erp_stock_moves FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'stockMoves.read'));
GRANT INSERT (tenant_id, id, type, quantity, product_id) ON public.erp_stock_moves TO authenticated;
GRANT DELETE ON public.erp_stock_moves TO authenticated;
CREATE POLICY erp_create ON public.erp_stock_moves FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'stockMoves.create'));
CREATE POLICY erp_delete ON public.erp_stock_moves FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'stockMoves.delete'));
GRANT UPDATE (type, quantity) ON public.erp_stock_moves TO authenticated;
CREATE POLICY erp_update ON public.erp_stock_moves FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'stockMoves.update')) WITH CHECK (private.erp_can(tenant_id, 'stockMoves.update'));

CREATE TRIGGER erp_guard_record BEFORE UPDATE ON public.erp_expenses
  FOR EACH ROW EXECUTE FUNCTION private.erp_guard_record();
GRANT SELECT ON public.erp_expenses TO authenticated;
CREATE POLICY erp_read ON public.erp_expenses FOR SELECT TO authenticated USING (private.erp_can(tenant_id, 'finance.expenses.read'));
GRANT INSERT (tenant_id, id, occurred_on, description, amount, category, is_recurrent, status) ON public.erp_expenses TO authenticated;
GRANT DELETE ON public.erp_expenses TO authenticated;
CREATE POLICY erp_create ON public.erp_expenses FOR INSERT TO authenticated WITH CHECK (private.erp_can(tenant_id, 'finance.expenses.create'));
CREATE POLICY erp_delete ON public.erp_expenses FOR DELETE TO authenticated USING (private.erp_can(tenant_id, 'finance.expenses.delete'));
GRANT UPDATE (occurred_on, description, amount, category, is_recurrent, status) ON public.erp_expenses TO authenticated;
CREATE POLICY erp_update ON public.erp_expenses FOR UPDATE TO authenticated
  USING (private.erp_can(tenant_id, 'finance.expenses.update')) WITH CHECK (private.erp_can(tenant_id, 'finance.expenses.update'));
COMMIT;
