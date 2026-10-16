'use client';

import { useEffect, useRef, useState } from 'react';
import type { CustomerDraft } from './registration';

export interface CustomerItem { id: string; version: number; fullName: string }
export interface CustomerRecord { id: string; version: number; draft: CustomerDraft }
export interface CustomerPersistence {
  items: CustomerItem[];
  startNew(): void;
  read(id: string): Promise<CustomerRecord>;
  save(draft: CustomerDraft, current: { id: string; version: number } | null, reason: string): Promise<{ id: string; version: number }>;
}
const messages: Record<string, string> = {
  CUSTOMER_CPF_CONFLICT: 'Já existe um cliente com esse CPF nesta empresa.',
  CUSTOMER_REVIEW_REQUIRED: 'Nome semelhante ou telefone compartilhado. Revise o conflito e informe uma justificativa antes de salvar.',
  VERSION_CONFLICT: 'O cadastro foi alterado. Consulte-o novamente antes de editar.',
  IDEMPOTENCY_CONFLICT: 'Esta operação já foi utilizada com outros dados. Consulte o cadastro antes de tentar novamente.',
  INVALID_CUSTOMER_FIELDS: 'O servidor recusou os campos. Confira nome, CPF, nascimento e telefone.',
  INVALID_JUSTIFICATION: 'Informe uma justificativa de pelo menos dez caracteres, sem dados pessoais.',
  ACCESS_DENIED: 'Sua conta não está autorizada para este piloto.',
  AUTH_REQUIRED: 'Sua sessão expirou. Entre novamente.',
};
export class CustomerPersistenceError extends Error {
  constructor(public readonly code: string) { super(messages[code] ?? 'Não foi possível confirmar a operação. Tente novamente ou consulte o cadastro.'); }
}
async function receive(response: Response) {
  const value = await response.json();
  if (!response.ok) throw new CustomerPersistenceError(typeof value.code === 'string' ? value.code : 'CUSTOMERS_UNAVAILABLE');
  return value;
}
/** No local storage and no legacy adapter. Identity changes invalidate the entire scope. */
export function useCustomerPersistence(scope: string | null, tenantId: string | undefined, owner: boolean) {
  const [state, setState] = useState<{ scope: string; items: CustomerItem[] } | null>(null);
  const operation = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => {
    if (!scope || !tenantId || !owner) return;
    const abort = new AbortController();
    void fetch(`/api/customers?tenantId=${encodeURIComponent(tenantId)}`, { cache: 'no-store', signal: abort.signal })
      .then(r => r.ok ? r.json() : null).then(value => {
        if (!abort.signal.aborted && value && Array.isArray(value.items)) setState({ scope, items: value.items });
      }).catch(() => { /* Fail closed; preparation remains available without a writer. */ });
    return () => abort.abort();
  }, [scope, tenantId, owner]);
  if (!scope || !owner || !tenantId || state?.scope !== scope) return null;
  const persistence: CustomerPersistence = {
    items: state.items,
    startNew() { operation.current = null; },
    async read(id) {
      return receive(await fetch(`/api/customers?tenantId=${encodeURIComponent(tenantId)}&customerId=${encodeURIComponent(id)}`, { cache: 'no-store' }));
    },
    async save(draft, current, reason) {
      const payload = JSON.stringify({ tenantId, draft, current, reason });
      if (operation.current?.payload !== payload) operation.current = { payload, id: crypto.randomUUID() };
      const result = await receive(await fetch('/api/customers', {
        method: current ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, draft, operationId: operation.current.id, ...(current ? { customerId: current.id, expectedVersion: current.version } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      }));
      // A confirmed commit must not become an apparent save failure if list refresh fails.
      setState(previous => previous?.scope === scope ? { scope, items: [...previous.items.filter(item => item.id !== result.id), { id: result.id, version: result.version, fullName: draft.fullName.trim() }] } : previous);
      try {
        const list = await fetch(`/api/customers?tenantId=${encodeURIComponent(tenantId)}`, { cache: 'no-store' });
        if (list.ok) { const value = await list.json(); if (Array.isArray(value.items)) setState(previous => previous?.scope === scope ? { scope, items: value.items } : previous); }
      } catch { /* The receipt already confirmed the SQL commit; never retry as a new write. */ }
      return result;
    },
  };
  return persistence;
}
