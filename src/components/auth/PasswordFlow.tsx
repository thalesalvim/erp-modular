'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { PasswordFlow as FlowKind } from '@/lib/auth/password-context';

export function PasswordFlow({ kind, authorized }: { kind: FlowKind; authorized: boolean }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const invite = kind === 'invite';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (password.length < 8 || password.length > 128) { setError('Use entre 8 e 128 caracteres.'); return; }
    if (password !== confirmation) { setError('As senhas não coincidem.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/auth/password', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, password, confirmation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a senha.');
      setPassword(''); setConfirmation(''); setDone(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar a senha.'); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
    <section className="w-full max-w-md space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-8">
      <p className="text-center text-xs font-bold text-indigo-300">{invite ? 'PRIMEIRO ACESSO' : 'RECUPERAÇÃO DE SENHA'}</p>
      <h1 className="text-center text-xl font-black">{invite ? 'Defina sua senha' : 'Defina uma nova senha'}</h1>
      {!authorized ? <p role="alert">Este acesso exige um link de {invite ? 'convite' : 'recuperação'} válido. O link pode ter expirado ou já ter sido utilizado. Solicite outro.</p>
        : done ? <><p role="status">{invite ? 'Sua senha foi definida. Acesso ativado.' : 'Sua senha foi alterada.'}</p>
          <Link href="/" className="block rounded-xl bg-indigo-600 p-3 text-center font-bold">{invite ? 'Entrar na minha empresa' : 'Continuar no HandyHub'}</Link></>
          : <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-slate-300">{invite ? 'Escolha uma senha pessoal. O responsável que enviou o convite não terá acesso a ela.' : 'Escolha a nova senha para sua conta.'} Use pelo menos 8 caracteres.</p>
            <label className="block text-xs font-bold">{invite ? 'Sua senha' : 'Nova senha'}<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3" /></label>
            <label className="block text-xs font-bold">Confirmar senha<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3" /></label>
            {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
            <button disabled={busy} className="w-full rounded-xl bg-indigo-600 py-3 text-xs font-black disabled:opacity-50">{busy ? 'Salvando…' : invite ? 'Ativar meu acesso' : 'Salvar nova senha'}</button>
          </form>}
      {!authorized && <Link href="/" className="block text-center text-xs font-bold text-indigo-300">Ir para o HandyHub</Link>}
    </section>
  </main>;
}
