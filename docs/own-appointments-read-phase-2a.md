# Fase 2A — leitura operacional própria da agenda (M3)

Base: `0c07079af81762f73f11266ebe314de19a6b2312`, branch
`codex/tenant-permissions-phase-2a`. Implementação local, sem publicação ou execução remota.

## Causa e contrato aprovado

A permissão isolada `appointments.read_own` permite ler a linha de agendamento, mas
as policies de clientes e serviços negam os cadastros sem permissões independentes.
O LEFT JOIN direto retorna nomes nulos, embora a Fase 1 tenha aprovado `clientName`
e `serviceName`. Conceder `services.read` como dependência também abriria preço e catálogo;
isso não é necessário nem foi feito.

Nova função: `public.erp_read_own_appointments(p_tenant uuid)`.
Retorna somente a projeção da Fase 1, sem novos campos ou permissões de negócio:

| Campo | Origem / formato |
| --- | --- |
| `id` | UUID do agendamento |
| `date` | `occurred_on`, `YYYY-MM-DD` |
| `time` | `occurred_at`, `HH:mm:ss[.fração]` |
| `clientName` | Nome atual do cliente relacionado por `(tenant_id,customer_id)` |
| `serviceName` | Nome atual do serviço relacionado por `(tenant_id,service_id)` |
| `status` | Status operacional do agendamento |

São data/hora locais armazenadas, sem conversão de timezone. Não há CPF, telefone,
e-mail, notas, preço de serviço, preço de agendamento, despesas, versão ou identificador
do profissional. CPF não existe no novo esquema normalizado; isto não certifica segurança
do JSON legado. Nomes são rótulos de exibição, nunca fonte de autorização.

`src/lib/permissions/appointment-read.ts` define tipos da projeção e do argumento UUID,
compatíveis com `ReadDTO<'appointments.read_own'>`. Os testes de compilação exigem exatamente
as mesmas chaves da Fase 1 e rejeitam campos financeiros, privados ou seletor arbitrário de usuário.
Não há implementação de página, API, adapter de Supabase ou filtro visual nesta entrega.

## Autorização e fronteira de leitura

- Exige `appointments.read_own` concedida ao papel atual (ou Owner), membership ativa e
  tenant ativo. A identidade vem de `auth.uid()`, nunca de argumento do cliente.
- O vínculo privado `(tenant,employee UUID) → Auth UUID` determina o responsável próprio.
  Não utiliza nome, metadata, claims de papel ou a atribuição independente de clientes.
- Sem grant, membership, identidade ou tenant autorizado: `42501 / ACCESS_DENIED`.
  Permissão válida sem vínculo próprio ou sem agendamentos: lista vazia. Esses resultados
  devem continuar distintos na integração futura.
- A mesma RPC permanece própria para Owner/Manager; `appointments.read` isolada não a
  habilita. Ela não substitui a futura projeção de agenda gerencial.

A migration `20261011020000_erp_own_appointments_read.sql` adiciona papel técnico
`handyhub_own_agenda_reader`, NOLOGIN, sem SUPERUSER/BYPASSRLS/memberships/ownership de tabelas
ou privilégio permanente de CREATE. Recebe apenas SELECT nas colunas necessárias de três
tabelas e EXECUTE em helpers de autorização. Não recebe DML nem dados privados/financeiros.

A RPC SECURITY DEFINER pertence a esse papel e usa `search_path = ''`. EXECUTE é limitado
a authenticated; PUBLIC, anon e service_role são revogados. A projeção é explícita, sem SQL
dinâmico, `SELECT *` ou argumento de profissional. O papel respeita FORCE RLS nas três tabelas:
appointments próprios e nomes de clientes/serviços relacionados apenas a esses appointments.
As policies novas são exclusivas do papel NOLOGIN, sem ampliar policies/grants de authenticated.
As policies dos relacionamentos consultam appointments, cujo predicado só depende de helpers
privados: não há recursão entre as tabelas de domínio.

Leitura usa snapshot da instrução SQL (função STABLE). Revogação, bloqueio ou reatribuição
valem na próxima instrução em READ COMMITTED; não cancelarão consultas já em andamento.
Não conservar respostas entre usuários/tenants nem cachear autorização entre requisições.

## Testes executados e reprodução

