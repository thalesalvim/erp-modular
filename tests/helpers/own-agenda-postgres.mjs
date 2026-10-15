// Native SQL authorization + actual loopback HTTP handler responses.
// Auth transport is controlled, not real Supabase Auth/JWT or PostgREST.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { ownAgendaRoute } from './own-agenda-route.mjs';

const [docker, endpoint, container, runId, token, serverId, imageId] = process.argv.slice(2);
assert.ok(endpoint === 'npipe:////./pipe/dockerDesktopLinuxEngine' || endpoint === 'unix:///var/run/docker.sock' || /^unix:\/\/\/home\/[^/]+\/\.docker\/desktop\/docker\.sock$/.test(endpoint));
assert.match(container, /^[a-f0-9]{64}$/);
assert.match(runId, /^[a-f0-9]{32}$/); assert.match(token, /^[a-f0-9]{32}$/);
assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
function command(args, input) {
  const result = spawnSync(docker, ['--host', endpoint, ...args], { input, timeout: 20000 });
  if (result.error) throw result.error;
  return result;
}
assert.equal(command(['info', '--format', '{{.ID}}']).stdout.toString('utf8').trim(), serverId);
const inspected = command(['container', 'inspect', container]);
assert.equal(inspected.status, 0);
const [owned] = JSON.parse(inspected.stdout.toString('utf8'));
assert.equal(owned.Id, container); assert.equal(owned.Image, imageId);
assert.equal(owned.Config.Labels['io.handyhub.pg-tests.run'], runId);
assert.equal(owned.Config.Labels['io.handyhub.pg-tests.resource'], token);
assert.equal(owned.HostConfig.NetworkMode, 'none');
assert.equal(owned.HostConfig.PublishAllPorts, false);
assert.equal(Object.keys(owned.HostConfig.PortBindings ?? {}).length, 0);
assert.equal((owned.HostConfig.Binds ?? []).length, 0);
assert.ok(owned.Mounts.every(m => m.Type === 'tmpfs' && m.Destination === '/var/lib/postgresql/data'));
assert.ok(Object.hasOwn(owned.HostConfig.Tmpfs, '/var/lib/postgresql/data'));

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = uuid(103), employee = uuid(3), manager = uuid(2), peer = uuid(4), owner = uuid(1);
function sql(statement, actor = null, role = 'authenticated') {
  if (actor !== null) assert.match(actor, /^[0-9a-f-]{36}$/);
  assert.ok(['postgres', 'authenticated'].includes(role));
  const result = command(['container', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
    Buffer.from(`SET SESSION AUTHORIZATION ${role};SET request.jwt.claim.sub='${actor ?? ''}';${statement}`, 'utf8'));
  return result.status === 0 ? { data: result.stdout.toString('utf8').trim(), error: null }
    : { data: null, error: { code: result.stderr.toString('utf8').match(/ERROR:\s+(\w{5}):/)?.[1] ?? 'unknown' } };
}
const admin = statement => { const result = sql(statement, null, 'postgres'); assert.equal(result.error, null); return result.data; };

let identity = employee;
let expired = false;
const route = ownAgendaRoute(async () => {
  const caller = identity; // One trusted synthetic identity per sequential HTTP test.
  return {
    auth: { getUser: async () => ({ data: { user: caller ? { id: caller } : null }, error: expired ? { status: 401 } : null }) },
    from: table => {
      assert.equal(table, 'tenant_memberships');
      const filters = {};
      const query = {
        select: fields => { assert.equal(fields, 'tenant_id'); return query; },
        eq: (key, value) => { filters[key] = value; return query; },
        maybeSingle: async () => {
          assert.equal(filters.user_id, caller); assert.equal(filters.is_active, true);
          assert.match(filters.tenant_id, /^[0-9a-f-]{36}$/);
          const result = sql(`SELECT coalesce(json_agg(m),'[]'::json) FROM (SELECT tenant_id FROM public.tenant_memberships WHERE tenant_id='${filters.tenant_id}' AND user_id='${caller}' AND is_active) m`, caller);
          return { data: result.error ? null : JSON.parse(result.data)[0] ?? null, error: result.error };
        },
      };
      return query;
    },
    rpc: async (name, args, options) => {
      assert.equal(name, 'erp_read_own_appointments'); assert.deepEqual(JSON.parse(JSON.stringify(options)), { get: true });
      assert.deepEqual(Object.keys(args), ['p_tenant']); assert.match(args.p_tenant, /^[0-9a-f-]{36}$/);
      const result = sql(`SELECT coalesce(json_agg(r),'[]'::json) FROM public.erp_read_own_appointments('${args.p_tenant}') r`, caller);
      return { data: result.error ? null : JSON.parse(result.data), error: result.error };
    },
  };
}, { HANDYHUB_OWN_AGENDA_ENABLED: 'true' }); // Isolated VM only, not process.env.

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const response = await route.GET(new Request('http://127.0.0.1' + req.url));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const cases = [];
async function get(name, actor, expectedStatus, expectedIds, target = tenant) {
  identity = actor;
  const response = await fetch(origin + '/api/agenda/own?tenantId=' + target, { cache: 'no-store' });
  assert.equal(response.status, expectedStatus, name);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json();
  if (expectedStatus === 200) {
    assert.deepEqual(body.items.map(r => r.id), expectedIds);
    for (const row of body.items) assert.deepEqual(Object.keys(row).sort(), ['clientName', 'date', 'id', 'serviceName', 'status', 'time']);
  } else assert.equal('items' in body, false);
  cases.push({ name, status: response.status });
}
try {
  await get('Own authorized tenant', employee, 200, [uuid(10331)]);
  await get('Homonymous colleague has only their own appointment', peer, 200, [uuid(10332)]);
  await get('Foreign tenant A', employee, 403, null, uuid(101));
  await get('Foreign tenant B', employee, 403, null, uuid(102));
  await get('Absent session', null, 401);
  expired = true; await get('Expired Auth transport result', employee, 401); expired = false;
  await get('No membership', uuid(6), 403);
  await get('Manager without own permission', manager, 403);
  admin(`UPDATE public.erp_appointments SET responsible_employee_id=NULL WHERE tenant_id='${tenant}' AND id='${uuid(10331)}'`);
  await get('Authorized empty agenda', employee, 200, []);
  admin(`UPDATE public.erp_appointments SET responsible_employee_id='${uuid(10301)}' WHERE tenant_id='${tenant}' AND id='${uuid(10331)}'`);
  // The fixture supplies the revision; the real RPC still verifies Owner authority.
  const beforeRevocation = admin(`SELECT revision FROM private.erp_policy_state WHERE tenant_id='${tenant}'`);
  assert.equal(sql(`SELECT public.erp_set_role_permissions('${tenant}','employee',ARRAY[]::text[],${beforeRevocation})`, owner).error, null);
  await get('Permission revoked', employee, 403);
  const revision = admin(`SELECT revision FROM private.erp_policy_state WHERE tenant_id='${tenant}'`);
  assert.equal(sql(`SELECT public.erp_set_role_permissions('${tenant}','employee',ARRAY['appointments.read_own']::text[],${revision})`, owner).error, null);
  admin(`UPDATE public.tenant_memberships SET is_active=false WHERE tenant_id='${tenant}' AND user_id='${employee}'`);
  await get('Membership inactive', employee, 403);
  admin(`UPDATE public.tenant_memberships SET is_active=true WHERE tenant_id='${tenant}' AND user_id='${employee}'`);
  admin(`UPDATE public.tenants SET status='Bloqueado' WHERE id='${tenant}'`);
  await get('Suspended tenant', employee, 403);
  admin(`UPDATE public.tenants SET status='Ativo' WHERE id='${tenant}'`);
  admin(`UPDATE public.tenant_data SET payload='{"appointments":[{"id":"legacy-only"}]}'::jsonb WHERE tenant_id='${tenant}'`);
  await get('Legacy JSON is not used', employee, 200, [uuid(10331)]);
  console.log(JSON.stringify({ scenarios: cases.length, cases, auth: 'controlled transport', database: 'native PostgreSQL after v5', http: 'loopback Node server, actual Next GET handler' }));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
