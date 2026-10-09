# HandyHub — validação local do onboarding e preparação do E2E

09/10/2026, America/Sao_Paulo. Branch `codex/camada-1-auth`, HEAD `2bafb7d`.

**Validação automatizada ampliada: 50 testes aprovados. Camada 1C ainda NÃO CONCLUÍDA.**

Esta passagem não executou requisições ao banco/Auth, envio de e-mails, criação de usuários ou alterações de infraestrutura. As chamadas Auth/DB dos novos testes são simuladas; as verificações SQL usam PGlite descartável em memória. Production e `handyhub-db` não foram modificados. Nenhum commit, push, merge, deploy ou migration externa foi executado.

## 1. Fluxo revisado e alcance das evidências

| Etapa | Código revisado | Validação local | Dependência real restante |
|---|---|---|---|
| Autorização Master | `src/lib/master/server.ts` | Auth rejeitado retorna 401 antes de inicializar cliente elevado; metadata não concede admin; registro `platform_admins` é exigido; falha de consulta retorna 503. | Confirmar comportamento do candidato no Preview com sessões e roles reais de staging. |
| Tenant + primeiro Owner | `src/app/api/master/tenants/route.ts`, `src/lib/master/onboarding.ts` | Entrada/CSRF, tenant Pendente, UID retornado pelo Auth, owner fixo, membership inicialmente inativa, finalização antes da ativação; compensação e falhas parciais nos testes existentes. | Master criar C com novo destinatário autorizado; comprovar envio/recebimento e estado persistido. |
| Callback do convite | `src/app/auth/callback/route.ts`, `src/lib/auth/callback.ts` | GET não consome OTP; POST exige mesma origem; destino invite sempre `/auth/activate`; OTP recusado não gera contexto; identidade/sessão incompatível é negada. | Link real entregue pelo template remoto, confirmação e sessão SSR no navegador do destinatário. |
| Definição da senha | `src/app/auth/password/route.ts`, `src/lib/auth/password-flow-server.ts`, `src/lib/auth/password-context.ts`, `src/components/auth/PasswordFlow.tsx` | Exige Auth verificado e contexto assinado ligado a UID, sessão, tipo, versão Auth e validade; entrada arbitrária/CSRF negados; usa `updateUser` da própria sessão; sucesso apaga contexto; versão antiga rejeita replay sequencial. | Destinatário define sua própria senha; logout/login normal e acesso exclusivo a C. |
| Convite Employee | `src/app/api/team/invite/route.ts`, `src/lib/auth/invitations.ts`, `src/lib/auth/authorization.ts` | Consulta filtra UID, tenant e membership ativa; owner/manager têm hierarquia limitada; UID vem do Auth; sem acesso elevado antes da autorização; recusa Auth não insere membership; erro de associação não relata sucesso. | Owner C convidar caixa distinta autorizada; entrega, aceitação e cargo employee persistido e testado. |
| Isolamento / ativação | Migrations e cutover existentes, executados somente em PGlite | A→B bloqueado para leitura/escrita; anon negado; membership inativa sem leitura em tenants/tenant_data/companies; usuário não consegue autoativar/promover membership; owner não consegue se tornar platform admin. | Confirmar isolamento exclusivo de C pela interface e chamadas diretas no staging/Preview. |

`is_active` significa associação autorizada após o provisionamento, não comprovação de que a pessoa recebeu o e-mail e concluiu a primeira senha. O callback válido estabelece uma sessão para permitir `updateUser`; a jornada de primeiro acesso deve ser comprovada separadamente. Não tratar uma membership ativa ou resposta 201 como aprovação do E2E.

Os testes com `otp_expired` simulam uma recusa do provedor e comprovam que o aplicativo não emite contexto nessa situação. Não revalidam o consumo único de um convite real no Supabase. O replay sequencial do contexto de senha foi validado localmente com mudança de versão Auth simulada; não foi executado um teste concorrente remoto. O histórico de OTP real anterior permanece em `camada-1c-email-evidence.json`.

## 2. Lacunas cobertas nesta passagem

Foi acrescentado `tests/onboarding-routes.test.mjs`, com **17 testes** que executam os handlers reais e os módulos de autorização/contexto, substituindo apenas as dependências Auth/DB, os cookies recebidos e o ambiente. O helper impede importação inesperada do SDK e não carrega arquivos `.env`.

Cobertura nova:

- Master sem Auth, Auth recusado, metadata forjada e falha na consulta de privilégios.
- Convite com origem cruzada, identidade/redirect/campos privilegiados injetados.
- Tenant diferente, membership inativa, employee que declara cargo owner e hierarquia owner/manager.
- Configuração ausente/inválida bloqueando o envio antes da chamada administrativa.
- Caminho autorizado Owner/Manager → Employee com UID Auth e tenant verificados.
- Recusa de convite pelo Auth, rate limit e falha na associação, sem falso sucesso nem detalhe privado na resposta/log.
- Handler Master usando owner fixo, estado Pendente e ativação restrita à membership recém-provisionada.
- Senha com contexto ausente/trocado, sessão/identidade incompatível, Auth recusado e campos arbitrários.
- Contexto apagado após sucesso e replay sequencial negado; falha do provedor não declarada como sucesso.
- GET de scanner sem consumo; callback recusado; contexts invite/recovery separados, HttpOnly, Secure, SameSite Strict e path `/auth`.
- Configuração de assinatura ausente bloqueando o consumo do OTP e callback sem identidade validada bloqueando ativação.

O teste SQL existente `tests/security-foundation.test.mjs` ganhou verificações de membership inativa, autoativação/promoção e autoatribuição de platform admin. Nenhum SQL desse teste foi executado no Supabase.

**Nenhum defeito de aplicação foi comprovado pelos testes desta passagem; não houve alteração em `src/`, RLS, permissões ou migrations.** Uma incompatibilidade de lint no novo helper de teste foi corrigida localmente, renomeando a variável reservada `module`; o lint final passou.

## 3. Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm test` antes da ampliação | 33 passaram, 0 falhas. |
| `node --test tests/onboarding-routes.test.mjs tests/security-foundation.test.mjs` | 16 passaram na primeira ampliação; depois adicionados dois casos de callback. |
| `npm test` com a ampliação | **50 passaram, 0 falhas, 0 skipped.** |
| `node --test tests/onboarding-routes.test.mjs` após o ajuste final do helper/asserções | **17 passaram, 0 falhas.** |
| `node node_modules/typescript/bin/tsc --noEmit` | Passou. |
| `node node_modules/eslint/bin/eslint.js tests/onboarding-routes.test.mjs tests/security-foundation.test.mjs --max-warnings 0` | Passou; 0 erros/avisos. |
| `git diff --check` após finalizar os arquivos | Passou. |

Node emitiu o aviso já existente `MODULE_TYPELESS_PACKAGE_JSON` ao importar módulos TypeScript de teste. Não houve mudança de `package.json` para eliminar esse aviso. O build da passagem anterior continua como evidência histórica; não foi repetido porque o código da aplicação, dependências e configuração de build não mudaram. Nenhum servidor ou deployment foi iniciado nesta passagem.

## 4. Conferência local da configuração, sem valores secretos

A leitura local confirmou:

| Item | Estado |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Configurada e corresponde exclusivamente ao staging `gbblkkgowccjycxtexvx`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Presente; claims da chave legada indicam anon e o ref de staging. Valor não registrado. |
| `SUPABASE_SERVICE_ROLE_KEY` | Presente; claims indicam service_role e o ref de staging. Exclusivamente server-side; valor não registrado. |
| `NEXT_PUBLIC_APP_ENV` | Corresponde a local. |
| `NEXT_PUBLIC_SITE_URL` | Corresponde à origem local esperada. |
| `AUTH_INVITE_TEMPLATE_MODE` | **Não configurada como `token_hash` no preflight atual.** As execuções locais anteriores habilitavam a flag somente no processo. Os handlers retornam 503 antes do envio sem essa configuração. Não foi habilitada nesta passagem. |
| Fixtures | Ref corresponde ao staging; perfis A/B, sem membership, múltiplas memberships e platform admin estão presentes. Nenhuma identidade foi criada. |
| Templates versionados | Convite e recuperação usam `TokenHash`; invite usa `RedirectTo`, recovery usa `SiteURL`. Isso não certifica a configuração remota. |

A correspondência de claims é uma conferência de associação das credenciais locais, não uma nova chamada de autenticação nem prova de validade de chaves no serviço.

Não foram repetidas consultas Vercel que já retornaram 403 para `handy-hub2`. Os detalhes/variáveis do Preview continuam pendentes de acesso de leitura. O estado remoto de SMTP/templates/callbacks não foi modificado ou revalidado nesta passagem. Não executar os scripts `verify-staging-onboarding.mjs`, `verify-staging-invites.mjs` ou `verify-staging-email.mjs` automaticamente: eles podem criar identidades, consumir tokens, mudar senhas ou enviar mensagens.

## 5. Roteiro do E2E real — preparado, não executado

### Condições antes do primeiro envio

