# Fase 2A — durabilidade do selo, referência v2

Base `32b436adc44a4ee720b43cdb86d74d808dac436f`, branch
`codex/tenant-permissions-phase-2a`. Somente implementação e testes locais;
sem staging/produção, commit, push, deploy ou mudanças HTTP/UI.

## Causa-raiz e solução

O gate anterior fixava tipo da relação, RLS/FORCE, definições e ACLs, mas omitia
`pg_class.relpersistence`. `UNLOGGED` preservava a aparência estrutural e era aceita
na retomada. Os ensaios anteriores comprovaram perda de despesas e de tetos individuais
de autorização após crash. Os logs `/tmp/handyhub-final-durability-crash.log` e
`/tmp/handyhub-final-durability-permissions.log` continuam como evidência histórica;
os crashes não foram repetidos nesta correção.

A migration aditiva `20261012030200_erp_durability_integrity.sql` introduz invariantes
explícitas para **47 tabelas**: todas devem existir no schema esperado, como tabela
ordinária (`relkind='r'`) e permanente (`relpersistence='p'`). Ausência, UNLOGGED ou
tipo indevido produz SQLSTATE `55000`, `RECOVERY_SCHEMA_DRIFT: DURABILITY_INVARIANT`.
Essa expectativa não é inferida da fotografia do banco.

`private.erp_assert_durable_relations()` é SECURITY INVOKER, search_path vazio,
restrita ao operador confiável; sem EXECUTE de PUBLIC/anon/authenticated/service_role.
O nome de schema é explícito: uma tabela temporária homônima não satisfaz o inventário.
O próprio PostgreSQL impede criar TEMP dentro de public/private/auth; isso também foi
ensaiado para evitar confundir uma sombra temporária com a relação real.

A fotografia agora inclui persistência nas entradas `relation/` e `relation-state/`.
`auth.users` recebe uma entrada específica de tipo/persistência: não passamos a
atestar toda a definição interna do Auth gerenciado. As invariantes e o novo formato
participam do digest versionado `7d695927c797983162323c428e392491`.

## Evolução versionada e atômica

A migration anterior já foi publicada no Git e permanece byte a byte intacta.
A atualização v2:

1. Abre transação e obtém lock exclusivo em `erp_runtime_control`, usando a mesma
   coordenação de operação/recuperação; requer janela exclusiva de operador/DDL.
2. Confere integridade e referência v1 antes de mudar definições.
3. Cria `private.erp_recovery_schema_seal_v2`, permanente, com RLS e triggers contra
   UPDATE/DELETE/TRUNCATE. Revoga privilégios dos papéis de aplicação.
4. Instala as invariantes de persistência e a fotografia com a propriedade adicional.
5. Atualiza o verificador ativo para usar a referência v2 e o digest literal revisado.
6. Valida as invariantes/definições antes de gravar a referência v2, verifica novamente
   a integridade completa e confirma a transação.

A referência v1 permanece na tabela original, sem UPDATE, DELETE, TRUNCATE ou perda de
seu snapshot. Ela é evidência histórica, não fallback operacional. A transição foi
ensaiada em banco com dados e membership restaurada limitada; v1 permaneceu idêntica.
Uma falha tardia na migration reverte funções/DDL e não deixa referência v2 parcial.
Isso comprova a evolução v1→v2 desta entrega, não migrations futuras ainda inexistentes.

O digest foi calculado apenas em fixture limpa descartável durante o desenvolvimento,
com invariantes ativas, e validado posteriormente com o literal fixo na migration real.
Não existe RPC de refresh, parâmetro de bypass ou comando que aceite automaticamente
uma fotografia encontrada em recuperação. A atualização não executa SET LOGGED ou
ALTER ROLE para fazer o gate passar. Erro mantém o estado anterior; se havia manutenção
ativa, ela permanece ativa. Falhar na instalação não desativa por si uma aplicação
externa: manter a aplicação suspensa durante a janela de atualização.

Migrations futuras devem preservar a referência anterior e versionar juntas inventário,
definições e nova âncora, com reprodução em instalação limpa e atualização com dados.
Não copiar este digest para uma alteração diferente, nem apagar a referência histórica.
Mudanças de partição/tipo ou versão do PostgreSQL também exigem revisão.

## Inventário exato

Todas as tabelas abaixo são duráveis; o novo selo v2 também está incluído.
Persistência do JSON legado é coberta por retenção, sem corrigir sua exposição.

### Empresariais — 27

- `public.erp_customers`
- `public.erp_customer_contacts`
- `public.erp_customer_notes`
- `public.erp_employees`
- `public.erp_employee_private`
- `public.erp_employee_schedules`
- `public.erp_professional_roles`
- `public.erp_employee_roles`
- `public.erp_products`
- `public.erp_product_costs`
- `public.erp_product_stock`
- `public.erp_services`
- `public.erp_promotions`
- `public.erp_promotion_targets`
- `public.erp_appointments`
- `public.erp_attendances`
- `public.erp_appointment_finance`
- `public.erp_appointment_notes`
- `public.erp_attendance_finance`
- `public.erp_attendance_notes`
- `public.erp_sales`
- `public.erp_sale_customers`
- `public.erp_sale_finance`
- `public.erp_sale_notes`
- `public.erp_stock_moves`
- `public.erp_expenses`
- `public.erp_sale_cmv`

### Metadados — 15

- `private.erp_permission_catalog`
- `private.erp_policy_state`
- `private.erp_role_permissions`
- `private.erp_permission_audit`
- `private.erp_employee_auth_links`
- `private.erp_customer_assignments`
- `private.erp_history_postings`
- `private.erp_runtime_control`
- `private.erp_employee_lifecycle`
- `private.erp_employee_lifecycle_audit`
- `private.erp_recovery_events`
- `private.erp_membership_revocations`
- `private.erp_membership_revocation_audit`
- `private.erp_recovery_schema_seal`
- `private.erp_recovery_schema_seal_v2`

