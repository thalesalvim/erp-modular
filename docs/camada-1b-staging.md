# HandyHub — relatório da Camada 1B no staging

Este é o relatório da preparação anterior. A retomada de convites e seus novos resultados estão em [camada-1b-convites.md](<C:/Users/Thales Alvim/erp-modular/docs/camada-1b-convites.md>).

Data: 08/10/2026. Branch local: `codex/camada-1-auth`. Resultado para revisão, sem publicação.

## 1. Status Camada 1B

**BLOQUEADA ANTES DO CUTOVER. STAGING CRIADO E ISOLADO DA PRODUÇÃO.**

O projeto separado foi confirmado, as migrations de fundação foram aplicadas nele, sete identidades sintéticas foram provisionadas e os dois bloqueios locais de grants/Master foram corrigidos. Auth por senha, memberships e autorização da API Master passaram nos testes anteriores ao cutover. TypeScript, 17 testes, lint direcionado e build Webpack passaram.

O gate de convites encontrou uma incompatibilidade crítica: o convite administrativo usa o fluxo padrão de convite do Supabase, enquanto o cliente usa PKCE e o callback só aceita `code`. O SDK instalado documenta que `inviteUserByEmail` não suporta PKCE. A configuração real mantém o template padrão com `ConfirmationURL`. Não há tratamento de `token_hash` nesse callback.

Foi obedecida a regra expressa desta tarefa: **“Se qualquer gate crítico falhar: PARE.”** Não foram executados cutover, testes posteriores ao fechamento, push ou deployment Preview. As tabelas empresariais ainda estão temporariamente abertas. Separação de infraestrutura não significa que o isolamento entre empresas já foi ativado.

Supabase foi consultado pela integração; o painel confirmou configurações de Auth. A integração Vercel permaneceu com resposta 403 para a equipe; após o login/2FA feito pelo usuário, o painel autenticado permitiu configurar e conferir apenas Preview. O repositório foi conferido pelo checkout e pela referência remota de `main`.

## 2. Ambientes

| Ambiente | Banco/Auth | Configuração | Estado |
|---|---|---|---|
| Local desta validação | `handyhub-staging`, ref `gbblkkgowccjycxtexvx` | Arquivo privado ignorado; servidor em loopback | Testado, servidor encerrado |
| Vercel Preview | Variáveis próprias do staging | Quatro variáveis salvas somente em Preview | Sem deployment e sem callback Preview completo |
| Vercel Development | Não configurado nesta execução | Sem alteração | Ainda não validado |
| Production | `handyhub-db`, ref `qmfwsnhpmsonndhgqsyi` | Variáveis existentes preservadas | Sem alteração |

Organização Supabase: **Thaleco7**, plano Free; staging confirmado Healthy, Postgres 17.11, região us-east-1. O projeto já havia sido criado pelo usuário; esta continuação não criou outro projeto, não fez upgrade e não alterou assinatura.

Variáveis, sem valores:

| Nome | Local de teste | Preview | Production |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Staging | Staging, Config | Existente, preservada |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Própria do staging | Própria do staging, Config | Existente, preservada |
| `NEXT_PUBLIC_APP_ENV` | Local | Preview, Config | Não adicionada nesta tarefa |
| `SUPABASE_SERVICE_ROLE_KEY` | Própria do staging, servidor | Própria do staging, Secret | Não adicionada nesta tarefa |
| `NEXT_PUBLIC_SITE_URL` | Origem local de teste | Pendente de URL real | Não adicionada nesta tarefa |

O guard existente de configuração rejeita o host de produção quando o ambiente é local/preview. Essa validação de sintaxe/role não verifica assinatura de JWT; a associação das credenciais ao staging também foi conferida durante a configuração e comprovada pelos acessos ao projeto sintético.

Não foram lidas ou copiadas chaves administrativas de produção. A Vercel chama variáveis públicas de “Config”; a chave administrativa de staging foi salva como **Secret** exclusivamente em Preview. A captura mostra nomes e destinos, com valores mascarados: [evidência das variáveis](<C:/Users/Thales Alvim/erp-modular/docs/evidence/camada-1b-preview-variables.jpg>).

