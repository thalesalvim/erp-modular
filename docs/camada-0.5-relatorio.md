# HandyHub — relatório da segunda passagem e Camada 0.5

**Data:** 8 de outubro de 2026. **Escopo:** auditoria de integrações, fundação
de identidade/tenant, três migrations aditivas, testes sintéticos e plano de
cutover. Nenhuma tela da Camada 1 foi iniciada. Não houve deploy, push, merge,
criação/exclusão de usuários Auth ou leitura de conteúdo de clientes.

## 1. Status

- **Camada 0: CONCLUÍDA.** As evidências externas antes indisponíveis foram
  obtidas e cruzadas. As correções locais da configuração Supabase foram
  mantidas, testadas e incluídas nesta branch. O código de produção continua
  no commit que foi auditado; não foi publicado nenhum código local.
- **Camada 0.5: CONCLUÍDA.** As três migrations aditivas foram aplicadas e
  verificadas no projeto Supabase real. O RLS das tabelas legadas permanece
  desligado de propósito até o cutover autenticado da Camada 1.
- **Pronto para começar a Camada 1: SIM**, para implementar Auth e a nova
  interface. Isto não inicia a Camada 1 nem autoriza o cutover de produção.
  Antes de qualquer publicação em Preview, falta provisionar um destino
  Supabase isolado e suas variáveis.

## 2. Acessos e produção

| Integração | Evidência consultada |
|---|---|
| Supabase | Projeto `handyhub-db`, ref `qmfwsnhpmsonndhgqsyi`, ativo, PostgreSQL 17.11; catálogos, grants efetivos, RLS, policies, funções, triggers, constraints, Auth e Storage consultados em leitura. |
| Vercel | Projeto `erp-modular`, deployments, domínios e nomes/targets de variáveis consultados sem descriptografar valores. |
| GitHub | Repositório `thalesalvim/erp-modular`, branches, refs, rulesets e GitHub Actions consultados em leitura. Endpoints de secrets não estão disponíveis pela integração. |

| Item de produção | Valor confirmado |
|---|---|
| Repositório | `thalesalvim/erp-modular` |
| Branch principal | `main` |
| Commit em `main` | `382155ba8a4df24b2bab46ff40f038607992ead1` |
| Deployment | `dpl_CH7dqWURTMipa81rY6Qh1hNNeuMU`, READY/Production |
| Commit no deployment | `382155ba8a4df24b2bab46ff40f038607992ead1` (`main`) |
| Domínios | `www.handyhub.com.br`, `handyhub.com.br` e aliases Vercel do projeto |
| Projeto Supabase usado pelo bundle atual | `handyhub-db` (`qmfwsnhpmsonndhgqsyi`) |

O código remoto auditado no GitHub e o deployment atual da Vercel coincidem
nesse SHA. O checkout local nesta branch contém as correções da Camada 0 e a
fundação 0.5; ele difere desse SHA e não foi enviado nem implantado. Assim,
**GitHub main = código atualmente em produção**; **o novo código local ainda
não é o código em produção**.

## 3. Supabase real

### Tabelas, constraints e estado de RLS

| Tabela | Estrutura/constraints relevantes | RLS / FORCE após as migrations |
|---|---|---|
| `public.tenants` | `id uuid` PK; `slug text` UNIQUE; dados de empresa e campos JSON existentes. | Desligado / não; a policy criada ainda está inativa. |
| `public.tenant_data` | `id uuid` PK; `tenant_slug`, `data_key`, `payload jsonb`; UNIQUE `(tenant_slug,data_key)`. Agora também `tenant_id uuid NOT NULL`, FK para `tenants(id)` com `ON DELETE RESTRICT`, UNIQUE `(tenant_id,data_key)`. | Desligado / não; as quatro policies criadas ainda estão inativas. |
| `public.companies` | `id integer` PK e campos `name`, `email`, `active`, `created_at`. Agora `tenant_id uuid NULL`, FK para `tenants(id)` com `ON DELETE RESTRICT` e índice. | Desligado / não; policies criadas ainda inativas. |
| `public.tenant_memberships` | `id uuid` PK; FKs `tenant_id → tenants.id` e `user_id → auth.users.id`; UNIQUE `(tenant_id,user_id)`; CHECK de cargo; índices para usuário ativo e tenant/cargo ativo. | Habilitado / não forçado; policy SELECT limitada a si próprio, Dono do tenant ou admin da plataforma. |
| `public.platform_admins` | `user_id uuid` PK/FK para `auth.users.id`; CHECK restringe `role` a `platform_admin`. | Habilitado / não forçado; sem policy nem grant direto para `anon`/`authenticated`. |

