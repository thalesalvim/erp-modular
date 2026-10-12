# Fase 2A — M4: histórico imutável de vendas e atendimentos

Base `95ed78ac43d3e6e6df6bbd52e46b028863d9a411`, branch
`codex/tenant-permissions-phase-2a`. Implementação e validação exclusivamente locais.
Nenhum backfill, alteração remota, tela, relatório, commit ou push nesta entrega.

## Modelo e fontes históricas

O legado `SaleItem` e `erp_sales` representam **uma linha de produto**, não cabeçalho
de pedido/carrinho. Mantemos as tabelas e FKs existentes. Não criamos um checkout novo.

| Operação | Snapshot operacional | Valores históricos |
| --- | --- | --- |
| Venda/linha | Produto, vendedor, versão-fonte do produto, data, quantidade; cliente opcional na ponte existente | Preço unitário praticado, quantidade, bruto, desconto absoluto da linha, líquido, moeda e pagamento |
| CMV da linha | Referência estável à mesma linha/tenant; origem documentada | Custo unitário reconhecido, quantidade e CMV total gerado |
| Atendimento | Cliente, serviço, profissional, versão-fonte do serviço, data/hora | Uma execução de serviço; bruto praticado, desconto absoluto, líquido, moeda e pagamento |

Novas colunas de snapshots coexistem com IDs cadastrais. IDs servem para integridade e
autorização por UUID; `*_name_snapshot` representa o nome **na leitura de registro da
operação**. JOIN com o cadastro continua podendo mostrar seu nome atual: não é fonte
histórica. Futuras APIs devem usar snapshots, sem fallback silencioso ao nome atual.
Agendamentos M3 continuam operacionais, com nomes atuais, sem alteração de contrato.

Estados explícitos: `incomplete` para linhas anteriores/desconhecidas, `posted` para
novas operações completas. Não preenchermos valores faltantes com dados atuais, zero,
nome “Geral”, custo cadastral ou moeda presumida. Os valores já existentes permanecem.
Registros incompletos não podem ser considerados completos nem incluídos silenciosamente
num futuro cálculo de margem/DRE. Sua reconciliação será uma operação separada autorizada.

## Comandos, atomicidade e auditoria

- `erp_post_sale`: Owner com `sales.create`, UUID estável do registro, UUIDs de produto,
  vendedor e cliente opcional, versão esperada do produto, data, quantidade, preço
  praticado, desconto, custo reconhecido explícito e referência documental, pagamento/moeda.
- `erp_post_attendance`: Owner com `attendances.create`, UUIDs do registro, serviço,
  profissional/cliente, versão esperada do serviço, data/hora, bruto/desconto, pagamento/moeda.
- As funções retornam **somente UUID**, resolvem nomes no banco e não aceitam ator ou
  rótulos históricos forjados. Uma única consulta obtém todos os nomes/versão-fonte em
  snapshot SQL comum. Um rename posterior não muda essas cópias. Não bloqueiam/escrevem
  o catálogo; uma alteração concorrente após a captura pode confirmar normalmente.
- Versão divergente no momento da captura: `40001 VERSION_CONFLICT`. Registro repetido:
  `23505`, sem sobrescrever ou adicionar outra auditoria. Não repetir automaticamente
  com UUID novo após timeout/resultado incerto; confirmar o registro pelo UUID original.
- Valores monetários não negativos/finito, máximo `999999999999.99` e centavos exatos;
  frações de centavo são rejeitadas, não arredondadas. Quantidade é inteira positiva.
  Bruto = quantidade × preço; líquido = bruto − desconto, com desconto ≤ bruto.
  Datas devem ser finitas; regras de período/fechamento contábil continuam pendentes.
- Root, financeiro, CMV, cliente e auditoria são atômicos. Constraint triggers adiáveis
  impedem confirmar root completo sem valores consistentes, CMV e auditoria privada.
  Auditoria registra tenant, operação, ator Auth e horário, com FKs compostas e unicidade.
- O comando cria root provisório, insere fragmentos/auditoria e finaliza somente esse
  UUID novo de `incomplete` para `posted`. Nada parcial fica visível fora da transação.
  Inserções tardias em fragmentos opcionais são negadas, inclusive na mesma transação
  após finalização. O protocolo não depende de GUC, xmin ou identidade de subtransação;
  postagem sob savepoint também foi testada. A versão técnica do root passa de 1 para 2
  na finalização interna, sem disponibilizar edição de um histórico existente.
- Depois de `posted`, UPDATE/DELETE, troca de responsável/tenant/estado/quantidade e
  TRUNCATE são negados por triggers; DML de cliente também não tem grants. Parent oculto
  por RLS causa negação, nunca interpretação de “incompleto editável”.

`history-posting.ts` descreve argumentos readonly, UUIDs, moeda explícita e dinheiro em
strings decimais. SQL continua sendo a validação definitiva. Não há adapter HTTP/JSON;
leitura monetária futura deve serializar decimais sem cálculos binários de ponto flutuante.

