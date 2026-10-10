/** Phase 1 specification, NOT wired to the current application or a security boundary.
 * Future server callers must load identity, membership, policy revision and record
 * relationships from trusted storage on EACH request. Never accept this context
 * from JSON, JWT user_metadata, browser state or a service-role impersonation.
 */
import type { TenantRole } from '../auth/authorization';

export type Scope = 'tenant' | 'own' | 'assigned';
export type Action = 'read' | 'create' | 'update' | 'delete';
export type Domain = 'customers' | 'employees' | 'appointments' | 'attendances'
  | 'sales' | 'products' | 'stockMoves' | 'services' | 'promotions' | 'expenses' | 'rolesList';
type DelegatedRole = Exclude<TenantRole, 'owner'>;

type Rule = {
  domain: Domain;
  action: Action;
  scope: Scope;
  fields: readonly string[];
  delegableTo: readonly DelegatedRole[];
};
const manager = ['manager'] as const;
const staff = ['manager', 'employee'] as const;
const read = <const F extends readonly string[]>(domain: Domain, scope: Scope, fields: F,
  delegableTo: readonly DelegatedRole[] = []): Rule & { action: 'read'; fields: F } =>
  Object.freeze({ domain, action: 'read', scope, fields: Object.freeze(fields),
    delegableTo: Object.freeze(delegableTo) });
const write = (domain: Domain, action: Exclude<Action, 'read'>): Rule & { action: Exclude<Action, 'read'>; fields: readonly [] } =>
  Object.freeze({ domain, action, scope: 'tenant', fields: Object.freeze([] as const),
    delegableTo: Object.freeze([] as const) });

/** Stable permission names. Unknown names, wildcards and platform roles deny.
 * Field lists are independent projections: no implicit inheritance/union.
 * Mutations are reserved for Owner until domain-specific patch rules are approved.
 */