O preflight encontrou 1 tenant, 1 linha de `tenant_data`, 1 linha de
`companies` e nenhum `tenant_data.tenant_slug` órfão. A migration preencheu
somente o novo `tenant_data.tenant_id` daquela linha; não leu nem alterou o
payload JSON. A linha existente de `companies` ficou com `tenant_id NULL`,
sem inferência por nome ou e-mail. Nenhum valor de linha foi exibido neste
relatório.

### RLS, policies e grants

As migrations criaram 13 policies, todas para `authenticated`:

- `tenant_memberships`: SELECT do próprio vínculo, vínculos do tenant para
  Dono, ou leitura pelo admin da plataforma; não há policy de escrita.
- `tenants`: SELECT para membro ativo ou admin; INSERT/DELETE para admin; UPDATE
  para Dono do próprio tenant ou admin, com `USING` e `WITH CHECK`.
- `tenant_data`: SELECT para membro ativo ou admin; INSERT/UPDATE/DELETE para
  Dono/Gestor ou admin. O payload único não permite restringir subcampos por
  cargo; Funcionário fica somente com leitura após o cutover.
- `companies`: SELECT para qualquer membro; INSERT/UPDATE/DELETE para
  Dono/Gestor ou admin, sempre exigindo `tenant_id` não nulo.

As policies de `tenants`, `tenant_data` e `companies` estão gravadas, mas não
são aplicadas enquanto `relrowsecurity=false`. Metadados confirmam que
`anon` e `authenticated` ainda têm SELECT/INSERT/UPDATE/DELETE nas três tabelas.
As policies não revogam grants e não isolam linhas por si sós.

Em `tenant_memberships`, `anon` não tem grants; `authenticated` tem somente
SELECT e fica submetido à policy. `platform_admins` não concede acesso direto
a `anon`/`authenticated`. `service_role` mantém CRUD nessas duas tabelas como
papel de backend privilegiado. As funções auxiliares não são executáveis por
`anon`; `authenticated` pode executar somente `has_tenant_role` e
`is_platform_admin` para avaliação de policies.

Os defaults para objetos criados por `postgres` foram revogados para
`PUBLIC`, `anon` e `authenticated`. Os defaults de `supabase_admin` continuam
amplos: a conexão executa como `postgres`, não é membro desse papel e o
Postgres recusou a alteração. Esse limite foi confirmado por metadados; não
houve tentativa de contorná-lo. Os grants já existentes nas três tabelas
legadas continuam amplos.

### Functions, trigger, views e Storage

- `private.has_tenant_role(uuid,text[])` e `private.is_platform_admin()` são
  `SECURITY DEFINER`, pertencem a `postgres`, fixam `search_path` vazio e
  negam EXECUTE a `PUBLIC`/`anon`; EXECUTE é dado a `authenticated` para as
  policies.
- `private.sync_tenant_data_identity()` é `SECURITY INVOKER`, também fixa
  `search_path` vazio, sem EXECUTE para roles cliente. O trigger BEFORE
  INSERT/UPDATE resolve o slug para ID e rejeita par inconsistente. O slug
  continua sendo compatibilidade, não autorização.
- Nenhuma view pública/privada relevante foi encontrada na inspeção.
- `storage.buckets` não tem buckets; não há policies Storage. `storage.objects`
  tem RLS habilitado, sem policy de projeto. O código atual não usa SDK Storage.

## 4. ANON

| Operação | `tenants` | `tenant_data` |
|---|---|---|
| SELECT | **PERMITIDO** | **PERMITIDO** |
| INSERT | **PERMITIDO** | **PERMITIDO** |
| UPDATE | **PERMITIDO** | **PERMITIDO** |
| DELETE | **PERMITIDO** | **PERMITIDO** |

Motivo: grants efetivos confirmados, RLS desligado e nenhuma policy prévia.
Para `tenant_memberships` e `platform_admins`, `anon` não tem grants. A role
pública não foi testada contra conteúdo de empresa.

## 5. AUTHENTICATED

| Operação | `tenants` | `tenant_data` |
|---|---|---|
| SELECT | **PERMITIDO** | **PERMITIDO** |
| INSERT | **PERMITIDO** | **PERMITIDO** |
| UPDATE | **PERMITIDO** | **PERMITIDO** |
| DELETE | **PERMITIDO** | **PERMITIDO** |

