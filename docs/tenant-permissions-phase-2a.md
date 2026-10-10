# Fase 2A — esquema empresarial e RLS local

## Estado e alcance

Base: `91fd517d8fd5d67a0cc3abd6839147e041af89ef`, Fase 1.
Branch de trabalho: `codex/tenant-permissions-phase-2a`.

**A vulnerabilidade alta do JSON legado continua aberta e a Camada 1C continua reprovada.**
Esta entrega instala objetos novos e vazios, sem consumir `all_data`, sem backfill e sem
alterar grants, policies ou conteúdo de `tenant_data`. As telas/APIs existentes continuam
usando o caminho legado. Não habilitar uso real do novo modelo antes do cutover revisado.
Não executar estas migrations remotamente nesta etapa. Validação exclusivamente em PGlite,
com roles e identidades sintéticas locais, sem acesso ao Auth ou a dados reais.

## Arquivos e ordem

1. `20261010060000_erp_permissions.sql`: catálogo igual ao da Fase 1, grants por papel/tenant,
   revisão, auditoria e função de configuração exclusiva do Owner.
2. `20261010060100_erp_domains.sql`: 26 tabelas empresariais vazias, vínculos privados,
   constraints e índices. RLS já ligada e privilégios revogados nesta migration.
3. `20261010060200_erp_domain_rls.sql`: políticas de leitura, escrita Owner limitada por
   coluna, helpers pessoais e proteção de identidade/versão dos registros.
4. `tests/tenant-domain-rls.test.mjs`: aplica migrations reais no banco local e faz consultas
   sob `authenticated`/`anon`. Não usa `service_role` para leituras operacionais.

Cada migration é transacional. A ordem é obrigatória. O versionador deve aplicá-las uma vez;
reexecutar manualmente o mesmo arquivo não é mecanismo de idempotência. Uma interrupção
entre as migrations deixa os objetos novos sem permissões operacionais até a última etapa.
Não existe trigger de sincronização, dual-write, view ou RPC que leia o JSON legado.

## Modelo e segregação física

Todos os registros empresariais possuem `tenant_id NOT NULL`, UUID estável, PK composta
`(tenant_id,id)`, `version` e `created_at`. UUID é identidade, não segredo nem autorização.
As referências entre entidades incluem **tenant e UUID**, com `ON DELETE RESTRICT` e índices
por tenant/referência. Não há FKs baseadas em nome, slug ou papel profissional.

| Domínio | Tabelas `public.erp_*` | Leitura e separação |
| --- | --- | --- |
| Clientes | `customers`, `customer_contacts`, `customer_notes` | Nome pode ser atribuído; telefone exige `customers.read`; notas só Owner |
| Colaboradores | `employees`, `employee_private`, `employee_schedules`, `employee_roles` | Nome próprio pelo vínculo Auth; contatos só Owner; estruturas pendentes fechadas |
| Funções profissionais | `professional_roles` | `rolesList.read`; nunca concede role de autenticação |
| Produtos | `products`, `product_costs`, `product_stock` | Preço de catálogo separado de custo e saldos/limites de estoque |
| Serviços | `services` | Catálogo com preço/duração e FK de função profissional |
| Promoções | `promotions`, `promotion_targets` | Oferta escalar separada dos alvos estruturados pendentes |
| Agenda | `appointments`, `appointment_finance`, `appointment_notes` | Dados operacionais próprios separados de preço e notas |
| Atendimentos | `attendances`, `attendance_finance`, `attendance_notes` | Operação própria separada de valores/pagamento e notas |
| Vendas | `sales`, `sale_customers`, `sale_finance`, `sale_notes` | Vendedor próprio pode ler operação; referência ao cliente e financeiro ficam separados |
| Estoque | `stock_moves` | Movimentos com FK produto/tenant; Employee sem permissão |
| Despesas | `expenses` | Owner ou Manager explicitamente autorizado; Employee nunca |

As tabelas auxiliares 1:1 usam o mesmo `id` do registro pai e FK composta. A separação
impede que `SELECT *` numa tabela operacional retorne notas, custo ou pagamento por acidente.
Joins continuam subordinados à RLS de cada tabela; não criamos views com privilégios elevados.
IDs relacionais e metadados técnicos não constituem os DTOs finais da API: nomes, formato
camelCase e validação de resposta ainda precisam do adaptador do servidor.

