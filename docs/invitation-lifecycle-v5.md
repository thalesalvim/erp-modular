# Ciclo de vida dos convites e selo v5

Esta evolução é local e aditiva. A migration
`20261014043000_erp_invitation_lifecycle_v5.sql` sucede v4 sem editar as 17
migrations históricas, a migration v3, a migration v4 ou seus registros de selo.
Não modifica a API, o Supabase Auth nem o envio de e-mail.

## Expiração no consumo

A autorização continua válida por dez minutos. A associação verifica o ticket
ao adquiri-lo e novamente depois da inserção do membership, que pode aguardar
um índice único ou outro lock. O trigger de histórico atribui `consumed_at` com
`pg_catalog.clock_timestamp()` no consumo efetivo e rejeita qualquer consumo
em ou depois de `expires_at`, inclusive entradas retrodatadas. A exceção reverte
o membership e deixa o ticket não consumido.

O prazo se refere ao consumo, não ao instante de COMMIT de uma transação que
um operador deliberadamente mantenha aberta. Registros anteriores de consumo
tardio não são corrigidos ou apagados durante o upgrade: sua evidência é preservada.

## Ordem dos locks

O fence privado adquire primeiro SHARE no controle de runtime e depois
NO KEY UPDATE na empresa. Convites, desativação/reativação, revogação,
restauração e recuperação coordenada usam esse fence antes dos locks individuais
de ator, ticket, funcionário e destinatário. NO KEY UPDATE permite os KEY SHARE
das FKs e serializa operações do mesmo tenant, inclusive suspensão por UPDATE.

Os locks e as revalidações anteriores permanecem. Os comandos de lifecycle e
review verificam a permissão antes e depois do fence; isso mantém a negação
histórica em manutenção. O helper verifica vínculo ativo Owner/Manager antes
de bloquear um tenant em nome de uma identidade autenticada. Nenhum ator é
recebido como parâmetro substituto de `auth.uid()`.

A manutenção continua entrando pelo lock de runtime primeiro. A serialização
reduz o paralelismo desses comandos dentro de uma empresa. Ela não certifica
ausência de todo deadlock envolvendo SQL administrativo arbitrário. Operadores
devem executar retenção para um tenant por transação; operações manuais em
vários tenants exigem uma ordem estável de UUIDs e a mesma disciplina de locks.

## Limites de criação

Os limites são constantes versionadas e protegidas pelo fingerprint v5:

| Limite | Por ator dentro do tenant | Por tenant |
| --- | ---: | ---: |
| Pendentes, não consumidas e não expiradas | 50 | 200 |
| Criações nas últimas 24 horas, incluindo expiradas/consumidas | 100 | 500 |
| Criações cumulativas, incluindo o arquivo histórico | 1.024 | 4.096 |

O trigger de INSERT verifica as cotas sob o fence da empresa, usando os registros
vivos e arquivados. Duas emissões concorrentes não ultrapassam o limite. Uma
transação que falha não gasta cota nem conserva emissões parciais. SQLSTATE
`55000 / INVITATION_QUOTA_EXCEEDED` indica bloqueio de capacidade; a API não foi
adaptada nesta fase para emitir HTTP 429.

Os tetos cumulativos impedem crescimento irrestrito também do arquivo imutável.
**A retenção não libera essa capacidade.** É uma escolha defensiva com impacto
operacional: uma empresa ou ator que atingir o teto deixa de emitir convites.
Não há reset administrativo, purga ou aumento de cota por configuração mutável.
Necessidades de capacidade maior exigem revisão e outra evolução versionada;
não há procedimento implementado de exportação/purga que renove o teto.

Dados anteriores que já excedam um limite são preservados; novas emissões ficam
bloqueadas. Esses tetos valem por tenant provisionado, não para a quantidade
global de tenants nem para outros dados da aplicação.

## Retenção auditável

Somente o dono revisado dos metadados, com privilégio DBA e sessão em `origin`,
pode chamar `private.erp_retain_invitation_authorizations(tenant_uuid, limite)`.
`anon`, `authenticated`, `service_role` e os papéis de capacidade não recebem
permissão para executar a retenção ou manipular o arquivo.