## Decisões contábeis e limites de aprovação

**CMV de mercadorias** reside em `erp_sale_cmv`, separado da receita e das despesas.
CMV = quantidade vendida × custo unitário efetivo **declarado/documentado** na operação.
O custo cadastral atual não é fonte automática de CMV. `cost_basis=documented_manual`
e referência obrigatória permitem rastrear a declaração; SQL não comprova a veracidade
do documento ou avalia o estoque. A referência tem apenas validação textual (não nula,
1–500 caracteres após btrim), sem FK/cadastro documental: não comprova existência,
autenticidade ou vínculo do documento com o tenant. Essa verificação é uma pendência
do modelo manual, não uma garantia oferecida por `documented_manual`.
FIFO, custo médio, lotes, frete/tributos incorporáveis
e integração com estoque dependem de política aprovada. Custo desconhecido bloqueia
postagem completa de venda; custo zero só é aceito quando explicitamente informado
com evidência, sem default. Não é certificação fiscal/contábil.

Compra de estoque não é despesa operacional da DRE por conveniência: conceitualmente
adquire estoque/ativo; o custo é reconhecido conforme a operação e a política contábil.
Os comandos não criam `erp_expenses`, compra, pagamento, baixa/entrada física de estoque
ou lançamento de DRE. Não implantamos regime fiscal, competência ou conciliação bancária.
Custos de serviços/comissões/profissionais não têm modelo aprovado: não foram estimados
como zero nem convertidos em CMV de mercadorias; a margem de serviços permanece pendente.

Escopo local conservador **BRL somente**, argumento obrigatório, sem conversão cambial.
A interface legada usa reais; não atribuímos BRL a registros antigos sem prova. Outras
moedas ficam negadas até aprovação do modelo. Desconto é valor absoluto por linha/serviço,
sem rateio implícito de desconto de pedido. Manager/Employee não podem postar. CMV é
Owner-only até aprovação de permissão histórica específica: nem `finance.sales.read`
nem `finance.products.cost.read` concede esse novo custo histórico ao Manager.

## Cancelamento, devolução e ajuste — regras e bloqueio atual

**Não suportados por comando nesta etapa**, portanto negados. Originais postados nunca
são editados, excluídos ou rebaixados a incompletos. O desenho obrigatório futuro é:

1. Evento compensatório append-only com UUID próprio, FK composta ao original, tenant,
   tipo, motivo, documento, ator, datas da ocorrência/registro e valores da mesma moeda.
2. Cancelamento integral reverte uma vez os efeitos autorizados do original; não usa
   preço/custo atual. Duplicidade e soma de reversões acima do original devem ser rejeitadas.
3. Devolução parcial exige quantidade ≤ saldo devolvível e rateio/centavos aprovados;
   recomposição do estoque/CMV depende da devolução física e condição da mercadoria.
   Reembolso sem retorno físico não deve automaticamente reverter CMV.
4. Ajuste preserva original e eventos anteriores, registra diferença ou substituição
   vinculada, e exige evidência/aprovação. Correção tardia de custo não altera o CMV original.
5. Tudo atômico, com serialização por original para evitar reversão concorrente excessiva.
   Períodos fechados, regras fiscais e rateio devem ser aprovados antes de habilitar escrita.

Essas são restrições/contratos para aprovação, **não testes de um fluxo já implementado**.
Não criamos estruturas preparatórias de reversão nem telas de cancelamento nesta missão.
Na revisão, um ensaio PostgreSQL estrutural confirmou INSERT autorizado em uma tabela
sintética que referencia o original por FK composta, sem mudar o original. As proteções
atuais não bloqueiam essa referência futura. Isso não valida cálculo, regras ou concorrência
de um estorno implementado. Script/log locais: `/tmp/handyhub-m4-review.py` e
`/tmp/handyhub-m4-review.log` (1 teste aprovado; tabela descartada com o container).

## Segurança e compatibilidade

Duas migrations adicionais: snapshots/constraints/RLS e comandos. Apenas uma tabela
pública adicional (CMV) e uma privada de auditoria; 27 tabelas empresariais agora.
Financeiro e nomes não migram para JSON. A matriz da Fase 1 e M1/M2/M3 foram preservadas.
Os novos contratos são comandos de criação histórica, não adapters de
`RecordCommand`/`MutationResult`. Novas colunas SQL também não são os DTOs finais da Fase 1:
a integração futura deve mapear explicitamente campos/erros e evitar `SELECT *` como
payload. Não foi encontrada quebra de consumidor atual, pois esses comandos não estão
integrados. BRL e CMV Owner-only são limites deliberados, não ampliação da delegação.

Papel `handyhub_history_writer`: NOLOGIN, sem SUPERUSER/BYPASSRLS, memberships, ownership
de tabelas, DELETE/TRUNCATE ou CREATE permanente. Apenas SELECT/INSERT necessários e
UPDATE da coluna `history_state` dos dois roots, com RLS limitada à finalização,
sob FORCE RLS. Catálogo não recebe escrita. RPCs e validador privado SECURITY DEFINER
pertencem ao papel, usam `search_path=''` e nomes qualificados. Anon/service_role/PUBLIC
não recebem EXECUTE. O validador não é RPC e não tem EXECUTE de authenticated. Auditoria
não é diretamente legível pelo cliente, inclusive Owner, e é imutável.

