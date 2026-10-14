import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Sobre Nós | HandyHub', description: 'Conheça o HandyHub, os contatos oficiais e como adicionar um atalho no celular.' };

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-6 pb-8">
        <Link href="/" prefetch={false} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-indigo-700 underline focus-visible:outline-2 focus-visible:outline-indigo-600">Voltar ao sistema</Link>
        <header className="space-y-3">
          <p className="text-sm font-bold uppercase tracking-widest text-indigo-700">HandyHub</p>
          <h1 className="text-3xl font-black sm:text-4xl">Sobre Nós</h1>
          <p className="leading-relaxed text-slate-600">O HandyHub é um sistema de gestão modular que reúne agenda, atendimentos, clientes, equipe, serviços e vendas. As funções disponíveis respeitam o perfil de acesso e o plano da empresa.</p>
        </header>
        <section aria-labelledby="official-contacts" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 id="official-contacts" className="text-xl font-bold">Contatos oficiais</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <a href="https://wa.me/553798558658" target="_blank" rel="noopener noreferrer" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 font-semibold text-emerald-800 focus-visible:outline-2 focus-visible:outline-emerald-700">WhatsApp<span className="mt-1 block text-sm">+55 37 9855-8658</span><span className="mt-1 block text-xs font-normal">Abre o WhatsApp em outra aba.</span></a>
            <a href="mailto:adm.handyhub@gmail.com" className="min-w-0 rounded-xl border border-indigo-200 bg-indigo-50 p-4 font-semibold text-indigo-800 focus-visible:outline-2 focus-visible:outline-indigo-700">E-mail<span className="mt-1 block break-all text-sm">adm.handyhub@gmail.com</span></a>
          </div>
          <p className="mt-4 text-sm text-slate-600">As mensagens só serão enviadas se você confirmar o envio no seu aplicativo.</p>
        </section>
        <section aria-labelledby="mobile-shortcut" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 id="mobile-shortcut" className="text-xl font-bold">HandyHub na tela inicial do celular</h2>
          <p className="text-sm leading-relaxed text-slate-600">Abra no celular o endereço do ambiente HandyHub autorizado pela sua empresa. Endereços localhost são previews de desenvolvimento e não funcionam em outro aparelho.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <div><h3 className="font-bold">Android — Chrome</h3><ol className="mt-2 list-decimal space-y-2 pl-5 text-sm"><li>Abra o site no Chrome e toque no menu de três pontos.</li><li>Escolha “Instalar e criar atalho” e depois “Criar atalho”. O nome da opção pode variar por versão.</li><li>Confira o nome e toque em “Adicionar”.</li></ol><a href="https://support.google.com/chrome/answer/15085120?co=GENIE.Platform%3DAndroid&hl=pt-BR" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-indigo-700 underline">Instruções oficiais do Chrome</a></div>
            <div><h3 className="font-bold">iPhone — Safari</h3><ol className="mt-2 list-decimal space-y-2 pl-5 text-sm"><li>Abra o site no Safari e toque em compartilhar.</li><li>Escolha “Adicionar à Tela de Início”. Nas versões que oferecem a opção, ative “Abrir como App da Web”.</li><li>Confira o nome e toque em “Adicionar”.</li></ol><a href="https://support.apple.com/pt-br/guide/iphone/iphea86e5236/ios" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-indigo-700 underline">Instruções oficiais da Apple</a></div>
          </div>
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Adicionar um atalho não garante funcionamento sem internet. A experiência PWA completa ainda está em preparação; o acesso continua exigindo conexão e autenticação.</p>
        </section>
      </div>
    </main>
  );
}
