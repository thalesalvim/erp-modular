# HandyHub — Camada 1C: diagnóstico de e-mail e parada na Fase 3

> Relatório histórico da Fase 3. Depois dele, o usuário configurou SMTP próprio
> e a Fase 4 foi retomada. Consulte `camada-1c-email-evidence.json` e o relatório
> da retomada para o estado atual; as tabelas abaixo registram aquele momento.

Data: 08/10/2026. Esta passagem concluiu o diagnóstico e a escolha do provedor.
A Camada 1C **não está concluída**. Nenhuma configuração externa foi alterada.

O prompt exige: “PARE no ponto exato e me diga passo a passo o que fazer” quando
for necessário criar conta, gerar credencial ou preencher secret. Esse é o
impedimento atual: SMTP próprio ainda não foi configurado no staging.

## Configuração real consultada

Projeto `handyhub-staging`, ref `gbblkkgowccjycxtexvx`, organização Thaleco7,
plano Free. A integração confirmou `ACTIVE_HEALTHY`.

| Configuração | Evidência atual |
|---|---|
| SMTP próprio | Desativado; formulário mostra Enable custom SMTP desligado |
| Transporte atual | Serviço padrão do Supabase |
| Invite | Template padrão com `{{ .ConfirmationURL }}`; edição bloqueada |
| Recovery | Template padrão com `{{ .ConfirmationURL }}`; edição bloqueada |
| Mensagem do painel | SMTP próprio necessário para editar os templates |
| Site URL | `http://localhost:3000` |
| Redirect URLs | Lista vazia |
| Login por e-mail | Habilitado |
| Confirmação de e-mail | Habilitada |
| Login anônimo | Desabilitado |
| Email OTP expiration | 3600 segundos |
| Email OTP length | 8 |
| Limite numérico atual de envio | Não legível no painel consultado; não foi contornada a ocultação |

A documentação atual restringe o SMTP padrão a endereços de membros da
organização e informa 2 mensagens/hora, sem garantia de entrega. Esse número é
da documentação, não uma leitura do campo ocultado do projeto.
Referência: [Supabase — SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Os templates token_hash já existem no repositório, mas **não estão instalados
no painel**. Invite usa `.RedirectTo` para `/auth/callback`; recovery usa
`.SiteURL` com `/auth/callback`. Antes do envio real, será preciso conferir a
origem da aplicação, cadastrar o callback exato e instalar ambos os templates.
A flag `AUTH_INVITE_TEMPLATE_MODE=token_hash` só deve ser ativada depois dessa
verificação. Não foi ativada nesta passagem.

## Solução recomendada

**Resend Free, usando SMTP nativo do Supabase.** Preserva a arquitetura validada
e dispensa uma dependência ou um serviço de envio novo no aplicativo.

O plano publicado custa US$ 0 e inclui 3.000 e-mails transacionais/mês, limite
de 100/dia e até 3 domínios. Não contratar plano, adicional ou overages.
Referências: [preços](https://resend.com/pricing) e
[quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits).

Para o primeiro teste, `onboarding@resend.dev` pode enviar à caixa associada à
conta Resend. Usar a mesma caixa Gmail de teste já autorizada pelo usuário ao
criar a conta. Isso permite iniciar sem mudar DNS. O destinatário de teste não
é um endereço sintético de eventos do provedor: precisamos comprovar o
recebimento na caixa real.
Referência: [restrição do domínio de teste](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

Para clientes e outros destinatários será necessário um domínio remetente
verificado, com configuração DNS revisada. A futura credencial de Production
deverá ser própria. O remetente de teste não aprova o envio em Production.

## Ação necessária do usuário — Fase 3

1. Criar ou acessar uma conta em [Resend](https://resend.com), no plano **Free**,
   usando a caixa de teste já indicada, e confirmar o e-mail.
2. Em **API Keys**, criar uma chave chamada `handyhub-staging`, com permissão
   **Sending access**. Guardar a chave privadamente.
3. Abrir [SMTP do handyhub-staging](https://supabase.com/dashboard/project/gbblkkgowccjycxtexvx/auth/smtp).
   Conferir o projeto e o ref antes de preencher.
4. Habilitar SMTP próprio e cadastrar os campos abaixo. Digitar a chave somente
   no campo Password desse painel e salvar a configuração.

| Campo | Valor |
|---|---|
| Sender email | `onboarding@resend.dev` |
| Sender name | `HandyHub Staging` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | API key Resend exclusiva do staging, inserida diretamente no painel |

Referência: [Resend — SMTP](https://resend.com/docs/send-with-smtp).

5. Avisar apenas: **“SMTP do staging configurado”**. Não enviar chave, senha,
   token de convite ou token de recuperação no chat.

Se aparecer exigência de pagamento, upgrade ou domínio verificado para essa
primeira configuração, interromper e informar a exigência. Não comprar nem
alterar o domínio de Production para contorná-la.

## Retomada após a credencial

Retomar na Fase 4: confirmar SMTP ativo no staging; conferir redirects e Site
URL; instalar templates; verificar links e rastreamento; então habilitar o modo
token_hash e testar convite e recuperação recebidos na caixa real.

Depois seguir a ordem do prompt: Preview isolado, testes completos do Preview,
auditoria final, planos operacionais de cutover/rollback e verificações locais
finais. Nenhuma dessas fases posteriores foi declarada concluída agora.

## Relatório de situação — 18 itens solicitados

| Item | Situação |
|---|---|
| 1. Status Camada 1C | **AGUARDANDO AÇÃO DO USUÁRIO NA FASE 3** |
| 2. Solução de e-mail utilizada | SMTP padrão ainda ativo; Resend Free recomendado, ainda não configurado |
| 3. Convite end-to-end | Recebimento e aceitação por e-mail real pendentes |
| 4. Recuperação end-to-end | Recebimento, troca de senha e login posterior pendentes |
| 5. Segurança dos callbacks | Mecanismo validado na 1B; links efetivamente entregues, expiração e fluxo completo ainda precisam da validação 1C |
| 6. Preview | Ainda não publicado; configuração completa de e-mail/origem pendente |
| 7. Testes do Preview | Não executados nesta passagem |
| 8. Auditoria final da Camada 1 | A executar depois do Preview, conforme a ordem solicitada |
| 9. Legado remanescente | Limitações anteriores registradas no relatório 1B; nenhuma correção fora do escopo nesta passagem |
| 10. Testes automatizados | Última execução 1B: 26 testes passaram e TypeScript passou; não rerodados como se fossem validação final 1C |
| 11. Build | Último build Webpack da 1B passou; build final 1C pendente |
| 12. Git | Branch `codex/camada-1-auth`, HEAD `1281eda`; apenas este diagnóstico local adicionado, sem commit, push ou merge nesta passagem |
| 13. Production | **INALTERADA por esta execução**; nenhum write no handyhub-db, Vercel Production ou domínio |
| 14. Plano de cutover Production | Plano operacional final 1C ainda não preparado; execução não autorizada |
| 15. Plano de rollback | Plano operacional final 1C ainda não preparado; execução não autorizada |
| 16. Pronta para cutover de Production? | **NÃO** |
| 17. Bloqueios reais restantes | Credencial SMTP; templates/URLs e e-mails completos; Preview isolado e validado; auditoria e planos finais; verificações finais |
| 18. Aprovação final | Não solicitada: critérios de prontidão ainda não atendidos |

A base de segurança já fechada no staging permanece documentada em
[Camada 1B](camada-1b-cutover-staging.md). O diagnóstico atual não substitui essa
evidência nem declara uma validação de e-mail que ainda não aconteceu.