Hoje a role não está limitada a tenant: as policies estão inativas porque RLS
está desligado. Depois do cutover, a estratégia preparada permite acesso a
todos os tenants com membership ativa do usuário; isso pode incluir mais de
um tenant, mas não qualquer tenant apenas por estar autenticado. `owner` e
`manager` escrevem o JSON; `employee` lê. O usuário não pode criar ou promover
membership pela tabela via API.

## 6. Isolamento e associação usuário → empresa

**Empresa A consegue acessar Empresa B? COMPROVADAMENTE PERMITIDO.** Os grants
de `anon` e `authenticated` incluem CRUD, e o RLS das tabelas legadas está
desligado. Não fiz requisição de leitura nem tentativa cruzada; a conclusão
vem exclusivamente da configuração efetiva.

A ligação pronta é `auth.uid()` → `tenant_memberships.user_id` →
`tenant_memberships.tenant_id` → `tenants.id`. A membership não usa e-mail,
nome, localStorage ou slug como chave. Uma pessoa pode ter memberships em mais
de um tenant, cada uma com um papel e estado ativo. Ainda não há memberships
nem usuários Auth; o banco exige que sua criação venha de fluxo confiável do
servidor. O trigger do slug só mantém compatibilidade e coerência do ID; não
autoriza a empresa escolhida pelo navegador.

## 7. Master e Equipe

| Área | Alcance atual observado |
|---|---|
| Interface | `/master` mantém credencial literal e flags em armazenamento do navegador; modo suporte usa token/estado cliente. `/equipe` ainda usa login próprio e estado local, sem sessão Auth própria. |
| Dados | O código consulta tenants/dados pelo cliente Supabase. O carregamento ocorre antes de certas verificações de interface. Como as tabelas legadas estão abertas, a configuração do banco não restringe nenhuma tela ao tenant. |
| Alteração de dados | A role pública possui UPDATE/INSERT/DELETE no banco. Dono/Gestor/Funcionário ainda não são separados efetivamente no banco atual. A API `/api/equipe` altera estado em memória sem autorização por Auth; isso não prova persistência em produção. |
| Privilégios | Master, suporte e cargos no navegador não estabelecem identidade ou autorização confiável no servidor. `platform_admins` oferece a base separada, mas não há usuário/admin provisionado nem interface nova. |

A credencial Master não foi exposta neste relatório, mas continua versionada no
código da branch principal e precisa ser removida na Camada 1. Os helpers e
policies da Camada 0.5 não transformam a interface atual em login seguro nem
fecham as tabelas legadas antes do cutover.

## 8. Auth

Configuração visível anteriormente pela integração: login e signup por e-mail
habilitados; confirmação de e-mail exigida; login por telefone, conta anônima e
providers externos desabilitados. Os catálogos mostram **0 usuários, 0 sessões
e 0 identidades**. Nenhuma conta foi criada ou alterada. Não incluí e-mails,
hashes, tokens ou outros dados pessoais. Duração de sessão, configuração de
recuperação/redirecionamentos e detalhes do transporte de e-mail não foram
expostos pela integração consultada.

## 9. Vercel e ambientes

O projeto não tem deployments nem variáveis para Preview/Development. Em
Production existem os nomes `NEXT_PUBLIC_SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_ANON_KEY`; ambos aparecem como criptografados e seus
valores não foram solicitados nem exibidos. `NEXT_PUBLIC_APP_ENV` não está
configurada no projeto remoto.

| Ambiente | Estado / risco |
|---|---|
| Development | Sem variáveis Vercel ou deployment. Destino efetivamente usado: **NÃO VERIFICÁVEL**. A configuração local da branch falha sem variáveis e rejeita o URL de produção. |
| Preview | Sem variáveis Vercel ou deployment. Destino efetivamente usado: **NÃO VERIFICÁVEL**. O risco de fallback é **CONFIRMADO** para o código atual de `main`, que ainda contém o fallback para o projeto Production quando a variável falta. As correções locais que fazem Preview falhar de forma segura não foram implantadas. |
| Production | Usa o deployment e projeto Supabase acima. As duas variáveis públicas estão definidas; os valores permaneceram ocultos. A revisão local exige também `NEXT_PUBLIC_APP_ENV=production`, ainda ausente no painel. |

Não houve alteração de variáveis ou configurações Vercel. Não se deve publicar
o checkout atual em Production sem primeiro preparar e revisar as variáveis.
Não se deve publicar Preview antes de existir um projeto Supabase isolado.

## 10. GitHub

