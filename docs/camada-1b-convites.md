# HandyHub — retomada dos convites da Camada 1B

08/10/2026. Resultado para revisão: **callback corrigido e mecanismo validado; integração de e-mail bloqueada por falta de SMTP. Nenhum cutover.**

Este relatório atualiza a [preparação anterior](<C:/Users/Thales Alvim/erp-modular/docs/camada-1b-staging.md>). Mantém suas alterações locais e distingue as provas realizadas nesta retomada das etapas ainda pendentes.

## 1. Causa raiz do problema PKCE

O convite administrativo da aplicação usa `inviteUserByEmail`. O template real do staging usa `ConfirmationURL`, que verifica o convite no próprio Supabase e redireciona com a sessão no fragmento. O callback SSR anterior só lia `code` e chamava `exchangeCodeForSession`; o cliente também era PKCE. Convites desse método não geram um code PKCE correspondente ao browser do destinatário.

O comportamento foi confirmado com um convite real gerado por `admin.generateLink({ type: 'invite' })`, sem envio de e-mail: HTTP **303**, query do callback contendo apenas `next`, e fragmento com `access_token`, `refresh_token`, `expires_at`, `expires_in`, `sb`, `token_type`, `type=invite`. Não havia `code`/`token_hash` na query. Fragmentos não chegam ao servidor HTTP. O `token` no link original era igual ao `hashed_token` fornecido pelo Auth.

Isso comprova o comportamento do token de convite oficial e corresponde ao template real lido no painel; **não equivale a testar a entrega de `inviteUserByEmail`**. Evidência: [diagnóstico JSON sem tokens](<C:/Users/Thales Alvim/erp-modular/docs/camada-1b-invite-diagnosis.json>). Comparação das opções oficiais: [diagnóstico antes da alteração de código](<C:/Users/Thales Alvim/erp-modular/docs/camada-1b-invite-diagnosis.md>).

