# Clientes com Observações — extensão gerenciada v6/3

Estado: **certificada localmente; instalação hospedada não certificada nem autorizada**.
Base Git: `e48b23378b469fd29c49b57b460e79f27e2cfcb3`, branch
`fix/convites-autorizacao-atomica`. O visual do modal não foi alterado nesta etapa.

## Contrato e integridade

Sequência: fundação gerenciada **v6/1 revisão 2 → v6/2 → v6/3**.
Esta é a linhagem gerenciada independente, não uma instalação automática de v1–v5/C1/O1.
Todos os SQLs, manifestos e registros de referência anteriores são preservados.

A v6/3 adiciona `notes NOT NULL DEFAULT ''` à identidade privada e limita o campo
a 2.000 caracteres. Mantém as assinaturas das RPCs `hh_customer_read` e
`hh_customer_write`, UUID por tenant, CPF único por empresa, Owner, RLS, auditoria
sem conteúdo pessoal, controle de versão e ordem de locks existentes.

| Operação | Sem `notes` | `notes` explícito |
|---|---|---|
| Criar | Observações vazias | Grava o texto, inclusive vazio |
| Atualizar | Preserva Observações atuais | Substitui o texto; vazio limpa explicitamente |
| Repetir comando antigo | Retorna o recibo antigo sem nova mutação | Não aceita reutilizar a mesma operação com outro contrato/conteúdo |

Os comandos antigos conservam exatamente a normalização e o fingerprint de quatro
campos da v6/2. Os novos incluem Observações e um marcador de contrato no fingerprint.
Recibos anteriores não são reescritos nem recalculados; uma repetição antiga após
outras edições retorna seu recibo original, sem reverter o cadastro atual.

Referência nova independente, reproduzida em **duas fixtures limpas** com revisão
inteiramente revertida antes da inserção do selo:

- v6/2 anterior: `0968ea0d188ae411bfec94435b6580bb98898ca6966e61f027404eeecf070bf5`.
- v6/3 ativa: `035e0eaeb70f125387444dbe95436b9df49fea7efd901ea96bc7592d70949ab5`.
- SQL v6/3 SHA-256: `18a8d2d35c4d613bb0f9bd71a0c296e32bad8a5c5273e3bfd7c9757a56e2d60e`.

O preflight exige o corpo exato do verificador v6/2 e o snapshot anterior revisado.
Ele recusa bancos instalados com o antigo candidato de laboratório com Observações;
essa variante não é a release v6/2 revisada e não recebe conversão automática.
O verificador ativo passa a exigir v6/1, v6/2 e v6/3, sem sobrescrever suas linhas.
O corpo do verificador ativo, excluído do snapshot para evitar ciclo de hash, é
conferido separadamente no postflight e por `verification_sql()`.
O assembler verifica as fontes anteriores e o manifesto novo; ausência ou alteração
de fontes falha fechada. Não há substituição de manifesto em memória no caminho revisado.

## Instalação e recuperação

O instalador não ativa pilotos nem muda automaticamente manutenção. Exige executor
`postgres`, confirmação explícita `handyhub.managed_install='pilot-v6-3'`, manutenção
ativa e todos os pilotos desabilitados. Não admite reinstalação ou estado inesperado.

Os locks seguem runtime → tenants → pilotos → memberships → clientes. O lock no
runtime drena comandos em andamento; o `ALTER TABLE` requer lock exclusivo breve
na identidade privada. Outros tenants podem aguardar durante a janela: planejar
manutenção, transações curtas e respeitar o timeout de lock de cinco segundos.

DDL, substituição de funções, privilégios temporários e referência nova pertencem
a uma única transação. Falha intermediária/tardia reverte integralmente a instalação.
As funções continuam pertencendo ao papel técnico NOLOGIN/NOBYPASSRLS; CREATE no
schema é temporário dentro da transação e revogado antes do commit.

Após um commit bem-sucedido, **não há downgrade destrutivo automático**. Um incidente
exige manter o piloto bloqueado, preservar dados/recibos, diagnosticar e aplicar
correção aditiva ou restauração autorizada de backup comprovado. Não remover a coluna
ou substituir referências para voltar a aceitar um estado arbitrário.

O assembler fornece SQL, mas não possui conexão ou executor hospedado. Não executar
estes artefatos no staging sem nova autorização, qualificação real, backup/restauração
e validação de Auth/PostgREST. A API conserva a flag server-side desativada por padrão
e continua recusando PATCH sem Observações explícitas; a compatibilidade antiga existe
na RPC, não é um afrouxamento da API.

## Evidências locais

`scripts/test-managed-customer-notes.py`: **20/20**, sem falhas ou ignorados:

1. Criação, leitura e edição antigas continuam funcionando.
2. Perfis, tenant e DML privado negados.
3. Campos, CPF e duplicidades validados.
4. Repetição, versões e concorrência do contrato antigo.
5. Referência anterior, integridade e rollback de dados.
6. Instalação v6/2, falha tardia e baseline preservada.
7. Instalação v6/3, falha tardia, upgrade e preflight adulterado.
8. Revogação, manutenção e auditoria privada.
9. Criação com/sem Observações e rejeição de tipos/tamanhos inválidos.
10. Omissão preserva; texto altera; vazio limpa.
11. Upgrade conserva registros, auditorias, recibos e repetições anteriores.
12. Repetição concorrente do novo contrato não duplica a operação.
13. Corridas de versão e CPF resultam em um único vencedor.
14. Rollback reverte cadastro, Observações, recibos e auditoria juntos.
15. Observações protegidas por tenant, perfil e ACL; CPF não é global.
16. Adulteração de RLS, ACL de coluna, função ou referências é recusada.
17. Revogação após espera por lock observada é revalidada e negada.
18. Assembler recusa fonte alterada e manifesto ausente.
19. Postflight somente leitura detecta substituição do verificador.
20. Instalação exige manutenção e pilotos desabilitados, sem ativá-los.

