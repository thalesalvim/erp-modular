# HandyHub — onboarding fechado, revisão da Camada 1C

08/10/2026. **Correção local validada; E2E Owner C/Employee C ainda NÃO APROVADO.**
Alvo de toda escrita externa: `handyhub-staging`, `gbblkkgowccjycxtexvx`.
Production/handyhub-db permaneceram intocados. Sem commit, push, merge ou deploy.

## Os nove itens solicitados

| Item | Resultado e limite |
|---|---|
| 1. Signup público existe? | Não há botão/fluxo de signup no código ativo. O backend Auth inicialmente permitia cadastro público: `disable_signup=false`. |
| 2. Foi desabilitado no staging? | **SIM.** Painel salvo e `/auth/v1/settings` confirma `disable_signup=true`. Chamada pública `signUp` retorna 422, `signup_disabled`, sem identidade criada. Anonymous sign-ins continua desligado; Email e confirmação de e-mail continuam ligados. Nenhuma configuração Production foi alterada. |
| 3. Como Master cria o primeiro Owner? | Servidor valida `getUser` + registro `platform_admins`. Exige nome/e-mail do responsável; cria tenant Pendente; convida pela API administrativa Auth; insere membership owner INATIVA; finaliza tenant; ativa a membership por último. O cargo é fixado pelo servidor, sem senha escolhida pelo Master. Falhas retornam etapa/estado parcial. Conta confirmada existente é recusada, sem associação/promoção silenciosa. O sucesso com SMTP e um novo Owner C ainda depende da caixa de teste adequada. |
| 4. Como Owner/Manager cria colaborador? | `/api/team/invite` valida UID, membership ativa e hierarquia no servidor. Owner convida manager/employee; manager apenas employee. Não convida owner/platform_admin; não aceita UID, redirect ou campos privilegiados. Auth administra o convite; membership usa UUID retornado pelo Auth. Falha de associação após envio fica explícita e requer revisão. |
| 5. Primeiro acesso | E-mail → GET de confirmação sem consumo → POST da mesma origem → `verifyOtp(type=invite)` → sessão SSR validada → `/auth/activate` → “PRIMEIRO ACESSO — Defina sua senha”. API usa `updateUser(password)` da própria sessão, confirmação e 8–128 caracteres. Cookie HttpOnly assinado liga fluxo, UID, session_id, versão Auth e validade de 30 minutos; é removido após sucesso. Contexto adulterado/ausente/trocado/reutilizado é rejeitado. A entrada empresarial carrega somente memberships válidas do UID. |
| 6. Recuperação | “Esqueci minha senha” solicita callback exato. E-mail recovery → confirmação → contexto recovery → `/auth/update-password`, “RECUPERAÇÃO DE SENHA”. Convite não autoriza esta tela e recovery não autoriza a tela de ativação. Token inválido/consumido/expirado leva a erro explícito; não cai silenciosamente no login. |
| 7. Teste real por e-mail | Convite anterior employee A: delivered; link real agora abriu ativação correta. Auth confirma a conta e senha definida, sem consultar o conteúdo da senha. Recuperação real: accepted + Resend delivered; logs mostram callback 303 → tela de recuperação → senha salva 200; Auth mostra token de recuperação consumido. Nova confirmação do mesmo link retorna `otp_expired`. A sequência completa de logout/login com senha na interface e o E2E de C não foram certificados. |
| 8. Username/passwordHash legado | Busca em `src` não encontrou username/passwordHash/staffDatabase/hashPassword como autenticação ativa. Login só e-mail/senha; antiga API Equipe retorna 410. Coluna histórica `tenants.logins` ainda existe, fora do SELECT Auth/grants autenticados. Staging tem dois tenants e zero arrays logins não vazios. Nenhum hash legado foi migrado para Auth ou removido de Production. |
| 9. Pronto para continuar 1C? | **SIM para prosseguir com os testes pendentes; NÃO para concluir 1C ou Production.** Falta o sucesso real Master → Owner C, convite Employee C, logout/login e isolamento só C, depois Preview e auditoria final. |

## Causa comprovada do retorno ao login

O e-mail continha o destino correto: `/auth/callback`, `token_hash`, `type=invite`.
O diagnóstico mostrou POST rejeitado **antes de verifyOtp**: `sameOrigin=false`.
A página de confirmação enviava `Referrer-Policy: no-referrer`, que faz uma
submissão nativa de formulário enviar `Origin: null`. A checagem de origem estava
correta; o cabeçalho a tornava incompatível com o próprio formulário.

A correção usa `strict-origin`: não inclui caminho/query do token no Referer e
permite preservar o Origin da submissão de mesma origem. A checagem CSRF não foi
relaxada. Convite real repetido após a correção chegou à página de ativação.
Referência: [MDN — Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy).

Antes de consumir tokens de senha, o callback também exige configuração server-side
do segredo de assinatura. Nenhum tenant/cargo/usuário é obtido da query string.
PKCE continua separado para troca legítima de código; links de convite/recuperação
usam o template oficial token_hash. Logs de diagnóstico omitem token/e-mail/senha.

