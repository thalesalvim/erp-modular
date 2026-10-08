import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

function loadModule(relativePath, environment = {}, dependencies = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, URL, atob, __dirname: process.cwd(), process: { env: environment },
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

const configModule = loadModule('../src/lib/supabaseConfig.ts');
const { getSupabaseConfig, PRODUCTION_SUPABASE_HOST } = configModule;
const valid = {
  url: 'https://local-fixture.invalid',
  publicKey: 'sb_publishable_test_fixture_only',
  appEnvironment: 'local',
};

function jwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.synthetic_signature`;
}

function environmentUrl(appEnvironment) {
  return appEnvironment === 'production' ? `https://${PRODUCTION_SUPABASE_HOST}` : valid.url;
}

test('explicit publishable and legacy anon configurations are accepted', () => {
  for (const appEnvironment of ['local', 'preview', 'production']) {
    for (const publicKey of [valid.publicKey, jwt('anon')]) {
      const url = environmentUrl(appEnvironment);
      const result = getSupabaseConfig({ ...valid, url, appEnvironment, publicKey });
      assert.equal(result.url, url);
      assert.equal(result.publicKey, publicKey);
      assert.equal(result.environment, appEnvironment);
    }
  }
});

test('each missing variable fails clearly without a fallback', () => {
  for (const [name, variable] of [
    ['url', 'NEXT_PUBLIC_SUPABASE_URL'],
    ['publicKey', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    ['appEnvironment', 'NEXT_PUBLIC_APP_ENV'],
  ]) {
    for (const value of [undefined, '', '   ']) {
      assert.throws(() => getSupabaseConfig({ ...valid, [name]: value }), new RegExp(variable));
    }
  }
});

test('privileged, user and malformed keys are rejected without exposing their value', () => {
  for (const publicKey of [
    'sb_secret_test_private_fixture', jwt('service_role'), jwt('authenticated'),
    jwt('postgres'), jwt(null), 'not_a_key', 'sb_publishable_', 'a.b.c',
  ]) {
    assert.throws(() => getSupabaseConfig({ ...valid, publicKey }), (error) => {
      assert.match(error.message, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
      assert.equal(error.message.includes(publicKey), false);
      return true;
    });
  }
});

test('URL validation rejects credentials, unexpected paths and insecure remote endpoints', () => {
  for (const url of [
    'not-a-url', 'http://remote-fixture.invalid', 'ftp://local-fixture.invalid',
    'https://user:private@local-fixture.invalid', 'https://local-fixture.invalid/rest/v1',
    'https://local-fixture.invalid?secret=fixture', 'https://local-fixture.invalid#fixture',
  ]) {
    assert.throws(() => getSupabaseConfig({ ...valid, url }), (error) => {
      assert.match(error.message, /NEXT_PUBLIC_SUPABASE_URL/);
      assert.equal(error.message.includes(url), false);
      return true;
    });
  }
});

test('HTTP is accepted only for local loopback', () => {
  for (const url of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321']) {
    assert.equal(getSupabaseConfig({ ...valid, url }).url, url);
    for (const appEnvironment of ['preview', 'production']) {
      assert.throws(() => getSupabaseConfig({ ...valid, url, appEnvironment }), /NEXT_PUBLIC_SUPABASE_URL/);
    }
  }
});

test('Vercel target must agree with the explicitly declared application environment', () => {
  for (const [deploymentEnvironment, appEnvironment] of [
    ['development', 'local'], ['preview', 'preview'], ['production', 'production'],
  ]) {
    assert.equal(getSupabaseConfig({ ...valid, url: environmentUrl(appEnvironment), deploymentEnvironment, appEnvironment }).environment, appEnvironment);
    const wrong = appEnvironment === 'local' ? 'production' : 'local';
    assert.throws(() => getSupabaseConfig({ ...valid, deploymentEnvironment, appEnvironment: wrong }), /VERCEL_ENV/);
  }
  assert.throws(() => getSupabaseConfig({ ...valid, appEnvironment: 'staging' }), /NEXT_PUBLIC_APP_ENV/);
});

test('the audited production project is rejected in local and preview, including explicit URLs', () => {
  for (const appEnvironment of ['local', 'preview']) {
    for (const url of [`https://${PRODUCTION_SUPABASE_HOST}`, `https://${PRODUCTION_SUPABASE_HOST}/`]) {
      assert.throws(() => getSupabaseConfig({ ...valid, url, appEnvironment }), /produção não é permitido/);
    }
  }
  assert.throws(() => getSupabaseConfig({ ...valid, appEnvironment: 'production' }), /produção auditada/);
});

test('the actual client module fails before createClient when configuration is missing', () => {
  let creations = 0;
  assert.throws(() => loadModule('../src/lib/supabase.ts', {}, {
    './supabaseConfig': configModule,
    '@supabase/supabase-js': { createClient: () => { creations++; } },
  }), /Supabase config/);
  assert.equal(creations, 0);
});

test('the actual client module initializes the SDK with synthetic values and no network access', async () => {
  let requests = 0;
  const { supabase } = loadModule('../src/lib/supabase.ts', {
    NEXT_PUBLIC_APP_ENV: valid.appEnvironment,
    NEXT_PUBLIC_SUPABASE_URL: valid.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: valid.publicKey,
  }, {
    './supabaseConfig': configModule,
    '@supabase/supabase-js': {
      createClient: (url, key) => createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        global: { fetch: () => { requests++; throw new Error('Network forbidden in configuration tests'); } },
      }),
    },
  });
  assert.equal(typeof supabase.from, 'function');
  const { data } = await supabase.auth.getSession();
  assert.equal(data.session, null);
  assert.equal(requests, 0);
});

test('Next configuration rejects privileged keys and environment mismatch before bundling', () => {
  const environment = {
    NEXT_PUBLIC_APP_ENV: 'preview',
    VERCEL_ENV: 'preview',
    NEXT_PUBLIC_SUPABASE_URL: valid.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: valid.publicKey,
  };
  const dependencies = { './src/lib/supabaseConfig': configModule };
  assert.ok(loadModule('../next.config.ts', environment, dependencies).default);
  assert.throws(() => loadModule('../next.config.ts', {
    ...environment, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('service_role'),
  }, dependencies), /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.throws(() => loadModule('../next.config.ts', {
    ...environment, NEXT_PUBLIC_APP_ENV: 'production',
  }, dependencies), /VERCEL_ENV/);
});