Semântica de valores: dinheiro `numeric(14,2)` com faixa não negativa e finita; desconto
percentual entre 0 e 100; quantidade inteira positiva; estoque não negativo; atendimento
exige `net_value = gross_value - discount` e desconto não maior que bruto. Datas/horas são
valores SQL tipados, sem conversão implícita do legado. Duração de serviço é minutos positivos.
Estados operacionais continuam texto não vazio quando especificado, pois transições e enums
não foram aprovados; **não são atributos de autorização**. Não habilitamos escrita delegada.
Regras de estorno, quantidade fracionária, moeda, duração legada e turnos noturnos precisam
ser decididas antes de importar valores que não se ajustem a essas constraints.

## Identidade e atribuição

`private.erp_employee_auth_links` liga `(tenant, employee_id)` a `(tenant, auth_user_id)`
com FK para a membership real e unicidade tenant/Auth. Colaborador sem conta Auth existe
apenas em `erp_employees`, sem vínculo; nunca satisfaz escopo pessoal por comparação de nome.
`private.erp_customer_assignments` registra a atribuição explícita cliente/profissional.
Ambas as extremidades precisam pertencer ao mesmo tenant.

Os helpers comparam exclusivamente `auth.uid()` a essas relações. `erp_is_self` exige
membership ativa e tenant `Ativo`; RLS combina esse vínculo com a permissão pessoal.
`erp_is_assigned` deriva a atribuição pelo vínculo do próprio solicitante, sem aceitar UUID
de outro usuário como argumento. Uma appointment não concede automaticamente permissão
para o cadastro/contato de cliente: cada domínio exige a sua concessão.

Ninguém com papel empresarial, nem Owner, recebe escrita direta nesses vínculos privados.
O procedimento privilegiado futuro de associação/reassociação requer revisão e auditoria;
não inventamos esse fluxo nesta etapa. INSERT/UPDATE do responsável/vendedor também não é
concedido ao cliente; novas operações via SQL empresarial permanecem sem responsável até
um fluxo aprovado. Os testes usam provisionamento sintético pelo dono técnico do banco.

## Permissões e delegação

`private.erp_permission_catalog` contém as 59 permissões da Fase 1, inclusive escopos,
campos e tetos por papel. Um teste compara cada entrada com o contrato TypeScript; não
existe configuração pelo cliente para ampliar o catálogo. Grants ausentes negam acesso.

`private.erp_can` consulta membership, tenant e grants na mesma consulta SQL. Owner pode
usar apenas permissões conhecidas do próprio tenant ativo. Manager/Employee precisam de
grant explícito **e** do teto fixo. Master isoladamente não dá acesso empresarial novo.
O helper verifica a concessão; políticas pessoais acrescentam obrigatoriamente o vínculo.
Não usar apenas o resultado desse helper como substituto do escopo de uma linha.

| Operação nova | Owner | Manager | Employee |
| --- | --- | --- | --- |
| Ler domínios classificados do próprio tenant | Sim | Somente grants delegáveis | Somente grants mínimos/escopo pessoal |
| Ler despesas, custos, pagamentos | Sim | Concessão financeira explícita | Negado mesmo se tentarem armazenar grant inválido |
| Ler notas privadas e contatos de colegas | Sim | Negado | Negado |
| Ler escala, funções do colaborador e alvos estruturados de promoção | Negado nesta etapa | Negado | Negado |
| CRUD de domínios classificados | Colunas explicitamente concedidas | Negado | Negado |
| Atualizar tenant, ID ou responsável/vendedor diretamente | Negado | Negado | Negado |
| Configurar grants empresariais | RPC abaixo, dentro do teto | Negado | Negado |
| Criar membership, promover papel ou conceder Master | Fora deste modelo | Negado | Negado |
| Dados de outra empresa | Negado | Negado | Negado |

A função nova de banco `public.erp_set_role_permissions(tenant, role, permissions[], expected_revision)`:

1. Valida Owner ativo com `auth.uid()` e tenant `Ativo`, mantendo locks de leitura nas linhas
   de tenant/membership durante a operação; não aceita identidade do ator como parâmetro.
2. Rejeita target Owner/Master, permissões desconhecidas, nulas, wildcards e grants além do teto.
3. Bloqueia a revisão do tenant para atualizar atomicamente o conjunto do papel. A revisão
   inicial é zero (sem grants); conflito resulta em SQLSTATE `40001`, sem alteração parcial.
4. Incrementa a revisão e grava auditoria na mesma transação. Array vazio revoga o papel.
5. Não cria usuários, memberships, tenants ou vínculos Auth. Não modifica roles empresariais.

