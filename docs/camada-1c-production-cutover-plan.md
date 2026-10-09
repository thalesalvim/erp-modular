# HandyHub — plano de cutover de Production

Preparado em 08/10/2026. **NÃO EXECUTADO. NÃO AUTORIZA EXECUÇÃO.**
Este é um plano condicionado: entrega real de e-mail e Preview ainda não passaram.
Somente uma aprovação posterior poderá autorizar alterações de Production.

Atualização de onboarding: antes de qualquer janela, exigir E2E Master → novo
Owner C → Employee C distinto e isolamento só C, conforme
[revisão atual](camada-1c-onboarding-corrigido.md). A interface é SaaS fechado;
desabilitar signup público em Production somente em execução futura aprovada,
depois de provar o provisionamento administrativo no candidato. Preservar login,
confirmação de e-mail e recuperação. Master não escolhe senhas.
Convite deve abrir `/auth/activate`; recovery `/auth/update-password`;
testar contexto assinado e erro explícito. Não reaplicar o callback anterior
com `no-referrer` em formulário nativo. Toda falha parcial de onboarding exige
reconciliação administrativa antes de liberar a empresa.

## Alvos fixos e estado consultado

- Repositório: `thalesalvim/erp-modular`; trabalho: `codex/camada-1-auth`.
- Production: `handyhub-db`, ref `qmfwsnhpmsonndhgqsyi`.
- Staging: `gbblkkgowccjycxtexvx`; nunca copiar suas contas/chaves para Production.
- Domínio aprovado para a futura produção: `https://www.handyhub.com.br`.
- Último deployment de referência da 1B: `dpl_CH7dqWURTMipa81rY6Qh1hNNeuMU`,
  main, commit `382155ba8a4df24b2bab46ff40f038607992ead1`.
  Conferir novamente o deployment efetivamente Current antes da janela.
- Leitura nesta passagem: Production tem 0 usuários Auth, 0 memberships,
  0 platform admins, 1 tenant e 1 company sem `tenant_id`.
- RLS de tenants/tenant_data/companies está desligado; identidade/admin ligado.
- Fundação já aplicada remotamente: `20261008022931`, `20261008022946`,
  `20261008023101`. Não reaplicar cegamente arquivos locais com outros timestamps.

## Condições obrigatórias antes de marcar a janela

1. Convite e recuperação recebidos, aceitos, senha definida pelo destinatário,
   logout/login e rejeição de reutilização comprovados no staging e Preview.
2. Preview de commit identificado, usando somente staging; testar as roles,
   A→B, anon, Master, Equipe e chamadas diretas. Registrar URL e SHA.
3. Aprovação humana do código, deste plano e do rollback. Decidir explicitamente
   as limitações de employee no JSON `all_data`, faturas empresariais e funções
   de Master ainda indisponíveis. Não ampliar grants para contornar limitações.
4. Revisar SMTP de Production, remetente/domínio verificado e credencial própria.
   `onboarding@resend.dev` para a caixa de teste não aprova entrega a clientes.
5. Conferir estado atual: dados podem ter mudado desde as contagens acima.
   Não assumir que ainda são fictícios ou que Auth continua vazio.
6. Definir manutenção que interrompa todos os escritores da aplicação e jobs,
   e um candidato anterior compatível com Auth/RLS fechado para rollback.
   O login legado da main não é esse candidato. Esses mecanismos precisam
   estar preparados e ensaiados antes da janela; não foram criados nesta execução.
7. Responsável com acesso para restaurar backup e para operar Vercel/Supabase;
   confirmar direitos/plano necessários. Se exigir cobrança ou upgrade, parar.

## Ordem operacional futura

