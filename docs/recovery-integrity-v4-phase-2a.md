# Integridade e recuperação — evolução v4

Implementação local na branch `fix/convites-autorizacao-atomica`. A migration
`20261014025551_erp_recovery_integrity_v4.sql` evolui os verificadores depois de
v3. As 17 migrations históricas, a migration v3, a API e as funções de negócio de
convites permanecem intactas. Não há aplicação em Supabase hospedado.

## Âncora ativa e referências históricas

Após instalar a migration, o gate usa `private.erp_recovery_schema_seal_v4`.
As tabelas de referência v1, v2 e v3 e seus registros não são regravados.
V4 acrescenta uma tabela permanente: o inventário passa de 49 para **50 relações**.
As 27 tabelas empresariais e as invariantes existentes continuam protegidas.

Âncora literal SHA-256 v4:
`de1ef206612099cc770f0719d3e4e442df474a3b96868f537f2e7bfddfd3183f`.

O snapshot v4 usa SHA-256 por entrada. O digest literal inclui todas as entradas,
inclusive ACLs de identidade, memberships, schemas e defaults. Só o corpo do
próprio verificador literal é excluído para evitar autorreferência; owner, ACL e
configuração desse verificador participam da âncora, e seu corpo permanece na
comparação com o snapshot completo. Não existe refresh/reseal operacional.

`supabase/recovery/reviewed-history-v4.json` registra os fingerprints completos
das referências históricas, as âncoras MD5 anteriores e os hashes dos fontes.
O SQL incorpora os fingerprints como literais independentes. Ele não depende de
ler um arquivo no servidor, nem aprende hashes de um banco em atualização.

| Referência histórica | SHA-256 do JSONB completo |
|---|---|
| v1 | `2c2cd5840f1e0f472020d51ee13c4b11b0f3a95d355d00017996d3599821fff9` |
| v2 | `52b1bef63e2f8cec9c68f0015987b85d86ef005ff382c8de62148e4e25b03912` |
| v3 | `d3cb51800efc910fb2a605cfe094ee84474d90ff82f58de5c85911ce175634d7` |

Canonicalização: SHA-256 dos bytes UTF-8 de `snapshot::pg_catalog.text`.
Os fingerprints foram reproduzidos a partir dos fontes preservados em clusters
limpos descartáveis. Uma referência alterada, inclusive em campos fora dos antigos
digests parciais, não pode virar automaticamente uma referência confiável de v4.

## Correções e ordem da transição

1. Exigir operador confiável, owner de metadados e PostgreSQL 17. Rejeitar sombras
   temporárias de catálogos ou tipos antes de chamar os verificadores legados.
2. Bloquear runtime, validar o manifesto histórico e o estado operacional v3.
3. Exigir manutenção, drenar as relações protegidas com locks exclusivos e
   revalidar referências e integridade antes de modificar os verificadores.
4. Criar o selo v4 com RLS, sem grants de aplicação e com triggers contra
   UPDATE/DELETE/TRUNCATE; evoluir somente os verificadores de recuperação.
5. Validar o digest literal e as invariantes antes de inserir a nova referência.
   Inserir os fingerprints históricos literais e validar novamente antes do COMMIT.

Toda a evolução pertence a uma transação. Falhas não deixam funções, permissões
ou referência v4 parciais. Manutenção previamente ativada permanece ativada se
a migration falhar; não se deve retomar a aplicação após uma falha.

Os verificadores qualificam catálogos, funções de catálogo e tipos com
`pg_catalog.`. Tipos usam nomes canônicos (`int4`, `int8`, `bool`, `regclass`,
`record`, etc.). O caminho `pg_catalog,pg_temp` também estabiliza o deparse das
definições quando existem tipos temporários homônimos. Esse caminho é uma camada
adicional: as consultas não dependem de resolução implícita de catálogos.

ACLs de todas as relações/colunas ERP e base entram no snapshot e na âncora.
Para `auth.users`, são protegidos persistência, owner, grants da tabela e grants
explícitos de todas as colunas para outros papéis. A definição interna completa
do Auth gerenciado não é atestada: um campo novo sem grants não muda esse escopo;
um grant nesse campo muda a âncora e é recusado, mesmo após tentativa de reseal.

## Perfil suportado e instalação

O manifesto completo é deliberadamente restrito ao perfil local revisado:
PostgreSQL 17.11, owner de metadados `postgres`, roles/ACLs da fixture e imagem:
`postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`.

Owners, ACLs ou referências históricas diferentes exigem um perfil independente
revisado e uma evolução versionada. **Nunca substituir os fingerprints pelos
valores observados no banco que falhou.** Um manifesto de produção não foi
produzido, e este arquivo não autoriza execução remota.

