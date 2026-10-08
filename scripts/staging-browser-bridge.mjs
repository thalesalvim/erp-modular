// Loopback-only fixture/evidence form for browser tests; never a production endpoint.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const fixtures = JSON.parse(readFileSync('.env.staging-fixtures.json', 'utf8'));
if (fixtures.ref !== 'gbblkkgowccjycxtexvx') throw new Error('Wrong staging');
const token = randomBytes(24).toString('hex');
const origin = 'http://127.0.0.1:43188';
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const server = createServer(async (request, response) => {
  const parsed = new URL(request.url, origin);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
  if (request.headers.host !== '127.0.0.1:43188' || parsed.pathname !== `/${token}`) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.method === 'GET') {
    const actor = parsed.searchParams.get('actor');
    const user = fixtures.users[actor];
    response.end(`<h1>HandyHub — fixtures de staging</h1><p>Somente dados sintéticos; projeto ${fixtures.ref}.</p><form method="get"><label>Perfil sintético<select name="actor">${Object.keys(fixtures.users).map((name) => `<option${name === actor ? ' selected' : ''}>${name}</option>`).join('')}</select></label><button>Obter credenciais sintéticas</button></form>${user ? `<label>E-mail sintético<textarea readonly>${escape(user.email)}</textarea></label><label>Senha sintética<textarea readonly>${escape(user.password)}</textarea></label>` : ''}<form method="post"><label>Nome da evidência<select name="name"><option>preview-variables</option><option>master-staging</option><option>equipe-staging</option></select></label><label>Imagem de evidência<textarea name="image"></textarea></label><button>Salvar evidência local</button></form>`);
    return;
  }
  if (request.method !== 'POST' || request.headers.origin !== origin || !request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) { response.writeHead(403).end(); return; }
  try {
    let body = '';
    for await (const chunk of request) { body += chunk; if (body.length > 10e6) throw new Error('Too large'); }
    const form = new URLSearchParams(body);
    const name = form.get('name');
    if (!['preview-variables', 'master-staging', 'equipe-staging'].includes(name)) throw new Error('Invalid filename');
    const bytes = Buffer.from(form.get('image') || '', 'base64');
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.length > 6e6) throw new Error('Invalid JPEG');
    mkdirSync('docs/evidence', { recursive: true });
    writeFileSync(`docs/evidence/camada-1b-${name}.jpg`, bytes);
    response.end(`<h1>Evidência salva: ${name}</h1>`);
    console.log(`Evidence saved: ${name}`);
  } catch { response.writeHead(400).end('Invalid evidence'); }
});
server.listen(43188, '127.0.0.1', () => console.log(`Staging browser bridge: ${origin}/${token}`));
setTimeout(() => server.close(), 45 * 60 * 1000).unref();
