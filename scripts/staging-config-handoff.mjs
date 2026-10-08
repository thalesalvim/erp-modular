// One-shot loopback form for existing STAGING credentials. No secrets in stdout or tracked files.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';

const ref = 'gbblkkgowccjycxtexvx';
const origin = 'http://127.0.0.1:43187';
const token = randomBytes(24).toString('hex');
const target = '.env.staging.local';
if (existsSync(target)) throw new Error('Staging configuration already exists; refusing to overwrite.');
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
  if (request.headers.host !== '127.0.0.1:43187' || request.url !== `/${token}`) {
    response.writeHead(404).end(); return;
  }
  if (request.method === 'GET') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<h1>HandyHub staging — configuração local</h1><p>Destino: ${ref}. Arquivo local ignorado pelo Git.</p><form method="post"><label>Chave pública do staging<input name="publicKey" type="password" required autocomplete="off"></label><label>Chave de servidor do staging<input name="serverKey" type="password" required autocomplete="off"></label><button>Salvar configuração local do staging</button></form>`);
    return;
  }
  if (request.method !== 'POST' || request.headers.origin !== origin || !request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
    response.writeHead(403).end(); return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 16000) throw new Error('Oversized request');
    }
    const form = new URLSearchParams(body);
    const publicKey = form.get('publicKey') || '';
    const serverKey = form.get('serverKey') || '';
    const decode = (key) => JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    const publicClaims = decode(publicKey);
    const serverClaims = decode(serverKey);
    if (publicClaims.ref !== ref || publicClaims.role !== 'anon' || serverClaims.ref !== ref || serverClaims.role !== 'service_role') throw new Error('Wrong project or role');
    if (![publicKey, serverKey].every((key) => /^[A-Za-z0-9_.-]+$/.test(key))) throw new Error('Invalid key');
    writeFileSync(target, `NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${publicKey}\nNEXT_PUBLIC_APP_ENV=local\nNEXT_PUBLIC_SITE_URL=http://localhost:3000\nSUPABASE_SERVICE_ROLE_KEY=${serverKey}\n`, { flag: 'wx', mode: 0o600 });
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<h1>Configuração local do staging salva.</h1><p>Nenhum valor foi exibido. O receptor local foi encerrado.</p>');
    server.close();
    console.log('Staging local configuration saved; no values displayed.');
  } catch {
    response.writeHead(400).end('Configuration rejected; no values displayed.');
  }
});
server.listen(43187, '127.0.0.1', () => console.log(`Staging configuration form: ${origin}/${token}`));
setTimeout(() => server.close(), 10 * 60 * 1000).unref();
