# Convites: autorização transacional e integridade v3

## Escopo

Correção local na branch `fix/convites-autorizacao-atomica`, base `8a77894`.
Nenhuma implantação, alteração hospedada, envio real de e-mail, commit ou push.
Os rascunhos experimentais e os arquivos não relacionados foram preservados.

O antigo `POST /api/team/invite` consultava uma membership, chamava Auth Admin e
inseria outra membership com `service_role`. Uma revogação confirmada entre essas
etapas não era reconsiderada pela inserção privilegiada.

## Protocolo

1. A rota mantém autenticação `getUser`, origem, JSON limitado a 4096 bytes,
   validação de entrada, template guard e redirect configurado.
2. A sessão autenticada chama `erp_authorize_invitation(tenant,role)`. O ator vem
   exclusivamente de `auth.uid()`. PostgreSQL registra uma autorização privada,
   com tenant/cargo/ator fixos e validade de dez minutos.
3. Auth Admin envia o convite. Somente o servidor chama
   `erp_bind_invited_membership(authorization,Auth-returned-UID)` como
   `service_role`. A vinculação é única e não cria membership. Nenhum campo do
   cliente seleciona o ator, o UID final ou a autorização a ser vinculada.
4. A sessão original chama `erp_create_invited_membership` com tenant, cargo,
   UID e autorização. PostgreSQL revalida a autoridade vigente, confere a
   vinculação exata, insere sem upsert e consome a autorização na mesma transação.

O ticket é necessário porque uma RPC autenticada que aceitasse somente um UUID
arbitrário permitiria contornar o fluxo administrativo de convite. Clientes não
podem vincular tickets, ler a tabela privada, forjar outro ator ou reutilizar uma
autorização consumida. A chave de serviço continua sendo uma fronteira confiável;
o cliente administrativo é usado para Auth e para vinculação, nunca para a
associação final.

Email e PostgreSQL não formam uma transação distribuída. Se a associação falhar,
o email/usuário Auth pode permanecer. A resposta nunca promete cancelamento do
email; nenhuma exclusão automática de conta, reativação ou associação alternativa
é tentada. Um convite sem membership não concede acesso ao tenant. Um erro depois
do commit pode deixar resultado HTTP ambíguo; duplicidade não reativa nem promove.

## Locks, RLS e menor privilégio

Ordem: runtime singleton `FOR SHARE`, tenant `FOR SHARE`, membership do ator
`FOR SHARE`, ticket `FOR UPDATE`, eventual funcionário destinatário `FOR SHARE`,
inserção da membership e consumo do ticket. Os locks duram até commit/rollback.
Manutenção bloqueia runtime primeiro, como os runbooks existentes. SHARE conflita
com atualizações de estado, ao contrário de KEY SHARE.

Revogação/suspensão/manutenção que confirmar primeiro provoca recusa; se o
convite adquirir os locks primeiro, a mudança aguarda sua conclusão. Isso é
serialização, não autorização baseada numa consulta antiga.

Não se adquire lock do funcionário do ator depois de sua membership: o lifecycle
existente bloqueia funcionário antes da membership alvo. A leitura de sua
inatividade permanece obrigatória; a desativação operacional não pode confirmar
a atualização da membership do ator enquanto o convite mantém SHARE nela.

`handyhub_invitation_operator` é NOLOGIN, NOINHERIT, sem SUPERUSER/BYPASSRLS,
CREATE em schemas permanentes ou memberships. Schemas temporários não podem
sombrear os helpers qualificados. UPDATE é concedido apenas nas colunas necessárias para
os row locks. As policies de UPDATE de tenant/ator/runtime têm `WITH CHECK(false)`:
permitem selecionar para lock, mas recusam alterações reais. Policies de leitura
e inserção são restritas ao ator/tenant/ticket; não há `USING(true)` experimental.
Lookups privados de metadados são helpers sem execução pública, com search_path
vazio. A invariante nova verifica ACLs diretas e privilégios efetivos, inclusive
PUBLIC, para impedir expansão de privilégios da capability.

Owner pode convidar Manager/Employee; Manager somente Employee. Master isolado,
Employee, ator inativo, tenant fora de Ativo e runtime indisponível são recusados.
Uma membership previamente revista/revogada não recupera autorização de convite
por restauração de um teto somente de leitura: o registro de revisão mantém
essa capacidade bloqueada conservadoramente. Um eventual retorno dessa capacidade
precisa de política explícita futura; não é inferido dos grants de leitura.

Destinatário existente/duplicado não sofre upsert ou promoção. Histórico de
revogação e vínculo operacional inativo também impedem associação. Os guardas
históricos permanecem instalados. Um conflito ou deadlock aborta a transação;
não existe fallback privilegiado.

## Migration aditiva e selo

Nova migration: `20261013010000_erp_invitation_integrity.sql`.
As 17 migrations anteriores não foram editadas. A CLI Supabase não está disponível
neste ambiente; nenhum pacote foi instalado. O arquivo segue a sequência
versionada do repositório e foi exercitado pelo harness próprio.

A instalação exige manutenção explícita, janela exclusiva de DDL e escritores
drenados. Ela bloqueia runtime e as relações na ordem dos runbooks e valida v2
antes e depois de drenar escritores. Drift preexistente impede a instalação.

