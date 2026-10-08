export type AppEnvironment = 'local' | 'preview' | 'production';

// Public project identity verified against Vercel and Supabase on 2026-10-07.
// Changing production projects requires reviewing this mapping and the environments.
export const PRODUCTION_SUPABASE_HOST = 'qmfwsnhpmsonndhgqsyi.supabase.co';

interface SupabaseEnvironment {
  url?: string;
  publicKey?: string;
  appEnvironment?: string;
  deploymentEnvironment?: string;
}

function invalid(variable: string, reason: string): never {
  // Never include a supplied value: it may accidentally contain a secret.
  throw new Error(`[Supabase config] ${variable}: ${reason}`);
}

/** Validates configuration only; never connects to Supabase. */
export function getSupabaseConfig(input: SupabaseEnvironment) {
  const environment = input.appEnvironment?.trim();
  if (environment !== 'local' && environment !== 'preview' && environment !== 'production') {
    invalid('NEXT_PUBLIC_APP_ENV', 'defina explicitamente local, preview ou production.');
  }

  if (input.deploymentEnvironment) {
    const expected = input.deploymentEnvironment === 'development' ? 'local' : input.deploymentEnvironment;
    if (environment !== expected) {
      invalid('NEXT_PUBLIC_APP_ENV', 'não corresponde ao ambiente VERCEL_ENV deste build.');
    }
  }

  const url = input.url?.trim();
  if (!url) invalid('NEXT_PUBLIC_SUPABASE_URL', 'variável obrigatória; nenhum projeto padrão será utilizado.');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    invalid('NEXT_PUBLIC_SUPABASE_URL', 'informe uma URL válida do projeto.');
  }

  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname);
  const allowedProtocol = parsedUrl.protocol === 'https:' ||
    (environment === 'local' && loopback && parsedUrl.protocol === 'http:');
  if (!allowedProtocol || parsedUrl.username || parsedUrl.password ||
      parsedUrl.search || parsedUrl.hash || parsedUrl.pathname !== '/') {
    invalid('NEXT_PUBLIC_SUPABASE_URL', 'use HTTPS sem credenciais, caminho ou parâmetros; HTTP somente em loopback no ambiente local.');
  }

  if (environment !== 'production' && parsedUrl.hostname === PRODUCTION_SUPABASE_HOST) {
    invalid('NEXT_PUBLIC_SUPABASE_URL', 'o projeto de produção não é permitido em local ou preview.');
  }
  if (environment === 'production' && parsedUrl.hostname !== PRODUCTION_SUPABASE_HOST) {
    invalid('NEXT_PUBLIC_SUPABASE_URL', 'o projeto não corresponde à produção auditada; revise o mapa de ambientes.');
  }

  const publicKey = input.publicKey?.trim();
  if (!publicKey) invalid('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'variável obrigatória; use somente chave publishable ou anon.');
  if (publicKey.startsWith('sb_secret_')) {
    invalid('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chave privilegiada proibida no cliente.');
  }

  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)) {
    let role: unknown;
    try {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(publicKey)) throw new Error();
      const encoded = publicKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
      const payload: unknown = JSON.parse(atob(padded));
      if (typeof payload === 'object' && payload !== null && 'role' in payload) role = payload.role;
    } catch {
      invalid('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'formato inválido; use uma chave pública publishable ou JWT anon.');
    }
    if (role !== 'anon') {
      invalid('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'somente JWT com role anon é permitido; service_role e outras roles são proibidas.');
    }
  }

  // Syntax/role checks do not verify a JWT signature or remote project identity.
  return { url, publicKey, environment: environment as AppEnvironment };
}