Um trigger adicional bloqueia grants fora do teto mesmo em importação privilegiada. Os
clientes não têm SELECT/INSERT/UPDATE/DELETE direto em catálogo, estado, grants ou auditoria.
A auditoria guarda UUID do ator/tenant, papel alvo, conjuntos anterior/novo, revisão e horário;
não aceita payload livre, tokens ou links. Erros revertidos não geram auditoria persistente
nessa transação: monitoramento de tentativas negadas pertence ao servidor futuro.

## RLS, grants e execução

- 26 tabelas públicas com `ENABLE` e `FORCE ROW LEVEL SECURITY`; anon sem privilégios.
- Privilégios de `PUBLIC`, anon, authenticated e service_role são revogados explicitamente
  antes das concessões mínimas. Nenhuma concessão operacional nova para service_role.
- Authenticated recebe SELECT protegido por RLS. Tabelas estruturadas pendentes têm policy
  `false` e nenhuma escrita para todos os papéis, inclusive Owner.
- INSERT/UPDATE têm lista explícita de colunas. UPDATE nunca aceita tenant/ID, vínculos ou
  versão enviada pelo cliente; um trigger mantém identidade imutável e incrementa a versão.
- DELETE usa Owner do tenant e FKs restritivas. Não há TRUNCATE, REFERENCES ou TRIGGER
  para authenticated. Manager/Employee não escrevem, mesmo com módulos habilitados.
- Tabelas privadas têm RLS sem policies e nenhum privilégio de cliente. Não usamos FORCE
  nelas: helpers do dono técnico precisam ler metadados sem recursão. Esse dono técnico não
  é o Owner empresarial e precisa ser confiável e indisponível ao navegador.
- SECURITY DEFINER usa `search_path = ''`, nomes qualificados, parâmetros tipados e nenhuma
  SQL dinâmica. EXECUTE é revogado de PUBLIC/anon/service_role; apenas helpers necessários
  e a função autorizada de concessão são executáveis por authenticated.
- Os testes também trocam os donos de metadados/helpers por uma role técnica sem SUPERUSER
  e sem BYPASSRLS, comprovando funcionamento sem depender desses atributos.
- FORCE RLS não protege contra superusuário ou credenciais técnicas privilegiadas. A proteção
  de credenciais administrativas e a configuração real do Supabase continuam externas ao teste.

## Revogação, revisão e concorrência

Cada instrução consulta membership, grants, vínculo e status atuais do snapshot SQL; não usa
claims de role nem módulos no JWT. Revogar grant, bloquear tenant ou desativar membership
nega a próxima instrução sob READ COMMITTED. Consultas já em andamento podem terminar;
transações de isolamento maior podem conservar snapshots. Não prometer revogação retroativa.

A revisão persistida aqui é **de configuração de permissões**, não um contador universal de
membership/atribuição. Não adicionar cache entre requests usando apenas essa revisão. Na
integração, ler identidade/vínculos atuais em cada operação e invalidar estado do cliente em
logout/troca de tenant. Não alteramos triggers de autenticação/membership legados nesta fase.

Versão de registro permite o futuro UPDATE com `WHERE version = expectedVersion`. O trigger
incrementa a versão; não implementa sozinho compare-and-swap nem impede lost update de um
Owner que emita SQL sem condição de versão. APIs unitárias e conflitos são etapa posterior.
O RPC de grants já compara revisão sob lock; os testes cobrem revisão obsoleta e atomicidade,
mas PGlite não comprova disputa real entre conexões PostgreSQL simultâneas.

## Compatibilidade e migração futura

Nenhum dado legado foi convertido. IDs antigos podem ser strings/timestamps; gerar mapa
estável por `(tenant, domínio, legacy_id)` e preservar IDs verificáveis. Backfill precisa
reconciliar contagens, somas e relações antes de trocar a fonte de verdade. Nomes iguais não
podem resolver identidade. Registros sem vínculo inequívoco permanecem sem atribuição,
invisíveis a Employee, até revisão autorizada; não descartar dados incompatíveis.

Etapas futuras separadas: aprovar pendências de negócio e contratos estruturados; preparar
conversor/dry-run com cópia autorizada e restrita; validar dados e totais; implementar APIs
com sessão do usuário, DTOs mínimos, CSRF e operações unitárias; adaptar as duas páginas;
remover caches antigos; fechar a leitura legada indevida; validar identidades reais no staging.
Não introduzir dual-write sem reconciliação. Preferir janela curta de escrita suspensa para
backfill final e troca da fonte de verdade. Manager legado não ganha financeiro automaticamente.