O procedimento exige runtime disponível e aceita lotes de 1 a 500 tickets.
Arquiva somente registros cuja expiração ocorreu há mais de 30 dias. Para cada
ticket conserva o JSON completo, ID, tenant, ator, datas, resultado
`consumed`/`expired`, SHA-256 da representação JSONB e instante de arquivamento.
O INSERT é validado contra o ticket bloqueado; o DELETE da tabela operacional
exige cópia idêntica no arquivo. Ambos ocorrem na mesma transação.

UPDATE, DELETE e TRUNCATE do arquivo são recusados, inclusive na sessão DBA
normal. Um ID arquivado não pode voltar à tabela operacional; associação e
binding de um ID já removido não restauram sua autorização. O gate de recuperação
também verifica checksums, metadados, resultado, idade e ausência de duplicação
entre arquivo e tabela operacional. Esse checksum não substitui a confiança no
DBA: um superusuário que deliberadamente altere todos os mecanismos continua
fora da fronteira de proteção dos papéis operacionais.

Exemplo para **PostgreSQL local descartável já validado**, como dono dos metadados:

```sql
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT private.erp_retain_invitation_authorizations('TENANT_UUID'::uuid,500);
SELECT private.erp_assert_recovery_integrity();
COMMIT;
```

O placeholder deve ser substituído pelo tenant conferido. Repetir lotes até o
procedimento retornar zero; registrar fora do banco o resultado operacional
necessário, sem credenciais. Falha no lote ou em uma etapa posterior antes do
COMMIT reverte cópia e exclusão. Nenhum agendamento ou serviço foi criado.

## Operações incompletas

Um ticket não consumido expira normalmente e entra na retenção após o prazo
histórico. Não estender validade, desconsumir, alterar destinatário já vinculado
ou reconstruir um ID arquivado. Uma nova tentativa exige nova autorização,
capacidade disponível e a identidade confirmada pelo fluxo legítimo de Auth.

Auth/SMTP e SQL continuam fora de uma transação distribuída. Um convite de
e-mail já enviado pode sobreviver a uma falha SQL. Esta migration não cancela
e-mail, apaga usuários Auth nem implementa reconciliação/reenvio de convites
existentes. Essas ações exigem investigação autorizada do fluxo de identidade;
não se deve compensar a falha concedendo membership diretamente.

## Cadeia de confiança e instalação

O manifesto `supabase/recovery/reviewed-history-v5.json` é obrigatório no harness.
Contém o perfil local revisado PostgreSQL 17.11, dono `postgres`, imagem fixada,
proveniência dos arquivos históricos e checksums completos das referências
v1–v4. O snapshot v4 independente tem SHA-256:

`d2edcdbeb4d0a02e0e39850842699fd3b7a5736e2c5555900205956f1c32b47e`

A âncora ativa de definições v5 é:

`236f9df1aedbaefdfcd9982b5209e1c3c45e2dbb1dce785a6af628fe63aba146`

É SHA-256 do objeto ordenado de todos os fingerprints do snapshot, excluindo
apenas o corpo de `private.erp_assert_reviewed_definitions()` para evitar uma
referência circular; esse corpo está incluído no snapshot completo do selo.
Não foi calculada a partir de um banco sendo atualizado. Os deltas SQL revisados
foram ensaiados no cluster descartável e revertidos antes de instalar o novo selo.

A migration exige manutenção, valida o estado v4, drena writers, revalida e
confere sua referência completa independente antes do DDL. Somente depois de
comparar a definição corrente à literal revisada insere
`private.erp_recovery_schema_seal_v5`, com as quatro referências anteriores.
Nenhuma referência histórica é sobrescrita. O inventário explícito evolui de
50 para 52 relações permanentes, acrescentando arquivo e selo v5. Os verificadores
v4 qualificados e suas proteções de ACL, papéis, RLS e durabilidade permanecem.

