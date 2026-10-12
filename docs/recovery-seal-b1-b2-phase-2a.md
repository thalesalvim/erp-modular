# Fase 2A — correções B1/B2 do selo

> Registro histórico B1/B2. A revisão independente encontrou B3; a referência atual
> e suas invariantes de papéis estão em [correção B3](recovery-role-invariants-b3-phase-2a.md).

Base `5b4e7cc4be511cc002ed49ccbc5c8126f19cc91e`, branch
`codex/tenant-permissions-phase-2a`. Esta entrega substitui a avaliação anterior do
selo; a recuperação coordenada A não foi modificada. Sem acesso remoto, dados reais,
commit, push, deploy, contratos HTTP/UI ou Fase 2B.

## Causas-raiz e reprodução anterior

**B1:** o digest de instalação não incluía as entradas `relation/`, que continham RLS
 e FORCE. Uma tabela com RLS desabilitado podia virar referência confiável. A comparação
posterior era consistente com uma referência insegura. Antes desta alteração, a prova
independente confirmou instalação/retomada aceitas e leitura de três linhas financeiras
em três tenants sintéticos por uma identidade sem membership.

**B2:** definição e `tgenabled` não determinam sozinhos a execução de um trigger. Com
`session_replication_role=replica`, triggers origin são ignorados. Defaults podem afetar
conexões novas; reparar um default não corrige automaticamente conexões abertas. Antes
da alteração, a prova independente confirmou retomada e duas escritas com a mesma versão.

Reprodução prévia: `/tmp/handyhub-b1b2-before.log`, PostgreSQL 17.11 real. As assertivas
dessas duas provas esperavam o defeito; seu `OK` não era uma aprovação de segurança.

## B1 — invariantes independentes da fotografia

A migration B ainda não publicada foi corrigida no próprio arquivo. Nenhuma migration
anterior versionada foi reescrita ou aplicada remotamente.

- `erp_assert_security_invariants` contém uma lista explícita das **27 tabelas empresariais**:
  todas precisam existir como tabelas ordinárias, com **RLS e FORCE RLS ativos**, inclusive
  `erp_sale_finance`. Essa condição não é aprendida da instalação corrente.
- As **14 tabelas privadas** têm expectativas explícitas: RLS ativo, sem FORCE para os
  metadados lidos pelos helpers proprietários; a exceção preexistente é
  `erp_history_postings`, que exige FORCE. Não alteramos essa arquitetura.
- Papéis de aplicação ou capability não podem ser proprietários das tabelas ERP.
- O digest versionado agora cobre também estado RLS/FORCE/tipo das relações, definições
  de colunas, ownership normalizado e o catálogo estático de permissões. Permanecem
  triggers/estado, policies, grants ERP, constraints, índices, funções e papéis técnicos.
- `erp_assert_reviewed_definitions` confere a referência aprovada **na instalação e em
  cada verificação/retomada**, antes de confiar na fotografia armazenada. Portanto,
  substituir apenas a fotografia após mudar uma policy não promove a mudança a aprovada.
- Para evitar hash autorreferente, somente o corpo do próprio verificador com o digest
  literal é excluído desse digest. Sua definição real, owner e ACL continuam na fotografia
  completa. O verificador versionado é uma âncora de confiança; não resiste a um DBA que
  substitua também essa âncora deliberadamente.
- A identidade do instalador é normalizada como `@metadata-owner` na referência portátil;
  owners/ACLs reais continuam fixados na fotografia da instalação. Detalhes específicos
  do provedor exigem revisão hospedada, não aceitação automática.

Digest revisado localmente: `32de635e795a3b9b977dda6f92060b33`. Gerado exclusivamente da
sequência limpa de migrations em banco descartável, com invariantes ativas, e posteriormente
validado com o digest fixo na instalação real dos testes PostgreSQL e PGlite. Não existe
comando operacional para recalculá-lo a partir de um banco em recuperação.

O selo também continua comparando owners/ACLs reais, colunas/defaults, schemas, default
privileges e memberships dos papéis cobertos. Triggers internos de FKs têm suas constraints
comparadas e seu estado desabilitado verificado pelo check anterior. Não se promete inventário
completo de toda função/extensão/configuração do provedor: Auth gerenciado e funções fora do
escopo ERP não são atestados por este mecanismo.

## B2 — execução segura e conexões antigas

`erp_assert_execution_safety` recusa:

1. Modo efetivo da sessão diferente de `origin`, inclusive `local` por política conservadora.
2. `pg_settings.reset_val` inseguro, mesmo quando um `SET origin` mascara o default herdado
   ou do servidor na sessão administrativa atual.
3. Defaults de `pg_db_role_setting` diferentes de origin que se apliquem ao banco atual:
   banco, papel global ou combinação papel/banco. Um default inseguro mascarado por outro
   mais específico seguro também é recusado. Defaults exclusivos de outros bancos ficam fora.
