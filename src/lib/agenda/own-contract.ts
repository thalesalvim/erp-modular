import type { OwnAppointmentDTO } from '../permissions/appointment-read';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = ['id', 'date', 'time', 'clientName', 'serviceName', 'status'] as const;

export function isAgendaUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Fail closed on schema drift. Never turn malformed/denied data into []. */
export function parseOwnAppointments(value: unknown): readonly OwnAppointmentDTO[] {
  if (!Array.isArray(value)) throw new Error('Invalid own agenda projection');
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid own agenda row');
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).length !== FIELDS.length ||
        FIELDS.some(field => !Object.hasOwn(row, field) || typeof row[field] !== 'string') ||
        !isAgendaUuid(row.id) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date as string) ||
        !/^\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(row.time as string) || seen.has(row.id.toLowerCase())) {
      throw new Error('Invalid own agenda row');
    }
    seen.add(row.id.toLowerCase());
    // Exact DTO; neither unknown fields nor nested/provider objects reach the browser.
    return Object.fromEntries(FIELDS.map(field => [field, row[field]])) as unknown as OwnAppointmentDTO;
  });
}

export type OwnAgendaState =
  | { status: 'loading' }
  | { status: 'ready'; items: readonly OwnAppointmentDTO[] }
  | { status: 'error'; code: 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'AGENDA_UNAVAILABLE' };
