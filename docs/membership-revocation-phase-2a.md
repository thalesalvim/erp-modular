# Fase 2A — revisão e revogação explícita de memberships

Base: `8846fb88ba8f0aa6b4238d7c8dc234e60c80b260`, branch
`codex/tenant-permissions-phase-2a`. Implementação somente local, sem aplicação remota.

## Causa-raiz e decisão

Uma membership é uma autorização empresarial por `(tenant_id,user_id)` Auth. Ela pode
ser legítima antes de existir cadastro operacional/vínculo de colaborador. Desativar um
cadastro sem vínculo não identifica a conta a revogar. Nomes e semelhanças de e-mail não
comprovam identidade, e bloquear toda conta sem vínculo destruiria acessos legítimos.

A solução é revisão explícita pelo Owner do tenant e revogação por UUID, independente
de vínculo operacional. Nenhum backfill, associação automática, ban Auth ou alteração
de papel é executado. Owners sem perfil e contas pendentes permanecem como estavam.
O fluxo provisório de 24 horas não foi implementado.

## Processo autorizado

1. Owner ativo no tenant ativo chama `erp_review_memberships(p_tenant uuid)`.
   Retorno fixo: `user_id uuid`, `role text`, `is_active boolean`,
   `activity_revision bigint`, `employee_id uuid` nullable, `is_revoked boolean`.
   Sem e-mail, senha, dados Auth privados ou inferência por nome. `employee_id=NULL`
   significa ausência de vínculo verificado, não irregularidade ou conta não confirmada.
2. Owner confere a identidade UUID e a necessidade de acesso por processo autorizado.
   A RPC não verifica identidade humana nem aprovação documental. A listagem não altera
   estados e não informa confirmação de e-mail. Essa verificação é separada.
3. Owner escolhe explicitamente o alvo e chama
   `erp_revoke_membership(p_tenant uuid,p_user uuid,p_expected_revision bigint,p_reason text)`.
   Motivos permitidos: `identity_review`, `offboarding`, `access_removed`. Sem texto
   pessoal livre. Retorno: `user_id uuid`, `is_active boolean` (false),
   `activity_revision bigint`. Não aceita ator, papel ou cadastro por parâmetros.
4. Depois da confirmação, novas consultas sob READ COMMITTED reavaliam a membership.
   Tratar `42501 ACCESS_DENIED/MEMBERSHIP_REVOKED`, `40001 MEMBERSHIP_CONFLICT` e `22023`
   como erros, nunca sucesso; recarregar/revisar conflitos, sem retry automático.

A RPC não revoga Owners nem o próprio ator. Manager, Employee, Master isolado e anon
não podem revisar ou revogar. Um Master que também seja Owner segue a autorização
empresarial de Owner. Os privilégios de plataforma não são modificados por essa operação.

## Atomicidade, auditoria e defesa no banco

Lock da membership Owner com SHARE, depois da membership-alvo com UPDATE. A revisão
esperada deve coincidir com `activity_revision`; atualização incrementa o contador pelo
trigger existente. O mesmo UUID/tenant é usado no marcador privado e na auditoria.
Revogação explícita de uma membership já inativa também incrementa revisão e registra
intenção, impedindo que uma autorização antiga de restauração de lifecycle a reative.

A transação grava marcador persistente, desativa membership e registra ator, motivo,
estado anterior, revisão anterior/nova e timestamp. Erro desfaz tudo. A auditoria é
imutável para UPDATE/DELETE/TRUNCATE e as FKs RESTRICT preservam identidades/dependências.
Vendas, agendamentos, snapshots, vínculos, conta Auth e platform_admins não são editados.

Trigger independente recusa `is_active=true` enquanto existir marcador de revogação,
inclusive upsert técnico. FK RESTRICT impede excluir/recriar ou trocar UUID/tenant da
membership para contornar a revogação. Authenticated/service_role não acessam marcadores
ou auditoria diretamente. RPCs usam papel NOLOGIN, sem SUPERUSER/BYPASSRLS, grants de
colunas mínimos, RLS e search_path vazio. Não recebem permissões de escrita em Auth,
tenants, platform_admins, vínculos ou papéis da membership. Metadata de revogação tem
RLS habilitada; helper de trigger é propriedade do operador confiável de migrations,
sem EXECUTE público e sem depender de credencial privilegiada operacional.

A restauração explícita está implementada em `20261012020100_erp_membership_restoration.sql`
e documentada abaixo. Não usar UPDATE manual, upsert ou exclusão/recriação como atalho.
O cadastro operacional pode permanecer ativo após revogar sua conta empresarial: isso
não transfere registros nem proíbe o Owner de registrar operações autorizadas em seu nome.
Desativação operacional continua sendo comando separado.

