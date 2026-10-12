# Fase 2A — recuperação coordenada e integridade da retomada

> Atualização B1/B2: este documento conserva as evidências históricas da primeira entrega A/B.
> A revisão independente reprovou seu selo inicial. A implementação atual, as novas invariantes,
> a proteção por conexão e a avaliação vigente estão em
> [Correções B1/B2](recovery-seal-b1-b2-phase-2a.md). A recuperação A foi preservada.

Base: `5b4e7cc4be511cc002ed49ccbc5c8126f19cc91e`, branch
`codex/tenant-permissions-phase-2a`. Escopo exclusivo dos achados A/B da auditoria
consolidada. Somente PostgreSQL descartável e identidades sintéticas. Sem publicação,
acesso remoto, mudanças de Auth/Master, novas regras comerciais ou integração de telas/APIs.

Arquivos desta entrega (o backlog separado não foi alterado):

- `supabase/migrations/20261012030000_erp_coordinated_recovery.sql` — nova RPC.
- `supabase/migrations/20261012030100_erp_recovery_integrity.sql` — selo e verificação.
- `supabase/recovery/phase-2a-resume-normalized.sql` — validação obrigatória e locks.
- `scripts/test-coordinated-recovery.py` — novos cenários PostgreSQL real.
- `scripts/test-employee-lifecycle.py` — expectativa do novo diagnóstico.
- `tests/coordinated-recovery.test.mjs` — compatibilidade PGlite.
- `tests/helpers/tenant-domain-fixture.mjs` — sequência das duas novas migrations.
- `docs/coordinated-recovery-and-integrity-phase-2a.md` — contrato, procedimento e evidências.

## Causas reproduzidas antes da correção

**A.** Desativar o colaborador grava a revisão da membership que o próprio comando
inativou. Revogar depois incrementa novamente essa revisão. A reativação individual
recusa a revisão diferente (`40001`); a restauração individual recusa o colaborador
inativo (`42501`). A proteção de cada operação estava correta, mas faltava uma
operação conjunta que comprovasse a origem dos dois bloqueios.

**B.** A verificação anterior examinava os triggers existentes e constraints não
validadas. Não detectava um trigger ausente nem comparava sua definição. Remover
`erp_guard_record` de `erp_products` durante manutenção permitia retomar e confirmar
duas alterações com a mesma versão esperada 1, sem incremento de versão.

Ambos foram reproduzidos no PostgreSQL **17.11 real**, sobre as 14 migrations anteriores.
O log local `/tmp/handyhub-audit-before.log` registra os dois comportamentos indevidos;
os testes de reprodução esperavam encontrar o defeito, portanto seu `OK` não era aprovação.

## A — contrato da recuperação coordenada

Nova migration `20261012030000_erp_coordinated_recovery.sql`:

```sql
-- Contrato de chamada preparada; não contém identidades ou dados reais.
SELECT * FROM public.erp_recover_employee_membership(
  $1::uuid,    -- tenant
  $2::uuid,    -- usuário Auth já vinculado
  $3::uuid,    -- colaborador confirmado
  $4::bigint,  -- versão esperada do colaborador
  $5::bigint,  -- revisão esperada da membership
  $6::boolean,-- confirmação explícita: true
  $7::text[]  -- permissões expressamente confirmadas; [] concede nenhuma
);
```

Retorna `employee_id`, `employee_version`, `user_id`, `activity_revision`. Ambas as
versões incrementam uma vez. Sem confirmação ou com parâmetros inválidos: `22023`;
sem autorização: `42501`; versão/identidade/origem dos bloqueios divergente: `40001`.
A futura interface deve recarregar os estados para nova revisão humana, sem retry cego.

- Owner ativo do próprio tenant ativo, com autorização efetiva `employees.update`.
  Manager, Employee, anônimo, outro tenant, Master sem Owner, próprio Owner e outro
  Owner não ganham um caminho de recuperação de proprietário.