O helper de snapshot permanece idêntico. Evoluem somente as invariantes de roles,
segurança, inventário permanente e o verificador da referência ativa. Acrescentam-se
o protocolo de convites, suas policies/grants, a invariante independente de
privilégios e duas tabelas privadas. O inventário passa de 47 para 49 relações;
as 27 tabelas empresariais continuam inalteradas.

v1 e v2 mantêm seus registros íntegros. v3 armazena também os checksums das duas
referências anteriores e recusa adulteração delas. A nova tabela de referência
é privada, com RLS e triggers contra UPDATE/DELETE/TRUNCATE. A evolução inteira
é transacional; não é um comando de reseal.

Digest de definições v3: `ba9386b07b1048f02d35781d5edbae9c`.
Foi fixado após revisão do delta conhecido e verificação em transação descartável
com rollback, partindo de v2 verificado. Não existe código de instalação que
calcule um digest e substitua o literal para aceitar objetos locais. Não editar
esse literal diante de drift: investigar a divergência.

## Reprodução local

Docker local autorizado, Linux AMD64 e imagem já presente:
`postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`.
No Windows, disponibilizar a CLI no PATH da sessão, sem configurar DOCKER_HOST ou
DOCKER_CONTEXT. O harness valida o contexto e seu endpoint real, fixa `--host`,
usa rede none/tmpfs/sem portas ou volumes externos e remove apenas IDs próprios.

```powershell
python -B tests/test_postgres_harness.py
node --test
python -B scripts/test-invitation-atomic.py
python -B scripts/test-invitation-v3-regressions.py
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js --no-cache src/app/api/team/invite/route.ts tests/onboarding-routes.test.mjs tests/helpers/invitation-route-postgres.mjs
git diff --check
```

Também executar separadamente os dez harnesses históricos `test-appointment-read`,
`test-recovery-durability`, `test-recovery-seal-hardening`,
`test-recovery-role-invariants`, `test-coordinated-recovery`,
`test-membership-restoration`, `test-membership-revocation`,
`test-employee-lifecycle`, `test-historical-snapshots`, `test-product-concurrency`:
`python -B scripts/<nome>.py`. Eles mantêm a fixture histórica de 17 migrations.
O runner v3 instala explicitamente a migration nova sobre essas fixtures; não
altera silenciosamente os testes históricos de bootstrap v1/v2.

As novas corridas usam uma conexão de controle e advisory lock. A liberação ocorre
somente após observar o vencedor no gate e comprovar que o perdedor está bloqueado
por ele via `pg_blocking_pids`. Polling tem prazo; sleep não determina o vencedor.
O teste de API usa o handler real, um Auth controlado e RPCs reais no PostgreSQL;
a revogação intermediária é confirmada no banco, não decidida pelo mock.

O adaptador Node também confere daemon, ID/imagem, labels de propriedade, rede,
mounts e ausência de portas antes de enviar SQL. Ele recebe a proveniência que
o harness confirmou após a criação; não aceita silenciosamente um container
arbitrário preexistente.

## Resultados locais efetivamente executados

| Validação | Resultado |
|---|---|
| Dez suítes históricas, fixture de 17 migrations | 154/154; as quatro suítes com assertions adaptadas também foram repetidas |
| Sete suítes após atualização explícita para v3 | 110/110, sem contar cenários herdados duplicados |
| Convites, concorrência, instalação e atualização v3 | 29/29 |
| Rota real com SQL real após hardening do adaptador | Reexecutada individualmente e aprovada |
| Node/PGlite e handlers | 113/113 |
| Segurança offline da infraestrutura | 38/38 |
| TypeScript sem emissão/incremental | Aprovado |
| Lint dos arquivos JS/TS desta correção | Aprovado |
| Sintaxe Python e diff check | Aprovados |

As 110 regressões repetem controles existentes; não são 110 funcionalidades novas.
As assertions históricas de JSON distinguem a fixture aberta do estado fechado
após manutenção/v3. O segundo exige erro SQL 42501 real e ausência de grants;
Master é verificado separadamente por identidade administrativa. Nenhum grant
legado foi reaberto para satisfazer testes.

A instalação limpa usa um cluster próprio, pois roles são globais ao cluster.
A atualização foi verificada com checksums de todas as relações preexistentes
public/private/auth, excluindo os registros de runtime/eventos que a manutenção
altera deliberadamente. Dados e teto restaurado `products.read` foram preservados;
falha tardia confirmou rollback de DDL e referências.

Inventário Docker final igual ao inicial: zero containers, zero volumes, três
redes e uma imagem, com IDs preservados e identidade do daemon inalterada.
As 17 migrations são byte a byte iguais a `e46d15d`. JPGs, RAR, ambiente,
rascunhos, probes e bytecode preexistentes foram preservados. Sem commit/push.

Logs e registro de hashes desta sessão estão em
`C:/Users/Thales Alvim/.codex/visualizations/2026/10/13/01a136d8-db52-76b2-98af-f22395bbd77a/invitation-atomic-validation/`.
Não são parte automática de um futuro commit.

Referências: [locks PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html),
[policies PostgreSQL 17](https://www.postgresql.org/docs/17/sql-createpolicy.html),
[Auth Admin inviteUserByEmail](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail).

Limites: Auth/SMTP/PostgREST hospedados, pools, backup/PITR e armazenamento
persistente continuam sem certificação. JSON legado e outras pendências da Camada
1C permanecem fora desta correção. Retenção/rate limiting dos tickets e revisão
operacional de convites não associados exigem política própria. Não aplicar
automaticamente a migration em nenhum ambiente remoto.
