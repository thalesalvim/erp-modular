'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TenantAuthEntry } from '@/components/auth/AuthEntry';
import { useAuth } from '@/components/auth/AuthProvider';
import { currentOwnAgendaState, loadOwnAgenda } from '@/lib/agenda/own-client';
import type { OwnAgendaState } from '@/lib/agenda/own-contract';

function OwnAppointments({ userId, tenantId }: { userId: string; tenantId: string }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; state: OwnAgendaState } | null>(null);
  const key = `${userId}/${tenantId}/${revision}`;

  useEffect(() => {
    if (!key || !tenantId) return;
    const controller = new AbortController();
    let current = true;
    void loadOwnAgenda(tenantId, controller.signal).then(state => {
      if (current && !controller.signal.aborted) setResult({ key, state });
    });
    return () => { current = false; controller.abort(); };
  }, [key, tenantId]);

  // A response belongs to one verified UI identity/tenant/request only. Old rows
  // disappear immediately on navigation/logout/refresh, before the new effect runs.
  const state = currentOwnAgendaState(key, result);
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
    <section className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-2">
        <Link href="/" className="text-sm font-semibold text-indigo-700 underline">Voltar ao sistema</Link>
        <h1 className="text-2xl font-bold">Meus Agendamentos</h1>
        <p className="text-sm text-slate-600">Consulta dos agendamentos atribuídos a você. Esta tela é somente de leitura.</p>
      </header>
      <button type="button" disabled={!key} onClick={() => setRevision(value => value + 1)}
        className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Atualizar agenda</button>
      <OwnAgendaView state={state} />
    </section>
  </main>;
}

function OwnAppointmentsBoundary() {
  const { user, selectedMembership, loading, error } = useAuth();
  if (loading || error || !user || !selectedMembership) return null;
  // Remount on identity/tenant changes, including A -> B -> A. Never resurrect
  // a previous selection's rows while waiting for fresh authorization.
  return <OwnAppointments key={`${user.id}/${selectedMembership.tenant_id}`}
    userId={user.id} tenantId={selectedMembership.tenant_id} />;
}

export function OwnAgendaPage() {
  return <TenantAuthEntry><OwnAppointmentsBoundary /></TenantAuthEntry>;
}

/** Operational projection only: no price, private notes or mutation actions. */
export function OwnAgendaView({ state }: { state: OwnAgendaState }) {
  if (state.status === 'loading') return <p role="status">Carregando seus agendamentos…</p>;
  if (state.status === 'error') {
    const messages = {
      AUTH_REQUIRED: 'Sua sessão não foi confirmada. Entre novamente para consultar a agenda.',
      ACCESS_DENIED: 'Você não tem acesso à agenda própria nesta empresa.',
      AGENDA_UNAVAILABLE: 'Não foi possível consultar a agenda agora. Tente novamente.',
    };
    return <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-800">{messages[state.code]}</p>;
  }
  if (state.items.length === 0) return <p role="status">Nenhum agendamento atribuído a você nesta empresa.</p>;
  return <ul aria-label="Seus agendamentos" className="space-y-3">
    {state.items.map(item => <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-bold text-indigo-700">{item.date.split('-').reverse().join('/')} às {item.time.slice(0, 8)}</p>
      <h2 className="mt-1 font-bold text-slate-900">{item.clientName}</h2>
      <p className="text-sm text-slate-700">{item.serviceName}</p>
      <p className="mt-2 text-xs text-slate-600">Status: {item.status}</p>
    </li>)}
  </ul>;
}
