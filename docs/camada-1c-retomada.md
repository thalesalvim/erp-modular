# HandyHub — Camada 1C: estado atual e continuidade

**Data da última retomada:** 09/10/2026 (America/Sao_Paulo)

**Situação:** 50 testes locais aprovados, cobertura de onboarding ampliada e roteiro E2E preparado; Camada 1C AINDA NÃO CONCLUÍDA.

**Branch de desenvolvimento:** `codex/camada-1-auth`  
**HEAD atual / commit listado no Preview:** `2bafb7d404cba2f0f87a7757d1df6f7bfa553ce4`

**Produção:** nenhuma alteração nesta retomada; nenhum deploy, push ou merge executado.

Este documento registra o estado técnico da Camada 1C e a transferência do ambiente de desenvolvimento de Americana/SP para Divinópolis/MG.

A revisão atual substitui o estado anterior de “aguardando aceitação” e a expectativa de que o Master criasse apenas tenant sem primeiro Owner.

Consulte também o [relatório de onboarding](camada-1c-onboarding-corrigido.md), contendo diagnóstico, testes, evidências e limitações.

## 1. Funcionalidades confirmadas na auditoria

- Signup público desabilitado somente no Supabase staging. A chamada pública retorna `signup_disabled`, sem criar identidade.
- Corrigido o problema dos convites que redirecionavam para login: `no-referrer` causava `Origin: null`. A correção utiliza `strict-origin`, preservando a validação CSRF.
- Convite real abriu a página **PRIMEIRO ACESSO — Defina sua senha**.
- Conta de teste confirmou e-mail e definiu senha. Nenhuma senha foi registrada nos relatórios.
- Recuperação de senha entregue pelo Resend, com callback e alteração de senha registrados.
- Reutilização do link de recuperação rejeitada com `otp_expired`.
- Fluxos de ativação e recuperação possuem contextos separados, assinados e associados à identidade, sessão e expiração.
- Master provisiona tenant, convite Auth e primeiro Owner pelo servidor, com membership inicialmente inativa e tratamento explícito de falhas parciais.
- Owner e Manager possuem convites limitados à autorização verificada no servidor.
- Auditoria anterior registrou 33 testes aprovados, TypeScript, lint direcionado, build e 11 grupos de testes de staging.
- Testes anteriores confirmaram bloqueio de acesso anônimo e isolamento entre empresas A/B.
- A auditoria anterior não encontrou ocorrências da chave service role nos 89 candidatos ao Git e 40 arquivos JavaScript do navegador inspecionados.

**Importante:** esses resultados pertencem à execução registrada em 08/10/2026. Devem ser revalidados quando necessário, especialmente após mudanças no ambiente.

## 2. Pendências da Camada 1C

A Camada 1C **não está aprovada para conclusão ou produção**.

Permanecem pendentes:

1. Executar o teste E2E completo de Owner C e Employee C com identidades distintas.
2. Validar a criação de novo tenant e a ativação real do primeiro Owner.
3. Validar logout e novo login com senha própria.
4. Confirmar isolamento de dados exclusivo da Empresa C.
5. Validar convite, ativação e permissões do Employee C.
6. Configurar remetente de e-mail adequado para múltiplos destinatários autorizados.
7. Validar callbacks, redirecionamentos e variáveis de ambiente no Preview.
8. Reexecutar os testes relevantes e concluir a auditoria de segurança.

O remetente `resend.dev` possui restrições de destinatário. A conta de teste anterior permanece como Employee da Empresa A e não deve ser reutilizada ou promovida artificialmente para simular Owner C.

As políticas RLS e grants fechadas anteriormente no staging não devem ser enfraquecidas para facilitar testes.

Nenhuma migration adicional foi criada na última passagem documentada.

## 3. Estado atualizado do Git e GitHub

**Repositório privado:** `thalesalvim/erp-modular`

**Branch enviada:** `codex/camada-1-auth`

**Último commit de código:** `90abd7b` — `feat(auth): preserve camada 1C onboarding and security work`

**HEAD atual:** `2bafb7d` — `docs: update camada 1C handoff for notebook`

Histórico preservado:

| Commit | Descrição |
|---|---|
| `382155b` | Base existente na main |
| `cb1a15c` | Preparação do isolamento entre empresas |
| `dc7dcbb` | Autenticação Supabase e vínculo com tenants |
| `e65ae4a` | Validação de Auth e RLS no staging |
| `1281eda` | Normalização do baseline |
| `90abd7b` | Preservação do onboarding e segurança da Camada 1C |
| `2bafb7d` | Atualização da documentação de transferência para o notebook |

Em 08/10/2026:

- O commit `90abd7b` foi realizado com sucesso.
- A branch `codex/camada-1-auth` foi enviada ao GitHub.
- A branch local passou a rastrear `origin/codex/camada-1-auth`.
- A `main` permaneceu no commit `382155b`.
- Não houve merge na `main`.
- Foram registrados 29 arquivos no último commit.

Seis imagens em `docs/evidence/` permaneceram fora do Git e foram copiadas separadamente para o Google Drive.

**Nota de continuidade:** ao retomar o trabalho no notebook, não iniciar pela `main`. Utilizar a branch `codex/camada-1-auth` para recuperar o código da auditoria.

## 4. Vercel e ambientes

### Preview

O push da branch `codex/camada-1-auth` acionou automaticamente um deployment de Preview na Vercel.

A interface mostrou:

- Branch: `codex/camada-1-auth`
- Commit: `90abd7b`
- Ambiente: Preview
- Resultado: `Ready`
- Tempo de build informado: aproximadamente 36 segundos

O resultado `Ready` comprova que a implantação foi concluída, mas não comprova que todos os fluxos de autenticação, permissões e onboarding funcionem corretamente.

A URL Supabase configurada em Preview foi conferida visualmente como pertencente ao projeto de staging. A correspondência de todas as credenciais e o teste funcional completo do Preview ainda requerem validação.

### Production

- Projeto Supabase: `handyhub-db`
- Ref: `qmfwsnhpmsonndhgqsyi`
- Domínio: `www.handyhub.com.br`
- Branch Vercel Production: `main`
- Commit observado: `382155b`

A interface da Vercel confirmou que o deployment de Production permaneceu associado à `main` após o push.

**Nenhum merge ou deploy manual em produção foi executado durante a transferência.**

### Staging

- Projeto: `handyhub-staging`
- Organização: Thaleco7 Free
- Callback local: `http://localhost:3000/auth/callback`
- Templates de e-mail: fluxo baseado em `token_hash`

Callbacks e URLs de Preview devem ser verificados antes de testes com convites reais.

## 5. Transferência do ambiente de desenvolvimento

O desenvolvimento estava sendo realizado no computador principal em Americana/SP.

O projeto foi preparado para continuar no notebook em Divinópolis/MG.

### Código

O código-fonte e o histórico de commits estão disponíveis no repositório privado do GitHub, branch `codex/camada-1-auth`.

### Backup local

Foi criada a pasta:

`C:\Users\Thales Alvim\erp-modular-backup-2026-10-08`

A existência de arquivos de documentação e do diretório Git foi verificada. Não foi realizada comparação integral de hashes entre origem e backup.

### Configurações privadas

Três arquivos foram armazenados em um pacote RAR protegido por senha, com nomes criptografados:

- `.env.staging.local`
- `.env.staging-fixtures.json`
- `.env.staging-invite-diagnosis.json`

O pacote foi testado no WinRAR e enviado pelo usuário ao Google Drive privado.

A senha não deve ser incluída neste documento, no GitHub nem nas conversas do Codex.

### Evidências visuais

As seis imagens `camada-1c-*.jpg` da pasta `docs/evidence/` foram enviadas separadamente ao Google Drive pelo usuário.

Essas imagens não integram o commit `90abd7b`.

## 6. Instruções para continuar no notebook