## Coerência do provisionamento

Auth/SMTP e PostgREST não compartilham uma transação. A implementação utiliza
etapas e compensação: erro no convite remove somente o tenant recém-criado
Pendente; erro após envio mantém/reconcilia tenant Pendente e owner inativo,
e retorna cadastro parcial para revisão. Erro na compensação informa incerteza
(`cleanupFailed`, `membershipActive=null`), nunca sucesso.
Não exclui nem promove uma identidade Auth já existente.

Um teste real do endpoint Master recusou anon/employee, recusou associação de
conta confirmada já pertencente a A e removeu o tenant sintético recém-criado.
Testes automatizados cobrem a ordem do sucesso e falhas de cada etapa. Isto não
substitui a entrega real do primeiro Owner C.

Antes de desabilitar signup, conferidos o handler oficial administrativo de
convite, o caminho servidor Master e os testes de provisionamento; a API de
convite administrativo já entregava o convite real. Após desabilitar, foi
provado provisionamento administrativo de link Auth sintético e rejeição pública.
Referências: [configuração Auth](https://supabase.com/docs/guides/auth/general-configuration),
[inviteUserByEmail](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail),
[handler oficial](https://github.com/supabase/auth/blob/master/internal/api/invite.go).

## Validação desta execução

| Verificação | Resultado |
|---|---|
| npm test | 33 passaram, 0 falhas; inclui RLS, contratos, contexto assinado e compensação |
| TypeScript | `tsc --noEmit` passou |
| Lint direcionado | Arquivos alterados Auth/Master e novos helpers/testes: 0 erros/avisos |
| Build local | Webpack final com env staging passou; nenhuma publicação |
| Testes API staging após signup fechado | 11 grupos passaram; veja JSON abaixo |
| Isolamento | Anon negado em tenants/tenant_data/memberships; employee A lê A, SELECT/UPDATE B retornam zero linhas |
| Segurança do contexto | Ausente/adulterado/tipo trocado/UID arbitrário/mismatch de senha negados; versão Auth anterior e OTP consumido rejeitados |
| Recovery sintético | Tela distinta, updateUser, senha antiga rejeitada e senha nova aceita |
| Master direto | Anon 401, employee 403, conta confirmada 409 com compensação; associação original preservada |
| Segredo privilegiado | Zero ocorrências em 89 arquivos candidatos ao Git e 40 JS do navegador no build final |
| Legado/produção | Nenhuma nova migration/RLS/grant aplicada; cutover staging existente preservado; zero escrita Production |

Os testes de mecanismo geraram duas identidades fictícias extras, associadas
como employee A, e senhas aleatórias somente em memória. Não foram usadas como
evidência de recebimento real de e-mail. Os dois tenants temporários de falha
Master foram compensados; staging continua com A/B, sem Empresa C criada.

Evidência de mecanismo: [JSON](camada-1c-onboarding-api-evidence.json).
Histórico de SMTP/estado real: [JSON](camada-1c-email-evidence.json).

## Pendências que impedem concluir o E2E solicitado

1. Duas identidades reais distintas para Owner C e Employee C. `resend.dev`
   restringe envio à caixa da conta Resend; é necessário remetente verificado
   exclusivo de staging/SMTP adequado e segunda caixa autorizada. Não foi feito
   upgrade nem alterado DNS/SMTP Production. A caixa já usada está confirmada
   como employee A; apenas remover sua membership não a torna nova conta
   convidável. Nenhuma membership dessa conta foi removida nesta execução.
2. Provar Master → tenant C → novo Owner C, entrega, senha própria, membership
   owner somente C, logout/login e acesso apenas C; depois Employee C distinto,
   cargo limitado e negação A/B, por interface e API.
3. Confirmar sequência manual completa do convite/recuperação anteriores.
   Os logs/metadados acima comprovam etapas, mas não certificam toda a jornada.
4. Gerar/revalidar Preview exclusivamente com staging, cadastrar callback exato
   da origem efetiva e testar nele o fluxo completo. Não houve push ou Preview
   novo nesta execução. Env Production não foi alterada.
5. Auditoria final após esses fluxos e revisão dos planos condicionais de
   Production. Nenhuma aprovação de Production está implícita neste relatório.

Se um convite já foi confirmado e a tela de senha não foi concluída, o token não
pode ser reutilizado. A definição de senha deve ser retomada com recuperação
da própria conta; não criar outra identity ou ampliar membership para contornar.

## Evidências visuais

![Convite real chegou ao primeiro acesso](evidence/camada-1c-activation.jpg)

![Signup público desabilitado no projeto de staging](evidence/camada-1c-signup-disabled.jpg)

## Estado final

**ONBOARDING FECHADO PREPARADO E VALIDADO LOCALMENTE NO STAGING.**
**CAMADA 1C AINDA NÃO CONCLUÍDA. OWNER C/EMPLOYEE C E2E NÃO APROVADO.**
**PRODUCTION INALTERADA.** Parada para revisão, sem iniciar qualquer cutover.
