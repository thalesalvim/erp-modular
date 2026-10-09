# HandyHub — Camada 1C: estado atual

08/10/2026. **Onboarding corrigido; Camada 1C AINDA NÃO CONCLUÍDA.**
Production/handyhub-db permanecem intocados. Sem commit, push, merge ou deploy.

A revisão atual substitui o estado anterior “aguardando aceitação” e a
expectativa de que o Master criasse apenas tenant sem primeiro Owner.

Leia o [relatório atual de onboarding](camada-1c-onboarding-corrigido.md), com os
nove itens solicitados, diagnóstico, testes, evidências e limites.

## Confirmado nesta passagem

- Signup público estava habilitado no Auth e foi desabilitado somente no staging;
  chamada pública retorna `signup_disabled`, sem criar identidade.
- Causa do convite indo ao login: `no-referrer` no formulário causava Origin null.
  Corrigido para strict-origin, mantendo validação CSRF e sem token no Referer.
- Convite real agora abriu “PRIMEIRO ACESSO — Defina sua senha”. A conta real de
  teste tem e-mail confirmado e senha definida; senha não foi lida nem registrada.
- Recovery real aceito e entregue pelo Resend; logs mostram callback e senha
  salva. Reutilização posterior do mesmo link foi rejeitada por `otp_expired`.
- Primeiro acesso `/auth/activate` e recuperação `/auth/update-password` têm
  contextos separados, assinados, ligados ao UID/sessão/versão Auth e expiração.
- Master cria tenant + convite Auth + owner pelo servidor, com membership
  inicialmente inativa, compensação e erro parcial explícito. Sucesso real com
  novo Owner C ainda precisa de caixa adequada e teste completo.
- Owner/manager convida somente dentro da autorização verificada no servidor.
- 33 testes, TypeScript, lint direcionado, build final e 11 grupos de testes
  diretos no staging após signup fechado passaram. Anon e A→B continuam negados.
- Zero ocorrências da service_role staging em 89 candidatos ao Git e 40 JS do
  navegador no build final. Env/fixtures permanecem ignorados.

## Limites e próximos testes

O E2E Owner C/Employee C continua **NÃO APROVADO**. Staging ainda tem apenas A/B.
O remetente resend.dev permite uma única caixa; precisamos de remetente exclusivo
adequado e segunda identidade autorizada. A conta do convite anterior é employee
A confirmado: não foi removida, promovida ou reutilizada como Owner C.

Logout/login manual com a senha própria, isolamento só C, Employee C distinto,
Preview com callback/env próprios e auditoria final continuam pendentes.
O código corrigido está localmente em `codex/camada-1-auth`, sem publicação.
RLS/grants staging já fechados na 1B não foram reaplicados nem afrouxados.
Nenhuma migration nova nesta execução.

## Ambientes e planos

Staging: `handyhub-staging`, ref `gbblkkgowccjycxtexvx`, organização Thaleco7 Free.
Callback local exato: `http://localhost:3000/auth/callback`; templates token_hash.
Antes de Preview, cadastrar sua origem real e manter todos os segredos próprios
no escopo Preview. A integração Vercel tinha retornado 403 para a equipe; a
conferência anterior do painel verificou URL staging e credenciais Preview.
Nenhuma configuração Vercel foi alterada nesta passagem de onboarding.

Production é `handyhub-db`, ref `qmfwsnhpmsonndhgqsyi`.
Última leitura anterior de referência: Vercel Current Ready
`dpl_CH7dqWURTMipa81rY6Qh1hNNeuMU`, main SHA
`382155ba8a4df24b2bab46ff40f038607992ead1`, www.handyhub.com.br.
Nenhuma escrita nesse projeto ou em Production Vercel nesta execução.

[Plano de cutover condicionado, não executado](camada-1c-production-cutover-plan.md).
[Plano de rollback condicionado, não executado](camada-1c-rollback-plan.md).
[Evidência API](camada-1c-onboarding-api-evidence.json).
[Histórico SMTP](camada-1c-email-evidence.json).

**Pronto para prosseguir com os testes pendentes da 1C: SIM.**
**Pronto para concluir 1C/Production: NÃO.** Parada para revisão.