Instalação limpa: preparar as 17 migrations originais, entrar em manutenção,
instalar v3 e retomar; depois entrar em manutenção e instalar v4. Atualização:
partir de v3 íntegro, com referências revisadas, em janela exclusiva de DDL e
escritores drenados. Verificar com `phase-2a-verify.sql` antes de executar
`phase-2a-resume-normalized.sql`. Os testes abaixo executam essa ordem somente em
clusters descartáveis. Não usar uma conexão genérica de projeto para reproduzi-los.

A CLI Supabase não estava disponível nesta preparação. O arquivo SQL aditivo usa
o timestamp já referenciado pelo teste preparatório; nenhum pacote foi instalado,
nenhum `db push`, `db reset` ou comando de banco hospedado foi executado.

## Reprodução segura no Windows

Python, Node/dependências locais, Docker Linux e a imagem fixada já devem existir.
Disponibilizar a CLI Docker no PATH da sessão, sem `DOCKER_HOST`/`DOCKER_CONTEXT`.
O harness valida o endpoint real e usa `--pull=never`, rede `none`, `tmpfs`, sem
portas/volumes externos. Somente IDs comprovadamente criados recebem limpeza.

```powershell
python -B scripts/test-recovery-integrity-v4.py --baseline
python -B scripts/test-recovery-integrity-v4.py --manifest
python -B scripts/test-recovery-integrity-v4.py
python -B scripts/test-recovery-integrity-v4.py --regressions
python -B tests/test_postgres_harness.py
python -B scripts/test-recovery-durability.py
python -B scripts/test-recovery-seal-hardening.py
python -B scripts/test-recovery-role-invariants.py
python -B scripts/test-coordinated-recovery.py
git diff --check
```

O manifesto é obrigatório inclusive nos modos baseline/manifest. Esses modos não
escrevem fingerprints. A baseline reproduz a vulnerabilidade original de v3 para
preservar evidência, e não deve ser interpretada como aprovação de v3.

O modo `--regressions` aplica a atualização explicitamente antes dos casos
existentes de lifecycle, revogação, restauração e recuperação. Não duplica testes
herdados. Uma assertion de erro legado é adaptada apenas nesse runner: os mesmos
ataques SQL reais agora exigem a recusa antecipada pela âncora v4. Os arquivos das
suítes históricas e seus resultados de v1/v2 não são modificados.

## Resultados executados — 2026-10-14

| Validação | Resultado |
|---|---|
| Testes direcionados v4, incluindo baseline original | 21/21 |
| Casos existentes após v4: lifecycle/revogação/restauração/recuperação | 76/76 |
| Durabilidade histórica v2 | 10/10 |
| Hardening histórico B1/B2 | 19/19 |
| Invariantes históricas B3 | 15/15 |
| Recuperação coordenada histórica | 34/34 |
| Infraestrutura offline, incluindo registro do entrypoint v4 | 38/38 |
| Instalação limpa, upgrade com dados e teto restaurado, falha tardia | Comprovados pelos testes direcionados |
| SHA-256 do estado revisado e manifesto obrigatório | Conferidos; referência ausente/adulterada é recusada |

Os 21 testes incluem seis casos de baseline/proveniência que preservam evidência
dos problemas originais; não são todos cenários novos de v4. Subcasos não são
contados como funcionalidades adicionais. As regressões preservam SQL real e
checagens de rollback, manutenção, permissões e dados.

Na validação final, os IDs de containers, redes, volumes e imagem coincidiram
antes/depois, com o mesmo daemon local. Restaram zero containers, zero volumes,
três redes e uma imagem. As instâncias de PostgreSQL foram removidas somente
pelo harness após prova de propriedade.

O conjunto final passou depois de corrigir preparações de teste que falhavam
antes do gate (pseudo-tipo `anyarray` de `pg_attribute`, FKs que impedem Auth
UNLOGGED) e de explicitar a representação estável com tipos temporários. Nenhum
erro foi convertido em aprovação fictícia nem resolvido abrindo grants legados.
Node/PGlite, frontend/build e infraestrutura hospedada não foram repetidos nesta
etapa de verificadores PostgreSQL.

## Limitações

- O selo não protege contra um DBA pleno que substitua os verificadores e os
  artefatos revisados. Exige controle de DDL, sessão operacional confiável e janela
  exclusiva; não constitui monitoramento contínuo.
- Auth/SMTP/PostgREST hospedados, backup/PITR, crash recovery, armazenamento e
  outros perfis/versionamentos de PostgreSQL não foram certificados.
- As correções de concorrência e API das outras auditorias continuam fora desta
  evolução. Nenhuma lógica de convites foi modificada.
- A proibição de `auth.users` UNLOGGED pode ser imposta pelo próprio PostgreSQL
  por causa das FKs. Esse caso é distinguido das recusas produzidas pelo gate.
- Resultados históricos anteriores deste repositório não equivalem à execução
  desta versão; considerar somente a tabela de resultados desta entrega.

Referências: [search_path PostgreSQL 17](https://www.postgresql.org/docs/17/runtime-config-client.html),
[SHA-256 nativo](https://www.postgresql.org/docs/17/functions-binarystring.html).