1. Instalar GitHub Desktop, Codex e ferramentas de desenvolvimento necessárias.
2. Clonar o repositório privado `thalesalvim/erp-modular`.
3. Selecionar a branch `codex/camada-1-auth`.
4. Confirmar que o HEAD corresponde ao commit esperado ou a um commit posterior de documentação.
5. Recuperar o pacote protegido do Google Drive.
6. Extrair as configurações de staging localmente, sem enviá-las ao GitHub.
7. Conferir versões de Node.js, gerenciador de pacotes e comandos definidos em `package.json`.
8. Instalar as dependências conforme o lockfile existente.
9. Verificar o conteúdo dos arquivos de ambiente sem revelar credenciais.
10. Executar TypeScript, testes automatizados, lint e build de acordo com os scripts disponíveis.
11. Validar que o ambiente local aponta somente para o Supabase de staging.
12. Retomar a auditoria da Camada 1C a partir das pendências documentadas.

Não executar migrações destrutivas, operações administrativas em produção, merge na `main` ou deploy de produção sem autorização expressa.

## 7. Orientações para o Codex

Ao iniciar uma nova sessão:

- Ler este documento e o relatório de onboarding corrigido.
- Inspecionar o estado real do Git antes de modificar arquivos.
- Não presumir que testes anteriores continuam aprovados após mudanças.
- Priorizar as pendências da Camada 1C.
- Preservar o isolamento entre tenants.
- Não expor senhas, tokens, chaves privadas nem dados de sessão.
- Não realizar deploy em Production sem autorização.
- Registrar evidências de cada teste e distinguir resultados comprovados de pendências.
- Antes de alterações importantes, explicar o plano e o impacto esperado.

## 8. Documentos complementares

- [Relatório de onboarding](camada-1c-onboarding-corrigido.md)
- [Plano de cutover condicionado](camada-1c-production-cutover-plan.md)
- [Plano de rollback condicionado](camada-1c-rollback-plan.md)
- [Evidências de API](camada-1c-onboarding-api-evidence.json)
- [Histórico de e-mail](camada-1c-email-evidence.json)

Os planos de cutover e rollback são documentação de contingência. Não devem ser interpretados como autorização para execução.

## 9. Primeira passagem de 09/10/2026 — evidências de retomada

Esta passagem leu o histórico, o repositório e os relatórios existentes. Não mudou código-fonte, configurações de Vercel/Supabase, migrations, RLS, grants, tenants ou memberships. Foram utilizados apenas o staging existente e contas sintéticas já provisionadas. Os testes de login criaram sessões de teste; nenhuma conta nova, convite ou recuperação por e-mail foi enviado.

### Concluído nesta passagem

| Verificação | Resultado atual e limite |
|---|---|
| Repositório | Branch `codex/camada-1-auth`, HEAD `2bafb7d`; nenhum arquivo rastreado modificado no início. As seis imagens e `erp-modular.rar` já estavam fora do Git. |
| Testes automatizados | `npm test`: **33 passaram, 0 falhas**. Incluem autorização, RLS, callback, contexto de senha e provisionamento/compensação Master. |
| TypeScript | `tsc --noEmit`: passou. |
| Lint direcionado | Arquivos de Auth/Master e helpers/testes da alteração existente: passou, sem erros ou avisos. Não corresponde a uma certificação de lint de todo o ERP. |
| Build | Build local Webpack, Next.js 16.3.8, com configuração própria de staging: passou; 11 páginas estáticas. Nenhuma publicação. |
| Projeto Supabase | Integração confirmou `handyhub-staging`, ref `gbblkkgowccjycxtexvx`, **ACTIVE_HEALTHY**. |
| Segurança do staging | Leitura de metadados: 13 policies; RLS ligado em `tenants`, `tenant_data`, `companies`, `tenant_memberships`, `platform_admins`; FORCE RLS desligado nessas cinco tabelas. Anon sem privilégios SELECT/INSERT/UPDATE/DELETE em `tenants` e `tenant_data`. Signup público continua desabilitado. |
| Dados de teste existentes | 2 tenants e 12 memberships; Empresa C não foi criada. |
| Chamadas diretas | Anon sem leitura empresarial; employee A e owner A autenticam, resolvem membership A, leem A e não recebem linhas de B. Convites sem autorização são rejeitados com 403 antes do envio. Master: anon 401; employee A e owner A 403; platform admin 200. |
| Navegador local | Conta sintética employee A: login → Company A/cargo Colaborador → Sair → formulário de login → novo login → Company A/cargo Colaborador. **Passou.** A saída demorou a refletir na interface nas primeiras observações; depois chegou ao formulário. Não houve erro de console capturado nem diagnóstico suficiente para atribuir causa ou medir desempenho. |
| Proteção de credenciais | `.env.staging.local` e `.env.staging-fixtures.json` continuam ignorados pelo Git. Nenhum valor secreto foi incluído nestas evidências. |