| Etapa | Ação e critério de avanço |
|---|---|
| 1 — estado anterior | Registrar Current deployment/commit/domínios, nomes e escopos de variáveis, configurações Auth/SMTP, histórico de migrations, schema, ACL de tabelas/colunas/sequences/functions, default privileges, policies, triggers e índices. Guardar configurações secretas somente no cofre privado, fora do Git. |
| 2 — manutenção e backup | Bloquear escritores/jobs; verificar que não há escrita concorrente. Fazer backup lógico consistente, criptografado e fora do repo, incluindo public/private, dados Auth/identities, histórico de migrations, ACL e sequences. Inventariar Storage separadamente: dump do banco não copia os objetos binários. Registrar contagens/checksums e manifest de cobertura. Ensaiar restauração local isolada com outbound e jobs desligados; nunca carregar o backup de Production no staging compartilhado de testes. |
| 3 — migrations | Comparar a fundação remota com os três arquivos de `supabase/migrations/202610080203*.sql`. As três já constam em Production. Aplicar somente diferenças aprovadas que realmente faltem, por migration revisada. Não aplicar `supabase/baseline/staging-application-baseline.sql`, não criar fixtures e não executar reset/db push irrestrito. O cutover não faz parte das migrations automáticas. |
| 4 — dados existentes | Classificar os dados existentes com o responsável. Preservar IDs e payloads. Mapear a company hoje sem tenant_id ao tenant comprovado, por operação revisada; abortar se a associação for ambígua. Validar tenant_data.tenant_id/tenant_slug/FKs e ausência de registros órfãos. Não excluir dados fictícios automaticamente. Não converter senha/hash legado em credencial Auth. |
| 5 — variáveis | Configurar somente escopo Production com a matriz abaixo, usando as credenciais próprias de handyhub-db. Não misturar Preview/Development. Validar o candidato antes de atribuir domínio público. |
| 6 — Auth e e-mail | Configurar Site URL e callback exatos abaixo; instalar os templates token_hash revisados. Habilitar flag de convite somente após verificar template. Configurar SMTP próprio de Production e limites; testar uma caixa explicitamente autorizada, sem envio em massa. |
| 7 — primeiro administrador | Identificar a pessoa responsável. Convidar/provisionar pela API administrativa Auth de Production, usando servidor/cofre; ela confirma e define sua senha. Consultar o UUID confirmado no Auth e registrar esse UUID em platform_admins pelo caminho privilegiado. Não usar metadata, parâmetro de URL, localStorage ou literal Master. Verificar login e privilégio desse UID. |
| 8 — memberships | Para cada tenant existente, verificar o proprietário e seu UUID Auth confirmado; criar membership owner ativa por caminho privilegiado revisado. Conferir tenant/UID/cargo com o responsável. Provisionar manager/employee apenas se solicitado. Platform admin não recebe associação empresarial implícita. Garantir owner confirmado para TODOS os tenants. |
| 9 — código compatível | Construir o SHA aprovado com variáveis Production próprias, mantendo manutenção e sem liberar tráfego ao candidato. Preparar também um deployment de retorno compatível com Auth/RLS. Validar configuração, sessão e endpoints nesse candidato. Não promover um artefato Preview que carregue credenciais staging. Qualquer merge/deploy futuro exige autorização específica. |
| 10 — último ponto de parada | Confirmar backups/restauração, maintenance, owners/admin confirmados, company mapeada, SMTP, SHA/candidato, rollback e autorização. Se uma condição falhar, não executar o cutover. Registrar operador e instante. |
| 11 — RLS e grants juntos | Na conexão explicitamente verificada de handyhub-db, definir `handyhub.cutover_ready='yes'` e executar `supabase/activation/camada-1-cutover.sql` na MESMA sessão, com stop on error. O script faz BEGIN, locks, valida associações/admin, liga RLS e altera grants/default privileges, e só depois COMMIT. Não separar essas alterações em deploys/migrations distintos. Timeout/erro deve resultar em ROLLBACK, não em continuação manual parcial. |
| 12 — inspeção imediata | Conferir flags RLS, 13 policies e ACL reais contra o staging. FORCE permanece desligado por decisão documentada; roles API não são owners/BYPASSRLS. service_role continua exclusivamente server-side. Conferir que anon perdeu CRUD e que authenticated não acessa logins/invoices/status por caminho indevido. |
| 13 — domínio e smoke | Somente com banco fechado e candidato compatível, liberar o domínio ao deployment aprovado. Executar a matriz abaixo; liberar manutenção apenas quando ela passar. Registrar URL, deployment, SHA, ref e resultados sanitizados. Observar logs de erros Auth/403/42501/5xx sem imprimir tokens. |
| 14 — fechamento | Registrar backup final de metadados/associações e resultados; manter rollback disponível e monitorar. Não apagar backups, contas ou dados antigos nesta janela. |