- Vínculo privado `(tenant_id, employee_id, auth_user_id)` obrigatório e confirmado.
  Nenhuma associação por nome/e-mail. A operação não resolve vínculos ausentes ou
  divergentes nem altera identidades. Os fluxos existentes para contas legítimas
  sem cadastro operacional permanecem disponíveis separadamente.
- Locks na ordem já usada: membership do Owner, colaborador, membership do alvo.
  Compara ambas as versões após os locks. Concorrência não gera sobrescrita silenciosa.
- Exige perfil inativo, membership revogada/inativa, mesmo vínculo, revisão atual igual
  à da revogação e evento de desativação na versão atual do colaborador.
- **Desativação → revogação:** a revisão registrada pela desativação deve ser seguida
  exclusivamente por revisões consecutivas de revogações auditadas. Uma atualização
  administrativa, inclusive `false → false`, deixa uma lacuna e impede a recuperação.
- **Revogação → desativação:** exige a autorização conservadora `restore_allowed` da
  revogação, sem invalidar as proteções de revisão já existentes.
- Permissões não são copiadas de um estado antigo: array obrigatório, sem duplicatas,
  restrito a permissões de leitura delegáveis ao papel atual e aos grants atuais.
  O teto confirmado continua intersectado com os grants correntes em `erp_can`.
- Limpa apenas os dois bloqueios cuja origem foi comprovada, na mesma transação.
  Os guards de ativação continuam executando; um bloqueio independente que recuse
  a ativação desfaz tudo. Tenant bloqueado e modo de manutenção também negam acesso.
- Registra os eventos de retorno e restauração nas duas auditorias imutáveis existentes,
  com ator, alvo, versões e permissões confirmadas. Falha em qualquer etapa desfaz
  estados, versões e ambos os eventos. Não toca histórico, snapshots ou responsáveis.
- Mantém RLS e o papel `handyhub_membership_reviewer` NOLOGIN/NOBYPASSRLS; acrescenta
  apenas os privilégios privados necessários. Clientes continuam sem escrita direta,
  upsert de reativação, acesso ao papel técnico ou edição dos registros de auditoria.
- Auth global e Platform Admin permanecem independentes. Não desbloqueia Auth nem
  altera confirmação de e-mail, senha, sessões, papel empresarial ou Master. A
  restrição do JSON para memberships revisadas permanece, com a exceção Master preexistente.

Estados ambíguos, eventos incompletos, vínculo alterado, revisão administrativa ou edição
posterior do colaborador sem evento de lifecycle correspondente são recusados. Não
fabricar auditoria nem editar contadores para fazer a operação passar. Esses casos exigem
investigação e procedimento específico aprovado; não há desbloqueio administrativo genérico.
A funcionalidade de acesso provisório de 24 horas continua fora do escopo.

## B — selo e verificação de esquema

Nova migration `20261012030100_erp_recovery_integrity.sql` e alteração do script
`supabase/recovery/phase-2a-resume-normalized.sql`.

1. Um digest versionado de definições e grants ERP foi obtido das migrations ordenadas
   em uma instalação local limpa do PostgreSQL 17.11. A instalação do selo recusa
   definições/grants ERP divergentes, inclusive trigger ausente ou grant de coluna extra.
2. Depois dessa validação, grava uma única fotografia privada dos objetos, incluindo
   os owners e ACLs efetivos da instalação. Não há comando público de criação/atualização
   do selo, nem rotina de recaptura na retomada. UPDATE/DELETE/TRUNCATE são bloqueados.
3. Compara conjuntos completos de chaves e fingerprints: ausência, adição, mudança de
   definição ou habilitação são divergências, não apenas o nome do objeto.
4. Abrange tabelas ERP públicas/privadas e relações centrais, RLS/FORCE, owners, colunas,
   defaults, constraints/validação, índices/validade, triggers/estado, policies/papéis/
   expressões, funções/corpo/SECURITY DEFINER/search_path/ACLs, grants de tabela/coluna,
   papéis técnicos e memberships de papéis, schemas, default privileges e catálogo
   estático de permissões. Grants de negócio editáveis pelo Owner não são congelados.
