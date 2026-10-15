import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(path, overrides = {}) {
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require: name => overrides[name] ?? require(name) });
  return loaded.exports;
}
const rules = load('../src/lib/customers/registration.ts');
// Mathematical fixtures only, unassociated with people; never logged or sent.
const draft = { fullName: 'Ana Silva', cpf: '52998224725', birthDate: '1990-04-12', phone: '(11) 98765-4321' };
const today = '2026-10-14';
const catalog = { tenantId: 'a', records: [{ id: 'customer-a', tenantId: 'a', ...draft }] };
const { CustomerRegistrationPreparation } = load('../src/components/customers/CustomerRegistrationPreparation.tsx', { '@/lib/customers/registration': rules });

test('CPF checks both digits and accepts only canonical digits or reviewed mask', () => {
  for (const value of ['52998224725', '529.982.247-25', '16899535009']) assert.equal(rules.validCpf(value), true);
  for (const value of ['', null, 52998224725, '52998224724', '52998224715', '529982247250', 'cpf52998224725', '529-982-24725']) assert.equal(rules.validCpf(value), false);
});
test('CPF rejects every repeated sequence', () => {
  for (let i = 0; i < 10; i++) assert.equal(rules.validCpf(String(i).repeat(11)), false);
});
test('masks retain digits without inventing identification and support national mobile/landline', () => {
  assert.match(rules.formatCpf(draft.cpf), /^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
  assert.equal(rules.formatCpf(''), '');
  assert.equal(rules.formatPhone('11987654321'), '(11) 98765-4321');
  assert.equal(rules.formatPhone('+55 (11) 98765-4321'), '(11) 98765-4321');
  assert.equal(rules.formatPhone('1134567890'), '(11) 3456-7890');
  assert.equal(rules.normalizePhone('+55 (11) 98765-4321'), rules.normalizePhone(draft.phone));
  for (const value of ['', '11111111111', '1198765', '(00) 98765-4321', '11887654321', '11987654321x', '+1 11987654321']) assert.equal(rules.normalizePhone(value), null);
});
test('all four holder fields are required and valid inputs produce no errors', () => {
  assert.equal(Object.keys(rules.validateCustomerDraft(draft, today)).length, 0);
  for (const field of ['fullName', 'cpf', 'birthDate', 'phone']) assert.ok(rules.validateCustomerDraft({ ...draft, [field]: '' }, today)[field]);
  assert.equal(Object.keys(rules.validateCustomerDraft({ fullName: '', cpf: '', birthDate: '', phone: '' }, today)).length, 4);
});
test('full name allows diacritics and apostrophes but rejects one word, digits and excessive length', () => {
  for (const name of ['José da Silva', 'Ana D’Ávila', 'Li Wu']) assert.equal(rules.validFullName(name), true);
  for (const name of ['Ana', 'Ana 123', '  ', '<script>nome</script>', 'A'.repeat(201)]) assert.equal(rules.validFullName(name), false);
});
test('birth date rejects impossible and future dates, including non-leap century years', () => {
  for (const date of ['2000-02-29', '2024-02-29', today]) assert.equal(rules.validBirthDate(date, today), true);
  for (const date of ['', '2026-10-15', '1900-02-29', '2026-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '14/10/1990', '1990-01-01T00:00:00Z']) assert.equal(rules.validBirthDate(date, today), false);
  assert.equal(rules.validBirthDate(draft.birthDate, 'invalid-clock'), false);
});
test('similar names trigger conservative alerts rather than automatic merge', () => {
  for (const name of ['Ána Silva', 'ANA SILVA', 'Silva Ana', 'Ana Silvia']) assert.equal(rules.similarCustomerName(draft.fullName, name), true);
  assert.equal(rules.similarCustomerName(draft.fullName, 'Bruno Souza'), false);
  assert.equal(rules.similarCustomerName('', ''), false);
});
test('same tenant CPF collision is blocked for every role, even with justification', () => {
  const review = rules.reviewCustomerDuplicates(draft, 'a', catalog);
  assert.equal(review.cpfConflict, true);
  for (const role of ['owner', 'manager', 'employee']) {
    const decision = rules.planCustomerReview(role, review, 'Justificativa não libera CPF repetido');
    assert.equal(decision.step, 'blocked-cpf');
    assert.equal(decision.canPersist, false);
  }
});
test('phone collision is an alert, not an automatic CPF-style block', () => {
  const review = rules.reviewCustomerDuplicates({ ...draft, cpf: '16899535009', fullName: 'Bruno Souza' }, 'a', catalog);
  assert.equal(review.cpfConflict, false);
  assert.equal(review.sharedPhone, true);
  assert.equal(rules.planCustomerReview('employee', review, '').step, 'request-review');
  assert.equal(rules.planCustomerReview('manager', review, '').step, 'needs-justification');
  for (const role of ['manager', 'owner']) {
    const result = rules.planCustomerReview(role, review, 'Telefone compartilhado pela família');
    assert.equal(result.step, 'review-prepared');
    assert.equal(result.canPersist, false);
  }
});
test('name exceptions follow the same review path; unknown role never receives authority', () => {
  const review = rules.reviewCustomerDuplicates({ ...draft, cpf: '16899535009', phone: '(21) 92345-6789', fullName: 'Ana Silvia' }, 'a', catalog);
  assert.equal(review.similarName, true);
  assert.equal(review.sharedPhone, false);
  assert.equal(rules.planCustomerReview('employee', review, 'qualquer texto').step, 'request-review');
  assert.equal(rules.planCustomerReview('manager', review, 'curta').step, 'needs-justification');
  assert.equal(rules.planCustomerReview('platform_admin', review, '').step, 'denied');
});
test('foreign, mixed or missing catalog fails closed without disclosing foreign record fields', () => {
  const foreign = { tenantId: 'b', records: [{ ...catalog.records[0], tenantId: 'b' }] };
  for (const input of [null, foreign, { tenantId: 'a', records: foreign.records }, { tenantId: 'a', records: null }]) {
    const review = rules.reviewCustomerDuplicates(draft, 'a', input);
    assert.equal(review.status, 'unavailable');
    assert.equal(Object.keys(review).sort().join(','), 'cpfConflict,sharedPhone,similarName,status');
    assert.equal(JSON.stringify(review).includes(draft.cpf), false);
    assert.equal(JSON.stringify(review).includes(draft.fullName), false);
    assert.equal(rules.planCustomerReview('owner', review, '').canPersist, false);
  }
});
test('CPF is tenant scoped, not a global key, and rows are not mutated', () => {
  const before = JSON.stringify(catalog);
  const tenantB = { tenantId: 'b', records: [{ ...catalog.records[0], tenantId: 'b', cpf: '16899535009', fullName: 'Bruno Souza', phone: '(21) 92345-6789' }] };
  assert.equal(rules.reviewCustomerDuplicates(draft, 'b', tenantB).cpfConflict, false);
  assert.equal(rules.reviewCustomerDuplicates(draft, 'a', catalog).cpfConflict, true);
  assert.equal(JSON.stringify(catalog), before);
});
test('legacy records remain unchanged and incomplete data cannot certify absence of conflicts', () => {
  const legacy = { tenantId: 'a', records: [{ id: 'legacy-id', tenantId: 'a', fullName: 'Ana Silva', phone: draft.phone }] };
  const before = JSON.stringify(legacy);
  const review = rules.reviewCustomerDuplicates(draft, 'a', legacy);
  assert.equal(review.status, 'partial');
  assert.equal(review.similarName, true);
  assert.equal(rules.planCustomerReview('owner', review, 'Qualquer justificativa').step, 'needs-catalog');
  assert.equal(JSON.stringify(legacy), before);
});
test('reviewed update identity excludes only the same tenant record; unknown/duplicate IDs deny', () => {
  assert.equal(rules.reviewCustomerDuplicates(draft, 'a', catalog, 'customer-a').cpfConflict, false);
  assert.equal(rules.reviewCustomerDuplicates(draft, 'a', catalog, 'foreign-id').status, 'unavailable');
  assert.equal(rules.reviewCustomerDuplicates(draft, 'a', { tenantId: 'a', records: [...catalog.records, ...catalog.records] }).status, 'unavailable');
});
test('no decision, including conflict-free owner, allows persistence in this stage', () => {
  for (const role of ['owner', 'manager', 'employee', null]) {
    const review = rules.reviewCustomerDuplicates(draft, 'a', { tenantId: 'a', records: [] });
    assert.equal(rules.planCustomerReview(role, review, 'Justificativa de revisão').canPersist, false);
  }
});
test('real form has accessible required fields, honest blocking, and no serializable input names', () => {
  const html = renderToStaticMarkup(React.createElement(CustomerRegistrationPreparation, { role: 'owner' }));
  assert.equal((html.match(/required=""/g) ?? []).length, 4);
  assert.match(html, /Preparação local — gravação indisponível/);
  assert.match(html, /Validar campos \(sem salvar\)/);
  assert.match(html, /<button type="button" disabled=""/);
  assert.match(html, /autoComplete="off"/);
  assert.doesNotMatch(html, /<(?:input|textarea)[^>]+ name=/);
  assert.doesNotMatch(html, /action="[^\"]+"/);
});
test('profile-specific instructions do not falsely submit review or grant override', () => {
  const employee = renderToStaticMarkup(React.createElement(CustomerRegistrationPreparation, { role: 'employee' }));
  const manager = renderToStaticMarkup(React.createElement(CustomerRegistrationPreparation, { role: 'manager' }));
  const owner = renderToStaticMarkup(React.createElement(CustomerRegistrationPreparation, { role: 'owner' }));
  assert.doesNotMatch(employee, /<textarea/);
  assert.match(employee, /solicitação ainda não pode ser enviada/);
  assert.match(manager, /CPF duplicado não pode ser liberado/);
  assert.match(owner, /Unificação futura exigirá autorização/);
});
function nodes(element, result = []) {
  if (!element || typeof element !== 'object') return result;
  if (Array.isArray(element)) { for (const child of element) nodes(child, result); return result; }
  result.push(element);
  nodes(element.props?.children, result);
  return result;
}
test('actual submit handler prevents navigation and emits only generic local errors', () => {
  for (const input of [draft, { fullName: '', cpf: '', birthDate: '', phone: '' }]) {
    let stateIndex = 0;
    const state = [input, null, ''];
    const published = [];
    const { CustomerRegistrationPreparation: Form } = load('../src/components/customers/CustomerRegistrationPreparation.tsx', {
      react: { ...React, useId: () => 'local-test', useState: () => [state[stateIndex++], value => published.push(value)] },
      '@/lib/customers/registration': rules,
    });
    const form = nodes(Form({ role: 'owner' })).find(node => node.type === 'form');
    let prevented = false;
    form.props.onSubmit({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(published.length, 1);
    assert.equal(Object.keys(published[0]).length, input === draft ? 0 : 4);
    assert.equal(JSON.stringify(published).includes(draft.cpf), false);
  }
});
test('actual page boundary hides during auth failure and remounts draft on user, tenant or role change', () => {
  let auth = { user: { id: 'u-a' }, selectedMembership: { tenant_id: 'a', role: 'owner', is_active: true }, loading: false, error: null };
  const Marker = () => React.createElement('div', null, 'local preparation');
  const page = load('../src/app/clientes/cadastro-inteligente/page.tsx', {
    '@/components/auth/AuthEntry': { TenantAuthEntry: ({ children }) => children },
    '@/components/auth/AuthProvider': { useAuth: () => auth },
    '@/lib/auth/authorization': { isTenantRole: role => ['owner', 'manager', 'employee'].includes(role) },
    '@/components/customers/CustomerRegistrationPreparation': { CustomerRegistrationPreparation: Marker },
    'next/link': { __esModule: true, default: ({ children }) => React.createElement('span', null, children) },
  });
  assert.deepEqual(Object.keys(page), ['default']);
  const CustomerPreparationBoundary = page.default().props.children.type;
  const base = auth;
  const key = () => nodes(CustomerPreparationBoundary()).find(node => node.type === Marker)?.key;
  const original = key();
  for (const change of [{ user: { id: 'u-b' } }, { selectedMembership: { ...base.selectedMembership, tenant_id: 'b' } }, { selectedMembership: { ...base.selectedMembership, role: 'employee' } }]) { auth = { ...base, ...change }; assert.notEqual(key(), original); }
  for (const change of [{ user: null }, { selectedMembership: null }, { selectedMembership: { ...base.selectedMembership, is_active: false } }, { loading: true }, { error: 'session expired' }, { selectedMembership: { ...base.selectedMembership, role: 'platform_admin' } }]) { auth = { ...base, ...change }; assert.equal(CustomerPreparationBoundary(), null); }
});
test('Next page exposes only its default component, never a test-only named boundary', () => {
  const source = readFileSync(new URL('../src/app/clientes/cadastro-inteligente/page.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const exports = ast.statements.filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
  assert.equal(exports.length, 1);
  assert.ok(exports[0].modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword));
  assert.equal(exports[0].name.text, 'CustomerPreparationPage');
});
test('new preparation sources contain no transport, persistence, logging or legacy adapters', () => {
  for (const path of ['../src/lib/customers/registration.ts', '../src/components/customers/CustomerRegistrationPreparation.tsx', '../src/app/clientes/cadastro-inteligente/page.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|supabase\.|localStorage|sessionStorage|console\.|saveTenantData|dbService|service_role|tenant_data/);
  }
});
