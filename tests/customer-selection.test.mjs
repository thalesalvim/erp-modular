import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(path, overrides = {}) {
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require: name => overrides[name] ?? require(name) });
  return loaded.exports;
}
const selection = load('../src/lib/customers/selection.ts');
const { customerChoices, customerNameFromChoice, selectedCustomerValue, isCurrentCustomerSource } = selection;
const { CustomerSelect } = load('../src/components/customers/CustomerSelect.tsx', { '@/lib/customers/selection': selection });
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rows = [{ id: 'a', name: 'Ana Silva', cpf: 'not-for-display', phone: 'private-phone', notes: 'private-notes' }, { id: 'b', name: 'Bruno Souza' }];
const render = props => renderToStaticMarkup(React.createElement(CustomerSelect, { choices: customerChoices(rows), currentName: '', status: 'ready', onChange: () => {}, ...props }));

test('choices expose only operational names and map a real option to the exact legacy name', () => {
  const choices = customerChoices(rows);
  assert.equal(customerNameFromChoice(choices, choices[0].value), 'Ana Silva');
  assert.equal(selectedCustomerValue(choices, 'Bruno Souza'), choices[1].value);
  assert.deepEqual(Object.keys(choices[0]).sort(), ['disabled', 'name', 'value']);
  assert.equal(JSON.stringify(choices).includes('private'), false);
});

test('homonyms, Unicode-equivalent names and reused identifiers are not silently associated', () => {
  const choices = customerChoices([{ id: '1', name: 'José Silva' }, { id: '2', name: ' JOSE\u0301 SILVA ' }, { id: '3', name: 'Nome A' }, { id: '3', name: 'Nome B' }]);
  assert.ok(choices.every(choice => choice.disabled));
  for (const choice of choices) assert.equal(customerNameFromChoice(choices, choice.value), null);
  assert.equal(selectedCustomerValue(choices, 'José Silva'), '');
});

test('empty, malformed, inherited and unregistered entries never become selectable customers', () => {
  assert.equal(customerChoices([]).length, 0);
  assert.equal(customerChoices([null, { name: 'Missing ID' }, { id: '', name: 'Blank ID' }, { id: NaN, name: 'Invalid ID' }, Object.create({ id: 'a', name: 'Inherited' })]).length, 0);
  const choices = customerChoices(rows);
  assert.equal(customerNameFromChoice(choices, 'forged-option'), null);
  assert.equal(selectedCustomerValue(choices, 'Unregistered person'), '');
});

test('source is rejected after user, company, membership refresh/revocation or logout changes', () => {
  const membership = { tenant_id: 'a', role: 'owner' };
  const source = { userId: 'user-a', membership };
  assert.equal(isCurrentCustomerSource(source, 'user-a', membership), true);
  assert.equal(isCurrentCustomerSource(source, 'user-b', membership), false);
  assert.equal(isCurrentCustomerSource(source, 'user-a', { tenant_id: 'b', role: 'owner' }), false);
  assert.equal(isCurrentCustomerSource(source, 'user-a', { ...membership }), false);
  assert.equal(isCurrentCustomerSource(source, 'user-a', null), false);
  assert.equal(isCurrentCustomerSource(source, undefined, membership), false);
});

test('actual read hook cancels a late response after switching membership', async () => {
  const pending = [];
  const published = [];
  let notify;
  const completed = new Promise(resolve => { notify = resolve; });
  let cleanup;
  const { useCustomerOptions: runRead } = load('../src/components/customers/useCustomerOptions.ts', {
    react: { useState: () => [null, value => { published.push(value); notify(); }], useEffect: effect => { cleanup = effect(); } },
    '@/lib/dbService': { getAllTenantDataCloud: tenant => new Promise(resolve => pending.push({ tenant, resolve })) },
    '@/lib/customers/selection': selection,
  });
  const a = { tenant_id: 'a' }, b = { tenant_id: 'b' };
  runRead('user-a', a);
  cleanup();
  runRead('user-b', b);
  pending[0].resolve({ customers: rows });
  await new Promise(setImmediate);
  assert.equal(published.length, 0);
  pending[1].resolve({ customers: [{ id: 'b', name: 'Cliente B' }] });
  await completed;
  assert.equal(published.length, 1);
  assert.equal(published[0].membership, b);
  assert.equal(published[0].userId, 'user-b');
  assert.equal(published[0].choices[0].name, 'Cliente B');
  cleanup();
});

test('actual read hook distinguishes missing/failed source from a confirmed empty list', async () => {
  for (const [result, expected] of [[null, 'unavailable'], [{ customers: null }, 'unavailable'], [{ customers: [] }, 'ready']]) {
    const published = [];
    let notify;
    const completed = new Promise(resolve => { notify = resolve; });
    const { useCustomerOptions: runRead } = load('../src/components/customers/useCustomerOptions.ts', {
      react: { useState: () => [null, value => { published.push(value); notify(); }], useEffect: effect => effect() },
      '@/lib/dbService': { getAllTenantDataCloud: async () => result },
      '@/lib/customers/selection': selection,
    });
    runRead('user-a', { tenant_id: 'a' });
    await completed;
    assert.equal(published[0].status, expected);
    assert.equal(published[0].choices.length, 0);
  }
});

