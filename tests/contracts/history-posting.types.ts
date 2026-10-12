import type { PostHistoricalSaleArgs, PostHistoricalAttendanceArgs } from '../../src/lib/permissions/history-posting';
import type { UUID } from '../../src/lib/permissions/policy';

export function assertHistoryContracts(sale: PostHistoricalSaleArgs, attendance: PostHistoricalAttendanceArgs) {
  const recordId: UUID = sale.p_record;
  const money: readonly string[] = [sale.p_unit_price, sale.p_discount, sale.p_unit_cost, attendance.p_gross_value];
  // @ts-expect-error Binary floating-point amounts are not command money contracts.
  const wrongMoney: PostHistoricalSaleArgs = { ...sale, p_unit_cost: 1.2 };
  // @ts-expect-error Display labels are resolved from UUID relationships, not supplied by the caller.
  const forgedLabel: PostHistoricalSaleArgs = { ...sale, product_name_snapshot: 'forged' };
  // @ts-expect-error Posting identity is auth.uid(), not a caller-selected actor.
  const forgedActor: PostHistoricalAttendanceArgs = { ...attendance, actor_user_id: recordId };
  // @ts-expect-error Unsupported currency must remain denied.
  const wrongCurrency: PostHistoricalSaleArgs = { ...sale, p_currency_code: 'USD' };
  // @ts-expect-error No optimistic overwrite of a historical record.
  sale.p_quantity = 5;
  // @ts-expect-error Names cannot select a professional.
  const wrongProfessional: PostHistoricalAttendanceArgs = { ...attendance, p_professional: 'Maria' };
  return { recordId, money, wrongMoney, forgedLabel, forgedActor, wrongCurrency, wrongProfessional };
}