FKs RESTRICT podem impedir exclusão de tenant, membership ou usuário Auth quando houver
vínculos novos. Isso preserva integridade, mas exige fluxo explícito de desligamento/retenção
antes de integrar onboarding/offboarding. Não chamar isso de compatibilidade de ciclo de vida
comprovada; apenas o código atual não foi alterado e as tabelas novas começam vazias.

## Reversão segura

Não incluímos down migration destrutiva. Antes de uso, manter objetos novos sem consumidores
é a reversão funcional mais segura; o legado já permanece intacto. Em ensaio local, uma
migration que falha deve ser revertida pela transação e corrigida antes da próxima aplicação.
Uma remoção futura de tabelas vazias requer autorização e comprovação de ausência de uso;
não presumir que continuam vazias após publicação.

Depois de novas escritas: suspender escritas, preservar backup/exportação restrita, reconciliar
alterações e preferir correção adiante. Nunca restaurar snapshot perdendo operações, excluir
novos dados para “voltar”, nem reabrir JSON ao Employee como rollback. Se o caminho seguro não
estiver disponível, usar manutenção com negação de acesso. Nenhum passo remoto foi executado.

## Cobertura verificável e limites

| Verificação local | Evidência no teste SQL |
| --- | --- |
| Legado preservado | Compara payload, policies e ACLs/flags de tenants, tenant_data, memberships e admins |
| Catálogo sem divergência | Compara todas as permissões, campos, ações, escopos e tetos com a Fase 1 |
| Anon/sem identidade/default deny | Percorre todas as 26 tabelas; RPC anon negado |
| Owner e isolamento A/B/C | Leitura de cada tabela por três Owners; dados exclusivamente do tenant correspondente |
| Employee pessoal | Mesmo nome para colaboradores diferentes; lê apenas próprio/atribuído, não órfão ou colega |
| Confidencialidade | SQL direto e joins não retornam despesas, custos, finanças, notas ou contatos restritos |
| Manager | Sem financeiro padrão, acesso após concessão explícita, notas privadas continuam negadas |
| Escalada | Sem grants para Owner/Master, sem subdelegação, sem wildcard, sem manipulação de vínculos/grants |
| Revogação | Grants, membership, tenant e vínculo reavaliados em instruções posteriores |
| Integridade | FKs compostas, referências cruzadas rejeitadas, identidade imutável, valores e unicidade |
| Concorrência de grants | Revisão obsoleta rejeitada, sem alteração parcial; auditoria atômica de sucesso |
| Definer/grants | search_path fixo, anon sem EXECUTE; helpers testados sem SUPERUSER/BYPASSRLS |

São testes reais de execução SQL local com JWT-sub simulado para escolher identidades,
não login Supabase, assinatura JWT, PostgREST, realtime ou validação remota. Nenhuma senha,
token ou sessão real é utilizada. A cobertura de FK inclui inspeção de constraints e ataques
representativos; não equivale a testar todas as combinações de valores de negócio.

Pendentes: integração de APIs/DTOs e fechamento do legado; contratos estruturados; escrita
delegada e subdelegação; mapeamento/associação Auth; reconciliação de dados legados; concorrência
em PostgreSQL multi-conexão; logs de tentativas negadas; PostgreSQL/Supabase hospedado e testes
reais de Owner/Manager/Employee no staging. **Aprovar os testes locais não aprova a Camada 1C.**

## Resultado da validação desta entrega

- `node --test tests/tenant-domain-rls.test.mjs`: **22 testes aprovados** (21 cenários SQL e
  seu teste agregador), zero falhas/ignorados.
- `npm test`: **89 aprovados**, zero falhas, ignorados ou TODOs; inclui os 67 anteriores.
- `npx tsc --noEmit --incremental false`: aprovado.
- `npx eslint tests/tenant-domain-rls.test.mjs`: aprovado.
- `NODE_USE_ENV_PROXY=1 npm run build`: aprovado, 11 páginas geradas.
- Revisão dos cinco arquivos novos: sem alterações em arquivos versionados anteriores,
  sem padrões de credenciais encontrados e sem erros de whitespace.

Logs locais: `/tmp/handyhub-phase2a-rls.log`, `/tmp/handyhub-phase2a-tests.log`,
`/tmp/handyhub-phase2a-types.log`, `/tmp/handyhub-phase2a-lint.log` e
`/tmp/handyhub-phase2a-build.log`. Esses logs são evidência desta execução, não artefatos remotos.
Sem regressões detectadas nas verificações executadas. Não houve commit, push, deploy ou
execução remota. Encerramento no checkpoint Fase 2A, aguardando revisão antes de integração.
