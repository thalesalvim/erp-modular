'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { sendPasswordRecovery } from '@/lib/auth/authService';
import { roleLabel } from '@/lib/auth/authorization';
import { supabase } from '@/lib/supabase';

function AuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <section className="w-full max-w-md space-y-5 rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-pink-600 text-2xl font-black">H</div>
          <h1 className="text-xl font-black">HandyHub Cloud</h1>
        </div>
        {children}
      </section>
    </main>
  );
}

export function AuthLoginForm() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [notice, setNotice] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setNotice('');
    try {
      if (recovery) {
        const redirectTo = new URL('/auth/callback', window.location.origin).toString();
        await sendPasswordRecovery(supabase, email, redirectTo);
        setNotice('Se a conta existir, você receberá um link para redefinir a senha.');
      } else {
        await signIn(email, password);
      }
    } catch {
      setError(recovery ? 'Não foi possível solicitar a recuperação agora.' : 'Não foi possível autenticar esta conta.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard>
      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-center text-sm font-bold">{recovery ? 'Recuperar senha' : 'Entrar com sua conta'}</h2>
        <label className="block text-xs font-bold text-slate-300">
          E-mail
          <input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none focus:border-indigo-500" />
        </label>
        {!recovery && (
          <label className="block text-xs font-bold text-slate-300">
            Senha
            <input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none focus:border-indigo-500" />
          </label>
        )}
        {error && <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-center text-xs font-bold text-rose-300">{error}</p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-center text-xs font-bold text-emerald-300">{notice}</p>}
        <button disabled={pending} className="w-full rounded-xl bg-indigo-600 py-3 text-xs font-black uppercase tracking-wide text-white hover:bg-indigo-500 disabled:opacity-50">
          {pending ? 'Aguarde…' : recovery ? 'Enviar link de recuperação' : 'Entrar'}
        </button>
        <button type="button" onClick={() => { setRecovery((value) => !value); setError(''); setNotice(''); }} className="w-full text-xs font-bold text-indigo-300 hover:underline">
          {recovery ? 'Voltar ao login' : 'Esqueci minha senha'}
        </button>
      </form>
    </AuthCard>
  );
}

export function TenantAuthEntry({ children }: { children: ReactNode }) {
  const { user, memberships, selectedMembership, loading, error, selectTenant, signOut } = useAuth();

  if (loading) {
    return <AuthCard><p role="status" className="text-center text-sm text-slate-300">Confirmando sessão e associações…</p></AuthCard>;
  }
  if (!user) return <AuthLoginForm />;
  if (error) {
    return <AuthCard><p role="alert" className="text-center text-sm text-rose-300">{error}</p><button onClick={() => void signOut()} className="w-full rounded-xl bg-slate-700 py-3 text-xs font-bold">Sair</button></AuthCard>;
  }
  if (memberships.length === 0) {
    return <AuthCard><p className="text-center text-sm">Esta conta ainda não possui associação empresarial ativa.</p><button onClick={() => void signOut()} className="w-full rounded-xl bg-slate-700 py-3 text-xs font-bold">Sair</button></AuthCard>;
  }
  if (memberships.length > 1 && !selectedMembership) {
    return (
      <AuthCard>
        <h2 className="text-center text-sm font-bold">Escolha uma empresa autorizada</h2>
        <div className="space-y-2">
          {memberships.map((membership) => (
            <button key={membership.tenant_id} onClick={() => selectTenant(membership.tenant_id)} className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-left hover:border-indigo-500">
              <span className="block text-sm font-bold">{String(membership.tenant.company_name ?? membership.tenant.companyName ?? membership.tenant.slug)}</span>
              <span className="text-xs text-slate-400">{roleLabel(membership.role)}</span>
            </button>
          ))}
        </div>
        <button onClick={() => void signOut()} className="w-full text-xs font-bold text-slate-400 hover:underline">Sair</button>
      </AuthCard>
    );
  }
  return <>{children}</>;
}
