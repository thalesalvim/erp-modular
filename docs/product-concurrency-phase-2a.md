# Fase 2A — correção local de concorrência M1/M2

Base: `69c032d8eeb58ff5b54fe1985781caecc600ce7d`, branch
`codex/tenant-permissions-phase-2a`. Escopo exclusivo: gravação obsoleta e versão do
agregado produto/custo. Estoque 1:1 participa para não deixar outro contador independente.
Não corrige M3, M4 nem o JSON legado.

## Causa e decisão

- **M1:** `private.erp_guard_record` incrementava `version`, mas os grants de UPDATE
  permitiam gravar sem comparar a versão lida. Contador sozinho não detecta conflito.
- **M2:** cada tabela tinha seu contador; alterar `erp_product_costs` não invalidava
  decisões tomadas com a versão anterior de `erp_products`.

A migration adicional `20261011010000_erp_product_concurrency.sql` torna
`erp_products.version` a versão canônica. Cada chamada bem-sucedida incrementa essa
versão uma vez, inclusive alterações apenas de custo/estoque e patches que repetem valores.
Os contadores dos filhos permanecem, mas não representam a versão esperada do agregado.

**Restrição funcional deliberada:** escrita direta foi revogada nas 26 tabelas novas,
inclusive grants por coluna. Somente produto/custo/estoque recebem comando de atualização.
Criação/exclusão de produtos e escritas dos demais domínios ficam negadas até comandos
próprios. Isso também impede DELETE + INSERT de reiniciar a versão. Não implementamos
CRUD versionado de todos os domínios. A matriz de negócio não mudou; a implementação
é mais restritiva onde falta comando seguro. Telas/APIs atuais usam o legado e não mudaram.

## Contrato e atomicidade

`public.erp_update_product(p_tenant uuid, p_product uuid, p_expected_version bigint,
p_product_patch jsonb = '{}', p_cost_patch jsonb = '{}', p_stock_patch jsonb = '{}')`
retorna `(record_id uuid, version bigint)`.

| Patch | Campos permitidos |
| --- | --- |
| Produto | `name`, `category` (aceita null), `price` |
| Custo | `cost` |
| Estoque | `initial_stock`, `min_stock` |

Exige patch não vazio, UUIDs, versão inteira positiva abaixo do limite seguro JavaScript
e tipos/constraints válidos. Rejeita identidade, tenant, versão e campos desconhecidos
nos patches. Estoque inexistente exige os dois campos iniciais.

1. Verifica `products.update`, identidade, membership e tenant atuais; hoje somente Owner.
2. Bloqueia a raiz `(tenant_id,id)` com `FOR UPDATE` e compara a versão após obter o lock.
3. Atualiza a raiz (trigger incrementa uma vez), depois custo e estoque, nessa ordem.
4. Retorna a versão nova. Qualquer falha desfaz a chamada inteira, sem absorver exceções.

`40001 / VERSION_CONFLICT` identifica gravação obsoleta. `42501 / ACCESS_DENIED` não
distingue registro inexistente de inacessível. Validação usa `22023`; constraints e
conversões também podem retornar seus códigos PostgreSQL. `RecordCommand.expectedVersion`
deve usar a versão da raiz; `MutationResult` já prevê `conflict / VERSION_CONFLICT`.
A futura API deverá mapear esse resultado (por exemplo HTTP 409). Não há retry automático:
reler e obter decisão explícita antes de gravar. Nenhum endpoint foi implementado.

**Leitura futura:** produto, custo/estoque autorizados e versão da raiz precisam vir do
mesmo snapshot SQL, por exemplo um SELECT com joins. Consultas separadas podem combinar
valores antigos com versão nova. Integração desse contrato de leitura ainda não foi feita.

Uma chamada bloqueia uma raiz, depois filhos em ordem fixa. Produtos distintos não se
bloqueiam nos testes. Transações externas com vários produtos deverão ordenar raízes
por `(tenant_id,id)`; não prometemos ausência de deadlock para SQL arbitrário. Isolamentos
REPEATABLE READ/SERIALIZABLE podem produzir `40001` do próprio PostgreSQL: tratar como conflito.

## Barreira de privilégios

- REVOKE INSERT/UPDATE/DELETE/TRUNCATE e INSERT/UPDATE por coluna nas 26 tabelas para
  PUBLIC, anon, authenticated e service_role. Leituras e FORCE RLS permanecem.
- SECURITY DEFINER com `search_path = ''`, nomes qualificados e campos permitidos.
  Proprietário `handyhub_product_writer`: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, sem ownership
  de tabelas, associação a papéis de cliente ou CREATE permanente no schema. Somente
  SELECT e escrita nas colunas necessárias das três tabelas, sem criar/excluir a raiz.
- Policies desse papel exigem `private.erp_can(...,'products.update')`; não contorna RLS.
  EXECUTE apenas para authenticated, revogado de PUBLIC/anon/service_role.