## 3. Usuários de teste

**Sete usuários Auth sintéticos**, todos com e-mail confirmado por verificação oficial de token. Identificadores genéricos: `ownerA`, `managerA`, `employeeA`, `ownerB`, `noMembership`, `multipleMemberships`, `platformAdmin`.

Foram usados `admin.generateLink` e `auth.verifyOtp`, sem inserir diretamente em `auth.users`, sem fabricar sessões/JWT e sem desabilitar confirmação global de e-mail. Nenhum e-mail de cliente real foi usado. Senhas e identificadores completos ficaram em arquivo local ignorado e não fazem parte deste relatório.

Configuração real lida no staging: provedor Email habilitado, confirmação de e-mail ligada, novos cadastros permitidos, login anônimo desligado, vinculação manual desligada, demais provedores desligados. SMTP/template padrão. Site URL ainda aponta para a origem local padrão; lista de Redirect URLs vazia. Nenhuma dessas opções de Auth foi alterada nesta execução.

## 4. Memberships

| Identidade | Empresa | Role/associação |
|---|---|---|
| ownerA | A | owner, ativa |
| managerA | A | manager, ativa |
| employeeA | A | employee, ativa |
| ownerB | B | owner, ativa |
| noMembership | Nenhuma | Sem membership |
| multipleMemberships | A e B | manager em A; employee em B, ativas |
| platformAdmin | Plataforma | Registro em `platform_admins`; sem membership empresarial |

Total final: **2 tenants, 6 memberships, 1 platform admin, 2 linhas sintéticas de `tenant_data` e 2 companies associadas**. O tenant descartável do teste CRUD foi excluído após o teste; não foram removidos dados de produção.

A identidade usada é a do Supabase Auth. Os helpers de policy relacionam `auth.uid()` a `tenant_memberships.user_id`, verificam `is_active` e role, e usam o UUID `tenant_id`. O slug fornecido pelo navegador serve para roteamento, não substitui essa associação. A autorização empresarial por essas policies ainda aguarda ativação de RLS.

## 5. RLS, estrutura e migrations

Estado real final do staging:

| Tabela | RLS | FORCE RLS | Situação |
|---|---|---|---|
| `tenants` | Desligado | Desligado | Policies dormentes; banco empresarial aberto |
| `tenant_data` | Desligado | Desligado | Policies dormentes; banco empresarial aberto |
| `companies` | Desligado | Desligado | Policies dormentes; banco empresarial aberto |
| `tenant_memberships` | Ligado | Desligado | SELECT condicionado por policy |
| `platform_admins` | Ligado | Desligado | Sem policy/browser grant; fechado ao cliente |

Migrations aplicadas **somente no staging**:

| Versão registrada no staging | Nome |
|---|---|
| `20261008153321` | `staging_application_baseline` |
| `20261008153749` | `security_identity_memberships` |
| `20261008153753` | `security_tenant_data_identity` |
| `20261008153800` | `security_rls_policies` |

O baseline reconstruiu schema, sem copiar linhas/secrets de produção. SQL aplicado: [staging-application-baseline.sql](<C:/Users/Thales Alvim/erp-modular/supabase/baseline/staging-application-baseline.sql>). As três migrations de 0.5 foram usadas sem alterar seus arquivos originais. As versões remotas geradas pela integração diferem dos nomes locais; não foi feito reparo automático do histórico nem `db push` em produção.

Constraints conferidas por metadados: UUID/PK e slug único em tenants; FK obrigatória `tenant_data.tenant_id → tenants.id` com DELETE RESTRICT; unicidade slug/data_key e índice único tenant_id/data_key; memberships com FKs para tenant/Auth, unicidade tenant/user e check de roles; platform admins com PK/FK Auth e check de role; companies com PK serial e FK nullable de tenant com DELETE RESTRICT. Foram conferidos 12 índices.

`private.sync_tenant_data_identity` é SECURITY INVOKER; o trigger anterior a INSERT/UPDATE valida a relação entre slug e UUID. `private.has_tenant_role` e `private.is_platform_admin` são SECURITY DEFINER, com `search_path` vazio e consulta de `auth.uid()`. Os proprietários técnicos reais têm BYPASSRLS; FORCE não restringe essas roles técnicas. As tabelas de identidade mantêm FORCE desligado para o acesso autorizado dos helpers sem recursão.