O fluxo de instalação é: v4 íntegra → entrada em manutenção pelo runbook
existente → v5 transacional → validação → retomada pelo runbook existente.
Falha mantém a manutenção para investigação e reverte o DDL v5; não ignorar o
gate nem recalcular fingerprints para aceitar o estado encontrado. O CLI
Supabase não estava disponível; o nome versionado segue o script preparatório.
Nenhuma instalação de dependências ou aplicação em serviço remoto ocorreu.

Perfis de provedores, donos ou ACLs distintos precisam de certificação
independente. A aprovação local não autoriza instalação em Supabase hospedado.

## Reprodução local

Requer Python, Node e dependências existentes do repositório, Docker Linux local
validado e a imagem já disponível:

`postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`

```powershell
python -B scripts/test-invitation-lifecycle-v5.py
python -B scripts/test-invitation-lifecycle-v5.py --fixed-synchronization-only
python -B scripts/test-invitation-lifecycle-v5.py --regressions
python -B scripts/test-invitation-lifecycle-v5.py --baseline
python -B scripts/test-recovery-integrity-v4.py
python -B tests/test_postgres_harness.py
```

O harness usa o endpoint local comprovado, `--pull=never`, `--network none`,
PGDATA em tmpfs, sem portas ou volumes externos. Cria nomes/labels únicos e
remove somente IDs de containers próprios. SQL usa UTF-8 binário. Os dados são
sintéticos; não há chamadas a Supabase Auth, SMTP, PostgREST ou bancos remotos.
Os testes de upgrade possuem fixtures independentes e comparam os dados de
todas as relações preexistentes, excetuando runtime e eventos da manutenção.

O caso de quatro transações usa o grafo real de espera e trata separadamente
barreira falha, timeout, saída antecipada e `40P01`. Na referência v4 comprova
o ciclo; em v5 comprova espera pelo fence e exige conclusão sem deadlock, com
recusa dos convites após desativação. Não utiliza uma espera fixa como prova
de ordem. A limpeza fecha o controlador antes de aguardar workers e confirma
ausência das sessões próprias, inclusive em falhas intermediárias.

## Validação registrada nesta implementação

Todos os resultados abaixo foram executados; não são projeções:

| Conjunto | Resultado final |
| --- | ---: |
| Instalação, upgrade, rollback e defesas v5 | 28/28 |
| Lifecycle, revogação, restauração e recuperação históricos depois de v5 | 76/76 |
| Integridade v4 na versão histórica preservada | 21/21 |
| Referências dos três achados e coordenação sobre v4 | 6/6 |
| Segurança offline da infraestrutura PostgreSQL | 38/38 |

No ensaio de referência, o ciclo completo foi observado e o PostgreSQL retornou
`40P01`. No ensaio v5, os dois comandos de desativação concluíram com sucesso e
os dois convites retornaram `42501`, sem deadlock ou timeout. A espera pelo
índice único até a expiração reverteu a inserção e deixou `consumed_at` nulo.
Os checksums de todas as relações preexistentes comparadas no upgrade e as
quatro referências históricas permaneceram iguais.

Na continuação, os 28 casos v5, os 76 históricos e os 38 offline foram repetidos
com aprovação. Uma rechecagem isolada adicional do caso cumulativo por empresa
também passou (1/1): após arquivar 500 de 4.096 tickets, os 3.596 vivos mais
os 500 arquivados continuaram impedindo a emissão por um ator sem histórico
pessoal. O caso permanece incluído no conjunto dos 28 testes v5.

Duas falhas iniciais dos testes históricos apontaram diferença no código de
negação em manutenção. A versão final mantém o contrato anterior com verificação
de permissão antes do fence e a repete depois; os 76 casos foram reexecutados.
Uma expectativa inicial de imutabilidade do arquivo foi corrigida para o
SQLSTATE `55000` do trigger histórico, sem alterar o trigger para aceitar escrita.

Não foram reexecutados nesta fase testes Node/PGlite, frontend ou integrações
reais com Auth/SMTP/PostgREST. Não há certificação de carga, produção, perfil
Supabase hospedado ou de todas as transações administrativas possíveis.