1. Autorização expressa do usuário para criar C e para convidar os dois destinatários definidos. A autorização da caixa employee A não deve ser estendida a uma nova caixa nem usada para reciclar essa identidade.
2. Remetente/SMTP exclusivo de staging capaz de entregar às duas caixas autorizadas distintas. A restrição anterior de `resend.dev` é uma pendência; nenhum novo envio foi feito para reavaliá-la.
3. Identidade Owner C nova e Employee C distinta; preservar todas as contas/memberships A/B existentes. Não promover a caixa já confirmada employee A para simular o teste.
4. Confirmar no painel de staging signup desabilitado, templates remotos corretos, Site URL e callback exatos da origem efetiva. O recovery usa SiteURL, portanto ela precisa corresponder ao ambiente do teste.
5. Se o teste usar Preview, confirmar SHA candidato, URL, chaves próprias de staging, `NEXT_PUBLIC_APP_ENV=preview`, `NEXT_PUBLIC_SITE_URL` do Preview e assinatura server-side. Build Ready sozinho não comprova isso. Acessos de leitura da equipe Vercel ainda estão bloqueados.
6. Somente após revisar os templates e autorizar o ensaio, configurar `AUTH_INVITE_TEMPLATE_MODE=token_hash` no processo/ambiente escolhido. Não mudar Production ou publicar automaticamente para resolver essa configuração.

### Sequência e critérios de aprovação

- [ ] Platform admin autenticado cria empresa fictícia C e informa responsável/e-mail; endpoint 201, owner fixo, tenant/membership coerentes.
- [ ] Owner C recebe e-mail real na caixa autorizada. Registrar entregue/recebido sem conteúdo do token.
- [ ] Abertura do link mostra confirmação; POST conduz a **PRIMEIRO ACESSO — Defina sua senha**.
- [ ] Owner C define e confirma sua própria senha manualmente; sucesso sem coleta/registro da senha pelo operador.
- [ ] Membership owner somente de C; navegação permite apenas C; A/B negadas por interface e chamadas diretas.
- [ ] Logout → login com e-mail/senha próprios → continua restrito a C.
- [ ] Link anterior reutilizado é recusado; não emitir nova membership ou promover conta para contornar a recusa.
- [ ] Owner C convida Employee C distinto; recebimento, primeiro acesso e senha concluídos manualmente.
- [ ] Employee C tem role employee de C, não gerencia convites nem acessa Master, A/B ou alterações administrativas.
- [ ] Anon sem dados empresariais; UPDATE C→A/B negado; operações previstas para owner em C permitidas.
- [ ] Recuperação real de uma conta C, após primeiro acesso: e-mail → callback recovery → nova senha manual → logout/login → link reutilizado negado.
- [ ] Falhas parciais de Auth/associação são revisadas antes de novas tentativas; não declarar onboarding concluído pela entrega isolada do e-mail.
- [ ] Evidências sanitizadas e revisão final do Preview/segurança, sem alterações de Production.

Esse roteiro não autoriza envio, criação de usuários, alteração de senha, configuração externa, push ou deploy. **Próximo passo:** resolver o remetente/acesso de leitura e escolher/autorizar as duas caixas; então executar o roteiro com participação dos destinatários.

## 6. Transferência para o notebook

As alterações desta passagem **não estão no GitHub**, pois nenhum commit/push foi autorizado. Clonar a branch sozinho não recupera os testes e relatórios novos.

Copiar para a nuvem privada e depois para os mesmos caminhos no notebook:

- `tests/onboarding-routes.test.mjs` (novo).
- `tests/security-foundation.test.mjs` (modificado).
- `docs/camada-1c-onboarding-validacao-local.md` (este relatório, novo).
- `docs/camada-1c-onboarding-local-evidence.json` (novo).
- `docs/camada-1c-retomada.md` (modificado, inclui ambas as passagens de 09/10).
- `docs/camada-1c-onboarding-corrigido.md` (modificado, aponta para o relatório atual).
- Preservar também `docs/camada-1c-retomada-evidence.json` e `docs/evidence/camada-1c-retomada-logout.jpg`, criados na passagem anterior sem commit, além das imagens históricas.

Credenciais e fixtures privadas permanecem no pacote protegido já existente, separado desses arquivos; não incluí-las em relatório ou Git. O RAR e as evidências anteriores não foram alterados. Após copiar, conferir branch/HEAD e rodar `npm test` esperando 50 testes; TypeScript/lint conforme acima. Revisar a configuração local e as pendências externas antes de qualquer convite.

**Validação local desta tarefa concluída; E2E real e Camada 1C ainda pendentes. Production preservada.**