test('real selector is required, labelled, has no free-text entry and does not expose private fields', () => {
  const html = render({ currentName: 'Ana Silva' });
  assert.match(html, /<label for="[^"]+"/);
  assert.match(html, /<select[^>]+required=""[^>]+aria-describedby=/);
  assert.match(html, /value="customer-0" selected=""/);
  assert.doesNotMatch(html, /<input|private-phone|private-notes|not-for-display/);
});

test('empty and failed reads remain distinct; stale names/options do not appear before authorization', () => {
  assert.match(render({ choices: [] }), /Nenhum cliente com identificação válida/);
  for (const status of ['loading', 'unavailable', 'restricted']) {
    const html = render({ status, currentName: 'Cliente de outra empresa' });
    assert.doesNotMatch(html, /Cliente de outra empresa|Ana Silva|Bruno Souza/);
  }
  assert.match(render({ status: 'unavailable' }), /role="alert"/);
  assert.match(render({ status: 'restricted' }), /Seu perfil ou plano/);
});

test('unconfirmed historical name is not exposed or invented as a registered option', () => {
  const html = render({ currentName: '<script>legacy</script>' });
  assert.match(html, /registro anterior foi preservado/);
  assert.doesNotMatch(html, /legacy/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /value="[^\"]+" selected=""/);
  assert.doesNotMatch(render({ choices: [], currentName: 'Cliente da empresa anterior' }), /Cliente da empresa anterior/);
});

test('about page uses official contacts and honest shortcut instructions without data or automatic messages', () => {
  const { default: AboutPage } = load('../src/app/sobre/page.tsx', { 'next/link': { __esModule: true, default: ({ children, href }) => React.createElement('a', { href }, children) } });
  const html = renderToStaticMarkup(React.createElement(AboutPage));
  assert.match(html, /Sobre Nós/);
  assert.match(html, /href="https:\/\/wa.me\/553798558658"/);
  assert.match(html, /href="mailto:adm.handyhub@gmail.com"/);
  assert.match(html, /PWA completa ainda está em preparação/);
  assert.match(html, /support.google.com\/chrome/);
  assert.match(html, /support.apple.com/);
  assert.doesNotMatch(html, /<form|service_role|tenant_data/);
});

test('actual scale renderer receives no invented rows for absent or malformed schedule', () => {
  const source = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map' && ts.isParenthesizedExpression(node.expression.expression)) {
      const text = node.expression.expression.getText(ast);
      if (text.includes('selectedEmpForSchedule.schedule')) expression = text;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, 'must exercise the real guarded renderer');
  for (const schedule of [undefined, null, {}, 'missing', []]) {
    assert.equal(vm.runInNewContext(expression, { selectedEmpForSchedule: { schedule } }).length, 0);
  }
  const existing = [{ dayIndex: 1, dayName: 'Segunda', isWorking: true, openTime: '09:00', closeTime: '18:00' }];
  assert.equal(vm.runInNewContext(expression, { selectedEmpForSchedule: { schedule: existing } }), existing);
});

test('actual selector access gate rejects stale company/profile and existing module/plan restrictions', () => {
  const source = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'customerSelectionAllowed') expression = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const context = { auth: { selectedMembership: { tenant_id: 'a', role: 'owner' }, user: { email: 'synthetic@example.invalid' } }, currentCompany: { id: 'a' }, activeUserEmail: 'synthetic@example.invalid', activeUserRole: 'Dono', roleLabel: () => 'Dono', visibleTabs: [{ id: 'customers' }], isModuleAllowedForCurrentPlan: () => true };
  assert.equal(vm.runInNewContext(expression, context), true);
  for (const change of [{ currentCompany: { id: 'b' } }, { activeUserEmail: 'other@example.invalid' }, { activeUserRole: 'Colaborador' }, { visibleTabs: [] }, { isModuleAllowedForCurrentPlan: () => false }, { auth: { selectedMembership: null, user: null } }]) assert.equal(vm.runInNewContext(expression, { ...context, ...change }), false);
});

test('actual new-record handlers do not preselect a customer from the old shared cache', () => {
  const source = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === 'onClick') {
      const text = node.initializer.getText(ast);
      if (text.includes('setEditingId(null)') && /setApptClientName|setFormClientName/.test(text)) handlers.push(node.initializer.expression.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(handlers.length, 4);
  for (const handler of handlers) {
    const values = [];
    const context = { services: [], employees: [], isManager: true, activeUserName: 'Synthetic' };
    context.customers = new Proxy([], { get() { throw Error('must not consume cached customers'); } });
    for (const name of handler.match(/set[A-Z]\w+/g)) context[name] = value => { if (/setApptClientName|setFormClientName/.test(name)) values.push(value); };
    const compiled = ts.transpileModule(`(${handler})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, context);
    assert.deepEqual(values, ['']);
  }
});
