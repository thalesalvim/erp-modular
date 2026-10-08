This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Configure Supabase explicitly before starting HandyHub. Copy `.env.example`
to `.env.local` and fill in the URL and **public** key of the intentionally
selected local/test project. Never use a privileged key. No project or key
is selected when configuration is missing.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

## Camada 0: configuração e evidências

Variáveis obrigatórias: `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (esta última aceita publishable ou JWT anon).
Use `local`, `preview` ou `production` no identificador de ambiente. Em Vercel,
ele precisa corresponder ao `VERCEL_ENV` do build; `development` corresponde a
`local`. Não use `NODE_ENV` para distinguir Preview de Production.

URL, chave e identificador são embutidos pelo Next.js no build. Alterar uma
variável posteriormente exige novo build. Um próximo build/deploy com estas
mudanças falhará se as três variáveis não estiverem configuradas. Esta etapa
não configura a Vercel nem faz deploy.

O identificador de ambiente não verifica a identidade do banco. É preciso
confirmar o project ref de cada URL no painel: local/teste para LOCAL,
staging/desenvolvimento para PREVIEW e o projeto confirmado para PRODUÇÃO.
Uma URL de produção inserida manualmente em LOCAL ainda apontaria para
produção; o código remove a escolha silenciosa, não adivinha os projetos.
A validação de chave verifica formato/role, não assinatura JWT, validade
remota, grants ou RLS.

Teste de configuração offline, sem carregar `.env.local` ou acessar Supabase:

```bash
node --test tests/supabase-config.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/lib/supabase.ts src/lib/supabaseConfig.ts next.config.ts tests/supabase-config.test.mjs
```

O [relatório completo](docs/camada-0-relatorio.md) registra o estado conhecido
e as pendências. As [consultas somente de leitura](supabase/inspection/camada-0-metadata.sql)
devem ser executadas uma por vez no SQL Editor do projeto correto, sem
consultar dados de empresas. Veja [a orientação de baseline](supabase/README.md).
Filtros `slug`/`tenant_slug`, cargos da interface e `localStorage` não
substituem autorização no banco; a Camada 1 ainda não foi implementada.

This project uses `next/font/google` to load Inter. The build needs access to Google Fonts.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