- Repositório correto: `thalesalvim/erp-modular`, público; default branch
  `main`, commit `382155ba8a4df24b2bab46ff40f038607992ead1`.
- A lista remota contém somente `main`. `codex/camada-0-base` existe localmente;
  ainda não existe no GitHub.
- Branch API mostra `protected=false`; rulesets retornam `[]`. O endpoint de
  detalhes de branch protection retornou 403, portanto regras finas não foram
  acessíveis; não foi encontrada proteção ativa.
- `.github/workflows` retorna 404 e há zero execuções de GitHub Actions.
- A integração não oferece acesso aos endpoints de secrets; existência e nomes
  dos secrets são **NÃO DISPONÍVEIS PELA INTEGRAÇÃO**. Nenhum valor de secret
  foi consultado.
- Não foram encontrados arquivos `.env`/chaves Supabase privilegiadas no
  bundle de produção consultado. A credencial Master literal no código é um
  dado sensível versionado que permanece pendente da Camada 1.

## 11. Alterações locais incluídas

| Arquivo | Finalidade |
|---|---|
| `.gitignore`, `.env.example` | Impedir versionamento de ambientes reais e documentar placeholders sem secrets. |
| `src/lib/supabase.ts`, `src/lib/supabaseConfig.ts`, `next.config.ts` | Exigir configuração explícita, validar papel/URL e bloquear fallback de Production em local/Preview. |
| `package.json`, `package-lock.json` | Adicionar PGlite como dependência de teste local. |
| `tests/supabase-config.test.mjs` | Testes de configuração, chave, URL, ambiente e inicialização SDK sem rede. |
| `tests/security-foundation.test.mjs` | Testes de duas empresas, roles, policies, trigger, cutover e grants com dados sintéticos. |
| `supabase/baseline/public-before-0.5.sql` | Baseline local sintética fiel aos metadados observados, para PGlite; não executar no remoto. |
| `supabase/inspection/camada-0-metadata.sql` | Consultas SELECT para catálogo; não altera banco. |
| `supabase/migrations/20261008020335_security_identity_memberships.sql` | Memberships, admin de plataforma, FKs, unicidade, índices e defaults do papel `postgres`. |
| `supabase/migrations/20261008020339_security_tenant_data_identity.sql` | `tenant_id`, backfill por slug, FK, índice e trigger compatível. |
| `supabase/migrations/20261008020344_security_rls_policies.sql` | Helpers e policies RLS; legado permanece sem RLS. |
| `supabase/activation/camada-1-cutover.sql` | Cutover separado, com pré-condições e confirmação; não executado. |
| `supabase/README.md` | Estado remoto atual, limites e como verificar sem confundir migrations e cutover. |
| `docs/camada-0-relatorio.md` | Marcado como histórico da primeira passagem. |
| `docs/camada-1-cutover.md` | Ordem para auth, membership, validações e ativação. |
| `docs/camada-0.5-relatorio.md` | Este relatório. |
| `README.md` | Requisitos locais de configuração e testes. |

## 12. Migrations remotas

| Versão remota | Arquivo/finalidade |
|---|---|
| `20261008022931` `security_identity_memberships` | `tenant_memberships`, `platform_admins`, grants mínimos e defaults restritos para `postgres`. |
| `20261008022946` `security_tenant_data_identity` | UUID/FK/índice em `tenant_data`, backfill de 1 ID e vínculo nullable em `companies`. |
| `20261008023101` `security_rls_policies` | Helpers, 13 policies; RLS ligado somente em membership/admin. |

A primeira tentativa falhou ao tentar alterar defaults de `supabase_admin` e
foi revertida pela transação. Confirmei que nenhum objeto ficou parcialmente
criado; retirei somente essa parte impossível para a role da integração,
apliquei novamente pelo `apply_migration` oficial e validei as três versões.
Nenhum SQL alternativo foi usado para contornar o bloqueio.

## 13. Testes e verificação

- `node --test tests/supabase-config.test.mjs tests/security-foundation.test.mjs`:
  **11/11 passaram**.
- `npx tsc --noEmit --incremental false`: **passou**.
- Lint dos dois arquivos de teste alterados: **passou**.
- `git diff --check`: **passou**.
- Build `npm run build -- --webpack` com URL localhost e chave sintética:
  **passou**, compilou e gerou as 9 páginas/rotas. O primeiro worker foi
  bloqueado pelo sandbox em `.next`; uma repetição local aprovada pelo sandbox
  concluiu normalmente.
