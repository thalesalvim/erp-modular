'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { updateOwnPassword } from '@/lib/auth/authService';
import { supabase } from '@/lib/supabase';

export default function UpdatePasswordPage() {
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active) return;
      setHasSession(!authError && Boolean(data.user));
      setChecking(false);
    });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password.length < 8) {
      setError('Use uma senha com pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setError('As senhas não coincidem.');
      return;
    }
    try {
      await updateOwnPassword(supabase, password);
      setPassword('');
      setConfirmation('');
      setMessage('Senha alterada para a conta Auth autenticada.');
    } catch {
      setError('Não foi possível alterar a senha desta sessão. Solicite um novo link de recuperação.');
    }
  }

  if (checking) return <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">Validando link…</main>;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <section className="w-full max-w-md space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-center text-xl font-black">Definir nova senha</h1>
        {!hasSession ? <p className="text-center text-sm text-rose-300">O link expirou ou não criou uma sessão válida. Solicite outro link.</p> : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-xs font-bold">Nova senha<input required type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3" /></label>
            <label className="block text-xs font-bold">Confirmar senha<input required type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3" /></label>
            {error && <p role="alert" className="text-center text-xs text-rose-300">{error}</p>}
            {message && <p role="status" className="text-center text-xs text-emerald-300">{message}</p>}
            <button className="w-full rounded-xl bg-indigo-600 py-3 text-xs font-black">Salvar nova senha</button>
          </form>
        )}
        <Link href="/" className="block text-center text-xs font-bold text-indigo-300 hover:underline">Voltar ao login</Link>
      </section>
    </main>
  );
}
