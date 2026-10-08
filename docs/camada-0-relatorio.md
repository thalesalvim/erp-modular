# HandyHub — relatório completo da Camada 0

> **Registro histórico da primeira passagem.** Foi escrito antes de as
> integrações externas ficarem disponíveis; as afirmações de que Supabase,
> Vercel e GitHub não podiam ser consultados foram superadas. Use
> [o relatório da segunda passagem e da Camada 0.5](camada-0.5-relatorio.md)
> como fonte atual para configurações remotas, migrations e status.

Data: 07/10/2026. Escopo: inventário, leitura de código e pequenas correções
locais. Nenhum acesso a registros do Supabase real foi realizado.

## 1. STATUS DA CAMADA 0

**CAMADA 0 — BLOQUEADA POR EVIDÊNCIA EXTERNA.**

A fundação local foi corrigida e testada. Não tenho acesso às policies reais.
RLS, grants, schema, associação entre identidade e empresa e configuração dos
ambientes remotos continuam não verificados. A Camada 0 não está concluída
e a Camada 1 não foi iniciada.

## 2. ESTADO DO GIT

| Item | Resultado |
| --- | --- |
| Raiz | `C:\Users\Thales Alvim\erp-modular` |
| Branch inicial | `main` |
| HEAD inicial e final | `382155ba8a4df24b2bab46ff40f038607992ead1` |
| Estado inicial | Limpo; nenhuma alteração local prévia |
| Origin | `https://github.com/thalesalvim/erp-modular.git` |
| Branch de trabalho | `codex/camada-0-base` |
| Branches inicialmente disponíveis | `main`, `origin/main`, `origin/HEAD -> origin/main` |
| Commit novo | Não criado; alterações locais disponíveis para revisão |
| Push/merge | Não realizados |

A escrita em `.git` foi bloqueada pelo sandbox; a branch foi criada após
aprovação da execução. Nenhuma alteração foi feita diretamente na `main`.
Sugestão de commit futuro: `chore(security): harden Supabase environment configuration`.

## 3. ARQUITETURA REAL CONFIRMADA

Confirmado **no código local**, sem comprovação de equivalência com o deploy:

`Usuário -> página cliente -> comparação de credenciais em tenants.logins -> estado React/localStorage -> cliente Supabase público -> slug/tenant_slug -> tenants ou tenant_data`.

| Área | Evidência local |
| --- | --- |
| Stack instalada | Next.js 16.3.8, React 19, TypeScript, Supabase JS 2.117.2; Node usado nos testes: 24.21.0 |
| App Router | `src/app/page.tsx`, `master/page.tsx`, `equipe/page.tsx`, layout e duas APIs |
| Next.js | `next.config.ts`, root do Turbopack explícita; documentação instalada de variáveis consultada |
| Cliente | Um único `createClient` de aplicação em `src/lib/supabase.ts`, compartilhado pelas páginas e `dbService.ts` |
| Helpers | `getTenantFromCloud`, `getAllTenantDataCloud`, `saveAllTenantDataCloud` |
| Dados operacionais | `tenant_data`, chave `all_data`, payload JSON com equipe, clientes, serviços, vendas, estoque, despesas, agenda e atendimentos |
| Persistência | `upsert` com `onConflict: tenant_slug,data_key`; isso é expectativa do código, não comprovação de UNIQUE no banco |
| Tenant | `?c=`, último slug no armazenamento local e seleção de `currentCompany`; filtros Supabase por slug |
| Login principal | `page.tsx:593-640`: busca tenants e compara credenciais no navegador; não chama signIn/signUp para estabelecer identidade Supabase |
| Sessão Supabase | `page.tsx:477-488`: tenta reaproveitar sessão existente e associar por email; logout chama signOut; configurações chamam updateUser |
| Equipe | Login próprio, `saas_active_session` no localStorage e opção de lembrar senha em `machine_saved_pass` |
| Cache | `saas_cache_<slug>`, preferências, tenants, auditoria e flags Master armazenados no navegador |
| APIs | `/api/equipe` usa `staffDatabase` em memória; `/api/whatsapp` calcula horários simulados, sem persistência Supabase |
| RPC/Storage | Nenhuma chamada `.rpc()` ou SDK Storage identificada; isso não comprova ausência no banco remoto |

O carregamento inicial solicita `tenants.select('*')` e dados operacionais
antes da confirmação do login de interface (`page.tsx:415,466`). Login próprio
não emite JWT. Sem sessão Supabase prévia, a chave pública normalmente usa a
role `anon`; com sessão prévia válida, usa a identidade dessa sessão, não
necessariamente a pessoa escolhida no login próprio.

