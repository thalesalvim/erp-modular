'use client';

import Link from 'next/link';
import { TenantAuthEntry } from '@/components/auth/AuthEntry';
import { useAuth } from '@/components/auth/AuthProvider';
import { isTenantRole } from '@/lib/auth/authorization';
import { CustomerRegistrationPreparation } from '@/components/customers/CustomerRegistrationPreparation';

function CustomerPreparationBoundary() {
  const { user, selectedMembership, loading, error } = useAuth();
  if (loading || error || !user || !selectedMembership?.is_active || !isTenantRole(selectedMembership.role)) return null;
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <Link href="/" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-semibold text-indigo-700 underline">Voltar ao sistema</Link>
        <header className="space-y-2">
          <h1 className="text-2xl font-bold sm:text-3xl">Cadastro Inteligente de Clientes</h1>
          <p className="text-sm text-slate-700">Primeira etapa: preparar os campos do titular, sem persistência ou concessão de acesso.</p>
        </header>
        <CustomerRegistrationPreparation key={`${user.id}/${selectedMembership.tenant_id}/${selectedMembership.role}`} role={selectedMembership.role} />
      </div>
    </main>
  );
}

export default function CustomerPreparationPage() {
  return <TenantAuthEntry><CustomerPreparationBoundary /></TenantAuthEntry>;
}
