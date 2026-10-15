/** Local preparation only. These checks do not authorize or persist customers. */
export interface CustomerDraft {
  fullName: string;
  cpf: string;
  birthDate: string;
  phone: string;
}
export type CustomerField = keyof CustomerDraft;
export type CustomerErrors = Partial<Record<CustomerField, string>>;

const digits = (value: string) => value.replace(/\D/g, '');

export function formatCpf(value: string): string {
  return digits(value).slice(0, 11).replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

export function validCpf(value: unknown): boolean {
  if (typeof value !== 'string' || !/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(value.trim())) return false;
  const cpf = digits(value);
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  for (const length of [9, 10]) {
    const sum = [...cpf.slice(0, length)].reduce((total, n, i) => total + Number(n) * (length + 1 - i), 0);
    const remainder = (sum * 10) % 11;
    if (Number(cpf[length]) !== (remainder === 10 ? 0 : remainder)) return false;
  }
  return true;
}

function nationalPhone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[\d\s()+.-]+$/.test(value)) return null;
  let phone = digits(value);
  if (/^55\d{10,11}$/.test(phone)) phone = phone.slice(2);
  if (!/^\d{10,11}$/.test(phone) || /^(\d)\1+$/.test(phone) || Number(phone.slice(0, 2)) < 11) return null;
  if (phone.length === 11 && phone[2] !== '9') return null;
  if (phone.length === 10 && !/[2-5]/.test(phone[2])) return null;
  return phone;
}

export function normalizePhone(value: unknown): string | null {
  const phone = nationalPhone(value);
  return phone ? `+55${phone}` : null;
}

export function formatPhone(value: string): string {
  let phone = digits(value);
  if (/^55\d{10,11}$/.test(phone)) phone = phone.slice(2);
  phone = phone.slice(0, 11);
  if (!phone) return '';
  if (phone.length <= 2) return `(${phone}`;
  const local = phone.slice(2);
  const split = local.length > 8 ? 5 : 4;
  return `(${phone.slice(0, 2)}) ${local.slice(0, split)}${local.length > split ? `-${local.slice(split)}` : ''}`;
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validBirthDate(value: unknown, today: string): boolean {
  return typeof value === 'string' && calendarDate(today) && calendarDate(value) && value <= today;
}

export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function validFullName(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 200 || !/^[\p{L}\p{M} '\u2019-]+$/u.test(value)) return false;
  return value.trim().split(/\s+/).filter(part => (part.match(/\p{L}/gu) ?? []).length >= 2).length >= 2;
}

export function validateCustomerDraft(draft: CustomerDraft, today: string): CustomerErrors {
  const errors: CustomerErrors = {};
  if (!validFullName(draft.fullName)) errors.fullName = 'Informe nome e sobrenome, sem números, com até 200 caracteres.';
  if (!validCpf(draft.cpf)) errors.cpf = 'Informe um CPF válido com 11 dígitos. Sequências repetidas não são aceitas.';
  if (!validBirthDate(draft.birthDate, today)) errors.birthDate = 'Informe uma data de nascimento existente e não futura.';
  if (!normalizePhone(draft.phone)) errors.phone = 'Informe telefone brasileiro com DDD e 10 ou 11 dígitos.';
  return errors;
}

function nameKey(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^\p{L} ]/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function similarCustomerName(a: string, b: string): boolean {
  if (a.length > 200 || b.length > 200) return false;
  const left = nameKey(a), right = nameKey(b);
  if (!left || !right) return false;
  if (left === right || left.split(' ').sort().join(' ') === right.split(' ').sort().join(' ')) return true;
  if (Math.min(left.length, right.length) < 8 || Math.abs(left.length - right.length) > 2) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    previous = next;
  }
  return previous[right.length] <= 2;
}

export interface CustomerReviewRecord {
  id: string;
  tenantId: string;
  fullName: string;
  cpf?: string;
  birthDate?: string;
  phone?: string;
}
export interface CustomerReview {
  status: 'unavailable' | 'partial' | 'complete';
  cpfConflict: boolean;
  similarName: boolean;
  sharedPhone: boolean;
}
const unavailable = (): CustomerReview => ({ status: 'unavailable', cpfConflict: false, similarName: false, sharedPhone: false });

/** Receives an explicitly scoped snapshot in tests; NO database/cache lookup.
 * Production will require a fresh authorized server projection, never caller claims.
 * Only booleans are returned; no CPF, name or identifier of another record. */
export function reviewCustomerDuplicates(draft: CustomerDraft, tenantId: string,
  catalog: { tenantId: string; records: readonly CustomerReviewRecord[] } | null, editingId?: string): CustomerReview {
  if (!tenantId || !catalog || catalog.tenantId !== tenantId || !Array.isArray(catalog.records)) return unavailable();
  const ids = new Set<string>();
  for (const row of catalog.records) {
    if (!row || row.tenantId !== tenantId || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.fullName !== 'string') return unavailable();
    ids.add(row.id);
  }
  // Unknown update identity must not silently become a creation or exclusion.
  if (editingId !== undefined && !ids.has(editingId)) return unavailable();
  const records = catalog.records.filter(row => row.id !== editingId);
  const incomplete = catalog.records.some(row => !validFullName(row.fullName) || !validCpf(row.cpf) || !normalizePhone(row.phone) || !row.birthDate || !calendarDate(row.birthDate));
  return {
    status: incomplete ? 'partial' : 'complete',
    cpfConflict: validCpf(draft.cpf) && records.some(row => validCpf(row.cpf) && digits(row.cpf!) === digits(draft.cpf)),
    similarName: records.some(row => similarCustomerName(row.fullName, draft.fullName)),
    sharedPhone: normalizePhone(draft.phone) !== null && records.some(row => normalizePhone(row.phone) === normalizePhone(draft.phone)),
  };
}

export function planCustomerReview(role: unknown, review: CustomerReview, justification: string) {
  const canPersist = false as const;
  if (role !== 'owner' && role !== 'manager' && role !== 'employee') return { step: 'denied' as const, canPersist };
  if (review.cpfConflict) return { step: 'blocked-cpf' as const, canPersist };
  if (review.status !== 'complete') return { step: 'needs-catalog' as const, canPersist };
  if (review.similarName || review.sharedPhone) {
    if (role === 'employee') return { step: 'request-review' as const, canPersist };
    if (justification.trim().length < 10) return { step: 'needs-justification' as const, canPersist };
    return { step: 'review-prepared' as const, canPersist };
  }
  return { step: 'fields-prepared' as const, canPersist };
}