4. Privilégios `SET` **ou `ALTER SYSTEM`** sobre o parâmetro alcançáveis por anon,
   authenticated, service_role, authenticator (quando existente) ou roles `handyhub_*`.
   A análise inclui herança e caminhos `SET ROLE`, inclusive NOINHERIT com SET permitido.

Não há ajuste automático de parâmetros, privilégios ou defaults para fazer o gate passar.
Erros `55000`: `RECOVERY_UNSAFE_SESSION_MODE`, `RECOVERY_UNSAFE_REPLICATION_DEFAULT` ou
`RECOVERY_UNSAFE_PARAMETER_PRIVILEGE`. Divergências estruturais continuam como
`RECOVERY_SCHEMA_DRIFT`, com detalhe `RLS_INVARIANT`, `METADATA_RLS_INVARIANT` ou
`RECOVERY_UNREVIEWED_SCHEMA`, conforme a causa.

### Proteção da aplicação independente dos triggers

Checar apenas a conexão que retoma seria insuficiente. `erp_runtime_available` agora
exige `current_setting('session_replication_role')='origin'` a cada comando. Os helpers
RLS e RPCs que usam `erp_can`/`erp_is_self`/`has_tenant_role` passam por essa condição.
Uma conexão antiga ainda em replica perde leituras empresariais e tem escritas recusadas.
Não há parâmetro de bypass nem dependência de um trigger para aplicar essa negação.

A RPC de delegação `erp_set_role_permissions` tem owner técnico e consultas diretas, sem
passar pelo helper de autorização no início. Por isso recebeu a mesma checagem explícita
antes de qualquer operação (`55000 ERP_RUNTIME_UNAVAILABLE`). Assinatura, regras de negócio,
permissões, auditoria e contratos externos permanecem os mesmos. A RPC coordenada A ficou
**byte a byte intacta**; a proteção é recebida pelo helper compartilhado.

As ACLs de escrita direta permanecem fechadas. Não se afirma que essa barreira limita um
superusuário/BYPASSRLS com privilégios de escrita direta nem que ela substitui Auth global.
A exceção Master preexistente no legado não foi ampliada nem usada para acesso operacional.

## Operação, reparação e evolução versionada

- Implantação/reparação futura exige autorização própria, janela exclusiva de administração,
  drenagem de escritores/pool e backup/manifestos. Nenhuma dessas ações foi feita remotamente.
- Falha de instalação não repara RLS previamente quebrado. Manter manutenção e aplicação
  suspensa; corrigir o objeto autorizado contra migrations revisadas, sem aceitar a fotografia
  ruim. Não usar o script antigo de retomada para contornar a recusa.
- Reparar defaults e ACLs com alteração administrativa específica aprovada; depois usar uma
  **nova conexão administrativa**. Uma conexão anterior pode manter modo/reset_val antigos.
- Descartar/recriar conexões do pool e verificar seu modo efetivo. Enquanto persistirem conexões
  antigas em replica, as RPCs/RLS normalizadas desta entrega negam suas operações; isso pode
  produzir indisponibilidade parcial, jamais conversão silenciosa para sucesso.
- Reexecutar a verificação de esquema/dados e retomar somente se íntegra. JSON legado continua
  sem grants após o procedimento de manutenção; nenhum fallback foi reaberto.
- Não desabilitar triggers no procedimento normal. O uso de replica para adulterar a fotografia
  existe somente em um teste adversarial no banco descartável.
- Migrations legítimas futuras devem versionar juntas a alteração de esquema, as invariantes,
  a âncora/digest revisados e a evolução da referência, preservando a anterior para auditoria.
  Sem API pública de refresh, flag de bypass ou aprendizagem automática do estado corrente.
  A referência atual é imutável; sua evolução será DDL deliberado em migration revisada, não
  uma opção do script de recuperação. Nenhuma rotação futura foi implementada nesta entrega.
- Uma mudança posterior de DBA, configuração ainda não carregada pelo servidor ou troca de
  verificador não pode ser impedida pelo selo. A barreira por conexão reduz a exposição de
  operações da aplicação quando o modo efetivo muda, mas não é resistência a administrador
  plenamente privilegiado. Gestão de privilégios, controle de DDL e monitoramento continuam necessários.

A política de defaults é conservadora: até um role de manutenção com default replica aplicável
pode impedir retomada. Não afrouxar a regra sem nova análise. Supavisor/PgBouncer hospedados,
roles gerenciados e parâmetros inacessíveis ainda precisam ser verificados com autorização.
Se o provedor não permitir confirmar/corrigir esses requisitos, a aprovação hospedada fica
bloqueada; os testes locais não substituem essa evidência.

## Evidências reproduzíveis

