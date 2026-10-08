# Diagnóstico real do convite — 08/10/2026

Projeto consultado e usado: `handyhub-staging` / `gbblkkgowccjycxtexvx`. Nenhum teste contra produção.

## Antes de alterar o código da aplicação

A rota `/api/team/invite` usa `admin.inviteUserByEmail(email, { redirectTo })`. O template real exibido no painel usa `{{ .ConfirmationURL }}`. O callback atual só lê `code` e chama `exchangeCodeForSession`. O cliente e o servidor usam PKCE.

Foi gerado um convite sintético com o método oficial `admin.generateLink({ type: 'invite' })`, sem envio de e-mail. Esse método permitiu examinar e consumir um token real do mesmo tipo de convite. Isso não foi um teste de entrega de `inviteUserByEmail`.

O link real foi `https://gbblkkgowccjycxtexvx.supabase.co/auth/v1/verify`, com parâmetros `token`, `type=invite` e `redirect_to`. O `token` era igual ao `hashed_token` retornado pelo Supabase, sem revelar seu valor. A requisição retornou HTTP **303** para o callback local real. Na query chegou somente `next`; no fragmento chegaram `access_token`, `refresh_token`, `expires_at`, `expires_in`, `sb`, `token_type` e `type=invite`. **Não chegaram code, token nem token_hash na query do callback.**

Fragmentos não são enviados pelo navegador ao servidor HTTP. Portanto, o callback SSR não tem um code PKCE para trocar nem o token original para verificar. O SDK oficial instalado documenta que `inviteUserByEmail` não suporta PKCE; o cliente PKCE também rejeita a detecção de um callback implícito. A combinação do template padrão, do fluxo implícito de convite e do callback de code é a causa. Mudar apenas `redirectTo` não transforma um convite em code PKCE.

Evidência sem tokens: [camada-1b-invite-diagnosis.json](<C:/Users/Thales Alvim/erp-modular/docs/camada-1b-invite-diagnosis.json>).

## Opções oficiais e decisão

| Opção | Uso adequado | Decisão |
|---|---|---|
| inviteUserByEmail | Cria identidade e envia o convite pelo Auth | Manter no endpoint autorizado, quando o template correto estiver disponível |
| generateLink | Gera link/token para entrega própria ou testes | Usar somente como gerador oficial de tokens nos testes; não devolver link de sessão ao owner |
| token_hash + verifyOtp | O template envia o hash para o servidor, que verifica o tipo e grava a sessão em cookies SSR | Implementar para convite e outros tipos de e-mail permitidos |
| code + exchangeCodeForSession | Fluxo realmente iniciado com PKCE e verifier correspondente | Preservar para esses fluxos; nunca aplicar a um convite implícito |

Será preparado um template de convite que aponta diretamente para `/auth/callback?token_hash={{ .TokenHash }}&type=invite`. A confirmação será explícita antes de consumir o token, para evitar consumo pelo simples prefetch de links. A sessão será criada no servidor usando a chave pública e `verifyOtp`. A membership continuará vinculada ao UUID retornado por Auth no servidor de convite; o callback não aceitará tenant/role para criar vínculos.

Documentação oficial: [templates e SSR](https://supabase.com/docs/guides/auth/auth-email-templates), [cliente SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs), [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).

## Limite externo confirmado

O staging foi criado em outubro de 2026 no plano Free. O painel desabilita a edição do template com o SMTP padrão e oferece SMTP próprio ou upgrade Pro. O [changelog de 03/06/2026](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier) confirma essa restrição para novos projetos Free. Não será contornada por API, upgrade ou processamento de fragmentos no navegador.

O usuário autorizou uma caixa de teste e informou que **não possui SMTP disponível**. Não haverá envio de convite incompatível para essa caixa. É possível provar o mecanismo de token, callback e sessão com tokens reais, mas não declarar a entrega/aceitação pelo template de e-mail integrado. O cutover permanece suspenso até esse gate estar concluído.