O ciclo no navegador utilizou credencial sintética existente. **Não certifica logout/login com a senha pessoal da caixa real, nem o E2E de Owner C/Employee C.** O teste de UPDATE A→B pertence às evidências anteriores; não foi repetido com escrita nesta passagem. Os seis grupos adicionais de verificações atuais estão detalhados no [JSON da retomada](camada-1c-retomada-evidence.json).

Prova visual atual da saída, sem credenciais:

![Conta sintética retornou ao formulário após Sair](evidence/camada-1c-retomada-logout.jpg)

### Vercel: leitura parcial, sem execução

A listagem disponível na integração retornou:

| Deployment existente | Ambiente / branch | Commit | Estado |
|---|---|---|---|
| `dpl_H2KiX7me37qN5sLk1LEcGwbRgryF` | Preview / `codex/camada-1-auth` | `2bafb7d404cba2f0f87a7757d1df6f7bfa553ce4` | READY |
| `dpl_9s3idd7gMZ48mge7bpPdhMbb2ND7` | Preview / `codex/camada-1-auth` | `90abd7b17e5435c1cdb703bc22cc83e925dfe376` | READY |
| `dpl_CH7dqWURTMipa81rY6Qh1hNNeuMU` | Production / `main` | `382155ba8a4df24b2bab46ff40f038607992ead1` | READY |

Preview mais recente listado: `https://erp-modular-p36134rjl-handy-hub2.vercel.app`.

Consultas explícitas dos detalhes do deployment, do projeto e das variáveis (sem decriptar valores) sob a equipe `handy-hub2` retornaram **403: forbidden**. O CLI `vercel` não está disponível nesta máquina. A listagem não certifica o alias Current nem o funcionamento do Preview. Não foram alteradas variáveis, proteção, callbacks ou autenticação da integração para contornar a restrição.

### Parcialmente concluído ou pendente

| Etapa da tarefa anterior | Estado real / requisito para continuar |
|---|---|
| Convite real anterior / recuperação real anterior | Entrega, ativação, senha salva e rejeição de OTP reutilizado constam do histórico. A sequência manual com senha pessoal continua sem certificação integral. |
| Master → novo tenant C → primeiro Owner C | Código e testes de contrato/compensação concluídos. **E2E real pendente**: remetente de staging adequado e identidade nova autorizada. |
| Owner C → Employee C distinto | **Pendente**: segunda caixa autorizada, entrega real, aceitação, senha definida pelo próprio destinatário e verificação da membership/cargo. |
| Isolamento exclusivo de C | **Pendente** após o provisionamento real de C. Não reutilizar ou promover a conta employee A para simular esse teste. |
| Preview: variáveis, credenciais, callbacks e fluxos | **Parcial**: URL staging observada na passagem anterior e build READY agora listado. Falta acesso de leitura aos detalhes/variáveis da equipe e validação funcional da origem/callback efetivos. Não configurar/deployar nesta retomada. |
| Auditoria final da Camada 1 | **Parcial**: testes atuais aprovados e segurança do staging preservada. Depende dos E2Es reais e da validação integral do Preview. |
| Cutover / rollback Production | Planos já existem; continuam condicionais, sem execução ou aprovação de Production. O ensaio operacional de rollback não foi realizado nesta passagem. |

**Ponto de parada:** para o E2E restante são necessários remetente verificado/SMTP de staging que entregue a duas caixas distintas autorizadas e ação manual dos destinatários para definir suas senhas. Para a auditoria completa do Preview, é necessário acesso de leitura da integração/operador à equipe Vercel `handy-hub2`. A restrição anterior de `resend.dev` permanece uma pendência documentada; não foi efetuado novo envio para reavaliá-la. Não foram solicitadas nem coletadas senhas pessoais no chat.

