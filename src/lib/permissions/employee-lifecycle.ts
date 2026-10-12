import type { UUID } from './policy';

export type LifecycleReason = 'offboarding' | 'temporary_leave' | 'authorized_return' | 'correction';
/** Local SQL contract; Owner-only. No Auth account deletion/ban, role change or reassignment. */
export interface EmployeeLifecycleArgs {
  readonly p_tenant: UUID;
  readonly p_employee: UUID;
  readonly p_expected_version: number;
  readonly p_is_active: boolean;
  readonly p_reason: LifecycleReason;
}
export interface EmployeeLifecycleRow {
  readonly record_id: UUID;
  readonly version: number;
  readonly is_active: boolean;
  /** null = no verified Auth link; true staff status alone does not restore a blocked membership. */
  readonly membership_active: boolean | null;
}
// VERSION_CONFLICT / MEMBERSHIP_CONFLICT (40001): reload and review; no automatic retry.
// ACCESS_DENIED (42501), ERP_MAINTENANCE (55000): never interpreted as successful activation.