Somente dados sintéticos em bancos descartáveis. PostgreSQL **17.11 real**, imagem fixada
por digest, Docker com `--network none`, sem portas, tmpfs, conexão por socket. Aplicação
simulada com `SET SESSION AUTHORIZATION authenticated/anon`, sem session_user superusuário
nos ataques de SET ROLE. Não é login/JWT/identidade real no Supabase ou ensaio PostgREST.

```sh
python3 scripts/test-appointment-read.py
python3 scripts/test-product-concurrency.py
node --test tests/tenant-domain-rls.test.mjs
npx tsc --noEmit --incremental false
npx eslint src/lib/permissions/appointment-read.ts tests/contracts/appointment-read.types.ts tests/helpers/tenant-domain-fixture.mjs tests/tenant-domain-rls.test.mjs
```

| Cobertura M3 (PostgreSQL real) | Evidência |
| --- | --- |
| Permissão mínima isolada | Seis campos completos; consulta direta a clientes/serviços continua sem linhas; join antigo continua sem nomes |
| Profissionais e registros órfãos | UUIDs distintos com mesmo nome; apenas o responsável atual, nunca colega/nulo |
| Isolamento A/B/C | A/B negados; IDs de entidades repetidos em outro tenant não misturam nomes |
| Default deny | Anon, sem identidade, sem membership, Master e papel sem grant negados |
| Revogação | Grant removido, membership desativada, tenant bloqueado e vínculo Auth removido reavaliados |
| Reatribuição e outros papéis | Acesso antigo removido; Owner/Manager não transformam RPC própria em listagem geral |
| Privacidade / views | Contatos/notas/financeiro/despesas sem linhas; campos proibidos ausentes; views `security_invoker` preservam isolamento |
| Privilégios e bypass | SET ROLE, DML, tabela de vínculos e seletor de usuário negados; grants por coluna, owner e EXECUTE inspecionados |

Resultado M3: **8 testes PostgreSQL aprovados**. Regressão: **12 testes PostgreSQL M1/M2**
e **22 testes PGlite** aprovados, incluindo RPC com helpers de metadados sem
SUPERUSER/BYPASSRLS. PGlite é PostgreSQL 17.5/WASM e não comprova concorrência multi-backend.
TypeScript e lint afetado aprovados. Logs locais: `/tmp/handyhub-m3-postgres.log`,
`/tmp/handyhub-m3-product-regression.log`, `/tmp/handyhub-m3-pglite.log`,
`/tmp/handyhub-m3-types.log`, `/tmp/handyhub-m3-lint.log`.

O harness compartilhado recebeu somente ajuste de prontidão: espera o processo PostgreSQL
final, evitando confundir o servidor temporário de initdb com o servidor definitivo.
Não alteramos o comando M1/M2. Build/suíte completa não repetidos; código de aplicação
e dependências não mudaram, e os contratos adicionados são apenas tipos.

## Limitações, riscos e checkpoint

- Nomes representam o cadastro atual; **M4/histórico não foi iniciado**.
- Não resolve outras projeções, agenda gerencial, atendimento ou vendas; não altera telas.
- Não adiciona paginação, filtro de período ou índices: os relacionamentos já têm índices
  por tenant/UUID. Volume grande exige medição local e paginação revisada antes da integração.
- Não cria view de produção. Views futuras devem usar `security_invoker` ou ter revisão
  própria; uma view/função privilegiada nova pode reabrir acesso. Não se certifica SQL futuro.
- Supabase hospedado, privilégios reais do executor de migrations, defaults de ACL, Auth/JWT
  e API HTTP não testados. Nome de papel já existente aborta a migration transacional;
  não reutilizar papel de privilégios desconhecidos. Nenhum acesso remoto realizado.
- Rollback seguro mantém negação dos cadastros. Não restaurar acesso amplo para remediar
  falha da projeção. Migration não modifica dados, catálogo de permissões ou migrations anteriores.

Nota provisória **9,0/10 restrita ao M3 local**: contrato realizável e isolamento demonstrados
em PostgreSQL real, sem falha alta/crítica identificada nos cenários executados. Limites são
integração/hospedagem não testadas e desempenho em volume não medido. Não é aprovação da
auditoria completa. JSON legado continua vulnerável e **Camada 1C permanece reprovada**.
