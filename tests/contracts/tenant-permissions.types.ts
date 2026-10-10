// Compile-time contract assertions, checked by tsc (not remote tests).
import type { ReadDTO, ReadResult, RecordCommand, UUID } from '../../src/lib/permissions/policy';
import { uuid } from '../../src/lib/permissions/policy';

export function assertResponseNarrowing(response: ReadResult<'appointments.read_own'>) {
  if (response.status === 'denied') {
    // @ts-expect-error A denied result must not expose an empty or partial collection.
    return response.items;
  }
  const record = response.items[0];
  // @ts-expect-error Personal appointment DTO has no financial price.
  const price = record.price;
  // @ts-expect-error Private notes cannot enter the personal response type.
  const notes = record.notes;
  return { record, price, notes };
}
// @ts-expect-error Display names cannot identify an authorization subject.
const invalidIdentity: UUID = 'Maria';
// @ts-expect-error Read permission cannot be used as a mutation command.
type InvalidCommand = RecordCommand<'products.read', { name: string }>;
// @ts-expect-error Unknown permissions cannot define response contracts.
type UnknownDTO = ReadDTO<'master.read'>;
const denied: ReadResult<'products.read'> = {
  status: 'denied', code: 'ACCESS_DENIED',
  // @ts-expect-error Denial and list data cannot be combined.
  items: [],
};
const empty: ReadResult<'products.read'> = {
  status: 'allowed', permission: 'products.read', items: [],
  tenantId: uuid('00000000-0000-4000-8000-000000000001'), policyRevision: 0,
};
void [invalidIdentity, denied, empty];
export type CompileTimeCases = [InvalidCommand, UnknownDTO];