A primeira rodada teve uma prova de adulteração interrompida por falta de ownership
antes de alcançar o gate. O teste foi corrigido para usar o proprietário técnico da
função; nenhuma permissão do produto foi ampliada. A rodada final passou integralmente.

O Docker usa exclusivamente endpoint local validado, imagem PostgreSQL fixada,
rede `none`, PGDATA tmpfs, sem portas/volumes externos. Limpeza somente por IDs
com propriedade comprovada e comparação dos inventários antes/depois.

Também passaram: **118/118** regressões Node no workspace e na cópia isolada de
publicação; TypeScript; lint direcionado; sintaxe Python; build integral de produção
isolado; **4/4** requisições HTTP bloqueadas com a flag ausente e zero chamadas ao
adaptador; fluxo HTTP criar → consultar → editar com Observações, repetição,
conflito de versão, CPF duplicado e perfis/tenant negados usando a release revisada.
A Home mantém a dívida de lint já registrada no diagnóstico anterior; não foi
declarado lint integral aprovado desse arquivo e nenhum visual foi redesenhado.
As **22/22** regressões PostgreSQL da fundação v6/1 também foram reexecutadas e
aprovadas, com inventário Docker preservado. No navegador, o Owner sintético editou
Observações pelo modal aprovado e, após fechar/reabrir, recuperou o texto persistido
na v6/3. A captura é evidência externa ao repositório; não integra o commit.
Comparação SHA-256: os 278 arquivos preexistentes acompanhados nesta etapa permaneceram
idênticos. As 20 migrations históricas e as 31 fontes da fundação foram conferidas.

Ressalva operacional: um encerramento anterior do piloto reportou diferença de
inventário Docker. Os snapshots daquela execução não estavam gravados; os eventos
disponíveis não comprovaram a causa exata. Não houve limpeza global nem remoção por
nome. O launcher agora grava inventários de IDs antes/depois fora do Git e reporta
diferenças. A repetição estritamente sequencial passou novamente em build, HTTP e
comparação final (`DOCKER_INVENTORY_PRESERVED=True`). Os dois JSONs dessa repetição
estão em `%TEMP%/handyhub-customer-functional-2qgcdwrf/`. Não atribuir o episódio a
reinicialização ou a outro processo sem evidência; manter os ensaios sequenciais.

## Reprodução sem serviços hospedados

```powershell
python -B scripts/managed_customer_notes_release.py
python -B scripts/test-managed-customer-notes.py
python -B scripts/local-managed-customer-notes-pilot.py --serve-seconds 300
```

O piloto usa os assemblers revisados v6/1, v6/2 e v6/3, sem atalhos de assinatura,
e imprime sua URL temporária. O build usa configuração sintética de loopback, sem
`.env`. A cópia inclui apenas alterações de aplicação candidatas e a base publicada
dos demais arquivos; não depende de alterações intermediárias fora do commit.
Auth/PostgREST são adaptados localmente com identidades sintéticas, não uma certificação
de GoTrue/PostgREST hospedado. PostgreSQL, RPC, RLS, API Next e persistência são reais.

Revisão independente de metadados, sem gravar manifesto automaticamente:
`python -B scripts/test-managed-customer-notes.py --review`.
Harnesses Docker devem ser executados sequencialmente para comparar inventários.

## Conjunto exato proposto para commit

Aplicação e testes do modal já auditados, junto da cadeia revisada:

1. `src/app/page.tsx`
2. `src/app/clientes/cadastro-inteligente/page.tsx`
3. `src/app/api/customers/route.ts`
4. `src/components/customers/CustomerModalForm.tsx`
5. `src/lib/customers/registration.ts`
6. `src/lib/customers/persistence-client.ts`
7. `src/proxy.ts`
8. `tests/customer-registration.test.mjs`
9. `tests/customer-modal.test.mjs`
10. `tests/customer-persistence-route.test.mjs`
11. `supabase/install/managed-v6/2/customers.sql`
12. `supabase/install/managed-v6/2/reviewed.json`
13. `scripts/managed_customers_release.py`
14. `scripts/test-managed-customers.py`
15. `supabase/install/managed-v6/3/customers-notes.sql`
16. `supabase/install/managed-v6/3/reviewed.json`
17. `scripts/managed_customer_notes_release.py`
18. `scripts/test-managed-customer-notes.py`
19. `scripts/local-managed-customer-notes-pilot.py`
20. `docs/managed-customer-notes-v6-3.md`

Mensagem sugerida: `feat(customers): add reviewed v6/3 notes extension and guarded Home registration`.
Nada foi adicionado ao índice. Excluir todos os demais arquivos, inclusive componente
preparatório aposentado, diagnóstico anterior à v6/3, candidatos/laboratórios antigos,
C1/O1, evidências, backups, arquivos suspeitos, caches, `.env` e RAR. Preservá-los localmente.

## Limitações e próxima etapa

Não há migração automática de `tenant_data` nem conversão dos consumidores legados de
agenda, atendimentos e vendas por nome. A regra de 24 horas não foi implementada.
Dados pessoais são protegidos por schema privado, ACL/RLS e RPC; não se alega proteção
contra administradores do banco ou backups legíveis. Não usar dados reais neste piloto.
Antes de qualquer ativação hospedada: confirmar executor/perfil, schema, backups,
Auth/PostgREST/RLS reais, autorização explícita e impacto da indisponibilidade do
cadastro normalizado enquanto a flag permanecer ausente.
