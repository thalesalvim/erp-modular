# HandyHub — Camada 1C: estado atual e continuidade

**Data:** 08/10/2026  
**Situação:** Onboarding corrigido; Camada 1C AINDA NÃO CONCLUÍDA.  
**Branch de desenvolvimento:** `codex/camada-1-auth`  
**Último commit publicado:** `90abd7b`  
**Produção:** Não alterada durante a transferência.

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

**Último commit:** `90abd7b` — `feat(auth): preserve camada 1C onboarding and security work`

Histórico preservado:

| Commit | Descrição |
|---|---|
| `382155b` | Base existente na main |
| `cb1a15c` | Preparação do isolamento entre empresas |
| `dc7dcbb` | Autenticação Supabase e vínculo com tenants |
| `e65ae4a` | Validação de Auth e RLS no staging |
| `1281eda` | Normalização do baseline |
| `90abd7b` | Preservação do onboarding e segurança da Camada 1C |

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

---

**Pronto para retomar a Camada 1C no notebook: SIM, após configuração e validação local.**

**Camada 1C funcionalmente concluída: NÃO.**

**Pronto para liberar Production: NÃO.**

**Último estado conhecido:** código sincronizado com GitHub, Preview implantado, Production preservada, configurações privadas e imagens transferidas ao Google Drive.