O caminho exigido para comprovar isolamento permanece incompleto:

`JWT válido -> auth.uid() -> vínculo verificado à empresa -> policy -> tenant_id/tenant_slug -> linha permitida`.

`currentCompany`, seleção de slug, email comparado no cliente, `isManager`,
`isDono` e `moduleRoles` não demonstram esse vínculo no banco.

## 4. SUPABASE REAL

**CONFIRMADO:** referências locais a `tenants` e `tenant_data`; antes da
correção, o fallback apontava ao project ref público `qmfwsnhpmsonndhgqsyi`
e usava uma chave publishable. Essa chave pública não é uma service_role.
O código não prova que esse projeto seja produção, nem seu schema atual.

**NÃO VERIFICADO:** existência/estrutura real das tabelas, colunas, tipos,
nullable, defaults, PK/FK/UNIQUE/CHECK, índices, RLS, FORCE RLS, policies,
roles de policies, USING/WITH CHECK, grants, functions/RPCs, triggers, views,
SECURITY DEFINER, buckets, Storage policies, vínculo com auth.users e
configuração GoTrue/Auth.

Não há ferramenta/conector Supabase disponível nesta sessão; Supabase CLI,
psql e pg_dump não estão no PATH. Não foram encontrados dumps SQL, migrations,
configuração de conexão de leitura, arquivos `.env*` operacionais ou nomes de
variáveis Supabase/Postgres/Vercel no processo. Os locais convencionais de
configuração Supabase/pgpass verificados também não existem. Não configurei
credenciais nem usei a chave pública para consultar dados de empresas.

### INFORMAÇÕES NECESSÁRIAS DO SUPABASE

Abra `supabase/inspection/camada-0-metadata.sql` e execute **uma consulta
numerada por vez** no SQL Editor do projeto correto. Traga resultados
identificados com número, ambiente e project ref não secreto.

| Consultas | Informação |
| --- | --- |
| 01–04 | Contexto, schemas, tabelas, RLS/FORCE e estrutura das duas tabelas |
| 05–07 | Campos de identidade/empresa, constraints/FKs e índices |
| 08–12 | Policies completas, roles/herança e privilégios efetivos de tabela/coluna e ACLs |
| 13–15 | Funções/RPCs, SECURITY DEFINER, EXECUTE, triggers e views |
| 16–17 | Default privileges e sequences |
| 18 | Metadados de buckets, opcional, somente se storage.buckets existir |
| 19–21 | Schemas/hooks PostgREST visíveis em configuração SQL, dependências de policies e privilégios de schema |

As consultas não executam funções de aplicação, não leem linhas empresariais
nem auth.users e não alteram o banco. Corpos de funções não são retornados:
será necessário revisar definições sanitizadas das funções referenciadas
pelas policies/triggers, RPCs acessíveis e hooks, sem executá-las. Ausência
de dependência catalogada não exclui SQL dinâmico dentro de funções.

Defaults, policies, definições de views e argumentos de triggers podem conter
literais sensíveis: omita esses valores antes de compartilhar. Informe erros
e resultados truncados; ausência de visibilidade não significa ausência do
objeto. Estas consultas não foram executadas nem validadas contra a versão
do PostgreSQL remoto.

Também precisamos de informações não secretas do painel: project ref/URL
pública por ambiente; schemas efetivamente expostos na Data API; existência
de hooks; providers habilitados, signup/anonymous sign-in, confirmação de
email, redirects, recuperação e duração de sessão. Não envie usuários,
senhas, tokens, JWTs, service_role, SMTP secrets ou connection strings.
O SQL Editor usa sua própria role: um SELECT permitido para o operador não
prova que anon/authenticated tenham acesso.

## 5. ISOLAMENTO ENTRE EMPRESAS

**Empresa A consegue acessar Empresa B? DEPENDE DE CONFIGURAÇÃO NÃO DISPONÍVEL.**

O cliente permite escolher slug e solicita tenants sem filtro no banco em
diversos fluxos. Isso evidencia dependência de autorização externa, não
comprova acesso cruzado real. Nenhuma empresa real foi usada como teste.
RLS ligado isoladamente também não bastaria: precisaríamos analisar policies,
grants, vínculo ao auth.uid(), owners, views, RPCs e funções privilegiadas.

## 6. ANON