## Compatibilidade e limites

- Nenhuma membership é revogada automaticamente, inclusive pendente ou sem vínculo.
- Uma conta revogada perde acesso de negócio normalizado e legado via membership.
  Login global, memberships em outras empresas e Master continuam independentes.
- Master ainda pode ler JSON pela policy de plataforma legada. Isso não é revogação
  global e não corrige a vulnerabilidade alta do JSON, que permanece aberta.
- O próprio usuário pode consultar sua linha de membership conforme policy legada;
  isso mostra estado da associação e não concede acesso às operações empresariais.
- Sessões/consultas já iniciadas e dados já recebidos não são apagados retroativamente.
- Fluxos existentes de ativação/upsert de uma conta explicitamente revogada passam a
  falhar em vez de desfazer o bloqueio. Integração HTTP/UI e mensagem de suporte pendentes.
- Manutenção bloqueia review/revoke; novos metadados entram nos locks de recuperação
  e em triggers de manutenção. Retomada continua sem restaurar grants do JSON.
- Operador DB proprietário/superusuário pode alterar DDL: essa autoridade administrativa
  não é concedida ao cliente nem modelada como um caminho operacional permitido.

## Testes locais e reprodução

```sh
python3 scripts/test-membership-revocation.py
python3 scripts/test-employee-lifecycle.py
```

O primeiro comando cobre: vínculo desativado e restauração obsoleta; ausência de vínculo;
review/revogação Owner; Manager/Employee/anon negados; outro tenant/UUID inexistente;
Owner sem cadastro; estado pendente preservado; Master independente; upsert/recriação
negados; zero linhas em 27 tabelas e operações/RPCs negadas; conflito/rollback; auditoria
imutável; duas conexões com mesma revisão; manutenção/recuperação.

Auth local é stub com UUID e `email_confirmed_at`; o cenário pendente prova preservação
de estado, não emissão/validação real de JWT nem o fluxo de e-mail Supabase. Identidades
sintéticas em PostgreSQL 17.11 descartável, sem rede/portas, imagem fixada. PGlite não é
usado como substituto da prova concorrente multi-backend.

Evidências desta execução:

| Verificação | Resultado |
| --- | --- |
| PostgreSQL 17.11, 14 cenários novos, incluindo duas conexões | APROVADO |
| PostgreSQL 17.11, regressão lifecycle/recovery, 14 cenários | APROVADO |
| Teste afetado reexecutado com reativação service_role e troca técnica de UUID/tenant | APROVADO |
| PGlite, 22 regressões de RLS/contratos/permissões | APROVADO |
| Lint da fixture alterada e conferência de diferenças | APROVADO |
| JWT/Auth real, staging, produção e HTTP/UI | NÃO TESTADO |

Logs locais: `/tmp/handyhub-membership-revocation.log`,
`/tmp/handyhub-membership-lifecycle-regression.log`,
`/tmp/handyhub-membership-bypass-final.log`, `/tmp/handyhub-membership-pglite.log`
e `/tmp/handyhub-membership-lint.log`. TypeScript/build não repetidos: contratos TS,
aplicação e dependências não foram alterados. O primeiro ensaio teve erro no setup
do teste, antes de executar cenários; o harness foi corrigido e as execuções finais
acima passaram. Nenhum teste falho foi contabilizado como aprovado.

Pendências para auditoria consolidada: executor e ACLs reais do Supabase, JWT/Auth real,
integração segura das RPCs, processo humano de revisão UUID, revisão independente da restauração,
tratamento de solicitações de exclusão/retenção e correção do JSON legado. Não há
aprovação da Fase 2A nem da Camada 1C por este documento.

## Restauração autorizada — correção do bloqueio operacional

`erp_restore_membership(p_tenant uuid,p_user uuid,p_expected_revision bigint,
p_confirm boolean,p_permissions text[],p_expected_employee uuid)` retorna
`user_id`, `is_active` e `activity_revision`. Somente Owner ativo do mesmo tenant ativo.
Confirmação deve ser true e permissões devem ser explicitamente informadas, sem null,
duplicatas, nomes desconhecidos ou permissões de escrita. Array vazio é permitido e
restaura a membership sem conceder leitura de negócio normalizada.

O vínculo atual deve corresponder ao UUID de colaborador confirmado pelo Owner; null
significa que o Owner revisou explicitamente a ausência de vínculo. Não criamos vínculo
nem inferimos identidade. Perfil vinculado inativo impede a restauração. Alterar/remover
um vínculo de membership revogada é bloqueado também no provisionamento técnico.