export const PERMISSIONS = Object.freeze({
  'customers.read': read('customers', 'tenant', ['id', 'name', 'phone'], manager),
  'customers.read_assigned': read('customers', 'assigned', ['id', 'name'], staff),
  'customers.private_notes.read': read('customers', 'tenant', ['id', 'notes']),
  'employees.read': read('employees', 'tenant', ['id', 'name'], manager),
  'employees.read_own': read('employees', 'own', ['id', 'name'], staff),
  'employees.private.read': read('employees', 'tenant', ['id', 'phone', 'email', 'authUserId']),
  'appointments.read': read('appointments', 'tenant', ['id', 'date', 'time', 'clientName', 'serviceName', 'professionalName', 'status'], manager),
  'appointments.read_own': read('appointments', 'own', ['id', 'date', 'time', 'clientName', 'serviceName', 'status'], staff),
  'finance.appointments.read': read('appointments', 'tenant', ['id', 'price'], manager),
  'appointments.private_notes.read': read('appointments', 'tenant', ['id', 'notes']),
  'attendances.read': read('attendances', 'tenant', ['id', 'date', 'time', 'clientName', 'serviceName', 'professionalName', 'status'], manager),
  'attendances.read_own': read('attendances', 'own', ['id', 'date', 'time', 'clientName', 'serviceName', 'status'], staff),
  'attendances.private_notes.read': read('attendances', 'tenant', ['id', 'notes']),
  'finance.attendances.read': read('attendances', 'tenant', ['id', 'grossValue', 'discount', 'netValue', 'paymentMethod'], manager),
  'sales.read': read('sales', 'tenant', ['id', 'date', 'clientName', 'productName', 'sellerName', 'quantity', 'status'], manager),
  'sales.read_own': read('sales', 'own', ['id', 'date', 'productName', 'quantity', 'status'], staff),
  'sales.private_notes.read': read('sales', 'tenant', ['id', 'notes']),
  'finance.sales.read': read('sales', 'tenant', ['id', 'unitPrice', 'total', 'paymentMethod'], manager),
  'products.read': read('products', 'tenant', ['id', 'name', 'category', 'price'], staff),
  'finance.products.cost.read': read('products', 'tenant', ['id', 'cost'], manager),
  'products.stock.read': read('products', 'tenant', ['id', 'initialStock', 'minStock'], manager),
  'stockMoves.read': read('stockMoves', 'tenant', ['id', 'productName', 'type', 'quantity'], manager),
  'services.read': read('services', 'tenant', ['id', 'name', 'category', 'duration', 'price', 'assignedRole'], staff),
  'promotions.read': read('promotions', 'tenant', ['id', 'title', 'duration', 'discountPercent', 'isAllPromo', 'active'], staff),
  'finance.expenses.read': read('expenses', 'tenant', ['id', 'date', 'description', 'amount', 'category', 'isRecurrent', 'status'], manager),
  'rolesList.read': read('rolesList', 'tenant', ['id', 'name'], manager),
  'customers.create': write('customers', 'create'),
  'customers.update': write('customers', 'update'),
  'customers.delete': write('customers', 'delete'),
  'employees.create': write('employees', 'create'),
  'employees.update': write('employees', 'update'),
  'employees.delete': write('employees', 'delete'),
  'appointments.create': write('appointments', 'create'),
  'appointments.update': write('appointments', 'update'),
  'appointments.delete': write('appointments', 'delete'),
  'attendances.create': write('attendances', 'create'),
  'attendances.update': write('attendances', 'update'),
  'attendances.delete': write('attendances', 'delete'),
  'sales.create': write('sales', 'create'),
  'sales.update': write('sales', 'update'),
  'sales.delete': write('sales', 'delete'),
  'products.create': write('products', 'create'),
  'products.update': write('products', 'update'),
  'products.delete': write('products', 'delete'),
  'stockMoves.create': write('stockMoves', 'create'),
  'stockMoves.update': write('stockMoves', 'update'),
  'stockMoves.delete': write('stockMoves', 'delete'),
  'services.create': write('services', 'create'),
  'services.update': write('services', 'update'),
  'services.delete': write('services', 'delete'),
  'promotions.create': write('promotions', 'create'),
  'promotions.update': write('promotions', 'update'),
  'promotions.delete': write('promotions', 'delete'),
  'finance.expenses.create': write('expenses', 'create'),
  'finance.expenses.update': write('expenses', 'update'),
  'finance.expenses.delete': write('expenses', 'delete'),
  'rolesList.create': write('rolesList', 'create'),
  'rolesList.update': write('rolesList', 'update'),
  'rolesList.delete': write('rolesList', 'delete'),
} as const satisfies Record<string, Rule>);
export type Permission = keyof typeof PERMISSIONS;
export type ReadPermission = { [P in Permission]: typeof PERMISSIONS[P]['action'] extends 'read' ? P : never }[Permission];
export type WritePermission = Exclude<Permission, ReadPermission>;