| Operação no Supabase real | Resultado comprovado |
| --- | --- |
| Ver tenants/tenant_data | Não verificado; o código tenta ler antes do login próprio |
| Criar | Não verificado; há insert/upsert no cliente, sem garantia conhecida da role |
| Alterar | Não verificado; há update/upsert no cliente |
| Excluir | Não verificado; há delete de tenant no painel Master |

Na API **local** `/api/equipe`, `UPDATE_SCHEDULE` recebe userId/newSchedule
e altera o objeto em memória sem verificar sessão ou cargo. Não consultei
essa rota em produção. A API WhatsApp local devolve horários simulados sem
autenticação; não há leitura do banco nessa rota.

## 7. AUTHENTICATED

Ver, criar, alterar e excluir dados de tenants/tenant_data: **não verificado**
para cada operação. Não é possível afirmar que um JWT válido pertença à
empresa selecionada. O login próprio não troca o JWT de uma sessão anterior.
Existem getSession/signOut/updateUser, mas nenhuma associação ao auth.uid()
foi comprovada no schema/policies reais. Grants de objeto e policies precisam
ser avaliados juntos; não haverá teste de leitura de outra empresa real.

## 8. MASTER E MAPA DE PERMISSÕES

O Master local usa credencial literal no código cliente (`master/page.tsx:342`,
**valor omitido**) e `master_session_active` no localStorage (`:209,:344`).
O modo suporte usa token derivado de horário e flags no navegador
(`:396-405`); não estabelece identidade privilegiada no servidor.
A busca de tenants ocorre no efeito inicial, antes da autenticação Master.
Nenhuma proteção de Master no servidor/banco foi comprovada. Não alterei
essas credenciais nem seus fluxos, conforme o limite da Camada 0.

| Tipo | Permissão desejada, proposta para validação futura | Garantia real disponível |
| --- | --- | --- |
| Visitante | Login/recuperação legítima; nenhum dado privado de empresas | Interface restringe telas; grants/RLS desconhecidos |
| Funcionário | Dados e ações operacionais autorizados apenas no próprio tenant | Papel/telas controlados no cliente; banco não verificado |
| Gestor | Administração operacional no próprio tenant conforme permissões | isManager/moduleRoles no cliente; banco não verificado |
| Dono | Gestão do tenant, equipe e plano; nenhum acesso a outro tenant | isDono e papéis no cliente; banco não verificado |
| Master HandyHub | Administração SaaS por identidade privilegiada verificada e auditada | Credencial/flag cliente; proteção de banco não verificada |
| Suporte HandyHub | Acesso restrito, temporário, autorizado e auditado por tenant | Bypass no navegador; autorização de servidor não comprovada |

O mapa descreve intenção conceitual, não novos cargos implementados. Ocultar
botões/telas não proíbe operações na API/banco. Logs em localStorage não
constituem auditoria confiável no servidor.

## 9. CONFIGURAÇÃO DE AMBIENTES E GITHUB

| Ambiente | Estado observado antes | Fundação local agora | Ainda falta |
| --- | --- | --- | --- |
| LOCAL | Sem env; cliente caía no projeto fixo do código | URL/chave/ambiente obrigatórios, sem fallback | Selecionar e confirmar projeto local/teste |
| PREVIEW | Nenhuma configuração Vercel disponível no repositório | APP_ENV=preview e coerência com VERCEL_ENV no build | Confirmar URL/ref, envs e branches de Preview |
| PRODUÇÃO | Nenhum deploy/config remoto inspecionado | APP_ENV=production e coerência com VERCEL_ENV no build | Confirmar projeto, envs, deployment/commit e branch de produção |

Não há `.vercel/project.json`, `vercel.json` ou workflows `.github` presentes
no checkout. `origin/HEAD -> origin/main` indica o default local do Git, não
prova que main gere produção Vercel. Não alterei nenhum painel remoto.
Não posso afirmar que Preview atualmente aponta ou não para produção.

O ambiente explícito é um identificador, não uma prova de identidade do banco.
URL de produção colocada manualmente em local/preview ainda conectaria nesse
projeto; nenhum mapa real estava disponível para validar isso. A escolha
silenciosa foi removida. HTTP é aceito somente em loopback no ambiente local;
demais URLs exigem HTTPS sem credenciais, caminhos, query ou fragmento.

Um próximo build com as mudanças exige configurar as três variáveis antes.
O código rejeita sb_secret e JWTs cuja role não seja anon, e valida antes do
bundle. Essa verificação não autentica assinatura JWT ou correspondência da
chave ao projeto. Variáveis NEXT_PUBLIC são fixadas no build.