### Variáveis futuras de Production — nomes, sem secrets

| Nome | Destino/uso |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | URL pública de qmfwsnhpmsonndhgqsyi |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Chave pública própria de Production, role anon/publishable |
| NEXT_PUBLIC_APP_ENV | `production`, consistente com VERCEL_ENV |
| SUPABASE_SERVICE_ROLE_KEY | Secret própria de Production, somente servidor |
| NEXT_PUBLIC_SITE_URL | `https://www.handyhub.com.br` |
| AUTH_INVITE_TEMPLATE_MODE | `token_hash`, depois de conferir template e URL |

SMTP password é configurada privadamente no painel Supabase Auth, não é variável
pública nem segredo a ser copiado do staging. Nenhum valor secreto neste plano.

### URLs e templates futuros

Site URL: `https://www.handyhub.com.br`.
Allowlist: `https://www.handyhub.com.br/auth/callback`, sem wildcard e sem localhost.
Invite usa `.RedirectTo` + `token_hash` + `type=invite`; recovery usa `.SiteURL`
com `/auth/callback`, `token_hash` e `type=recovery`. GET exibe confirmação;
POST consome OTP e remove token da URL. Após confirmação, a própria pessoa define
a senha. Desabilitar rastreamento/regravação dos links no provedor utilizado.

### Smoke tests antes de liberar manutenção

- Login/logout, refresh e sessão persistente; sem membership não vê empresas.
- Owner A acessa e altera campo permitido de A; manager opera somente A;
  employee lê A e não obtém privilégio administrativo/escrita genérica.
- A→B/B→A: SELECT vazio/negado e UPDATE/DELETE zero linhas, confirmando que B/A
  não mudaram. INSERT/transferência estrangeira rejeitados. Usar apenas tenants
  de teste autorizados; nunca explorar dados de clientes reais.
- Anon negado nas cinco tabelas e Master 401; usuário comum Master 403.
- Platform admin Master permitido; fatura/status apenas pelo servidor autorizado.
- Equipe com UID/membership real e tenant correto; parâmetros/caches não ampliam acesso.
- Usuário com múltiplas memberships vê somente as associações registradas.
- Convite recebido, confirmação, senha própria, membership, logout/login;
  recuperação recebida, troca de senha, login novo e reutilização negada.
- Chave privilegiada ausente de JS/browser; erros críticos não anunciam sucesso.

Os usuários/tenants sintéticos para esse smoke de Production requerem autorização
própria na futura janela. Não reutilizar contas/chaves staging nem testar clientes.

## Backup e critérios de aborto

O plano Free não é evidência de PITR/backup automático contratado. Fazer exportação
própria e prova de restauração. A cobertura de Auth, policies personalizadas em
schemas gerenciados e Storage precisa ser conferida no manifest; não presumir
que um dump default contém tudo. Referências:
[Supabase — backups](https://supabase.com/docs/guides/platform/backups) e
[backup/restauração via CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

Parar para rollback seguro em falha de autenticação administrativa, owner legítimo
sem acesso, escrita estrangeira permitida, anon permitido, erro de config/ref,
vazamento de secret, SMTP sem entrega, ou candidato/deploy indisponível.
O procedimento está no [plano de rollback](camada-1c-rollback-plan.md).

Este documento prepara a ordem; backup, ensaio de restauração, bootstrap,
manutenção, SMTP Production e deployments de retorno NÃO foram executados.