5. Os ACLs do JSON legado são exceção deliberada à fotografia: entrar em manutenção
   os revoga. A retomada exige separadamente ausência de acesso de tabela **e coluna**
   para anon/authenticated/service_role; não restaura esses grants.
6. A verificação financeira anterior permanece. A retomada trava as relações em ordem
   estável, valida o selo e os dados, e só então desativa manutenção e grava o evento,
   tudo na mesma transação. Contenção resulta em timeout/rollback, não retomada parcial.

Divergência: `55000 RECOVERY_SCHEMA_DRIFT: <chave do objeto>`. Selo inexistente:
`55000 RECOVERY_SCHEMA_SEAL_MISSING`; definição divergente na instalação:
`55000 RECOVERY_UNREVIEWED_SCHEMA`. O código novo identifica a divergência antes do
antigo `RECOVERY_SCHEMA_INTEGRITY_FAILURE`; a expectativa da regressão foi atualizada.
O diagnóstico mostra apenas identificadores do esquema, sem dados empresariais/segredos.

O digest serve para comparação de drift, não como assinatura contra um DBA malicioso.
Um superusuário pode substituir o próprio verificador: ACLs, gestão de acesso DDL,
artefatos revisados e backups continuam necessários. ACLs/owners centrais específicos do
provedor são fixados na fotografia inicial e exigem revisão da instalação hospedada.

### Procedimento operacional, ainda sem autorização de execução remota

1. Suspender escritores/jobs, estabelecer janela exclusiva de DDL/administração e
   preservar backup e manifestos de contagens/checksums dos dados e snapshots.
2. Entrar em manutenção pelo script existente. Executar `phase-2a-verify.sql` em leitura.
3. Se houver divergência, **manter manutenção ativa**. Registrar chave, versão do banco,
   commit das migrations, definição e ACL relevantes, sem registros privados.
4. Comparar com uma instalação descartável construída do mesmo commit revisado. Corrigir
   o objeto específico apenas mediante mudança versionada e autorização próprias.
   Não atualizar/apagar o selo, recalcular o digest para aceitar a divergência, restaurar
   grants inseguros ou recriar objetos automaticamente pelo script de retomada.
5. Conferir novamente integridade referencial/financeira e manifestos de dados. Só com
   esquema íntegro executar `phase-2a-resume-normalized.sql`; conferir manutenção falsa
   e evento de recuperação, com JSON ainda fechado.
6. Mudanças legítimas futuras no esquema ou upgrade do PostgreSQL exigem revisão/testes
   e evolução versionada do selo. Nunca aprender automaticamente o estado corrente.

Os locks de relações não constituem um bloqueio global contra toda alteração de função
ou papel por um DBA concorrente. A janela exclusiva de DDL é requisito operacional.
O modo de manutenção também não cancela sessões Auth ou privilégios globais Master.

## Evidências e comandos reproduzíveis

Ambiente real: Docker PostgreSQL 17.11, imagem fixada pelo harness existente, `--network none`,
volume temporário, sem portas publicadas/DSN remoto; identidades sintéticas. **16 migrations**
aplicadas em sequência. Containers descartados automaticamente.