Superusuário ainda pode desabilitar triggers/alterar objetos; isso exige controle externo.
Não usamos credencial técnica como leitura operacional. Criação/transferência do papel,
privilégios/defaults de ACL no Supabase hospedado permanecem não testados. Papel preexistente
faz a migration transacional falhar. FKs RESTRICT retêm cadastros/memberships referenciados;
offboarding físico, anonimização e retenção exigem desenho posterior, sem apagar snapshots.

## Migração futura e reversão segura

Preservar backup e IDs legados; mapear por `(tenant,domínio,legacy_id)`, nunca somente nomes.
Copiar rótulos/valores comprovados do registro original, não do cadastro atual. Reconciliar
quantidade × preço, descontos, totais, moeda, responsáveis, custo/documento e datas.
Valores ausentes/contraditórios permanecem incompletos em quarentena de reconciliação;
não imputar custo atual/zero ou ajustar centavos para forçar igualdade. Não alterar os
originais para ocultar divergências. Converter para `posted` só por importador autorizado
que preserve evidência/auditoria e cumpra as constraints; esse importador não existe aqui.

Depois de uso, rollback não pode descartar novos dados, restaurar cadastros sobre snapshots
nem remover proteção de imutabilidade. Suspender novas postagens, preservar/reconciliar e
corrigir adiante. Antes de aplicação, falhas de migration revertem a transação. Sem down
migration destrutiva, backfill real ou rollback remoto nesta entrega.

## Evidências reproduzíveis

```sh
python3 scripts/test-historical-snapshots.py
python3 scripts/test-product-concurrency.py
python3 scripts/test-appointment-read.py
node --test tests/history-snapshots.test.mjs tests/tenant-domain-rls.test.mjs
npx tsc --noEmit --incremental false
npx eslint src/lib/permissions/history-posting.ts tests/contracts/history-posting.types.ts tests/history-snapshots.test.mjs tests/helpers/tenant-domain-fixture.mjs tests/tenant-domain-rls.test.mjs
```

| Evidência executada | Resultado |
| --- | --- |
| PostgreSQL 17.11, M4: venda, preço/custo posterior, receita/CMV/margem, nomes de serviço/profissional/cliente | APROVADO |
| Papéis, tenants/FKs UUID, CMV separado, DML/role bypass, auditoria e imutabilidade | APROVADO |
| Centavos, NaN/Infinity, limites, descontos, custo desconhecido, moeda, duplicidade e versão-fonte | APROVADO |
| Rollback de postagem/auditoria, fragmentos/quantidades inconsistentes e auditoria ausente | APROVADO |
| Parent oculto: papel/policy sintéticos locais de escrita acidental, guard nega por RLS | APROVADO |
| Fragmento opcional tardio e postagem sob savepoint | APROVADO |
| 14 testes PostgreSQL M4 | APROVADO, nenhum ignorado |
| Regressão PostgreSQL M1/M2 (12) e M3 (8) | APROVADO |
| PGlite: 8 testes M4 (inclui agregador) + 22 regressões | APROVADO |
| TypeScript e lint afetado | APROVADO |
| Supabase/Auth real, PostgREST, telas, volume, DRE/fiscal, importação, devoluções/estornos | NÃO TESTADO / NÃO IMPLEMENTADO |

Exemplo concreto: 2 × 100 = bruto 200, desconto 10, receita líquida 190, CMV 2 × 60 = 120,
margem bruta 70. Após mudar cadastro para preço 150 e custo 80, o histórico permanece igual.
Valores sintéticos, não um cálculo de DRE concluído. Nenhum teste final falhou.

Containers locais sem rede/portas, tmpfs e imagem PostgreSQL fixada por digest. Identidades
Auth sintéticas; chamadas empresariais usam sessão sem superusuário. PGlite usa PostgreSQL
17.5/WASM e não comprova concorrência multi-backend. Logs `/tmp/handyhub-m4-postgres.log`,
`/tmp/handyhub-m4-product-regression.log`, `/tmp/handyhub-m4-agenda-regression.log`,
`/tmp/handyhub-m4-pglite-final.log`, `/tmp/handyhub-m4-types.log`, `/tmp/handyhub-m4-lint.log`.
Build/suíte completa não repetidos: não alteramos aplicação, dependências ou telas.

Avaliação provisória **9,0/10 para M4 local**: snapshots, atomicidade, imutabilidade e
negação têm execução PostgreSQL real e regressão. Limites: integração/hosted não testados,
política de estoque/serviços/moedas/compensações e migração ainda pendentes. Não substitui
auditoria independente completa. **JSON legado vulnerável; Camada 1C continua reprovada.**
