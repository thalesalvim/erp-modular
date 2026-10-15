import { isAgendaUuid, parseOwnAppointments, type OwnAgendaState } from './own-contract';

export function currentOwnAgendaState(key: string | null,
  result: { key: string; state: OwnAgendaState } | null): OwnAgendaState {
  return key && result?.key === key ? result.state : { status: 'loading' };
}

/** No cache, credentials from the same-origin session; no all_data adapter. */
export async function loadOwnAgenda(tenantId: string, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<OwnAgendaState> {
  if (!isAgendaUuid(tenantId)) return { status: 'error', code: 'ACCESS_DENIED' };
  try {
    const response = await fetcher(`/api/agenda/own?tenantId=${encodeURIComponent(tenantId)}`, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    });
    if (response.status === 401) return { status: 'error', code: 'AUTH_REQUIRED' };
    if (response.status === 403) return { status: 'error', code: 'ACCESS_DENIED' };
    if (!response.ok) return { status: 'error', code: 'AGENDA_UNAVAILABLE' };
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('status' in body) || body.status !== 'ready' || !('items' in body)) {
      return { status: 'error', code: 'AGENDA_UNAVAILABLE' };
    }
    return { status: 'ready', items: parseOwnAppointments(body.items) };
  } catch {
    return { status: 'error', code: 'AGENDA_UNAVAILABLE' };
  }
}
