// Compile the actual handler/DTO without importing environment-bound SDK clients.
// Caller supplies Auth transport; PostgreSQL integration supplies REAL SQL below it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
export function loadOwnAgendaModule(path, dependencies = {}, environment = {}) {
  const source = readFileSync(new URL('../../src/' + path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, URL, Request, Response,
    AbortController, process: { env: environment },
    fetch: () => { throw new Error('Network access forbidden in test'); },
    require: name => { assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency: ' + name); return dependencies[name]; },
  });
  return loaded.exports;
}

export const agendaContract = loadOwnAgendaModule('lib/agenda/own-contract.ts');
export function ownAgendaRoute(clientFactory, environment = {}) {
  return loadOwnAgendaModule('app/api/agenda/own/route.ts', {
    'next/server': require('next/server'),
    '@/lib/agenda/own-contract': agendaContract,
    '@/lib/supabase/server': { createServerSupabaseClient: clientFactory },
  }, environment);
}