### Git ao encerrar esta passagem

- Nenhum commit novo, push, merge ou fetch executado. HEAD permanece `2bafb7d`.
- `origin/codex/camada-1-auth` armazenado localmente também aponta para `2bafb7d`; `main` e `origin/main` armazenados localmente apontam para `382155b`. Isso descreve referências locais; não é uma nova consulta ao GitHub.
- Arquivo rastreado modificado: `docs/camada-1c-retomada.md`.
- Novos artefatos desta passagem: `docs/camada-1c-retomada-evidence.json` e `docs/evidence/camada-1c-retomada-logout.jpg`.
- Permanecem sem rastreamento as seis imagens anteriores `camada-1c-activation.jpg`, `camada-1c-callbacks.jpg`, `camada-1c-email-flow.jpg`, `camada-1c-preview.jpg`, `camada-1c-recovery-template.jpg`, `camada-1c-signup-disabled.jpg` e `erp-modular.rar`. Não foram incluídos em commit nem alterados nesta passagem. O pacote privado não deve ser publicado.
- Nenhuma mudança de código-fonte pendente criada nesta passagem. A documentação e os artefatos novos aguardam revisão; `git diff --check` passou após a edição final. A sessão sintética foi encerrada e os servidores locais de teste foram parados.

## 10. Segunda passagem de 09/10/2026 — onboarding preparado para o E2E real

Resultado: **50 testes aprovados**, TypeScript e lint direcionado passaram. Foram criados 17 testes dos handlers reais com dependências Auth/DB simuladas e ampliado o teste SQL local para membership inativa/autoativação/escalada de plataforma. Não foi comprovado defeito que exigisse mudar a aplicação; `src/`, migrations, RLS e permissões permaneceram intactos. Não houve novas chamadas ao Auth/banco externo, identidades, e-mails, servidores ou deployments.

O preflight local confirmou que URL, chave pública, chave server-side e fixtures correspondem ao staging, sem registrar valores. `AUTH_INVITE_TEMPLATE_MODE` **não está configurada como `token_hash` no preflight**; os handlers corretamente bloqueiam o envio com 503. Não foi habilitada. Os templates versionados são compatíveis, mas o estado remoto exige conferência antes de autorização/envio.

O relatório [Validação local e roteiro do E2E](camada-1c-onboarding-validacao-local.md) separa evidências locais, limites e ações humanas, e contém a lista dos arquivos que devem acompanhar a transferência. [JSON sanitizado](camada-1c-onboarding-local-evidence.json).

Permanecem bloqueados o recebimento real em duas caixas distintas autorizadas, provisionamento/ativação de Owner C e Employee C, validação funcional do Preview e auditoria final. O 403 da Vercel não foi repetido; nenhuma configuração externa foi modificada. O build aprovado pertence à primeira passagem; não foi repetido sem alteração do código/dependências/configuração da aplicação.

Estado Git adicional desta passagem:

- Modificados: `tests/security-foundation.test.mjs`, `docs/camada-1c-onboarding-corrigido.md` e este documento.
- Novos: `tests/onboarding-routes.test.mjs`, `docs/camada-1c-onboarding-validacao-local.md`, `docs/camada-1c-onboarding-local-evidence.json`.
- HEAD permanece `2bafb7d`; nenhum commit/push/merge/deploy. Documentação, testes e evidências sem commit precisam ser copiados separadamente para a nuvem privada/notebook; clonar a branch não inclui essas alterações.
- Os artefatos da primeira passagem e o RAR privado foram preservados. Não há código da aplicação alterado ou trabalho de teste deixado pela metade. `git diff --check` passou ao finalizar.

---

**Pronto para retomar a Camada 1C no notebook: SIM, após configuração e validação local.**

**Camada 1C funcionalmente concluída: NÃO.**

**Pronto para liberar Production: NÃO.**

**Último estado conhecido:** código preservado em `2bafb7d`; 50 testes locais aprovados; login/logout sintético confirmado na primeira passagem; roteiro real de Owner C/Employee C e transferência documentados. E-mail/manual e acesso Vercel continuam pendentes. Production não foi modificada.