A revisão esperada deve coincidir tanto com a membership atual como com a última revisão
de revogação registrada. Qualquer atualização independente posterior, inclusive novo
bloqueio false ou mudança de cargo, gera conflito e não é sobrescrita. Não usar nova
revogação apenas para apagar evidência de outro bloqueio; um conflito exige investigar
sua origem. Confirmação do Owner é decisão de autorização, não prova automática de
identidade humana. Ban/exclusão Auth e privilégios Master não são alterados nem contornados.

Cada permissão confirmada deve ser leitura delegável ao cargo atual e estar no conjunto
atualmente habilitado pelo Owner para esse cargo. O marcador permanece, com estado de
revogação false e teto individual de permissões; `erp_can` cruza esse teto com os grants
atuais a cada nova consulta. Alterar grants de cargo depois não amplia o teto confirmado;
revogar um grant de cargo continua retirando o acesso. Não copiamos grants históricos,
não alteramos cargos, não concedemos Owner ou Master. O teto não é uma nova implementação
geral de permissões individuais: aplica-se somente às memberships explicitamente revisadas
por este fluxo de recuperação.

Locks: membership Owner SHARE → colaborador vinculado SHARE → membership-alvo UPDATE,
compatíveis com o lifecycle. Restauração altera marcador, membership e auditoria na mesma
transação. Auditoria registra ação revoke/restore, estado anterior/próximo, revisões,
permissões confirmadas, ator e motivo `authorized_restore`; eventos antigos permanecem.
Nova revogação limpa o teto, registra nova revisão e exige nova confirmação para restaurar.
Erros desfazem tudo. Não há flag de bypass de cliente nem remoção de histórico.

O JSON legado não suporta o teto individual: uma policy RESTRICTIVE fecha o payload para
essas memberships, inclusive após restauração. Master permanece exceção independente da
policy de plataforma existente. Policies anteriores e grants legados não são ampliados.
A UI atual depende do JSON, portanto uma restauração segura do acesso normalizado não
promete restabelecer a UI legada; integração segura permanece fora do escopo. A exposição
alta do JSON para outras contas ainda não revisadas continua aberta.

Reprodução adicional:

```sh
python3 scripts/test-membership-restoration.py
node --test tests/tenant-domain-rls.test.mjs
```

Cenários: restauração mínima/autorizada, teto vazio, conflito e bloqueio independente,
colaborador inativo, UUID de vínculo incorreto, Manager/Employee/anon/outro tenant,
confirmação falsa, escalada e grants removidos, Auth/Master preservados, rollback e
nova revogação. A suite de revogação mantém testes de duas conexões, upsert, troca de
UUID/tenant e imutabilidade. Nenhuma confirmação de e-mail/JWT real é presumida.

### Evidências finais da restauração

| Verificação local | Resultado |
| --- | --- |
| PostgreSQL 17.11: 14 testes de restauração, incluindo duas conexões | APROVADO |
| PostgreSQL 17.11: 14 regressões de revogação | APROVADO |
| PostgreSQL 17.11: 14 regressões lifecycle/recovery e snapshots preservados | APROVADO |
| PGlite: 22 regressões de RLS/contratos/permissões | APROVADO |
| Lint dos dois arquivos JavaScript afetados | APROVADO |

Bloqueio anterior à primeira revogação deixa `restore_allowed=false`. Atualização
independente após revogação invalida a revisão; repetir a revogação conserva a restrição
em vez de emitir uma autorização limpa de restauração. Esses casos requerem investigar
origem e autoridade do bloqueio, e não uma reativação informal. Não há ferramenta genérica
para remover bloqueios de outros fluxos nesta entrega.

PostgreSQL exige também policy UPDATE para o lock SHARE do colaborador. O papel NOLOGIN
recebe somente UPDATE(version) com policy Owner; o comando não executa UPDATE nessa tabela.
Nenhum cliente recebe esse privilégio nem pode assumir o papel.

Ensaios iniciais falharam por ambiguidade ON CONFLICT, ausência de policy de leitura do
catálogo para o papel restrito e ausência de policy de lock do colaborador. Corrigidos
sem abrir acesso ao cliente; as execuções finais acima passaram. Logs:
`/tmp/handyhub-membership-restoration.log`,
`/tmp/handyhub-restoration-revocation-regression.log`,
`/tmp/handyhub-restoration-lifecycle-regression.log`,
`/tmp/handyhub-restoration-pglite.log` e `/tmp/handyhub-restoration-lint.log`.
Nenhum teste hospedado foi executado. Nota provisória 9,0/10 somente no escopo local;
a revisão independente permanece necessária e a Camada 1C continua reprovada.
