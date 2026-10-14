'use client';

import { useId } from 'react';
import { customerNameFromChoice, selectedCustomerValue, type CustomerChoice } from '@/lib/customers/selection';

export function CustomerSelect({ choices, currentName, onChange, status }: {
  choices: readonly CustomerChoice[];
  currentName: string;
  onChange: (name: string) => void;
  status: 'loading' | 'ready' | 'unavailable' | 'restricted';
}) {
  const id = useId();
  const value = status === 'ready' ? selectedCustomerValue(choices, currentName) : '';
  return (
    <div>
      <label htmlFor={id} className="font-bold block mb-1">Cliente cadastrado *</label>
      <select id={id} required value={value} aria-describedby={`${id}-help`} aria-busy={status === 'loading'} onChange={(event) => {
        if (status !== 'ready') return;
        const name = customerNameFromChoice(choices, event.target.value);
        if (name !== null) onChange(name);
      }} className="min-h-11 w-full min-w-0 border p-2.5 rounded-xl bg-white text-slate-800">
        <option value="" disabled>{status === 'loading' ? 'Carregando clientes…' : 'Selecione um cliente'}</option>
        {status === 'ready' && choices.map((choice) => (
          <option key={choice.value} value={choice.value} disabled={choice.disabled}>{choice.name}{choice.disabled ? ' — cadastro ambíguo' : ''}</option>
        ))}
      </select>
      <div id={`${id}-help`} className="mt-1 space-y-1 text-[11px] text-slate-600">
        {status === 'unavailable' && <p role="alert">Não foi possível confirmar os clientes desta empresa. Atualize a página antes de continuar.</p>}
        {status === 'restricted' && <p role="alert">Seu perfil ou plano não permite selecionar clientes desta empresa.</p>}
        {status === 'ready' && choices.length === 0 && <p>Nenhum cliente com identificação válida disponível. Cadastre ou regularize o cliente antes de continuar.</p>}
        {status === 'ready' && choices.some((choice) => choice.disabled) && <p>Cadastros com nomes ou identificadores repetidos não podem ser associados com segurança neste fluxo.</p>}
        {status === 'ready' && currentName && !value && <p>O cliente registrado não corresponde a um cadastro disponível nesta empresa. Selecione um cliente válido para continuar; o registro anterior foi preservado.</p>}
      </div>
    </div>
  );
}