`.env*`, `.vercel` e PEM já eram ignorados; `.env.example` é a única exceção
adicionada. Não há env/PEM/key versionados na inspeção atual/histórico de nomes.
A varredura dos 108 commits alcançáveis localmente, em 20 caminhos de fontes
e configurações históricos (lockfile excluído), não identificou chave
Supabase privilegiada, JWT de chave ou connection string pelos padrões
pesquisados. Isso não cobre branches remotas não obtidas, repositórios externos
ou todo formato possível de segredo. Credenciais literais de aplicação e
senha lembrada no navegador foram confirmadas; valores omitidos.

## 10. ALTERAÇÕES LOCAIS REALIZADAS

| Arquivo | Mudança e motivo | Risco/limite | Verificação |
| --- | --- | --- | --- |
| `src/lib/supabase.ts` | Remove URL/chave fixas e usa validador central | Sem env, inicialização falha intencionalmente | Testes reais de import/inicialização, tsc, lint |
| `src/lib/supabaseConfig.ts` | Valida ambiente, URL e tipo/role da chave; mensagens sem valores | Não comprova configuração remota nem assinatura | 9 testes offline, tsc, lint |
| `next.config.ts` | Valida antes do bundle e compara VERCEL_ENV | Futuro build exige env explícita | Teste de config, build sem env e build Webpack |
| `.env.example` | Modelo vazio, sem projeto/chave reais | Exige preenchimento intencional fora desta etapa | Inspeção e git check-ignore |
| `.gitignore` | Permite versionar apenas .env.example | Outros .env permanecem ignorados | git check-ignore |
| `tests/supabase-config.test.mjs` | Testes offline, SDK real com fetch bloqueado e fixtures sintéticas | Não testa acesso remoto ou permissões de dados | node --test e lint |
| `supabase/README.md` | Registra baseline pendente e procedimento de coleta | Não é baseline nem dump restaurável | Revisão documental |
| `supabase/migrations/.gitkeep` | Prepara diretório vazio | Nenhuma migration executável | Inspeção de arquivos |
| `supabase/inspection/camada-0-metadata.sql` | 21 consultas para obter evidência real | Resultados externos ainda pendentes | Revisão estática; não executado em PostgreSQL |
| `README.md` | Orienta envs, testes, riscos do build e coleta | Não configura ambientes remotos | Revisão documental |
| `docs/camada-0-relatorio.md` | Consolida evidência, limitações e próximos requisitos | Não comprova estado remoto | Conferência com código/comandos |

Nenhum schema fictício, migration, link remoto ou configuração de banco foi
criado. **BASELINE PENDENTE DE INTROSPECÇÃO DO BANCO REAL.**

## 11. TESTES

| Verificação | Resultado |
| --- | --- |
| TypeScript antes e após mudanças | PASSOU: tsc --noEmit --incremental false |
| Lint dos arquivos de código alterados e testes | PASSOU: zero erros/avisos |
| Lint geral inicial | 116 erros e 121 avisos preexistentes; não corrigidos fora do escopo |
| Configuração offline | 9/9 PASSARAM; nenhuma requisição à rede |
| Variáveis ausentes | PASSOU: módulo cliente não chama createClient; build falha claramente antes de compilar |
| Configuração explícita válida | PASSOU: SDK inicializa com domínio .invalid e chave sintética |
| Chave privilegiada/user JWT | PASSOU: rejeição no validador e na configuração Next, sem expor valor no erro |
| Ambiente Vercel incompatível | PASSOU: rejeição antes do bundle |
| Build padrão Turbopack | NÃO PASSOU: fonte bloqueada no sandbox; tentativa liberada encontrou erro interno criando processo de CSS/PostCSS |
| Build de diagnóstico Webpack | PASSOU com --webpack e configuração Supabase sintética; compilação, TypeScript e geração de 9 páginas |
| Bundle cliente do build sintético | 27 arquivos JS inspecionados; nenhum antigo project ref, sb_secret com valor ou JWT service_role encontrado |
| Consultas SQL | 21 statements SELECT na revisão estática; nenhum comando de alteração; execução PostgreSQL pendente |
| Git diff --check | PASSOU; sem erros de whitespace |

O build Webpack precisou da liberação de rede para a fonte Google Inter.
Isso não envolve o Supabase real. O comando padrão `npm run build` permanece
inalterado; sucesso do Webpack não prova que o erro Turbopack esteja resolvido.
Não houve teste end-to-end de login/dados em produção. Configuração local
deve ser preenchida antes de qualquer teste funcional autorizado posterior.

