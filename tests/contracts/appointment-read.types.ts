import type { OwnAppointmentDTO, OwnAppointmentsRpcArgs } from '../../src/lib/permissions/appointment-read';
import type { ReadDTO, UUID } from '../../src/lib/permissions/policy';

type Assert<T extends true> = T;
export type ExactProjection = Assert<
  [Exclude<keyof OwnAppointmentDTO, keyof ReadDTO<'appointments.read_own'>>,
    Exclude<keyof ReadDTO<'appointments.read_own'>, keyof OwnAppointmentDTO>] extends [never, never]
    ? true : false
>;
export function assertOwnAgendaContract(row: OwnAppointmentDTO, tenantId: UUID) {
  const args: OwnAppointmentsRpcArgs = { p_tenant: tenantId };
  const id: UUID = row.id;
  const labels: readonly string[] = [row.date, row.time, row.clientName, row.serviceName, row.status];
  // @ts-expect-error No service or appointment financial price in the own projection.
  const price = row.price;
  // @ts-expect-error No confidential notes in the own projection.
  const notes = row.notes;
  // @ts-expect-error Contact details are not operational agenda fields.
  const phone = row.phone;
  // @ts-expect-error No professional name or user selector in the own projection.
  const professionalName = row.professionalName;
  // @ts-expect-error RPC accepts no arbitrary subject identity.
  const forged: OwnAppointmentsRpcArgs = { p_tenant: tenantId, p_user: id };
  // @ts-expect-error A display name cannot select the tenant.
  const invalid: OwnAppointmentsRpcArgs = { p_tenant: 'Owner C' };
  return { args, id, labels, price, notes, phone, professionalName, forged, invalid };
}