- Sem GUC secreto, papel no payload ou caminho alternativo de DML para clientes.
  Administradores/donos técnicos e futuras funções privilegiadas estão fora dessa garantia;
  backfill/manutenção precisam preservar versão raiz e atomicidade. Não usar esse acesso
  como caminho operacional. Nenhuma credencial remota foi usada.

## Reprodução e cobertura

Requer dependências instaladas, Node, Python 3, Docker e imagem PostgreSQL já disponível,
fixada por digest no script. Ele não baixa imagem, não aceita DSN remoto, usa `--network none`,
sem portas, socket local e tmpfs; remove o container ao terminar. Fixtures sintéticas são
compartilhadas. Chamadas de aplicação usam `SET SESSION AUTHORIZATION authenticated/anon`,
sem manter session_user superusuário nos testes de SET ROLE. Auth é simulado, não JWT real.

```sh
python3 scripts/test-product-concurrency.py
node --test tests/tenant-domain-rls.test.mjs
npx tsc --noEmit --incremental false
npx eslint tests/tenant-domain-rls.test.mjs tests/helpers/tenant-domain-fixture.mjs
```

| Teste | Resultado e evidência |
| --- | --- |
| Duas conexões, mesmo produto | APROVADO: segundo espera lock e recebe 40001; primeira gravação preservada |
| Versão correta, patch conjunto | APROVADO: produto/custo/estoque confirmam; raiz 1 → 2 uma vez |
| Versão ausente, inválida ou futura | APROVADO: erro sem alteração |
| Custo versus produto+custo | APROVADO: custo incrementa raiz, concorrente obsoleto rejeitado |
| Estoque versus custo | APROVADO: mesma raiz serializa ambos e detecta conflito |
| Produtos distintos | APROVADO: segunda escrita termina em timeout de 700 ms com outra raiz bloqueada por 2 s |
| Escrita direta | APROVADO: UPDATE, DELETE, UPSERT, TRUNCATE, SET ROLE e GUC falso negados; ACLs das 26 tabelas |
| Tenant, identidade e papéis | APROVADO: tenant/ID estrangeiro, campos forjados, Manager, Employee, Master e anon negados |
| Rollback por conflito | APROVADO: segunda chamada obsoleta desfaz primeira chamada na mesma transação |
| Rollback por constraint | APROVADO: estoque inválido desfaz raiz e custo |
| Filhos ausentes e tipos | APROVADO: criação atômica; estoque incompleto/fracionário/null rejeitado |
| Papel proprietário da função | APROVADO: sem login/bypass/membership/tabelas/DDL; FORCE RLS ativo |
| Regressão de autorização | APROVADO: 22 testes PGlite, incluindo agregador; escopos, isolamento, legado, revogação e constraints |
| Supabase hospedado, Auth real e APIs | NÃO TESTADO; nenhum acesso remoto |

As primeiras 12 verificações são testes executados em **PostgreSQL 17.11 real**. Corridas
usam backends independentes e barreiras verificadas em `pg_stat_activity`, inclusive espera
por lock. **PGlite (PostgreSQL 17.5/WASM)** não comprova concorrência multi-backend.
Logs: `/tmp/handyhub-occ-postgres.log`, `/tmp/handyhub-occ-pglite.log`,
`/tmp/handyhub-occ-types.log`, `/tmp/handyhub-occ-lint.log`.
TypeScript e lint dos dois arquivos JavaScript afetados passaram (exit 0). Não repetimos
a suíte completa de 89 testes nem o build: não houve alteração em código da aplicação,
dependências ou contratos TypeScript; suas aprovações anteriores permanecem evidência
histórica, sem serem apresentadas como nova execução.

## Limites, reversão e checkpoint

Migration adicional transacional sem backfill/exclusões; migrations anteriores e tenant_data
preservados. Aplicada apenas localmente. Criação/transferência do papel exige privilégios
do executor de migrations ainda **não testados no Supabase hospedado**. Papel preexistente
com esse nome faz falhar, sem confiar em seus privilégios. Falha reverte a transação.

Depois de uso, não restaurar grants antigos/versões anteriores: reabriria M1/M2. Manter
escritas negadas, preservar dados e corrigir adiante. Antes da integração faltam comandos
dos outros domínios/criação/exclusão e leitura consistente. M3, M4, desativação, retenção
e auditoria de comandos de negócio permanecem pendentes, sem alterações nesta entrega.

Avaliação provisória **9,0/10 apenas para a correção local M1/M2**, pela evidência nativa
de conflitos, atomicidade e privilégios. Limites: integração ausente, caminhos de escrita
fechados e compatibilidade hospedada não testada. Não substitui a auditoria completa.
Fase 2A aguarda revisão; **Camada 1C reprovada**, vulnerabilidade alta do JSON ainda aberta.