/** Opaque IDs prevent accidentally using names or slugs as identity. */
declare const uuidBrand: unique symbol;
export type UUID = string & { readonly [uuidBrand]: true };
export function uuid(value: string): UUID {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid UUID');
  return value.toLowerCase() as UUID;
}
export interface RolePolicy {
  readonly tenantId: UUID;
  readonly revision: number;
  readonly grants: Readonly<Record<DelegatedRole, readonly Permission[]>>;
}
export interface AuthorizationContext {
  readonly userId: UUID;
  readonly membership: { readonly userId: UUID; readonly tenantId: UUID; readonly role: TenantRole; readonly active: boolean };
  readonly tenantActive: boolean;
  readonly policy: RolePolicy;
  /** Current authorization revision, obtained from trusted storage, not the JWT. */
  readonly currentRevision: number;
}
export interface RecordScope {
  readonly tenantId: UUID;
  /** Resolved through a verified tenant + employee -> Auth relationship. */
  readonly subjectUserId?: UUID | null;
  readonly assignedUserIds?: readonly UUID[];
}
export type Denial = { readonly status: 'denied'; readonly code: 'ACCESS_DENIED' };
export type Decision = Denial | { readonly status: 'allowed'; readonly scope: Scope };
const deny = (): Denial => ({ status: 'denied', code: 'ACCESS_DENIED' });
function known(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
function validContext(ctx: AuthorizationContext | null, tenantId: UUID): ctx is AuthorizationContext {
  return !!ctx && ctx.membership.active === true && ctx.tenantActive === true
    && ['owner', 'manager', 'employee'].includes(ctx.membership.role)
    && ctx.userId === ctx.membership.userId && ctx.membership.tenantId === tenantId
    && ctx.policy.tenantId === tenantId && Number.isSafeInteger(ctx.currentRevision)
    && ctx.currentRevision >= 0 && ctx.policy.revision === ctx.currentRevision;
}
export function authorize(ctx: AuthorizationContext | null, permission: string, record: RecordScope): Decision {
  if (!known(permission) || !validContext(ctx, record.tenantId)) return deny();
  const rule: Rule = PERMISSIONS[permission];
  const role = ctx.membership.role;
  if (role !== 'owner' && (!rule.delegableTo.includes(role) || !ctx.policy.grants[role]?.includes(permission))) return deny();
  // Even Owner's request for a personal projection is scoped; use the tenant permission for broader reads.
  if (rule.scope === 'own' && record.subjectUserId !== ctx.userId) return deny();
  if (rule.scope === 'assigned' && !record.assignedUserIds?.includes(ctx.userId)) return deny();
  return { status: 'allowed', scope: rule.scope };
}

/** Whole role grant replacement is only a planning result, never a database write.
 * Future persistence requires an atomic revision comparison + increment + audit.
 * Manager delegation remains denied pending a reviewed subdelegation model.
 */
export function planDelegation(ctx: AuthorizationContext | null, tenantId: UUID,
  targetRole: string, requested: readonly string[]): Denial | {
    status: 'allowed'; tenantId: UUID; targetRole: DelegatedRole;
    expectedRevision: number; grants: readonly Permission[];
  } {
  if (!validContext(ctx, tenantId) || ctx.membership.role !== 'owner'
    || (targetRole !== 'manager' && targetRole !== 'employee')) return deny();
  if (requested.some(p => !known(p) || !(PERMISSIONS[p].delegableTo as readonly string[]).includes(targetRole))) return deny();
  return { status: 'allowed', tenantId, targetRole, expectedRevision: ctx.currentRevision,
    grants: [...new Set(requested)] as Permission[] };
}

export type Scalar = string | number | boolean | null;
export type ReadDTO<P extends ReadPermission> = Readonly<{
  [F in typeof PERMISSIONS[P]['fields'][number]]: Scalar;
}>;
/** Denied results have no data property. Empty authorized lists have items: []. */
export type ReadResult<P extends ReadPermission> = Denial | {
  readonly status: 'allowed'; readonly permission: P; readonly items: readonly ReadDTO<P>[];
  readonly tenantId: UUID; readonly policyRevision: number;
};
/** Server contract prototype: strips unknown fields and rejects nested values.
 * Not an adapter for all_data and NEVER to be run as a browser-only filter.
 */
export function projectRecord<P extends ReadPermission>(ctx: AuthorizationContext | null, permission: P,
  scope: RecordScope, source: Readonly<Record<string, unknown>>): ReadResult<P> {
  if (!known(permission) || PERMISSIONS[permission].action !== 'read'
    || authorize(ctx, permission, scope).status !== 'allowed' || !ctx) return deny();
  const dto: Record<string, Scalar> = {};
  for (const field of PERMISSIONS[permission].fields) {
    const value = source[field];
    if (!Object.hasOwn(source, field) || !(value === null || typeof value === 'string'
      || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) return deny();
    dto[field] = value;
  }
  return { status: 'allowed', permission, items: [dto as ReadDTO<P>],
    tenantId: scope.tenantId, policyRevision: ctx.currentRevision };
}

/** No full-collection replacement or tenant/identity/assignment fields in a patch.
 * Phase 2 must supply separate per-domain allowlisted patch schemas; nothing
 * here authorizes executing a write or deleting records omitted from a response.
 */
export interface RecordCommand<P extends WritePermission, Patch extends object> {
  readonly permission: P;
  readonly recordId: UUID;
  readonly tenantId: UUID;
  readonly expectedVersion: number;
  readonly patch: Patch;
}
export type MutationResult = Denial | { status: 'conflict'; code: 'VERSION_CONFLICT' }
  | { status: 'applied'; recordId: UUID; version: number };
