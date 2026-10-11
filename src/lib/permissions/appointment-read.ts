import type { ReadDTO, UUID } from './policy';

/** SQL RPC projection only; not wired to an API/page or a browser authorization filter.
 * Names are current labels, never identity. Database identity is auth.uid().
 */
export type OwnAppointmentDTO = ReadDTO<'appointments.read_own'> & Readonly<{
  id: UUID;
  date: string; // YYYY-MM-DD, tenant-local date; no timezone conversion.
  time: string; // HH:mm:ss[.fraction], tenant-local time.
  clientName: string;
  serviceName: string;
  status: string;
}>;

export interface OwnAppointmentsRpcArgs {
  readonly p_tenant: UUID;
}

/** 42501 ACCESS_DENIED must map to denial, never an authorized empty list.
 * A permitted identity with no linked/assigned appointment legitimately gets [].
 * Membership and grants must be checked per request; no cross-user/tenant caching.
 */
export type OwnAppointmentsRpcRows = readonly OwnAppointmentDTO[];
