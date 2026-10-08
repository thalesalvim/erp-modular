'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AuthLoginForm } from '@/components/auth/AuthEntry';
import { useAuth } from '@/components/auth/AuthProvider';
import { updateOwnEmail, updateOwnPassword } from '@/lib/auth/authService';
import { supabase } from '@/lib/supabase';

export default function AccountSecurityPage() {
  const { user, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  if (!user) return <AuthLoginForm />;

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const callback = new URL('/auth/callback?next=%2Fauth%2Faccount', window.location.origin).toString();
      await updateOwnEmail(supabase, email, callback);
      setEmail('');
      setNotice('Solicitação enviada. Confirme a alteração pelo link enviado pelo Supabase Auth.');
    } catch {
      setError('Não foi possível solicitar a alteração do e-mail desta conta.');
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await updateOwnPassword(supabase, password);
      setPassword('');
      setNotice('Senha da conta Auth alterada.');
    } catch {
      setError('Não foi possível alterar a senha desta conta.');
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl space-y-6 bg-slate-950 p-6 text-slate-100">
      <header className="flex items-center justify-between"><h1 className="text-xl font-black">Segurança da conta</h1><button onClick={() => void signOut().catch(() => undefined)} className="text-xs font-bold text-rose-300">Sair</button></header>
      <p className="text-sm text-slate-300">Conta autenticada: {user.email ?? 'e-mail indisponível'}</p>
      <form onSubmit={changeEmail} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="font-bold">Alterar e-mail</h2>
        <input required type="email" autoComplete="email" placeholder="Novo e-mail" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3" />
        <button className="rounded-xl bg-indigo-600 px-4 py-3 text-xs font-bold">Solicitar alteração</button>
      </form>
      <form onSubmit={changePassword} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="font-bold">Alterar senha</h2>
        <input required type="password" minLength={8} autoComplete="new-password" placeholder="Nova senha (mín. 8 caracteres)" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3" />
        <button className="rounded-xl bg-indigo-600 px-4 py-3 text-xs font-bold">Alterar senha</button>
      </form>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
      <Link href="/" className="text-xs font-bold text-indigo-300 hover:underline">Voltar ao HandyHub</Link>
    </main>
  );
}
