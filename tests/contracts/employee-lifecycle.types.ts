import type { EmployeeLifecycleArgs, EmployeeLifecycleRow } from '../../src/lib/permissions/employee-lifecycle';
import type { UUID } from '../../src/lib/permissions/policy';
export function assertLifecycleContract(args: EmployeeLifecycleArgs, row: EmployeeLifecycleRow) {
  const id: UUID = row.record_id;
  const membership: boolean | null = row.membership_active;
  // @ts-expect-error Display names never select the subject.
  const name: EmployeeLifecycleArgs = { ...args, p_employee: 'Maria' };
  // @ts-expect-error No role upgrade is part of lifecycle.
  const role: EmployeeLifecycleArgs = { ...args, role: 'owner' };
  // @ts-expect-error No arbitrary actor/identity in a command.
  const actor: EmployeeLifecycleArgs = { ...args, actor_user_id: id };
  // @ts-expect-error No legal/personal free-text audit payload.
  const reason: EmployeeLifecycleArgs = { ...args, p_reason: 'medical details' };
  return { id, membership, name, role, actor, reason };
}
