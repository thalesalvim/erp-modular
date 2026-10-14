import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadSource(path, dependencies = {}) {
  const loaded = { exports: {} };
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require: (name) => dependencies[name] ?? require(name) });
  return loaded.exports;
}

const { groupVisibleNavigation } = loadSource('../src/lib/navigation/groups.ts');
const ids = (groups) => groups.flatMap((group) => group.tabs.map((tab) => tab.id)).sort();

// Exercise the actual page's existing filtering before the presentation grouping.
const homeSource = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
const homeAst = ts.createSourceFile('page.tsx', homeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const menuExpressions = {};
function findMenuExpressions(node) {
  if (ts.isVariableDeclaration(node) && ['allTabs', 'visibleTabs'].includes(node.name.getText(homeAst))) {
    menuExpressions[node.name.getText(homeAst)] = node.initializer.getText(homeAst);
  }
  ts.forEachChild(node, findMenuExpressions);
}
findMenuExpressions(homeAst);
function actualMenu(role, moduleRoles = {}) {
  const compiled = ts.transpileModule(`const allTabs = ${menuExpressions.allTabs}; const visibleTabs = ${menuExpressions.visibleTabs}; module.exports = visibleTabs;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(compiled, {
    ...require('lucide-react'),
    CalendarIcon: require('lucide-react').Calendar,
    UsersIcon: require('lucide-react').Users,
    SettingsIcon: require('lucide-react').Settings,
    module: loaded, exports: loaded.exports, require,
    isManager: role === 'owner' || role === 'manager', isDono: role === 'owner',
    activeUserRole: { owner: 'Dono', manager: 'Gestor', employee: 'Colaborador' }[role],
    currentCompany: { moduleRoles },
  });
  return loaded.exports;
}

test('actual employee menu does not offer management, financial or owner-only screens', () => {
  const menu = Array.from(ids(groupVisibleNavigation(actualMenu('employee'))));
  for (const forbidden of ['dashboard', 'services', 'promotions', 'expenses', 'team', 'dre', 'my_plan']) assert.ok(!menu.includes(forbidden), forbidden);
  assert.ok(menu.includes('calendar'));
  assert.ok(menu.includes('my_schedule'));
  assert.ok(ids(groupVisibleNavigation(actualMenu('owner'))).includes('my_plan'));
  assert.ok(!ids(groupVisibleNavigation(actualMenu('manager'))).includes('my_plan'));
});

test('existing per-module role restrictions survive categorization', () => {
  const menu = Array.from(ids(groupVisibleNavigation(actualMenu('employee', { stock: ['Dono'], customers: ['Gestor'] }))));
  assert.ok(!menu.includes('stock'));
  assert.ok(!menu.includes('customers'));
  assert.ok(menu.includes('calendar'));
});

// The grouping receives an already filtered menu; it must never grant visibility.
for (const [role, authorized] of Object.entries({
  owner: ['dashboard', 'calendar', 'atendimentos', 'services', 'promotions', 'pos', 'stock', 'expenses', 'team', 'customers', 'dre', 'my_plan', 'settings'],
  manager: ['dashboard', 'calendar', 'atendimentos', 'services', 'promotions', 'pos', 'stock', 'expenses', 'team', 'customers', 'dre', 'settings'],
  employee: ['calendar', 'atendimentos', 'pos', 'stock', 'customers', 'my_schedule', 'settings'],
  restricted: ['calendar', 'settings'],
})) {
  test(`grouping preserves exactly the supplied ${role} menu, including original item objects`, () => {
    const input = authorized.map((id) => Object.freeze({ id }));
    const groups = groupVisibleNavigation(Object.freeze(input));
    assert.deepEqual(Array.from(ids(groups)), [...authorized].sort());
    assert.ok(groups.every((group) => group.tabs.length > 0));
    for (const tab of groups.flatMap((group) => group.tabs)) assert.ok(input.includes(tab));
  });
}

test('empty authorization produces no menu categories', () => {
  assert.equal(groupVisibleNavigation([]).length, 0);
});

test('new authorized routes remain available without duplication', () => {
  const input = [{ id: 'future-module' }, { id: 'calendar' }];
  assert.deepEqual(Array.from(ids(groupVisibleNavigation(input))), ['calendar', 'future-module']);
});

test('real login renders a concealed required password and an accessible non-submit control', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { AuthLoginForm } = loadSource('../src/components/auth/AuthEntry.tsx', {
    './AuthProvider': { useAuth: () => ({ signIn: () => { throw Error('must not submit during render'); } }) },
    '@/lib/auth/authService': { sendPasswordRecovery: () => { throw Error('must not send during render'); } },
    '@/lib/auth/authorization': { roleLabel: () => '' },
    '@/lib/supabase': { supabase: null },
  });
  const html = renderToStaticMarkup(React.createElement(AuthLoginForm));
  assert.match(html, /type="password"/);
  assert.match(html, /autoComplete="current-password"/);
  assert.match(html, /required=""/);
  assert.match(html, /<button type="button" aria-label="Mostrar senha" aria-pressed="false" aria-controls="[^"]+"/);
});
