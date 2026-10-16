'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatCpf, formatPhone, localToday, validateCustomerDraft, type CustomerDraft } from '@/lib/customers/registration';
import { CustomerPersistenceError, type CustomerPersistence } from '@/lib/customers/persistence-client';

/** Body of the existing compact Home modal. No legacy writer, cache or local audit. */
export function CustomerModalForm({ persistence, customerId, onSaved, buttonClassName }: {
  persistence: CustomerPersistence; customerId: string | null; onSaved(): void; buttonClassName: string;
}) {
  const [draft, setDraft] = useState<CustomerDraft>({ fullName: '', cpf: '', birthDate: '', phone: '', notes: '' });
  const [current, setCurrent] = useState<{ id: string; version: number } | null>(null);
  const [loading, setLoading] = useState(Boolean(customerId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [reviewRequired, setReviewRequired] = useState(false);
  const [reason, setReason] = useState('');
  const alive = useRef(true);
  const read = useRef(persistence.read);
  useEffect(() => {
    alive.current = true;
    if (customerId) {
      void read.current(customerId).then(record => {
        if (!alive.current) return;
        setDraft({ ...record.draft, cpf: formatCpf(record.draft.cpf), phone: formatPhone(record.draft.phone), notes: record.draft.notes ?? '' });
        setCurrent({ id: record.id, version: record.version }); setLoading(false);
      }).catch(() => { if (alive.current) setMessage('Não foi possível consultar o cadastro. Feche e tente novamente.'); });
    }
    return () => { alive.current = false; };
  }, [customerId]);

  function change(field: keyof CustomerDraft, value: string) {
    setDraft(previous => ({ ...previous, [field]: value })); setMessage('');
    if (field !== 'notes') { setReviewRequired(false); setReason(''); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loading || (customerId && !current)) return;
    const errors = validateCustomerDraft(draft, localToday());
    if (Object.keys(errors).length) { setMessage(Object.values(errors)[0] ?? 'Confira os campos.'); return; }
    setSaving(true); setMessage('');
    try { await persistence.save(draft, current, reviewRequired ? reason : ''); if (alive.current) onSaved(); }
    catch (error) {
      if (alive.current) {
        if (error instanceof CustomerPersistenceError && error.code === 'CUSTOMER_REVIEW_REQUIRED') setReviewRequired(true);
        setMessage(error instanceof CustomerPersistenceError ? error.message : 'Não foi possível confirmar o salvamento. Consulte o cadastro ou tente novamente.');
      }
    } finally { if (alive.current) setSaving(false); }
  }
  const input = 'w-full border p-2.5 rounded-xl outline-none';
  return <form onSubmit={save} className="space-y-3">
    {message && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{message}</p>}
    {loading && <p role="status">Consultando cadastro…</p>}
    <fieldset disabled={saving || loading} className="space-y-3">
      <div><label htmlFor="customer-full-name" className="font-bold block mb-1">Nome completo *</label><input id="customer-full-name" required maxLength={200} autoComplete="off" placeholder="Nome completo" value={draft.fullName} onChange={e => change('fullName', e.target.value)} className={input} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label htmlFor="customer-cpf" className="font-bold block mb-1">CPF *</label><input id="customer-cpf" type="text" inputMode="numeric" required maxLength={14} autoComplete="off" placeholder="000.000.000-00" value={draft.cpf} onChange={e => change('cpf', formatCpf(e.target.value))} className={input} /></div>
        <div><label htmlFor="customer-birth-date" className="font-bold block mb-1">Data de nascimento *</label><input id="customer-birth-date" type="date" required autoComplete="off" value={draft.birthDate} onChange={e => change('birthDate', e.target.value)} className={input} /></div>
      </div>
      <div><label htmlFor="customer-phone" className="font-bold block mb-1">WhatsApp *</label><input id="customer-phone" type="tel" inputMode="tel" required maxLength={20} autoComplete="off" placeholder="(00) 00000-0000" value={draft.phone} onChange={e => change('phone', formatPhone(e.target.value))} className={input} /></div>
      <div><label htmlFor="customer-notes" className="font-bold block mb-1">Observações</label><textarea id="customer-notes" rows={2} maxLength={2000} autoComplete="off" placeholder="Observações..." value={draft.notes ?? ''} onChange={e => change('notes', e.target.value)} className={input} /></div>
      {reviewRequired && <div><label htmlFor="customer-reason" className="font-bold block mb-1">Justificativa da revisão</label><textarea id="customer-reason" rows={2} maxLength={1000} minLength={10} required autoComplete="off" value={reason} onChange={e => setReason(e.target.value)} placeholder="Explique por que são clientes diferentes" className={input} /><p className="mt-1 text-slate-500">Não inclua CPF, nascimento ou telefone na justificativa.</p></div>}
      <button type="submit" disabled={saving || loading} className={`w-full ${buttonClassName} text-white font-bold py-3 rounded-xl cursor-pointer disabled:opacity-50`}>{saving ? 'Salvando...' : 'Salvar Cliente'}</button>
    </fieldset>
  </form>;
}
