# Fase 2A — B3: invariantes dos papéis operacionais

Base `5b4e7cc4be511cc002ed49ccbc5c8126f19cc91e`, branch
`codex/tenant-permissions-phase-2a`. Correção local; sem acesso remoto, commit ou push.
Complementa A/B1/B2, sem alterar a recuperação coordenada A nem o backlog separado.

## Causa e reprodução

O selo anterior fotografava `role/authenticated`, mas sua referência independente
fixava atributos somente dos papéis `handyhub_*`. Uma configuração inicial com
`authenticated BYPASSRLS` podia ser aceita como referência. RLS/FORCE ativos não
limitam um papel com BYPASSRLS. A identidade da aplicação sem membership conseguia
ler dados financeiros de três tenants sintéticos depois da retomada.

O ataque foi reproduzido antes da alteração, em PostgreSQL 17.11 real descartável:
`/tmp/handyhub-b3-before.log`. A falha de asserção nesse log representa o defeito,
não falha de infraestrutura. Alterar o papel exige administrador; a leitura indevida
subsequente não exigia privilégios adicionais do usuário. Não é escalada autônoma de
Owner/Manager/Employee.

## Solução e matriz versionada

A migration B ainda não publicada incorpora `private.erp_assert_operational_roles()`.
Essa função **SECURITY INVOKER**, com `search_path=''`, sem EXECUTE público/cliente,
valida um modelo explícito antes de aceitar a referência e em cada verificação de
retomada. Não consulta a fotografia para decidir se os atributos são seguros.
Seu corpo, owner e grants são cobertos pelo selo. Não executa ALTER ROLE, GRANT,
REVOKE corretivo nem repara automaticamente configurações.

| Papel | Atributos obrigatórios | Memberships |
|---|---|---|
| `anon`, `authenticated` | NOSUPERUSER, NOBYPASSRLS, NOLOGIN, NOCREATEROLE, NOCREATEDB, NOREPLICATION | Nenhuma membership de saída; entrada apenas do broker autorizado ou administrador confiável |
| `authenticator`, quando presente | NOSUPERUSER, NOBYPASSRLS, NOINHERIT, NOCREATEROLE, NOCREATEDB, NOREPLICATION | Pode assumir exclusivamente `anon`, `authenticated`, `service_role`, com SET TRUE, INHERIT FALSE, ADMIN FALSE |
| Cinco papéis técnicos `handyhub_*` listados abaixo | NOSUPERUSER, NOBYPASSRLS, NOLOGIN, NOINHERIT, NOCREATEROLE, NOCREATEDB, NOREPLICATION | Nenhuma aresta de membership de entrada ou saída |
| `service_role` | NOSUPERUSER, NOLOGIN, NOCREATEROLE, NOCREATEDB, NOREPLICATION | BYPASSRLS permitido explicitamente; sem memberships de saída; entrada somente broker/administrador confiável |
| Proprietário confiável dos metadados e superusuários | Fora da identidade operacional; administradores da instalação | Podem ser membros dos quatro papéis padrão acima; a exceção não concede privilégios novos |

Papéis técnicos: `handyhub_product_writer`, `handyhub_own_agenda_reader`,
`handyhub_history_writer`, `handyhub_lifecycle_operator`,
`handyhub_membership_reviewer`. São owners das RPCs/triggers específicos já existentes,
sem LOGIN ou BYPASSRLS. Funções de metadados SECURITY DEFINER continuam sob o
proprietário confiável da instalação, com definições/ownership conferidos pelo selo.
Papéis técnicos adicionais não são automaticamente aprovados pelo digest versionado.

O JWT comum do cliente usa `authenticated`; acesso público usa `anon`. Master é
uma permissão de negócio da identidade autenticada, não um papel PostgreSQL privilegiado.
O broker PostgREST precisa de SET ROLE, inclusive para chamadas administrativas
explicitamente autorizadas com `service_role`. Essa exceção é exclusiva do broker:
`authenticated` não pode assumir `service_role` nem alcançar `authenticator`.
As credenciais do broker/service_role pertencem ao limite administrativo, nunca ao navegador.
Papéis internos do serviço Auth gerenciado não são identidades operacionais das RPCs
ERP e não são alterados. A compatibilidade exata desses papéis depende de auditoria hospedada.

### Herança, troca de papel e direção dos vínculos

SUPERUSER/BYPASSRLS não são herdados como privilégios ordinários. Contudo, SET ROLE
pode assumir um papel que os possua; inversamente, um papel desconhecido com BYPASSRLS
pode herdar os grants SELECT de `authenticated`. Por isso o verificador examina
**as duas direções** das memberships, incluindo ADMIN/INHERIT/SET de cada aresta.

O modelo é fechado: arestas não aprovadas são recusadas mesmo com INHERIT FALSE e
SET FALSE, sem esperar uma mudança futura habilitá-las. Isso impede cadeias indiretas
por um papel intermediário aparentemente inofensivo. INHERIT em `anon`,
`authenticated` e `service_role` pode ser TRUE ou FALSE: sem memberships de saída,
nenhum dos dois estados concede acesso adicional. O broker e os papéis técnicos
obrigatoriamente são NOINHERIT.

A exceção de administrador aceita somente um superusuário ou o proprietário dos
metadados já confiado pela arquitetura, fora do conjunto operacional protegido.
Não aceita qualquer papel arbitrário apenas por possuir BYPASSRLS. Ownership das
tabelas/funções continua sob os controles anteriores; esta entrega não redesenha o
limite de confiança do instalador.