O [SDK instalado](<C:/Users/Thales Alvim/erp-modular/node_modules/@supabase/auth-js/src/GoTrueAdminApi.ts:177>) documenta a limitação de PKCE nesse método. A [documentação de templates](https://supabase.com/docs/guides/auth/auth-email-templates) descreve o fluxo SSR por hash e `verifyOtp`.

## 2. Fluxo anterior

Solicitante Auth → servidor confere membership/cargo → `inviteUserByEmail` → Auth cria identidade → servidor grava membership no UUID retornado → e-mail com ConfirmationURL → verificação no Supabase → fragmento de sessão → callback tenta code PKCE inexistente.

A autorização do solicitante e a associação por UUID já estavam corretas. A combinação entre template, tipo de link e callback era incompatível. Alterar somente `redirectTo` não resolveria.

## 3. Fluxo corrigido e limite de ativação

Fluxo preparado: solicitante Auth → servidor confere membership ativa e hierarquia → convite administrativo → e-mail aponta ao callback com `token_hash`/`type=invite` → destinatário confirma → servidor chama `verifyOtp` com chave pública → sessão em cookies SSR → definição da própria senha → membership existente do UUID convidado → logout/login normal.

`inviteUserByEmail` permanece como método de entrega da aplicação. `generateLink` foi usado como gerador oficial de tokens nos testes, sem apresentar link de sessão ao owner. Os callbacks que realmente recebem code PKCE mantêm `exchangeCodeForSession`.

**O template corrigido está local; não está ativo no painel.** O projeto novo Free não permite editar templates usando o SMTP padrão. O painel oferece SMTP próprio ou upgrade. O usuário informou não ter SMTP disponível. O [changelog oficial de 03/06/2026](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier) confirma a restrição para novos projetos Free. Não houve upgrade, cobrança, tentativa de contornar o limite por API ou leitura de fragmentos no navegador.

Foi adicionado um gate server-side: enquanto o operador não tiver configurado e revisado o template real, `AUTH_INVITE_TEMPLATE_MODE` permanece sem ativação. Pedidos autorizados recebem **503**, sem envio de link incompatível. A flag não substitui a prova da configuração/entrega real.

## 4. Alterações realizadas

| Arquivo | Alteração |
|---|---|
| [callback/route.ts](<C:/Users/Thales Alvim/erp-modular/src/app/auth/callback/route.ts>) | Callback central: code PKCE ou OTP permitido; confirmação explícita; cookies SSR; erros e redirects seguros |
| [auth/callback.ts](<C:/Users/Thales Alvim/erp-modular/src/lib/auth/callback.ts>) | Validação dos tipos/parâmetros e lista exata de destinos |
| [team/invite/route.ts](<C:/Users/Thales Alvim/erp-modular/src/app/api/team/invite/route.ts>) | Mesma origem, JSON limitado, campos permitidos, gate de template e respostas sem cache |
| [auth/invitations.ts](<C:/Users/Thales Alvim/erp-modular/src/lib/auth/invitations.ts>) | Valida solicitação e origem de redirect definida pelo servidor |
| [invite.html](<C:/Users/Thales Alvim/erp-modular/supabase/templates/invite.html>) | Template de convite com hash, preparado para SMTP próprio |
| [recovery.html](<C:/Users/Thales Alvim/erp-modular/supabase/templates/recovery.html>) | Template de recuperação por hash, preparado e não ativado |
| [.env.example](<C:/Users/Thales Alvim/erp-modular/.env.example>) | Documenta a flag exclusivamente server-side e Site URL, sem valores reais |
| [auth-callback.test.mjs](<C:/Users/Thales Alvim/erp-modular/tests/auth-callback.test.mjs>) | Nove testes novos de callback, campos/destinos e hierarquia de convites |
| [verify-staging-invites.mjs](<C:/Users/Thales Alvim/erp-modular/scripts/verify-staging-invites.mjs>) | Testes reais de token/cookies/senha/membership e API, restritos ao ref de staging |

Não foram criadas migrations ou tabelas nesta retomada. Não foram modificados RLS/grants, SMTP, templates remotos, confirmação de e-mail ou assinatura. As correções locais anteriores de Master/authService foram preservadas. Nenhuma dependência foi atualizada.

## 5. Callback final

Rota única: `/auth/callback`.

- `code` válido: troca PKCE usando o verifier correspondente no cliente SSR existente.
- `token_hash`: aceita somente `invite`, `recovery`, `email`, `email_change`; não aceita code junto, duplicidade de parâmetros, campos de tenant/role ou tipos arbitrários.
- GET de OTP mostra confirmação e **não consome o token**. POST da mesma origem verifica o OTP; isso evita consumo pelo simples prefetch de um scanner de e-mail.
- Convite e recuperação encaminham obrigatoriamente a `/auth/update-password`. Outros destinos são caminhos exatos permitidos: `/`, `/equipe`, `/auth/account`, `/auth/update-password`.
- Destinos externos, escapes, queries e fragmentos arbitrários são rejeitados. Erros redirecionam a `/?auth=callback-error`, sem detalhes de SDK ou credenciais.
- Todas as respostas usam no-store/private e no-referrer; a confirmação restringe formulários à própria origem e bloqueia enquadramento por outro site.

O callback usa a **chave pública**, verifica o usuário por `getUser` e não cria memberships. Não usa service_role. Tokens expirados/ inválidos são delegados à validação oficial de Auth e têm o mesmo tratamento seguro de erro. A expiração cronológica de um token válido ainda não foi exercitada nesta rodada.

## 6. Membership e convidado

O endpoint valida o solicitante por Supabase Auth, consulta sua membership ativa pelo UID e tenant solicitado, e aplica a hierarquia: owner → manager/employee; manager → employee; employee → nenhum convite. O tenant só é usado após essa autorização.

Auth cria a identidade no momento do convite e retorna seu UUID. O servidor vincula exatamente esse UUID ao tenant autorizado. Não associa por nome, não cria vínculos no callback e não exige tabela duplicada de convites pendentes para esse fluxo. A confirmação/uso único do token continuam no Supabase Auth.

O convidado controla a própria senha por `auth.updateUser`. A aplicação não escolhe, armazena ou envia senha do funcionário. O teste usou uma senha aleatória somente na memória do processo, sem registrá-la no relatório ou gravá-la para a nova identidade.

O teste real de callback gerou uma identidade sintética adicional com membership employee em A. O teste de diagnóstico gerou outra identidade sintética, sem membership. Estado final: **9 identidades Auth confirmadas, 7 memberships, 2 tenants, 1 platform admin**. Não foi criada identidade para a caixa pessoal autorizada, nem enviado e-mail a ela.

## 7. Segurança contra manipulação de tenant

O endpoint rejeita campos inesperados como `tenant_id`, `userId`, `redirect`, `redirectTo`, flags administrativas e e-mails malformados. Alterar `tenantId` para B não evita a consulta de membership do solicitante em B. Não aceita promoção para owner/platform admin pelo convite.

O callback rejeita tenant/role/e-mail na URL e não possui operação de associação. A autorização não depende de localStorage, user_metadata ou nome da empresa.

Essa segurança da API de convite não fecha o acesso direto às tabelas empresariais ainda abertas. Nenhuma prova de isolamento RLS foi substituída por ocultação de botões.

## 8. Testes de convite

| Caso | Resultado exato |
|---|---|
| Owner A → employee A | Hierarquia permite; endpoint real responde **503** por template não configurado. Entrega positiva pendente |
| Owner A → manager A | Hierarquia permite; endpoint real responde **503**. Entrega positiva pendente |
| Manager A → employee A | Hierarquia permite; endpoint real responde **503**. Entrega positiva pendente |
| Manager A → owner | **403** |
| Employee A → convite | **403** |
| Owner A → tenant B | **403** |
| Owner A → platform_admin | **400** |
| Manipulação de tenant_id/userId/redirect/redirectTo/e-mail | **400** |
| Token oficial invite → confirmação → sessão SSR | **PASS**, UID exato confirmado por Auth |
| Membership do convidado | **PASS**, exatamente employee em A |
| Definição de senha → logout → login normal | **PASS**, membership preservada |
| Token reutilizado | **NEGADO**, erro genérico e nenhuma sessão nova |
| Token inválido | **NEGADO**, erro genérico e nenhuma sessão nova |
| Token válido envelhecido até expirar | **NÃO EXECUTADO**, não simulado como prova hosted |
| E-mail de identidade já confirmada | `generateLink(type=invite)` oficial rejeitou; vínculo owner existente permaneceu inalterado. Entrega desse caso pelo endpoint ainda pendente |
| Origem externa na confirmação | Rejeitada, sem sessão nova |
| Redirect externo/tenant no callback | Rejeitados |

Recuperação pelo token oficial também passou: criou a sessão SSR do UID certo; após troca de senha, a antiga falhou e a nova funcionou. **Entrega do e-mail de recuperação não foi validada.**

Evidência: [nove registros PASS do mecanismo e APIs](<C:/Users/Thales Alvim/erp-modular/docs/camada-1b-invite-mechanism-evidence.json>). O próprio arquivo registra `email_delivery_validated: false` e `cutover_allowed: false`.

## 9. TypeScript, lint, testes e build

| Verificação | Resultado |
|---|---|
| npm test | **26 PASS, 0 FAIL**; nenhum teste antigo removido |
| TypeScript | PASS |
| Lint direcionado | 0 erros/0 warnings |
| git diff --check | PASS, com avisos de LF/CRLF do checkout |
| Build Webpack com configuração staging | PASS |
| Auth/Master anteriores ao cutover | **11 registros PASS** na rodada final sequencial |
| Mecanismo de convite/recuperação + API | **9 registros PASS**, com limite de entrega explicitado |

Uma rodada concorrente dos scripts de Auth interferiu nas próprias sessões sintéticas: logout global de um caller invalidou um cookie usado pela outra suíte. O cleanup das chamadas de convite foi limitado à sessão local; a rodada final de Auth/Master foi executada sequencialmente e passou. Não foi ampliada permissão para eliminar esse resultado.

Service role: módulo server-only, sem prefixo público. Não é retornada pelas APIs testadas nem logada pela aplicação. Busca literal da chave real do staging: **0 ocorrências em 45 arquivos de assets do cliente e 0 nos 83 arquivos versionáveis examinados**. Arquivos privados de ambiente/fixtures/diagnóstico continuam ignorados pelo Git. Nenhuma chave de produção foi usada. O servidor local foi encerrado após os testes; build não foi deployment.

## 10. Commit criado

**Nenhum commit criado.** O commit separado solicitado é condicionado ao fluxo correto, e o gate de entrega/aceitação do convite integrado ainda não passou. As correções continuam locais para revisão, na branch `codex/camada-1-auth`, sem push, merge ou troca de branch. HEAD preservado: `dc7dcbba1ab2bb8e863a08424b20a08fe1d6278d`.

## 11. Cutover do staging

**NÃO EXECUTADO.** O prompt proíbe iniciar antes da validação completa do convite. SMTP/template reais e a entrega permanecem indisponíveis. Nenhum comando de ativação de RLS/grants foi enviado, nem parcialmente aplicado.

## 12. Estado RLS no staging

Consulta final pela integração:

| Tabela | RLS | FORCE |
|---|---|---|
| tenants | Desligado | Desligado |
| tenant_data | Desligado | Desligado |
| companies | Desligado | Desligado |
| tenant_memberships | Ligado | Desligado |
| platform_admins | Ligado | Desligado |

Treze policies existentes. As empresariais continuam dormentes. Histórico permanece com as quatro migrations de fundação já registradas; nenhuma migration nova nesta retomada.

## 13. Grants finais no staging

**NÃO APLICADOS.** O estado de grants anterior permanece: anon/authenticated com privilégios amplos nas três tabelas empresariais; authenticated SELECT condicionado em memberships; sem grant de navegador em platform_admins.

O [plano de cutover](<C:/Users/Thales Alvim/erp-modular/supabase/activation/camada-1-cutover.sql>) permanece somente preparado. Não houve concessão adicional para fazer o convite ou o Master funcionar.

## 14. Empresa A → Empresa B

Convite pela API A → B: **403**. Isso não prova o bloqueio de dados.

SELECT/UPDATE empresarial A → B após banco fechado: **NÃO EXECUTADO**. Com RLS desligado e grants amplos, o acesso direto empresarial continua permitido pela configuração atual. Não declarar isolamento concluído.

## 15. Anon

Dados empresariais de tenants/tenant_data/companies: **ainda permitidos pela configuração atual**, sujeitos a tipos/constraints comuns. Anon → Master API: **401** no teste real. Anon → dados empresariais NEGADO pós-cutover continua pendente.

## 16. Master

Na rodada final, anon recebeu 401 e owner/employee receberam 403 em todas as operações CRUD da API. Platform admin recebeu 200 na leitura; alteração sintética de invoices/status persistiu e foi revertida; criação/exclusão de tenant descartável respondeu 201/200. Campos proibidos e origem externa foram rejeitados.

O caminho server-side com Auth → platform_admin continua funcionando, sem dependência de credencial do navegador. As correções anteriores foram preservadas. Nenhum Master Production foi publicado ou alterado.

## 17. Equipe

Os sete perfis originais passaram novamente pelo authService real com UID/memberships/roles e logout. A API legada segue POST 410/GET 405. Convites não autorizados foram negados. Nesta retomada não foi repetida toda a interface de Equipe, já exercitada na preparação anterior.

Permanecem os limites registrados no relatório anterior: compatibilidade de escrita operacional do employee com o payload agregado e leitura autorizada de invoices do portal precisam de revisão antes de declarar compatibilidade total com o banco fechado. Nenhum módulo de DRE/estoque/vendas/agenda foi modificado.

## 18. Production

**INALTERADA NESTA RETOMADA.** Nenhum write no `handyhub-db`; nenhuma alteração de Auth, dados, RLS/grants, migrations ou secrets de produção. Nenhuma ação de variáveis/deployment na Vercel Production; nenhum merge/main/push.

A consulta final read-only de produção confirmou zero usuários Auth, zero memberships, as mesmas treze policies, o mesmo estado de RLS e somente as três migrations existentes de 0.5. O staging usado em todos os testes é o ref separado `gbblkkgowccjycxtexvx`.

Preview continua sem deployment. As variáveis de staging preparadas antes não foram trocadas por produção; callbacks/Site URL Preview ainda não estão completos. A origem local real usada nos testes foi `http://localhost:3000`, sem URL de produção ou Preview inventada.

## 19. Status Camada 1B

**BLOQUEADA para a conclusão; correção local PARCIALMENTE VALIDADA.**

O mecanismo oficial de token/SSR/senha/membership já passou. Falta configurar SMTP exclusivo de staging e ativar o template preparado; depois provar o fluxo completo vindo do endpoint autorizado e recebido por e-mail, incluindo owner/manager, expiração real e caso de conta existente. Só então criar o commit separado e reavaliar os gates para cutover do staging, provas diretas de isolamento e eventual Preview.

A caixa de teste fornecida pelo usuário não foi exposta neste relatório e não recebeu um convite incompatível. Não foi escolhido plano pago ou serviço com cobrança. A restrição de template é o bloqueio externo concreto desta retomada; as demais provas de banco fechado continuam condicionadas a resolvê-lo.

## 20. Pronto para revisar deploy de produção?

**NÃO.**

Convite integrado, expiração real, cutover/isolamento hosted e Preview completo continuam pendentes. A execução para aqui para revisão, sem iniciar automaticamente outra camada e sem publicar em produção.