## 12. O QUE NÃO FOI ALTERADO

Dados, tabelas, policies, RLS, grants, triggers, functions, usuários e Supabase
Auth de produção; login/recuperação/cargos atuais; Master e Equipe; APIs;
modelo JSON; DRE, financeiro, estoque, produtos, vendas e agenda; variáveis e
configuração remotas da Vercel; workflows/configurações remotas GitHub;
dependencies/lockfile; branch main. Não houve deploy, push, merge, reset,
db push, migration remota, envio de mensagens externas ou teste cruzado de
empresas. Apenas código/configuração/documentação/testes locais mudaram.

## 13. PENDÊNCIAS E CHECKLIST DE ENCERRAMENTO

| Critério | Status |
| --- | --- |
| Qual banco/projeto cada ambiente usa | Pendente; apenas antigo fallback local conhecido |
| Tabelas principais reais existentes | Pendente; nomes esperados no código conhecidos |
| Estrutura real de tenants/tenant_data | Pendente |
| RLS habilitado | Pendente |
| Policies existentes | Pendente |
| Grants existentes | Pendente |
| Associação entre identidade e empresa | Pendente |
| Acesso anon a tenants | Pendente |
| Acesso anon a tenant_data | Pendente |
| Acesso authenticated a outro tenant | Pendente |
| Operações que dependem do frontend | Confirmadas no código local; listadas nas seções 3 e 8 |
| Operações realmente protegidas pelo banco | Pendente |
| Triggers/functions relevantes | Pendente |
| Constraints relevantes | Pendente |
| Secrets privilegiados no frontend | Não encontrados em Supabase local no escopo pesquisado; credencial Master literal confirmada e pendente da Camada 1; bundle remoto não inspecionado |
| Queda silenciosa em produção | Fallback local removido/testado; configuração remota e destino do projeto continuam pendentes |
| Configuração centralizada/validada | Confirmada/testada localmente |
| Versionamento fiel do schema | Diretório preparado; baseline pendente |
| Dependências para Camada 1 | Identificadas, ainda exigem evidência/decisões |

Para fechar esta camada, faltam os resultados SQL e a configuração não
secreta de projetos/ambientes/Auth/Data API; revisão de funções dependentes;
baseline fiel após introspecção; comparação do deployment real com o código;
e esclarecimento do erro de build Turbopack no ambiente alvo. Não concluir
isolamento com base somente em botões ocultos, grants ou RLS=true.

## 14. PRÉ-REQUISITOS DA CAMADA 1

1. **Supabase Auth:** confirmar configuração real, providers, redirects,
   recuperação e sessão; definir fluxo que crie/verifique identidade no servidor.
2. **Usuários:** inventariar a modelagem e planejar migração das credenciais
   próprias sem expor senhas/hashes ou modificar usuários nesta etapa.
3. **Tenants:** confirmar chaves e constraints e definir vínculo persistente
   entre auth.uid() e empresa; slug não pode servir de autorização.
4. **Cargos/permissões:** validar a matriz desejada e representá-la de forma
   verificável no servidor/banco, antes de depender de controles de interface.
5. **Policies/grants:** revisar SELECT/INSERT/UPDATE/DELETE, WITH CHECK,
   RPCs, views, owners e SECURITY DEFINER; planejar testes com tenants
   sintéticos em banco isolado, após baseline real.
6. **Recuperação:** substituir atualização direta de logins por recuperação
   baseada em identidade/tokens verificados; alinhar updateUser e sessão.
7. **Master:** planejar identidade privilegiada, autorização do servidor e
   auditoria; substituir credencial embutida e flags locais em etapa autorizada.
8. **Suporte:** definir acesso por tenant, restrito/temporário/auditável,
   sem tratar token no localStorage como comprovação de privilégio.
9. **Equipe:** alinhar login à identidade real, autorização da API e papéis;
   eliminar armazenamento de senha no navegador na etapa autorizada.
10. **Entrega:** confirmar ambientes isolados e preparar revisão/validação
    local; alterações de produção e deploy exigem etapa própria autorizada.

Nenhum desses itens foi implementado. O próximo passo desta Camada 0 é obter
e analisar a evidência externa, antes de autorizar a Camada 1.

Referências de interpretação, sem evidência específica do banco HandyHub:
[Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[PostgreSQL pg_policies](https://www.postgresql.org/docs/current/view-pg-policies.html)
e [PostgreSQL funções de privilégios](https://www.postgresql.org/docs/current/functions-info.html).