Erros SQLSTATE `55000`, com `RECOVERY_SCHEMA_DRIFT` e detalhes
`RECOVERY_UNSAFE_OPERATIONAL_ROLE` ou `RECOVERY_UNSAFE_ROLE_MEMBERSHIP`.
SUPERUSER também é recusado pelo gate B2 anterior, pois concede implicitamente
privilégios sobre `session_replication_role`; esse caso pode produzir
`RECOVERY_UNSAFE_PARAMETER_PRIVILEGE`. Falha na retomada mantém manutenção ativa.

Referência atual: `3a17fd541f024fdb24f6012e9a839b6d`. Calculada apenas de instalação
limpa local para revisão e depois validada com o literal fixo nas migrations reais.
Não há mecanismo operacional de recalcular/aprender o estado encontrado. O digest
anterior `32de635e795a3b9b977dda6f92060b33` fica como evidência histórica B1/B2.

## Testes e reprodução

```bash
python3 scripts/test-recovery-role-invariants.py
python3 scripts/test-recovery-seal-hardening.py
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

| Verificação | Ambiente / resultado |
|---|---|
| Ataque original authenticated BYPASSRLS | PostgreSQL 17.11: recusado antes de instalar selo |
| authenticated SUPERUSER | PostgreSQL: recusado pelo gate de privilégios B2 |
| anon, authenticator e cinco capabilities com BYPASSRLS | PostgreSQL: todos recusados |
| Capabilities com LOGIN/INHERIT/CREATEROLE/CREATEDB/REPLICATION | PostgreSQL: recusadas 25 combinações |
| Herança e SET ROLE, todas as quatro combinações, caminhos indiretos | PostgreSQL: recusados |
| Papel desconhecido com BYPASSRLS herdando grants operacionais | PostgreSQL: recusado |
| Broker herdando ou administrando service_role; caminho inverso do cliente | PostgreSQL: recusados |
| Papéis administrativos legítimos e broker sintético correto | PostgreSQL: instalação/retomada aceitas |
| Alteração perigosa após selo, inclusive fotografia substituída | PostgreSQL: retomada recusada, manutenção preservada |
| Owner/Manager/Employee/Master alterando papéis ou chamando verificador | PostgreSQL: negados |
| Requests sucessivos numa conexão do broker e outra conexão | PostgreSQL: sem leitura financeira por identidade sem membership; cliente não assume service_role |
| B1/B2: RLS/FORCE, defaults, grants de parâmetros, sessões antigas e comandos preparados | 19 regressões PostgreSQL aprovadas |
| A: ambas as ordens, bloqueios independentes, isolamento, concorrência e auditoria | 8 regressões PostgreSQL aprovadas |
| Instalação/recuperação/retomada com o mesmo digest no PGlite | 5 testes aprovados (inclui teste agrupador) |
| Supabase, Auth gerenciado, Supavisor/PgBouncer reais | NÃO TESTADO |

São **15 cenários B3**, com subcasos; mais **27 regressões PostgreSQL**. Não contar
cada subcaso como cenário independente. Logs: `/tmp/handyhub-b3-final.log`,
`/tmp/handyhub-b3-b1b2-regression.log`, `/tmp/handyhub-b3-a-regression.log` e
`/tmp/handyhub-b3-pglite.log`. PostgreSQL 17.11 em imagem fixada, containers offline,
sem portas publicadas e removidos ao final; somente fixtures sintéticas. PGlite
17.5/WASM não comprova sessões concorrentes ou comportamento hospedado.

A primeira rodada encontrou um erro de comprimento no prefixo dos papéis técnicos
na nova checagem; foi corrigido e toda a suíte B3 reexecutada. Um cenário foi ajustado
para exercitar uma cadeia válida de memberships em vez de um ciclo já proibido pelo
PostgreSQL. Nenhuma expectativa de segurança foi removida.

## Limites, compatibilidade e publicação

- O desenho aceita o modelo PostgREST sintético documentado. `authenticator` pode
  estar ausente no fixture sem PostgREST; quando existir, será obrigatoriamente validado.
- Memberships adicionais de roles gerenciadas/customizadas podem bloquear a instalação
  deliberadamente. Exigem inventário e revisão explícita; não remover vínculos reais
  automaticamente nem acrescentar exceções com base apenas na fotografia.
- Não é prova de compatibilidade com Supabase hospedado, e não houve acesso a ele.
- A checagem acontece na instalação/verificação/retomada. Não é monitoramento contínuo:
  um DBA que habilite BYPASSRLS durante operação pode contornar RLS e a manutenção
  baseada em RLS. Isso exige controlar DDL/roles, janela exclusiva e drenagem de sessões.
  O gate não pode neutralizar um superusuário que substitua o verificador.
- A barreira B2 contra replica permanece; não equivale a barreira contra BYPASSRLS
  concedido por administrador em tempo de operação. Não prometer revogação de sessões
  globais Auth ou de credenciais administrativas por esta migration.
- RLS/FORCE, triggers, políticas e operações comerciais não foram alterados. A migração
  A conserva SHA256 `82551f51aa2320c19867fd371b694d47acf34b291da58ac80e53bd419c2c8191`.
- Sem mudanças TypeScript/UI ou dependências; build e TypeScript não foram repetidos.

Arquivos desta correção: migration B existente, este documento, aviso no documento
B1/B2 e `scripts/test-recovery-role-invariants.py`. Backlog separado intacto, SHA256
`18860c756cc09b473c1c9aaafcf11dd626aeb0e961db34b9fc4ed29ba87b8d90`.

Nota provisória **9,2/10 no escopo B3 local**: configuração inicial insegura recusada,
herança bidirecional coberta, modelo legítimo sintético aceito e regressões preservadas.
Sem falha crítica/alta identificada no escopo testado; não equivale a auditoria
independente nem aprovação hospedada. A exposição alta do JSON legado permanece
aberta e a Camada 1C continua reprovada. Aguardar revisão antes de commit/push.
