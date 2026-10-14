// Controlled Auth adapter, REAL authorization RPCs against the caller-owned fixture.
// Invoked only by test-invitation-atomic.py; never loads environment files or an SDK.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { homedir } from 'node:os';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { NextResponse } = require('next/server');
const [docker, endpoint, container, actor, recipient, tenant, runId, resourceToken, serverId, imageId] = process.argv.slice(2);
assert.ok(['npipe:////./pipe/dockerDesktopLinuxEngine', 'unix:///var/run/docker.sock', `unix://${homedir()}/.docker/desktop/docker.sock`].includes(endpoint));
assert.match(container, /^[a-f0-9]{64}$/);
for (const value of [actor, recipient, tenant]) assert.match(value, /^[0-9a-f-]{36}$/);
for (const value of [runId, resourceToken]) assert.match(value, /^[a-f0-9]{32}$/);
assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
// Refuse accidental standalone use against an arbitrary existing container.
// The parent passes the provenance it confirmed AFTER creating its own resource.
function metadata(args) {
  const result = spawnSync(docker, ['--host', endpoint, ...args], { timeout: 10000 });
  assert.equal(result.status, 0, 'Owned fixture metadata unavailable');
  return result.stdout.toString('utf8').trim();
}
assert.equal(metadata(['info', '--format', '{{.ID}}']), serverId);
const [owned] = JSON.parse(metadata(['container', 'inspect', container]));
assert.equal(owned.Id, container);
assert.equal(owned.Image, imageId);
assert.equal(owned.Config.Labels['io.handyhub.pg-tests.run'], runId);
assert.equal(owned.Config.Labels['io.handyhub.pg-tests.resource'], resourceToken);
assert.equal(owned.HostConfig.NetworkMode, 'none');
assert.equal(owned.HostConfig.PublishAllPorts, false);
assert.equal(Object.keys(owned.HostConfig.PortBindings ?? {}).length, 0);
assert.equal((owned.HostConfig.Binds ?? []).length, 0);
assert.ok(owned.Mounts.every(m => m.Type === 'tmpfs' && m.Destination === '/var/lib/postgresql/data'));
assert.ok(Object.hasOwn(owned.HostConfig.Tmpfs, '/var/lib/postgresql/data'));
const rpcNames = [];
function sql(statement, role = 'postgres') {
  const result = spawnSync(docker, ['--host', endpoint, 'container', 'exec', '-i', container,
    'psql', '-X', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    input: Buffer.from(`SET SESSION AUTHORIZATION ${role};SET request.jwt.claim.sub='${actor}';${statement}`, 'utf8'),
    timeout: 20000,
  });
  if (result.error) throw result.error;
  return result.status === 0 ? { data: result.stdout.toString('utf8').trim(), error: null }
    : { data: null, error: { code: result.stderr.toString('utf8').match(/ERROR:\s+(\w{5}):/)?.[1] ?? 'unknown' } };
}
function rpc(role) {
  return async (name, args) => {
    assert.ok(['erp_authorize_invitation', 'erp_bind_invited_membership', 'erp_create_invited_membership'].includes(name));
    rpcNames.push(name);
    const values = Object.values(args).map(v => { assert.match(v, /^[a-z0-9-]+$/); return `'${v}'`; });
    return sql(`SELECT public.${name}(${values.join(',')})`, role);
  };
}
const origin = 'https://local.example.invalid';
const dependencies = {
  'next/server': { NextResponse },
  '@/lib/auth/invitations': {
    parseInvitationInput: value => { assert.deepEqual(JSON.parse(JSON.stringify(value)), { tenantId: tenant, email: 'synthetic@example.invalid', role: 'employee' }); return value; },
    invitationRedirect: () => origin + '/auth/callback',
  },
  '@/lib/supabase/server': { createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) }, rpc: rpc('authenticated'),
    from: () => { throw new Error('No cached authorization permitted'); },
  }) },
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({
    auth: { admin: { inviteUserByEmail: async () => {
      // Commit a REAL revocation between Auth dispatch and the association RPC.
      assert.equal(sql(`UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='${tenant}' AND user_id='${actor}'`).error, null);
      return { data: { user: { id: recipient } }, error: null };
    } } }, rpc: rpc('service_role'),
    from: () => { throw new Error('Forbidden elevated membership write'); },
  }) },
};
const source = readFileSync(new URL('../../src/app/api/team/invite/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, {
  module: loaded, exports: loaded.exports, URL, Request, Response, TextDecoder, Uint8Array,
  process: { env: { AUTH_INVITE_TEMPLATE_MODE: 'token_hash', NEXT_PUBLIC_SITE_URL: origin } },
  console: { error: () => { throw new Error('Unexpected provider error'); } },
  require: name => { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]; },
});
const response = await loaded.exports.POST(new Request(origin + '/api/team/invite', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tenantId: tenant, email: 'synthetic@example.invalid', role: 'employee' }),
}));
process.stdout.write(JSON.stringify({ status: response.status, rpc: rpcNames }));