### Identidade e base — 5

- `public.tenants`
- `public.tenant_memberships`
- `public.platform_admins`
- `public.tenant_data`
- `auth.users`

## Evidências reproduzíveis

```bash
python3 scripts/test-recovery-durability.py
python3 scripts/test-recovery-seal-hardening.py
python3 scripts/test-recovery-role-invariants.py
python3 scripts/test-coordinated-recovery.py \
  test_disable_then_revoke_then_joint_recovery \
  test_revoke_then_disable_then_joint_recovery \
  test_independent_block_after_both_survives_rerevocation \
  test_manager_employee_anon_foreign_tenant_and_uuid_denied \
  test_two_connections_recovery_then_stale_deactivation_conflicts \
  test_two_connections_deactivation_serializes_before_recovery \
  test_capability_role_and_membership_drift \
  test_intact_schema_allows_resume_preserving_data
node --test tests/coordinated-recovery.test.mjs
```

| Verificação | Resultado local |
|---|---|
| UNLOGGED em despesas/revogações antes da primeira instalação | v1 aceita como reprodução histórica; v2 recusa preventivamente |
| Atualização de v1 já insegura | Recusa sem conversão automática e sem tabela v2 residual |
| Falha tardia durante evolução v1→v2 | Rollback de DDL/funções; v1 preservada e verificável |
| Evolução legítima com dados e Manager limitado | Dados, referência histórica e teto individual preservados |
| Inventário permanente e presença na fotografia | 47 relações verificadas; inventário ERP comparado ao catálogo real |
| UNLOGGED após selo íntegro | Recusa em 11 tabelas de finanças/metadados/auditoria/referências |
| Relação ausente e sombra TEMP | Recusa; TEMP em schema permanente também é negada pelo PostgreSQL |
| Fotografia adulterada para aceitar UNLOGGED | Invariante independente recusa retomada |
| Owner/Manager/Employee/Master manipulando persistência ou selo | Negados |
| Retomada íntegra | Aceita; JSON continua sem grants após manutenção |
| A/B1/B2/B3 | Regressões focadas aprovadas |
| Supabase hospedado e recuperação real de backup | NÃO TESTADO |

Contagem: **10 cenários novos PostgreSQL 17.11**, com subcasos (não contar cada linha
como teste novo), mais **19 B1/B2**, **15 B3** e **8 A**. PGlite 17.5/WASM: **5 testes**,
incluindo agrupador; não equivale a prova de sessões concorrentes/pool hospedado.
Logs `/tmp/handyhub-durability-final.log`, `handyhub-durability-b1b2.log`,
`handyhub-durability-b3.log`, `handyhub-durability-a.log`, `handyhub-durability-pglite.log`.

A enumeração inicial do teste não aceitava o dígito de `seal_v2`; o teste foi corrigido
para incluir a 47ª relação e reexecutado. Nenhuma regra de segurança foi removida.
A suíte histórica anterior ao primeiro selo foi ajustada para omitir também a migration
v2 no preparo: aplicar v2 sem seu pré-requisito v1 seria um fixture inválido. Os ensaios
após instalação usam a sequência completa das 17 migrations.

## Riscos residuais e operação

- `relpersistence='p'` é necessário, mas não certifica fsync, synchronous_commit,
  armazenamento, replicação, PITR ou políticas de backup do provedor. Esses controles
  e a recuperação operacional precisam de validação própria, autorizada.
- Não converter automaticamente uma tabela perdida para permanente: isso não recupera
  registros nem tetos individuais apagados. Se houve crash no estado inseguro, manter
  manutenção e reconciliar dados/auditoria/autorizações a partir de backup confiável.
- A checagem não é monitoramento contínuo e não impede um DBA pleno de mudar objetos
  depois da retomada ou substituir verificadores. Exige controle de DDL, janela exclusiva
  e drenagem de escritores/pool. Não há promessa contra administrador plenamente privilegiado.
- Tabelas permanentes e PK/FKs não substituem manifests de dados, testes de restauração
  ou decisões legais de retenção. Não houve teste hospedado nem migração de dados reais.
- Somente schemas/tabelas listados e objetos previamente cobertos pelo selo são atestados;
  extensões, tabelas externas e toda a arquitetura Auth do provedor não são certificadas.
- A definição do helper compartilhado de fotografia é reproduzida em migration versionada,
  como requerido pelo SQL de evolução; futuras mudanças precisam rever o diff com cuidado.
- A recuperação A conserva SHA256 `82551f51aa2320c19867fd371b694d47acf34b291da58ac80e53bd419c2c8191`.
  O backlog conserva `18860c756cc09b473c1c9aaafcf11dd626aeb0e961db34b9fc4ed29ba87b8d90`.

Arquivos: nova migration v2, novo teste `scripts/test-recovery-durability.py`, este documento,
atualização de `tests/helpers/tenant-domain-fixture.mjs` e do preparo histórico em
`scripts/test-recovery-seal-hardening.py`. Sem contratos HTTP/UI alterados; build/TypeScript
não foram repetidos. Sem commit/push.

**Nota provisória 9,2/10 no escopo local da correção:** recusa preventiva, evolução versionada
atômica e preservação do teto individual comprovadas; regressões preservadas. Sem falha
crítica/alta identificada ou bloqueio operacional no escopo testado. Aguardar revisão
independente; esta nota não substitui novo gate consolidado nem validação hospedada.
O JSON legado permanece vulnerável e a Camada 1C permanece reprovada.
