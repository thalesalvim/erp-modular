import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react');
function load(path, overrides = {}, globals = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: name => overrides[name] ?? require(name), ...globals });
  return mod.exports;
}
const rules = load('../src/lib/customers/registration.ts');
const { CustomerPersistenceError } = load('../src/lib/customers/persistence-client.ts');
function nodes(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child => nodes(child, result)); return result; }
  result.push(node); nodes(node.props?.children, result); return result;
}
function harness(save = async () => ({ id: 'local-id', version: 1 })) {
  const state = [], refs = [], cleanups = []; let index = 0, refIndex = 0, saved = 0;
  const mock = { ...React, useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; }, useRef(initial) { const slot = refIndex++; return refs[slot] ??= { current: initial }; }, useEffect(fn) { if (!cleanups.length) cleanups.push(fn()); } };
  const { CustomerModalForm } = load('../src/components/customers/CustomerModalForm.tsx', { react: mock, '@/lib/customers/registration': rules, '@/lib/customers/persistence-client': { CustomerPersistenceError } });
  const render = () => { index = 0; refIndex = 0; return nodes(CustomerModalForm({ persistence: { items: [], startNew() {}, save, read: async () => null }, customerId: null, buttonClassName: 'bg-indigo-700', onSaved: () => saved++ })); };
  const field = id => render().find(node => node.props?.id === id);
  function fill() {
    for (const [id, value] of Object.entries({ 'customer-full-name': 'Pessoa Fictícia', 'customer-cpf': '52998224725', 'customer-birth-date': '1990-04-12', 'customer-phone': '(11) 98765-4321', 'customer-notes': 'Preferência exclusivamente fictícia' })) field(id).props.onChange({ target: { value } });
  }
  return { render, field, fill, saved: () => saved, submit: () => render().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }), unmount: () => cleanups.forEach(fn => fn?.()) };
}
test('compact form has exactly five normal fields; notes optional; review hidden', () => {
  const h = harness(), elements = h.render();
  assert.equal(elements.filter(n => n.type === 'input' || n.type === 'textarea').length, 5);
  assert.equal(h.field('customer-notes').props.maxLength, 2000);
  assert.equal(h.field('customer-notes').props.required, undefined);
  assert.equal(h.field('customer-reason'), undefined);
  for (const id of ['customer-full-name','customer-cpf','customer-birth-date','customer-phone','customer-notes']) assert.ok(elements.some(n => n.type === 'label' && n.props.htmlFor === id));
});
test('actual modal submit sends all five fields once through the injected authorized client', async () => {
  const commands = [], h = harness(async (draft, current, reason) => { commands.push({ draft, current, reason }); return { id: 'local-id', version: 1 }; });
  h.fill(); await h.submit();
  assert.equal(commands.length, 1); assert.equal(commands[0].draft.notes, 'Preferência exclusivamente fictícia');
  assert.equal(commands[0].current, null); assert.equal(commands[0].reason, ''); assert.equal(h.saved(), 1);
});
test('review appears only after the structured server conflict and clears on relevant changes', async () => {
  for (const id of ['customer-full-name','customer-cpf','customer-birth-date','customer-phone']) {
    const h = harness(async () => { throw new CustomerPersistenceError('CUSTOMER_REVIEW_REQUIRED'); });
    h.fill(); assert.equal(h.field('customer-reason'), undefined); await h.submit();
    assert.ok(h.field('customer-reason')); h.field('customer-reason').props.onChange({ target: { value: 'Motivo de revisão' } });
    h.field(id).props.onChange({ target: { value: h.field(id).props.value } });
    assert.equal(h.field('customer-reason'), undefined);
  }
});
test('invalid justification keeps the review field accessible for correction', async () => {
  let tries = 0; const h = harness(async () => { throw new CustomerPersistenceError(tries++ ? 'INVALID_JUSTIFICATION' : 'CUSTOMER_REVIEW_REQUIRED'); });
  h.fill(); await h.submit(); await h.submit(); assert.ok(h.field('customer-reason'));
});
test('unrelated errors never reveal a justification field or raw provider text', async () => {
  const h = harness(async () => { throw new Error('private provider payload'); });
  h.fill(); await h.submit(); assert.equal(h.field('customer-reason'), undefined);
  assert.equal(JSON.stringify(h.render()).includes('private provider payload'), false);
});
test('closing and reopening resets conflict, justification and personal draft', async () => {
  const old = harness(async () => { throw new CustomerPersistenceError('CUSTOMER_REVIEW_REQUIRED'); }); old.fill(); await old.submit(); old.unmount();
  const fresh = harness(); assert.equal(fresh.field('customer-reason'), undefined); assert.equal(fresh.field('customer-cpf').props.value, '');
});
test('late completion after modal unmount cannot close a different dialog', async () => {
  let finish; const h = harness(() => new Promise(resolve => { finish = resolve; }));
  h.fill(); const pending = h.submit(); h.unmount(); finish({ id: 'local-id', version: 1 }); await pending;
  assert.equal(h.saved(), 0);
});

function persistenceHarness(fetch) {
  const state = [], refs = []; let index = 0, refIndex = 0, effect;
  const mock = { useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; }, useRef(initial) { const slot = refIndex++; return refs[slot] ??= { current: initial }; }, useEffect(fn) { effect ??= fn; } };
  const { useCustomerPersistence } = load('../src/lib/customers/persistence-client.ts', { react: mock }, { fetch, crypto: globalThis.crypto, AbortController });
  return { useRender(scope = 'actor:tenant:owner', owner = true) { index = 0; refIndex = 0; return useCustomerPersistence(scope, 'synthetic-tenant', owner); }, async initialize() { effect(); await new Promise(resolve => setImmediate(resolve)); } };
}

test('confirmed commit survives list refresh failure and retries retain their operation ID', async () => {
  const commands = []; let reads = 0;
  const h = persistenceHarness(async (_url, options) => {
    if (!options.method) { if (reads++) throw new Error('Synthetic connection loss'); return { ok: true, json: async () => ({ items: [] }) }; }
    commands.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 'synthetic-id', version: 1 }) };
  });
  assert.equal(h.useRender(), null); await h.initialize();
  const client = h.useRender(), draft = { fullName: 'Synthetic Person', cpf: '', birthDate: '', phone: '', notes: '' };
  await client.save(draft, null, '');
  assert.equal(h.useRender().items[0].id, 'synthetic-id');
  await client.save(draft, null, ''); assert.equal(commands[0].operationId, commands[1].operationId);
  client.startNew(); await client.save(draft, null, ''); assert.notEqual(commands[1].operationId, commands[2].operationId);
});

test('a late save from an old scope cannot make customers visible in another scope', async () => {
  let finish;
  const h = persistenceHarness(async (_url, options) => options.method ? new Promise(resolve => { finish = resolve; }) : { ok: true, json: async () => ({ items: [] }) });
  h.useRender(); await h.initialize(); const client = h.useRender();
  const pending = client.save({ fullName: 'Synthetic Person', cpf: '', birthDate: '', phone: '', notes: '' }, null, '');
  assert.equal(h.useRender('another-actor:tenant:owner'), null); assert.equal(h.useRender(null, false), null);
  finish({ ok: true, json: async () => ({ id: 'synthetic-id', version: 1 }) }); await pending;
  assert.equal(h.useRender('another-actor:tenant:owner'), null); assert.equal(h.useRender(null, false), null);
});
