'use client';

import { useId, useState, type FormEvent } from 'react';
import type { TenantRole } from '@/lib/auth/authorization';
import { formatCpf, formatPhone, localToday, validateCustomerDraft, type CustomerDraft, type CustomerErrors, type CustomerField } from '@/lib/customers/registration';

export function CustomerRegistrationPreparation({ role }: { role: TenantRole }) {
  const id = useId();
  const [draft, setDraft] = useState<CustomerDraft>({ fullName: '', cpf: '', birthDate: '', phone: '' });
  const [errors, setErrors] = useState<CustomerErrors | null>(null);
  const [justification, setJustification] = useState('');

  function change(field: CustomerField, value: string) {
    setDraft(previous => ({ ...previous, [field]: value }));
    setErrors(null);
  }
  function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors(validateCustomerDraft(draft, localToday()));
  }
  const classes = 'mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-400 bg-white p-3 text-slate-900 focus-visible:outline-2 focus-visible:outline-indigo-600';
  const help = (field: CustomerField) => `${id}-${field}-help`;
  return (
    <div className="space-y-5">
      <section aria-labelledby={`${id}-blocked`} className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <h2 id={`${id}-blocked`} className="font-bold">Preparação local — gravação indisponível</h2>
        <p className="mt-2">O servidor ainda não garante CPF único, revisão de conflitos ou atualização normalizada. Este formulário não cria nem altera clientes e não consulta cadastros de nenhuma empresa.</p>
        <p className="mt-2">Use dados fictícios nesta avaliação. Os campos ficam apenas em memória e são descartados ao sair, recarregar ou trocar usuário ou empresa. Não há salvamento de rascunho.</p>
      </section>
      <form noValidate onSubmit={validate} className="space-y-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-fullName`} className="text-sm font-bold">Nome completo *</label>
            <input id={`${id}-fullName`} type="text" required maxLength={200} autoComplete="off" value={draft.fullName} onChange={e => change('fullName', e.target.value)} aria-invalid={Boolean(errors?.fullName)} aria-describedby={help('fullName')} className={classes} />
            <p id={help('fullName')} className="mt-1 text-sm text-slate-700">{errors?.fullName ?? 'Informe o nome e sobrenome do titular.'}</p>
          </div>
          <div>
            <label htmlFor={`${id}-cpf`} className="text-sm font-bold">CPF do titular *</label>
            <input id={`${id}-cpf`} type="text" inputMode="numeric" required maxLength={14} autoComplete="off" value={draft.cpf} onChange={e => change('cpf', formatCpf(e.target.value))} aria-invalid={Boolean(errors?.cpf)} aria-describedby={help('cpf')} className={classes} placeholder="000.000.000-00" />
            <p id={help('cpf')} className="mt-1 text-sm text-slate-700">{errors?.cpf ?? 'A validação dos dígitos não comprova identidade ou situação cadastral.'}</p>
          </div>
          <div>
            <label htmlFor={`${id}-birthDate`} className="text-sm font-bold">Data de nascimento *</label>
            <input id={`${id}-birthDate`} type="date" required autoComplete="off" value={draft.birthDate} onChange={e => change('birthDate', e.target.value)} aria-invalid={Boolean(errors?.birthDate)} aria-describedby={help('birthDate')} className={classes} />
            <p id={help('birthDate')} className="mt-1 text-sm text-slate-700">{errors?.birthDate ?? 'Dia, mês e ano; datas futuras não são aceitas.'}</p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-phone`} className="text-sm font-bold">Telefone / WhatsApp *</label>
            <input id={`${id}-phone`} type="tel" inputMode="tel" required maxLength={20} autoComplete="off" value={draft.phone} onChange={e => change('phone', formatPhone(e.target.value))} aria-invalid={Boolean(errors?.phone)} aria-describedby={help('phone')} className={classes} placeholder="(11) 90000-0000" />
            <p id={help('phone')} className="mt-1 text-sm text-slate-700">{errors?.phone ?? 'Telefone brasileiro com DDD. Número compartilhado gera revisão, não bloqueio automático.'}</p>
          </div>
        </div>
        <section aria-labelledby={`${id}-review`} className="rounded-xl bg-slate-100 p-4 text-sm">
          <h2 id={`${id}-review`} className="font-bold">Duplicidades e revisão</h2>
          <p className="mt-2">CPF repetido na mesma empresa deve ser bloqueado. Nomes semelhantes e telefone repetido exigem análise. A consulta segura de duplicidades ainda não está conectada.</p>
          <p className="mt-2">{role === 'employee' ? 'Colaborador: solicite revisão ao Gestor ou Dono. A solicitação ainda não pode ser enviada por esta tela.' : role === 'manager' ? 'Gestor: exceções de nome ou telefone exigirão justificativa e confirmação do servidor. CPF duplicado não pode ser liberado.' : 'Dono: revise conflitos; nenhuma exceção libera CPF duplicado. Unificação futura exigirá autorização e auditoria próprias.'}</p>
          {role !== 'employee' && <div className="mt-3">
            <label htmlFor={`${id}-justification`} className="font-bold">Justificativa para revisão futura (não enviada)</label>
            <textarea id={`${id}-justification`} rows={3} maxLength={1000} autoComplete="off" value={justification} onChange={e => setJustification(e.target.value)} className={classes} aria-describedby={`${id}-privacy`} />
            <p id={`${id}-privacy`} className="mt-1 text-slate-700">Não repita CPF ou dados sensíveis na justificativa. Ela não autoriza nem registra uma exceção.</p>
          </div>}
        </section>
        {errors !== null && <p role={Object.keys(errors).length ? 'alert' : 'status'} className="rounded-xl border border-slate-300 p-3 text-sm font-semibold">
          {Object.keys(errors).length ? 'Revise os campos indicados. Nada foi salvo.' : 'Campos validados localmente. Nada foi salvo; duplicidades e autorização ainda dependem do servidor.'}
        </p>}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" className="min-h-11 rounded-xl bg-indigo-700 px-4 py-3 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">Validar campos (sem salvar)</button>
          <button type="button" disabled aria-describedby={`${id}-blocked`} className="min-h-11 rounded-xl bg-slate-200 px-4 py-3 text-sm font-bold text-slate-600">Salvar cadastro — indisponível</button>
        </div>
      </form>
      <p className="text-sm text-slate-700">Clientes antigos continuam consultáveis no cadastro atual. Completar CPF e nascimento exigirá atualização revisada por UUID, sem substituir registros nem vínculos históricos.</p>
    </div>
  );
}
