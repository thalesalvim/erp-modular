export const MASTER_TENANT_COLUMNS = [
  'id', 'slug', 'company_name', 'owner_name', 'owner_email', 'plan_name', 'monthly_fee',
  'due_day', 'status', 'allowed_modules', 'invoices', 'logo_type', 'logo_icon', 'logo_url',
  'primary_color', 'created_at',
].join(',');

export interface MasterInvoice {
  id: string;
  referenceMonth: string;
  amount: number;
  dueDate: string;
  status: 'Aberto' | 'Pago' | 'Vencido';
  paidAt?: string;
  paymentMethod?: string;
  receiptUrl?: string;
  receiptName?: string;
  cardLast4?: string;
}

export interface MasterTenantRow {
  id: string;
  slug: string;
  company_name: string;
  owner_name: string | null;
  owner_email: string | null;
  plan_name: string;
  monthly_fee: number;
  due_day: number;
  status: 'Ativo' | 'Bloqueado' | 'Pendente' | 'Cancelado';
  allowed_modules: Record<string, boolean>;
  invoices: MasterInvoice[];
  logo_type: 'icon' | 'image';
  logo_icon: string;
  logo_url: string | null;
  primary_color: string;
  created_at: string;
}

export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const shortText = (value: unknown, max = 200) => typeof value === 'string' && value.length <= max;
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
const statuses = ['Ativo', 'Bloqueado', 'Pendente', 'Cancelado'];
const modules = ['dashboard', 'calendar', 'atendimentos', 'services', 'promotions', 'pos', 'stock', 'expenses', 'team', 'customers', 'dre', 'settings'];

function validInvoices(value: unknown) {
  if (!Array.isArray(value) || value.length > 240) return false;
  const ids = new Set<string>();
  const keys = ['id', 'referenceMonth', 'amount', 'dueDate', 'status', 'paidAt', 'paymentMethod', 'receiptUrl', 'receiptName', 'cardLast4'];
  return value.every((invoice) => {
    if (!isRecord(invoice) || Object.keys(invoice).some((key) => !keys.includes(key))) return false;
    if (!shortText(invoice.id, 100) || !invoice.id || ids.has(invoice.id as string)) return false;
    ids.add(invoice.id as string);
    if (typeof invoice.referenceMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(invoice.referenceMonth)) return false;
    if (typeof invoice.amount !== 'number' || !Number.isFinite(invoice.amount) || invoice.amount < 0 || invoice.amount > 1e7) return false;
    if (!date(invoice.dueDate) || !['Aberto', 'Pago', 'Vencido'].includes(String(invoice.status))) return false;
    if (invoice.paidAt !== undefined && !date(invoice.paidAt)) return false;
    if (invoice.paymentMethod !== undefined && !shortText(invoice.paymentMethod, 80)) return false;
    if (invoice.receiptName !== undefined && !shortText(invoice.receiptName, 200)) return false;
    if (invoice.cardLast4 !== undefined && (typeof invoice.cardLast4 !== 'string' || !/^(?:•••• )?\d{4}$/.test(invoice.cardLast4))) return false;
    if (invoice.receiptUrl !== undefined && (typeof invoice.receiptUrl !== 'string' || invoice.receiptUrl.length > 1e6 || !/^(https:\/\/|data:(image\/(png|jpeg|webp)|application\/pdf);base64,)/.test(invoice.receiptUrl))) return false;
    return true;
  });
}

// Explicit allowlist: neither credentials nor identity/role assignments enter a tenant mutation.
export function validateTenantMutation(value: unknown, creating = false): Record<string, unknown> {
  if (!isRecord(value) || !Object.keys(value).length) throw new Error('Campos obrigatórios ausentes.');
  const allowed = ['company_name', 'owner_name', 'owner_email', 'plan_name', 'monthly_fee', 'due_day', 'status', 'allowed_modules', 'invoices', 'logo_type', 'logo_icon', 'logo_url', 'primary_color'];
  if (creating) allowed.push('slug');
  for (const [key, field] of Object.entries(value)) {
    if (!allowed.includes(key)) throw new Error('Campo não autorizado.');
    let valid: boolean;
    switch (key) {
      case 'slug': valid = typeof field === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(field) && field.length <= 100; break;
      case 'company_name': valid = shortText(field) && Boolean((field as string).trim()); break;
      case 'owner_email': valid = typeof field === 'string' && field.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field); break;
      case 'monthly_fee': valid = typeof field === 'number' && Number.isFinite(field) && field >= 0 && field <= 1e7; break;
      case 'due_day': valid = typeof field === 'number' && Number.isInteger(field) && field >= 1 && field <= 31; break;
      case 'status': valid = typeof field === 'string' && statuses.includes(field); break;
      case 'logo_type': valid = field === 'icon' || field === 'image'; break;
      case 'logo_url': valid = field === null || (shortText(field, 2048) && /^https:\/\//.test(field as string)); break;
      case 'allowed_modules': valid = isRecord(field) && Object.entries(field).every(([name, enabled]) => modules.includes(name) && typeof enabled === 'boolean'); break;
      case 'invoices': valid = validInvoices(field); break;
      default: valid = shortText(field);
    }
    if (!valid) throw new Error('Valor inválido para o cadastro da empresa.');
  }
  if (creating && (!value.slug || !value.company_name)) throw new Error('Nome e slug são obrigatórios.');
  return value;
}