- O build padrão Turbopack teve uma falha interna de processo CSS/PostCSS no
  sandbox; isso não foi reproduzido no build Webpack. Nenhum build/deploy
  ocorreu na Vercel.
- A suíte PGlite simula usuários e empresas fictícios; não faz conexão com o
  Supabase remoto. A validação remota feita após as migrations consultou apenas
  catálogos e agregados sem ler payload, nomes ou e-mails de empresas.

## 14. Cutover da Camada 1

1. Criar/provisionar um projeto Supabase isolado para Preview/Development e
   configurar variáveis distintas; não reutilizar Production.
2. Implementar Supabase Auth no fluxo da aplicação e confirmar que a sessão/JWT
   corresponde ao usuário autenticado. Migrar o login próprio sem copiar
   senhas/hashes para metadata.
3. Provisionar, por fluxo confiável de servidor, usuários Auth e memberships
   validadas por responsáveis de cada tenant. Nunca aceitar `tenant_id` ou
   role arbitrários do navegador.
4. Provisionar `platform_admins` somente por operação privilegiada de servidor;
   substituir credencial literal, flags de suporte e papéis locais.
5. Adaptar consultas para `tenant_id`, validar permissões no servidor e
   solucionar o mapeamento de `companies` se essa tabela passar a ser usada.
6. Testar em Preview isolado: anon sem acesso; A não lê/escreve B; cargos;
   recovery/login; rotas Master/Equipe; revisar logs e backup.
7. Confirmar pelo menos um admin de plataforma e um Dono Auth ativo por
   tenant. O script de cutover aborta sem essas pré-condições.
8. Somente depois da revisão e autorização separada, ativar em Production via
   `supabase/activation/camada-1-cutover.sql`, com
   `handyhub.cutover_ready='yes'`. Esse passo liga/força RLS nas tabelas
   antigas e revoga os grants públicos. Não foi executado nesta tarefa.
9. Revalidar permissões e isolamento A/B com usuários sintéticos/contas
   aprovadas e executar smoke tests antes de liberar tráfego.

## 15. Riscos conhecidos

- Até o cutover, `tenants`, `tenant_data` e `companies` permitem CRUD a
  `anon`/`authenticated`. **A Empresa A ainda pode acessar a Empresa B.**
- O deployment da Vercel ainda executa o commit antigo, com fallback de
  configuração. As correções locais não chegaram a GitHub/produção.
- Preview/Development não têm projeto ou variáveis próprias. Um Preview do
  commit atual de `main` pode apontar silenciosamente ao banco Production.
- `supabase_admin` ainda tem defaults amplos; os defaults de `postgres` estão
  restritos. Novos objetos criados sob `supabase_admin` precisam de revisão de
  grants/RLS.
- Não há contas Auth/memberships/admins reais. Os caminhos de login, convite e
  recuperação da Camada 1 precisam ser construídos e provisionados.
- `companies` tem uma linha sem `tenant_id`; se ela entrar no fluxo protegido,
  precisa de associação explícita antes do cutover.
- A credencial Master e o modo suporte cliente precisam ser substituídos por
  identidade/autorização confiável e auditada.

## 16. Pendências de evidência

Somente estes pontos ficaram sem confirmação pela integração:

- Nomes/existência de GitHub Actions secrets; endpoints de secrets indisponíveis.
- Regras detalhadas de branch protection; o indicador de branch é `false` e
  rulesets estão vazios, mas o endpoint detalhado retornou 403.
- Duração de sessão e redirects/detalhes do fluxo de recuperação do Auth.
- Projeto efetivamente usado por Preview/Development; não há deployments nem
  variáveis desses ambientes.
- Se existe um projeto de staging em outra organização/conta Supabase não
  visível para esta integração.

O estado dos defaults amplos de `supabase_admin` não é pendência de evidência:
foi confirmado. É uma limitação de permissão da conexão para alterá-los.

## 17. Git e decisão

Branch de trabalho local: `codex/camada-0-base`. `main` não foi alterada. As
alterações permanecem restritas a esta branch; não houve push, merge ou deploy.
O SHA inicial local era `382155ba8a4df24b2bab46ff40f038607992ead1`. O SHA do
único commit local desta consolidação será informado junto com este relatório
na resposta da execução. GitHub remoto continua somente em `main`; a branch
de trabalho não foi enviada.

**Pronto para Camada 1: SIM**, para iniciar separadamente a implementação de
Auth e interface sobre esta fundação. O banco permanece aberto até haver
identidades, memberships e validação suficiente para o cutover; este relatório
não inicia nem autoriza esse próximo trabalho.