| Verificação | Ambiente | Resultado |
|---|---|---|
| Reprodução anterior dos dois defeitos | PostgreSQL 17.11, base de 14 migrations | Defeitos confirmados antes da alteração |
| Recuperação nas duas ordens; revogações repetidas; versões e UUIDs; escopo mínimo; Owner/papéis/tenant; escrita direta/upsert; bloqueios independentes; rollback e auditoria; histórico postado e Master/Auth | PostgreSQL real | APROVADO — 18 cenários novos |
| Recuperação concorrente com desativação em ambas as ordens | PostgreSQL real, duas conexões | APROVADO — incluído nos 18 cenários |
| Trigger ausente/desabilitado/alterado; função/search_path; policy/grants/colunas; RLS/constraint/papel; selo privado; inicialização divergente; retomada íntegra | PostgreSQL real | APROVADO — 16 cenários novos |
| Trigger removido em transação já confirmada; retomada recusa e não recria trigger; novas escritas continuam negadas | PostgreSQL real | APROVADO — caso reforçado e reexecutado isoladamente |
| Restauração individual existente | PostgreSQL real | APROVADO — 14 regressões |
| Lifecycle, retenção e recuperação existentes | PostgreSQL real | APROVADO — 14 regressões; caso do novo diagnóstico reexecutado após ajuste de expectativa |
| Novo fluxo, selo e lifecycle | PGlite PostgreSQL 17.5/WASM | APROVADO — 11 testes reportados pelo Node |
| RLS e contratos de permissões existentes | PGlite | APROVADO — 22 testes |
| Lint dos dois arquivos JavaScript afetados | ESLint local | APROVADO |
| PostgreSQL/Supabase hospedado, Auth real, carga prolongada e restauração real de backup | Não executado | NÃO TESTADO |
| Build e TypeScript | Sem alteração de código/contratos TypeScript | NÃO REEXECUTADO nesta entrega |

```bash
python3 scripts/test-coordinated-recovery.py
python3 scripts/test-membership-restoration.py
python3 scripts/test-employee-lifecycle.py
node --test tests/coordinated-recovery.test.mjs tests/employee-lifecycle.test.mjs tests/tenant-domain-rls.test.mjs
./node_modules/.bin/eslint tests/coordinated-recovery.test.mjs tests/helpers/tenant-domain-fixture.mjs
```

Logs desta execução em `/tmp/handyhub-coordinated-*.log` (temporários, não versionados).
As primeiras execuções também identificaram um cast SQL necessário na consulta de catálogo,
um preparo de histórico que incrementava indevidamente a versão usada pelo teste, e a
expectativa do diagnóstico anterior. Corrigidos e verificados; não foram ocultados como aprovação.

PGlite e PostgreSQL real aceitaram o mesmo digest de definições/grants. PGlite não comprova
locks ou concorrência entre conexões; essas evidências vieram exclusivamente do PostgreSQL
real. Não se presume equivalência ao ambiente Supabase hospedado.

## Limites, compatibilidade e avaliação

- Migrations anteriores preservadas; alterações aditivas. Nenhuma associação/backfill,
  reativação automática, remoção de dados ou alteração do legado operacional.
- A cadeia de auditoria precisa estar íntegra. Não atribuir aprovação a recuperação de
  estados ambíguos ou administrativos: permanecer bloqueado é o resultado seguro.
- O selo é intencionalmente estrito: alterações de esquema/grants/versão do PostgreSQL
  podem exigir análise mesmo quando legítimas. Planejar isso na futura integração hospedada.
- Há duas migrations transacionais: se a instalação do selo falhar, a migração anterior
  pode já estar aplicada. O novo script de retomada recusa selo ausente; não voltar ao
  script antigo para contornar a recusa. Resolver a instalação em manutenção.
- O check não substitui backup, reconciliação integral dos dados, política legal de retenção
  ou auditoria independente. Sem promessa de rollback destrutivo depois de novas gravações.
- Backlog separado preservado. Fase 2B não iniciada. A vulnerabilidade alta do JSON legado
  **continua aberta**, fora do escopo A/B; a **Camada 1C permanece reprovada**.

Avaliação provisória: **9,2/10 no escopo local A/B**, sustentada pela reprodução prévia,
negações adversariais, atomicidade e concorrência real. Nenhuma falha crítica/alta identificada
nesse escopo durante estes testes. Descontos por ausência de validação hospedada, de carga
prolongada e de revisão independente final; não é aprovação da Fase 2A completa.