Storage do staging: **zero buckets**. Nenhuma função do schema public executável por anon foi encontrada no inventário consultado. Não foram criadas Functions, buckets ou callbacks de produção.

Os advisors confirmam o estado aberto das três tabelas: [policy com RLS desligado](https://supabase.com/docs/guides/database/database-linter?lint=0007_policy_exists_rls_disabled) e [RLS desligado no schema public](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public). O aviso [RLS sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) de platform_admins corresponde ao bloqueio intencional do cliente. A [proteção de senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) está desligada; não foi alterada configuração ou plano para esse recurso.

## 6. Policies, uma por uma

Todas as 13 policies estão destinadas à role `authenticated`. Nas regras abaixo, “admin” significa `private.is_platform_admin()` verdadeiro para `auth.uid()`, e membership significa vínculo ativo no UUID da empresa.

| Policy | Operação | USING | WITH CHECK | Ativa agora? |
|---|---|---|---|---|
| `tenants_read_members` | SELECT | owner/manager/employee da empresa ou admin | — | Não |
| `tenants_insert_platform_admin` | INSERT | — | admin | Não |
| `tenants_update_owner` | UPDATE | owner da empresa ou admin | owner da empresa ou admin | Não |
| `tenants_delete_platform_admin` | DELETE | admin | — | Não |
| `tenant_data_read_members` | SELECT | owner/manager/employee da empresa ou admin | — | Não |
| `tenant_data_insert_managers` | INSERT | — | owner/manager da empresa ou admin | Não |
| `tenant_data_update_managers` | UPDATE | owner/manager da empresa ou admin | owner/manager da empresa ou admin | Não |
| `tenant_data_delete_managers` | DELETE | owner/manager da empresa ou admin | — | Não |
| `companies_read_members` | SELECT | tenant_id não nulo e owner/manager/employee ou admin | — | Não |
| `companies_insert_managers` | INSERT | — | tenant_id não nulo e owner/manager ou admin | Não |
| `companies_update_managers` | UPDATE | tenant_id não nulo e owner/manager ou admin | Mesmo critério | Não |
| `companies_delete_managers` | DELETE | tenant_id não nulo e owner/manager ou admin | — | Não |
| `tenant_memberships_read_related` | SELECT | próprio user_id, owner da empresa ou admin | — | Sim |

`platform_admins` não tem policy permissiva para o navegador. A API valida a associação administrativa pelo servidor. As policies empresariais existem, mas não impõem restrições enquanto RLS estiver desligado.

## 7. Grants — antes, agora e plano posterior

Antes desta preparação o public schema do staging estava vazio. Depois do baseline e da 0.5, este é o estado real, **sem cutover**:

| Tabela | anon | authenticated |
|---|---|---|
| tenants | SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE | Mesmos privilégios |
| tenant_data | Mesmos sete privilégios | Mesmos sete privilégios |
| companies | Mesmos sete privilégios | Mesmos sete privilégios |
| tenant_memberships | Sem grant | SELECT com RLS |
| platform_admins | Sem grant | Sem grant |

Os privilégios adicionais ao CRUD foram encontrados no banco real por herança dos defaults de objetos da plataforma. TRUNCATE, REFERENCES e TRIGGER são privilégios SQL; isso não significa que todos sejam expostos como operação REST.

O arquivo [camada-1-cutover.sql](<C:/Users/Thales Alvim/erp-modular/supabase/activation/camada-1-cutover.sql>) continua **preparado e NÃO APLICADO**. Ele revoga os grants amplos atuais, liga RLS/FORCE nas três tabelas e concede apenas o necessário: anon sem dados empresariais; authenticated com colunas específicas em tenants, sem `logins`/`invoices`, UPDATE apenas de perfil/identidade visual; tenant_data e companies subordinados às roles das policies. Memberships/admins não recebem escrita pelo navegador.

Foi ajustada localmente a tentativa de alterar defaults da role gerenciada `supabase_admin`: só é feita se a conexão tiver associação autorizada a essa role. Sem isso, gera NOTICE e preserva esses defaults gerenciados. Os defaults de postgres e os grants explícitos dos objetos atuais continuam contemplados no fechamento. Objetos futuros criados por roles gerenciadas precisam de grants deliberados em migrations revisadas. Não foi ampliado acesso de authenticated para contornar os bloqueios locais.

## 8. Teste A → B

**O isolamento empresarial ainda não está validado no banco fechado do staging.**

| Verificação | Resultado exato nesta execução |
|---|---|
| Login A encontra membership A | PASS no authService real |
| Login multi-membership encontra exatamente A/B e roles esperadas | PASS no authService real |
| Owner A tenta convidar para B pela API | 403, negado |
| SELECT empresarial A → A após cutover | NÃO EXECUTADO |
| SELECT empresarial A → B após cutover | NÃO EXECUTADO |
| UPDATE empresarial A → B após cutover | NÃO EXECUTADO |
| Transferência por tenant_slug/tenant_id após cutover | NÃO EXECUTADO |

Pelos grants amplos e RLS desligado, **o banco atual permite acesso entre empresas nas tabelas empresariais**, sujeito às constraints comuns. Uma restrição na API de convites ou no seletor da interface não fecha as demais consultas diretas. Não foi feita tentativa contra dados de clientes reais.

## 9. Anon

| Recurso | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| tenants | PERMITIDO pela configuração atual | PERMITIDO | PERMITIDO | PERMITIDO |
| tenant_data | PERMITIDO pela configuração atual | PERMITIDO | PERMITIDO | PERMITIDO |
| companies | PERMITIDO pela configuração atual | PERMITIDO | PERMITIDO | PERMITIDO |
| memberships/admins | NEGADO | NEGADO | NEGADO | NEGADO |

INSERT/UPDATE continuam sujeitos a tipos, FKs e checks; isso não constitui isolamento. A API Master responde **401** sem usuário Auth. A prova de anon → dados empresariais NEGADO após cutover não foi executada.

## 10. Authenticated

Nas três tabelas empresariais, SELECT/INSERT/UPDATE/DELETE estão **PERMITIDOS pela configuração atual**, com constraints comuns. Isso vale inclusive para identidade sem membership: as policies empresariais ainda não estão ativas. Em memberships, SELECT está condicionado à policy; INSERT/UPDATE/DELETE são negados. Em platform_admins, operações diretas do cliente são negadas.

Os sete testes do authService confirmaram UID, memberships, roles e logout. O usuário sem membership não recebeu vínculo fictício. O usuário com duas memberships recebeu exatamente os dois vínculos previstos. Não foi testada toda a seleção visual de empresa desse perfil. A prova hosted de owner próprio permitido/employee escrita negada aguarda cutover e nova rodada direta de testes.

## 11. Master

| Camada | Evidência e alcance |
|---|---|
| Interface | Owner A recebeu “Acesso restrito”; platform admin viu as duas empresas sintéticas |
| Dados | GET da API: anon 401; owner/employee 403; platform admin 200, sem `logins` no DTO |
| Alteração | PATCH de invoices/status pelo admin persistiu no banco; foi revertido ao estado sintético inicial. POST 201 e DELETE 200 de tenant descartável |
| Privilégios | Cada chamada usa `auth.getUser()` no servidor e confere `platform_admins` pelo UID antes de operar dados empresariais com credencial elevada |

Foram removidas as operações Supabase diretas do cliente Master. A persistência agora antecede a mensagem de sucesso. A API valida uma lista explícita de campos, rejeita `logins` e outros campos indevidos, limita o corpo e exige a mesma origem nas mutações. Testes de atribuição indevida de campos e origem externa responderam 400. Usuários owner/employee receberam 403 em GET/PATCH/POST/DELETE Master.

Operações que antes simulavam persistência de campos inexistentes, notas/contrato/permissões de módulos, foram marcadas indisponíveis. Exclusão não purga dados vinculados; FKs continuam protegendo os vínculos. O modo suporte continua desabilitado. Logs de apresentação locais não são trilha confiável de auditoria administrativa.

Fontes: [servidor Master](<C:/Users/Thales Alvim/erp-modular/src/lib/master/server.ts>), [contratos](<C:/Users/Thales Alvim/erp-modular/src/lib/master/contracts.ts>), [API](<C:/Users/Thales Alvim/erp-modular/src/app/api/master/tenants/route.ts>), [interface](<C:/Users/Thales Alvim/erp-modular/src/app/master/page.tsx>).

Essa prova fecha o caminho da API Master. Ela não elimina o acesso direto às tabelas enquanto o cutover estiver suspenso.

## 12. Equipe

Owner A e employee A entraram em `/equipe` com a mesma identidade Supabase Auth do sistema. A interface exibiu empresa A e as roles DONO/COLABORADOR esperadas; o menu do employee foi restringido. A API legada de equipe está aposentada: POST respondeu 410, GET 405. Employee não pôde convidar; owner A não pôde convidar em B nem promover para owner pelo endpoint testado.

Os dados empresariais ainda usam o payload agregado `tenant_data`. A policy preparada permite leitura a employee, mas escrita somente a owner/manager ou admin. Alguns controles operacionais continuam visíveis para employee; após o fechamento, gravações desse perfil devem falhar por policy. A camada de persistência agora propaga o erro de Supabase, sem anunciar sucesso falso. Não foi validada gravação operacional de employee no banco fechado.

Não foram modificados os módulos de DRE, estoque, vendas ou agenda. O histórico de invoices em “Meu Plano” no portal principal e em Equipe continua dependendo de `currentCompany.invoices`. Como invoices foi removido do DTO de identidade para compatibilidade com os grants finais, **essa leitura de faturamento precisa de decisão e caminho autorizado próprio antes de declarar compatibilidade completa**. Não foi criado endpoint empresarial de faturamento nesta tarefa.

## 13. Convites — bloqueio crítico

Autorização negativa da API passou: employee → convite 403; owner A → empresa B 403; owner → promoção para owner 403. O convite continua server-side e usa a verificação de Auth/membership preparada na Camada 1A.

O fluxo positivo de recebimento e aceitação **não passou pelo gate**. Evidências de código e configuração real:

1. [invite/route.ts:60](<C:/Users/Thales Alvim/erp-modular/src/app/api/team/invite/route.ts:60>) chama `admin.inviteUserByEmail`.
2. [supabase.ts:14](<C:/Users/Thales Alvim/erp-modular/src/lib/supabase.ts:14>) fixa `flowType: 'pkce'`.
3. [callback/route.ts:19](<C:/Users/Thales Alvim/erp-modular/src/app/auth/callback/route.ts:19>) aceita apenas `code` e usa `exchangeCodeForSession`; não processa token de convite.
4. [SDK instalado:177](<C:/Users/Thales Alvim/erp-modular/node_modules/@supabase/auth-js/src/GoTrueAdminApi.ts:177>) documenta incompatibilidade de PKCE com esse método; [GoTrueClient.ts:3880](<C:/Users/Thales Alvim/erp-modular/node_modules/@supabase/auth-js/src/GoTrueClient.ts:3880>) rejeita callback implícito em cliente PKCE.
5. O painel de staging mantém template padrão com `ConfirmationURL`, sem SMTP customizado e sem Redirect URLs de Preview.

Essa é uma conclusão por configuração real e código oficial instalado, **não uma alegação de teste completo de entrega/aceitação de e-mail**. O provisionamento por token dos sete usuários não substitui esse fluxo de convite da aplicação. A documentação explica as variáveis e verificação de tokens dos [templates de Auth](https://supabase.com/docs/guides/auth/auth-email-templates).

Correção a revisar: caminho de confirmação que valide o token de convite por mecanismo oficial, estabeleça a sessão/cookies e encaminhe a definição de senha; template/callback/delivery de staging compatíveis. Não basta reativar grants amplos ou desligar confirmação de e-mail. Essa correção adicional não foi implementada depois do gate de parada.

## 14. Recuperação

Login por senha e logout foram testados. O fluxo completo de recuperação por e-mail, aceitação do link, troca da própria senha, troca de e-mail e renovação/expiração de sessão **não foi executado ponta a ponta**. A configuração atual de callbacks e a validação de convites precisam ser resolvidas antes de concluir esses gates. Nenhum usuário de produção foi alterado.

## 15. Service role

**Própria do staging e exclusivamente server-side na aplicação.** O módulo administrativo usa `import 'server-only'` e variável sem prefixo `NEXT_PUBLIC_`; rotas validam o usuário e a associação administrativa antes das operações privilegiadas. Scripts de provisionamento/teste são ferramentas Node locais e não entram no bundle do navegador.

A busca pela chave administrativa real do staging encontrou **zero ocorrências em 45 arquivos de `.next/static`** e zero nos 72 arquivos versionáveis examinados naquele momento. Arquivos privados de ambiente/fixtures foram confirmados ignorados pelo Git. O relatório, SQL de baseline e capturas adicionados depois não contêm valores de credenciais. Não foi usado `service_role` de produção.

## 16. Legado remanescente

`tenants.logins` ainda existe no schema, mas não é lido pelos caminhos ativos de Auth ou pelo DTO Master. A leitura de invoices foi retirada do authService e do carregamento genérico de metadados. Credenciais/hash caseiros não foram encontrados como autoridade de login nos caminhos ativos revisados.

O arquivo de configuração ainda contém fixtures estáticas `SUPER_ADMIN`/`INITIAL_USERS`/`DEMO_USERS`; a busca não encontrou importadores externos dessas definições. Não foram usados para autenticar. LocalStorage continua como cache e logs de apresentação, sem determinar identidade ou role; a chave antiga de credenciais lembradas aparece somente na limpeza de cache. Modo suporte continua indisponível.

Permanecem o payload empresarial agregado, a pendência de invoices do portal e os controles operacionais visíveis para employee. Campos não persistidos do Master foram marcados indisponíveis em vez de manter falsas confirmações. Nenhuma dessas pendências foi resolvida afrouxando grants.

## 17. Testes automatizados e dependências

| Verificação | Resultado |
|---|---|
| `npm test` | **17 PASS, 0 FAIL** |
| TypeScript `tsc --noEmit` | PASS |
| Lint direcionado às áreas alteradas | 0 erros, 0 warnings |
| `git diff --check` | PASS; apenas avisos de normalização LF/CRLF do checkout |
| Provisionamento real de staging | 8 registros PASS |
| Auth/API reais anteriores ao cutover | 11 registros PASS |
| RLS/PostgREST hosted depois do cutover | NÃO EXECUTADO |

Os testes novos exercitam contratos administrativos, campos proibidos, limites e entradas inseguras. Os testes locais de SQL/PGlite ajudam a validar o plano, mas não comprovam o estado do banco hosted. A suíte real usa o **authService da aplicação**, IDs/session cookies do Supabase e APIs locais com banco staging; não substitui a autorização por mocks.

Evidências sem senhas: [provisionamento](<C:/Users/Thales Alvim/erp-modular/docs/camada-1b-provision-evidence.json>) e [Auth/API antes do cutover](<C:/Users/Thales Alvim/erp-modular/docs/camada-1b-before-evidence.json>). A suíte posterior foi preparada em [verify-staging-auth.mjs](<C:/Users/Thales Alvim/erp-modular/scripts/verify-staging-auth.mjs>), mas não foi executada.

Cinco pacotes HIGH foram reportados no grafo; são uma cadeia de desenvolvimento relacionada ao advisory abaixo, não cinco CVEs independentes. Não houve atualização de dependências.

| Pacote | Versão instalada | Relação | Alcance |
|---|---|---|---|
| eslint-config-next | 16.3.8 | Direta, devDependency | Desenvolvimento |
| @next/eslint-plugin-next | 16.3.8 | Transitiva | Desenvolvimento |
| fast-glob | 3.3.1 | Transitiva | Desenvolvimento |
| micromatch | 4.0.8 | Transitiva | Desenvolvimento |
| braces | 3.0.3 | Transitiva, origem do advisory | Desenvolvimento |

Advisory verificado: [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), negação de serviço por esgotamento de pilha. O override existente permaneceu inalterado. O alcance observado é o tooling de desenvolvimento; o audit não demonstra exploração da aplicação em runtime.

## 18. Build

**Build Webpack passou com a configuração real de staging**, Next 16.3.8. Executado pelo launcher [run-staging-local.mjs](<C:/Users/Thales Alvim/erp-modular/scripts/run-staging-local.mjs>) com verificação explícita do project ref e ambiente. Nenhuma dependência/package lock foi alterada. O build não é deployment.

## 19. Preview

**Não criado. Sem URL de deployment Preview. Sem push.**

As quatro variáveis Preview foram salvas e conferidas com credenciais do staging. A configuração de `NEXT_PUBLIC_SITE_URL`, whitelist/callback de Auth e teste do deployment real continuam pendentes. Não foi inventada uma URL para preencher essa lacuna. A separação das variáveis foi confirmada; o ambiente Preview completo ainda não foi validado.

## 20. Produção

**Produção não foi alterada nesta execução.**

| Item | Evidência final |
|---|---|
| Repositório | `thalesalvim/erp-modular` |
| Branch de produção | `main` |
| Commit remoto de main e deployment atual | `382155ba8a4df24b2bab46ff40f038607992ead1` |
| Deployment atual | `dpl_CH7dqWURTMipa81rY6Qh1hNNeuMU`, READY |
| Domínios | handyhub.com.br; www.handyhub.com.br; erp-modular-iota.vercel.app |
| Supabase de produção | `handyhub-db` / `qmfwsnhpmsonndhgqsyi` |
| Auth de produção | Continua com zero usuários |
| RLS de produção | Mesmo estado anterior: três tabelas empresariais desligadas, identidade ligada |
| Histórico de produção | Somente as três migrations de 0.5 já existentes; nenhuma nova migration |

O painel Vercel autenticado mostrou o deployment e o link com o commit completo, compatível com `git ls-remote` de main. As duas variáveis Production existentes continuam com data anterior, 05/10. A consulta final de metadados Supabase confirmou o histórico de produção: `20261008022931`, `20261008022946`, `20261008023101`. Não houve write, cutover, criação de usuários, alteração de dados, RLS/grants/Auth de produção.

O checkout permanece em `codex/camada-1-auth`, HEAD `dc7dcbba1ab2bb8e863a08424b20a08fe1d6278d`. As mudanças desta execução estão locais e sem commit. **Código local preparado ≠ código em produção.** Não houve merge, push, deploy ou alteração de branch/proteções do GitHub. Servidores locais e pontes temporárias foram encerrados; painéis de revisão foram preservados.

## 21. Pendências que impedem finalizar a Camada 1

1. Corrigir e provar o fluxo positivo de convite: recebimento/aceitação, sessão, definição de senha e membership esperada.
2. Validar recuperação, troca de senha/e-mail, expiração/renovação de sessão e callbacks reais.
3. Revisar o caminho autorizado para histórico de invoices do portal principal/Equipe, sem devolver a permissão ampla de leitura de invoices.
4. Resolver a compatibilidade operacional de employee com a escrita do payload agregado e conferir mensagens/fluxos com banco fechado, sem ampliar privilégios administrativos.
5. Somente após os gates prévios passarem, executar o cutover **no staging** e provar por PostgREST/API: anon negado; A→A permitido; A→B SELECT/UPDATE negado; transferência de tenant negada; employee sem escrita administrativa; owner autorizado; nenhuma autoatribuição de memberships/admin.
6. Repetir Auth/Master/Equipe no staging fechado, incluindo perfis sem vínculo e com múltiplas memberships, sem apoiar a conclusão somente na interface.
7. Gerar Preview isolado apenas após os gates, concluir Site URL/Redirect URLs e validar esse deployment ponta a ponta.

A revisão das cinco dependências HIGH fica na camada específica solicitada; não foi usada como motivo para upgrades nesta tarefa. Produção permanece aguardando revisão separada mesmo se o staging vier a passar.

## 22. Pronto para deploy de produção?

**NÃO.**

Staging separado e fundação preparada; Camada 1B bloqueada pelo gate de convites e pelas provas ainda pendentes de Auth/compatibilidade/banco fechado. Nenhum cutover ou deployment de produção foi executado. A execução termina para revisão, sem iniciar automaticamente outra camada.
