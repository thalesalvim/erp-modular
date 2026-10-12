import type { UUID } from './policy';

/** Local SQL command contracts, not application APIs. Numeric strings avoid
 * binary floating-point calculations; the database rejects fractional cents.
 * BRL is the only supported posting currency pending broader business approval.
 */
export interface PostHistoricalSaleArgs {
  readonly p_tenant: UUID;
  readonly p_record: UUID;
  readonly p_product: UUID;
  readonly p_expected_product_version: number;
  readonly p_seller: UUID;
  readonly p_customer: UUID | null;
  readonly p_occurred_on: string;
  readonly p_quantity: number;
  readonly p_unit_price: string;
  readonly p_discount: string;
  readonly p_unit_cost: string;
  readonly p_cost_reference: string;
  readonly p_payment_method: string;
  readonly p_currency_code: 'BRL';
}

export interface PostHistoricalAttendanceArgs {
  readonly p_tenant: UUID;
  readonly p_record: UUID;
  readonly p_service: UUID;
  readonly p_expected_service_version: number;
  readonly p_professional: UUID;
  readonly p_customer: UUID;
  readonly p_occurred_on: string;
  readonly p_occurred_at: string;
  readonly p_gross_value: string;
  readonly p_discount: string;
  readonly p_payment_method: string;
  readonly p_currency_code: 'BRL';
}

/** RPCs return only a UUID. Labels, actor and totals are resolved by the database.
 * 40001 VERSION_CONFLICT and 23505 duplicate record require explicit handling,
 * never automatic re-posting with a new record UUID.
 */
export type HistoricalPostingId = UUID;
