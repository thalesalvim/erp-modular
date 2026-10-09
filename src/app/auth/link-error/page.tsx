import Link from 'next/link';
export default function AuthLinkErrorPage() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
    <section className="w-full max-w-md space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-8">
      <h1 className="text-xl font-black">Este link não pôde ser confirmado</h1>
      <p role="alert">O link pode estar inválido, expirado ou já ter sido utilizado. Nenhuma ativação foi concluída.</p>
      <p className="text-sm text-slate-300">Para primeiro acesso, peça um novo convite ao responsável pela empresa. Para recuperar a senha, solicite um novo e-mail na tela de login.</p>
      <Link href="/" className="block font-bold text-indigo-300">Ir para o HandyHub</Link>
    </section>
  </main>;
}