```bash
python3 scripts/test-recovery-seal-hardening.py
python3 scripts/test-coordinated-recovery.py
node --test tests/coordinated-recovery.test.mjs tests/employee-lifecycle.test.mjs tests/tenant-domain-rls.test.mjs
```

PostgreSQL real 17.11: imagem fixada pelo harness, containers sem rede/portas publicadas,
volume temporário, somente identidades sintéticas; containers removidos ao terminar.

| Verificação | Evidência | Resultado |
|---|---|---|
| RLS e FORCE antes da instalação, nas 27 tabelas públicas | 54 alterações negativas; instalação rejeitada | APROVADO |
| Metadados, exceção FORCE do histórico, policy, coluna, catálogo e owner divergentes | Referência insegura rejeitada | APROVADO |
| Instalação íntegra | 16 migrations; verificação e retomada aceitas | APROVADO |
| Fotografia substituída após policy/FORCE indevidos | Âncora independente recusa retomada | APROVADO |
| Trigger removido, desabilitado ou redefinido | Retomada recusada, manutenção preservada | APROVADO |
| Banco/papel/papel+banco e override aparentemente seguro | Defaults perigosos detectados | APROVADO |
| Default do servidor por ALTER SYSTEM | SET origin não mascara reset_val perigoso | APROVADO |
| Login real novo com default de papel/banco | Nova conexão herda replica e gate recusa | APROVADO |
| SET/ALTER SYSTEM, PUBLIC e caminho NOINHERIT/SET ROLE | Privilégios perigosos detectados | APROVADO |
| Papéis não administrativos | Sem edição de selo, verificador ou parâmetro | APROVADO |
| Conexão persistente ainda replica após reparo e retomada | RPC recusada; nova conexão segura escreve com CAS correto | APROVADO |
| Comando preparado executado em origin e reutilizado após troca para replica | Segunda execução negada antes do CAS; só a primeira incrementa versão | APROVADO |
| Leituras e delegação em sessão replica | Zero linhas / comando recusado | APROVADO |
| Reparação explícita local e retomada | Manutenção encerrada, JSON continua fechado | APROVADO |
| Recuperação A, atomicidade, histórico e concorrência | Regressões PostgreSQL e hash do arquivo preservado | APROVADO |
| Supabase real, Supavisor/PgBouncer, carga prolongada e migrations futuras completas | Não executados | NÃO TESTADO |

Contagens: **19 cenários B1/B2** (um contém as 54 subverificações RLS/FORCE), **34 regressões
PostgreSQL A/B** e **33 testes PGlite**. Quatro cenários A foram reexecutados após o último
endurecimento dos parâmetros. O cenário de comando preparado também foi reforçado e
reexecutado isoladamente; essas repetições não são contadas como novos cenários únicos.

Logs temporários: `/tmp/handyhub-b1b2-final.log`, `handyhub-b1b2-prepared-final.log`,
`handyhub-b1b2-ab-regression.log`, `handyhub-b1b2-a-final.log`, `handyhub-b1b2-pglite-final.log`.
A primeira rodada exigiu correção do escape da consulta de enumeração no teste; a expectativa
privada foi ajustada à exceção FORCE já existente em `erp_history_postings`. Não houve
remoção de controle para fazer os testes passarem.

PGlite 17.5/WASM aceitou as migrations e o mesmo digest, mas não comprova conexões concorrentes
ou comportamento de um pool hospedado. A conexão persistente, login novo, configurações do
servidor e comando reutilizado foram testados no PostgreSQL real. Nenhum teste simula sucesso
para Supavisor/PgBouncer. Build/TypeScript não foram repetidos: não houve alteração TypeScript/UI.

## Arquivos e avaliação

Alterados nesta execução:
- `supabase/migrations/20261012030100_erp_recovery_integrity.sql`.
- `docs/coordinated-recovery-and-integrity-phase-2a.md` — aviso de substituição desta avaliação.

Criados:
- `scripts/test-recovery-seal-hardening.py`.
- `docs/recovery-seal-b1-b2-phase-2a.md`.

Demais pendências anteriores preservadas. O SHA256 da migration A continua
`82551f51aa2320c19867fd371b694d47acf34b291da58ac80e53bd419c2c8191`; o backlog separado continua
`18860c756cc09b473c1c9aaafcf11dd626aeb0e961db34b9fc4ed29ba87b8d90`.

Nota provisória **9,2/10 no escopo local B1/B2**: ataques reproduzidos antes, recusados depois,
invariantes independentes e proteção de conexões persistentes comprovadas. Nenhuma falha
crítica/alta ou bloqueio operacional relevante identificado no escopo local testado. Faltam
revisão independente e compatibilidade hospedada autorizada; não é aprovação global da Fase 2A.
A vulnerabilidade alta do JSON legado permanece aberta e a **Camada 1C continua reprovada**.
Parar para revisão, sem commit/push.
