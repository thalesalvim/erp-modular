# Instalação gerenciada e compatibilidade v6 — projeto técnico

> Registro histórico de 14/10/2026, preservado para rastreabilidade. As referências
> abaixo a artefatos ainda inexistentes descrevem aquela data. A fundação limitada
> v6/1 revisão 2 foi implementada posteriormente: consulte
> [o instalador do piloto](managed-installer-pilot-v6.md) para o estado atual.
> Ela não instala a cadeia histórica completa nem certifica o ambiente hospedado.

Data: 14/10/2026. Branch: fix/convites-autorizacao-atomica.
HEAD-base: 95eeed56d91937d33383dd8b71cdead55717f41f.
Status: **V6 BLOQUEADA para implementação/instalação da cadeia histórica completa.**

Este é um projeto técnico, não uma migration, manifesto aprovado ou autorização de
instalação. Não existe selo v6 implementado. Os testes abaixo validam controles
anteriores e impedimentos de ordem; não uma v6 instalada.

## 1. Decisão e limite do contrato

Separar explicitamente:
- upgrade de instalação com referências v1–v5 autênticas;
- instalação gerenciada nova sobre baseline, sem referências anteriores.

**A cadeia histórica literal e uma raiz gerenciada nova são trajetórias distintas.**
Preservar arquivos/selos existentes não autoriza inserir na staging cópias de
selos produzidos em outro banco, nem afirmar que v1–v5 passaram onde não ocorreram.

Não foi demonstrado bootstrap que execute todos os arquivos históricos intactos
no perfil gerenciado: guards v1/v4 falham antes da v6. Uma raiz gerenciada própria
é a alternativa recomendada para instalações novas, mas exige definir e certificar
seu contrato de linhagem. Se forem exigidos os mesmos selos/etapas operacionais
v1–v5 na staging, essa alternativa não satisfaz o requisito.

Nenhuma implementação parcial foi criada para aparentar resolver a instalação.

## 2. Causas e ordem efetiva

| Causa | Evidência no código | Consequência |
| --- | --- | --- |
| SET ROLE para ownership | produto 20261011010000:124; agenda 20261011020000:59; equivalentes history/lifecycle/membership/convites | CREATE temporário no schema não substitui SET da role de destino; postgres gerenciado não é superusuário |
| Modelo fechado de memberships | v1 20261012030100:38–50; v4 20261014025551:228–246 | Edge legítimo supabase_realtime_admin → authenticated é recusado; vínculos Storage/authenticator também precisam de revisão |
| Auth owner/ACLs no digest integral | v4:453–469,539; v5:708–715 | auth.users é de supabase_auth_admin no staging; o perfil local revisado usa postgres |
| Referências completas locais | reviewed-history-v4/v5.json; preflight v4:29–40 | Defaults, schema ACLs e edges do provedor afetam históricos; não trocar hashes pelos do alvo |
| Baseline existente | identidade 20261008020335:10 | CREATE TABLE não é idempotente; datas diferentes no histórico hospedado não justificam rerun |
| Corte do legado | enter-maintenance:23; resume:25 | tenant_data é fechado para papéis operacionais, mas o frontend gerencial ainda o utiliza |

Ordem atual: baseline externa → três migrations identidade/RLS → cutover
operacional separado → 14 migrations Phase 2A → manutenção/v3/resume →
manutenção/v4/resume → manutenção/v5/resume. Existem 20 migrations SQL:
17 históricas, v3, v4 e v5. Activation/recovery não são migrations automáticas.

Uma v6 posterior não executa se um passo anterior abortar. Um verificador
substituído antes da v4 é sobrescrito pelo próprio SQL histórico posterior.
Omitir SELECTs de validação ou substituir literais durante execução não preserva
a cadeia. Cada arquivo também possui BEGIN/COMMIT próprios; um BEGIN externo
não transforma automaticamente todos os arquivos numa transação única.

## 3. Invariantes do produto versus infraestrutura

| Produto — preservar | Infraestrutura — fixar por perfil revisado |
| --- | --- |
| auth.uid, UUID do ator, tenant ativo e membership atual | Definição/owner/ACL de auth.uid do provedor |
| RLS/FORCE no domínio e projeção mínima própria | Owner, persistência, RLS e ACLs de auth.users |
| Roles técnicas NOLOGIN/NOBYPASSRLS/NOINHERIT, sem superuser/criação/replicação | Atributos e edges ADMIN/INHERIT/SET de serviços Supabase |
| ACLs sensíveis e ausência de DML direto do cliente | Defaults/schema ACLs do instalador e dos serviços |
| pg_catalog explícito, search_path seguro, proteção contra sombras | Versão PostgreSQL e comportamento do distribuidor |
| Ticket único, vínculo imutável, expiração, quotas, arquivo auditável | Direitos específicos de criação de roles e ownership |
| Locks, revalidação, rollback, auditoria, relações permanentes | Janela de DDL/Auth e mecanismos de backup/restore |
| Digests fixos e referências antigas preservadas | Perfil de infraestrutura com identidade explícita |

Separação não significa excluir ownership/ACLs/edges do gate: os dois conjuntos
devem ser validados. Não usar qualquer owner, prefixos supabase_* ou dados live
como autoridade. Grants de coluna, grant options e caminhos de herança relevantes
continuam protegidos.

As colunas internas Auth são opacas no v4, salvo grants a terceiros. Isso não
certifica todo GoTrue/Storage/Realtime. A nova versão deve explicitar essa fronteira.

## 4. Trajetórias propostas

### A. Upgrade de v5 existente

1. Exigir perfil conhecido, gate v5 original íntegro e referências completas.
2. Conferir fontes/manifestos antes de DDL e após aquisição dos locks.
3. Instalar objetos/verificadores v6 aditivos com nova âncora revisada.
4. Referência v6 registra perfil/origem, digests de produto/infraestrutura,
   hashes completos de v1–v5 e proveniência do release.
5. Comparar valores integrais de referências e checksums dos dados antes/depois.
6. Falha reverte o lote v6; referências anteriores permanecem literalmente iguais.

Proibir UPDATE/DELETE/TRUNCATE, disable trigger e reseal das referências antigas.
Retomar somente pelo gate correto, nunca por resume forçado.
Essa trajetória pode servir ao perfil local original; não instala a staging,
onde as referências não existem. Transferência entre infraestruturas exige
uma trajetória específica, não um upgrade com preflight ignorado.

### B. Instalação gerenciada nova com raiz v6 própria

Pré-condições: baseline certificada, zero ERP/roles handyhub/selos, perfil exato,
executor apto e release revisado. Estado misto aborta antes de DDL; não limpar
automaticamente instalações parciais.

Ordem proposta:
1. preflight somente leitura contra manifesto independente;
2. janela exclusiva/locks e segunda verificação;
3. bootstrap de roles de aplicação e direitos estritos do executor;
4. definições de produto equivalentes ao estado final v5, em artefato NOVO
   revisado, com source map das fontes históricas e diferenças explícitas;
5. verificadores v6 de produto, infraestrutura e origem;
6. comparação dos digests fixos antes de inserir referência;
7. raiz v6 identificada como instalação nova, postflight e commit transacional.

Não criar selos v1–v5 fictícios. A proveniência de fontes antigas é registro de
fontes, não selo de instalações alegadamente realizadas. Esse caminho tem
linhagem própria e ainda exige SQL completo, prova de equivalência e manifesto
revisado. Não pode ser chamado de cadeia histórica literal instalada.

~~~mermaid
flowchart TD
  P["Preflight obrigatório"] --> S{"Estado e perfil"}
  S --> L["v5 local autêntica e íntegra"]
  S --> M["Baseline gerenciada sem ERP ou selos"]
  S --> X["Misto ou desconhecido: abortar"]
  L --> U["Upgrade v6: preservar referências literais"]
  M --> B["Bootstrap gerenciado versionado"]
  B --> R["Raiz v6 própria: sem selos antigos artificiais"]
  U --> G["Digests fixos, dados e postflight"]
  R --> G
~~~

## 5. Bootstrap, ownership e identidade

Bootstrap deve pertencer ao release do instalador, fora do push automático da
cadeia histórica, versionado com hashes, testes e source map. Não gerar SQL do
estado live ou remover guards usando regex.

Privilégios: somente roles enumeradas e ownership nos schemas de aplicação;
provar CREATEROLE/administração específica/SET da role de destino. Grants
transitórios auditados, sem INHERIT/SET para usuários operacionais; remover ou
fixar explicitamente os vínculos finais do instalador. CREATE de schema apenas
durante a transferência, depois REVOKE. Não acrescentar SUPERUSER/BYPASSRLS
nem GRANT ALL como correção de permissões.

O postgres staging não tem grant option observado em USAGE auth. Chamadas diretas
auth.uid em contexto de roles técnicas exigem esse acesso. Não transferir owner
de auth.users, alterar auth.uid ou ampliar Auth para contornar isso.

Alternativas a revisar para a nova raiz:
- USAGE auth específico por grantor autorizado: depende de operação do provedor
  e conflita com a restrição atual de não alterar objetos Auth.
- Helper privado estreito de identidade, do metadata owner, que somente retorna
  auth.uid(), com nome qualificado/search_path fixo, sem parâmetro de ator, sem
  acesso a registros Auth e EXECUTE limitado. Definições/policies novas usariam
  esse helper mantendo a identidade do JWT validado pelo PostgREST.

O helper é candidato para evitar grants Auth, mas não foi implementado:
exige revisão de TODOS os chamadores e testes reais. Não substituir strings
auth.uid mecanicamente. Nenhum claim user_metadata, fallback, parâmetro de ator
ou chave service_role substitui a identidade.

Roles técnicas continuam NOBYPASSRLS/NOLOGIN e separadas dos donos das tabelas.
Metadata owner é operador confiável, não credencial de aplicação.

## 6. Versionamento e manifesto

Artefatos propostos para um release futuro, ainda inexistentes:
- supabase/install/managed-v6/RELEASE-ID/preflight.sql
- bootstrap.sql e install-root.sql com DDL completo revisado
- postflight.sql e source-map.json
- manifesto gerenciado revisado e manifesto de upgrade local
- migration aditiva de upgrade local, gerada pela CLI quando implementada

Manifesto deve fixar perfil/versão PostgreSQL, baseline, modo fresh/upgrade,
hashes das fontes, inventário, atributos/edges, owners exatos, ACLs e digests de
produto/infraestrutura/históricos exigidos por trajetória.

Observações de staging NÃO são um manifesto aprovado. Produzir candidatos em
duas construções independentes de fontes/bootstrap revisados; revisar diferenças;
congelar digests antes dos ensaios de upgrade; testar adulterações.
Mudança do provedor exige nova revisão/versionamento, sem aceitar qualquer estado
corrente nem editar silenciosamente a âncora.

Cobertura deve incluir dependências transitivas de triggers, por exemplo
private.sync_tenant_data_identity(), e não apenas nomes erp_*.
Auth e outras relações externas usadas precisam de contrato delimitado.

## 7. Baseline, legado e portas de homologação

Comparação desta tarefa, com PostgreSQL nativo e metadados hosted somente leitura:
**13 policies, três funções, 15 constraints e um trigger coincidiram exatamente.**
Incluiu sync_tenant_data_identity e seu trigger.

O perfil de roles/Auth foi reconfirmado em leitura: auth.users permanece de
supabase_auth_admin, postgres permanece NOSUPERUSER e os 16 edges de infraestrutura
consultados permanecem iguais à auditoria anterior. Nenhum desses registros é
uma aprovação automática de manifesto v6.

Não é certificação de baseline completa: faltam índices, todas as colunas/defaults,
ACLs/defaults/sequences, dados e dependências transitivas. Não fazer migration
repair nem pular etapas por nomes. Staging tem zero relações ERP, zero funções ERP,
zero roles handyhub e nenhum selo. Seus dados existentes não são descartáveis.

src/lib/dbService.ts e src/app/page.tsx continuam lendo/escrevendo tenant_data e
mantendo cache saas_cache_<tenant>. Criar tabelas não converte esse JSON.

Homologação depende de:
1. contrato de linhagem fresh versus cadeia histórica literal e release completo;
2. manifesto independente, bootstrap e direitos do executor aprovados;
3. baseline completa certificada e reconciliação sem perda de dados;
4. testes do caminho NOVO, negativos/upgrade/rollback;
5. candidato gerenciado separado autorizado para DDL/hooks/grants reais;
6. backup/PITR disponível e restore ensaiado, com RPO/RTO e proteção de Auth;
7. plano de piloto/normalização sem fallback silencioso ou reabertura do legado;
8. janela que drene gravações, convites/jobs/SMTP e considere locks Auth;
9. postflight de fingerprints, referências, RLS, JWT/PostgREST real, negativas,
   tenant estrangeiro, expiração/refresh e limites de linhas.

Preservar o JSON como dado/arquivo não significa manter acesso operacional.
Não remover registros, converter em massa ou fazer dual-write não certificado.
Se a agenda gerencial precisar continuar operacional, o corte normalizado
depende primeiro de estratégia funcional compatível e aprovada.

## 8. Rollback

Instalador novo precisa de unidade transacional explícita, sem COMMITs ocultos
dos arquivos históricos. Falha não deixa DDL parcial ou grants transitórios.
Registrar release/raiz só depois do último gate.

Após commit não existe rollback transacional. Não há down v6 certificada.
Recuperação exige correção forward revisada ou restore aprovado; não apagar selos
nem usar versões antigas para reseal. Considerar perda de alterações posteriores
ao backup e indisponibilidade. Emails/links não são revertidos pelo banco.

Não usar session_replication_role como procedimento de implantação; postgres
staging não tem esse direito. Restore Auth precisa seguir procedimento do
provedor em candidato separado, sem alterar diretamente Auth da staging.

## 9. Evidências e limites

**6/6 provas locais, sem falhas ou ignorados:**
- v4 recusou owner gerenciado simulado e impediu etapa v6 posterior;
- rollback preservou ownership, dados e referências anteriores;
- instalação histórica limpa v5 permaneceu válida;
- falha tardia histórica v5 reverteu integralmente DDL do lote;
- upgrade preservou registros/autorização e referências v1–v4 literalmente;
- leitura própria isolada por tenant e adulteração de catálogo recusada.

São seis testes com várias assertivas; não seis instalações v6. Instalação/upgrade
GERENCIADOS v6 permanecem pendentes. Nesta rodada não foram novamente executadas
as 41 provas da auditoria anterior; esses resultados são evidência histórica.

Imagem fixa PostgreSQL 17.11, network none, tmpfs, sem portas/volumes externos,
cleanup por IDs próprios. Inventário da suíte igual antes/depois.
Não reproduz supautils, todos os objetos/serviços GoTrue/Storage/Realtime,
Auth/JWT/PostgREST real, WAL/PITR ou permissões especiais do distribuidor.

Helpers/evidências foram guardados em pasta externa NOVA, preservando os anteriores.
test-v6-design.py executa as seis provas; compare-baseline.py só reconstrói
baseline num container próprio e compara os metadados já coletados, sem DSN remoto.

As 17 migrations históricas, v3/v4/v5, manifestos e arquivos anteriores permanecem
intactos. Este documento é o único arquivo novo do repositório nesta tarefa.
Nenhuma migration/manifesto v6, instalador, função/API ou permissão hospedada foi
criada/alterada. Sem commit/push/merge/PR/deploy. Sem serviços reais de SMTP/Auth
utilizados por esses testes PostgreSQL.

## 10. Alternativas descartadas e próximo lote

Descartadas: v6 somente após v5; ownership temporário de Auth; remoção de edges do
provedor; reseal; copiar referências locais como histórico hosted; regex para
pular guards; RLS desabilitada; privilégios amplos; fallback silencioso no legado.
Nenhuma dessas alternativas comprova preservação da cadeia.

Próximo lote: fechar a linhagem de instalação nova e o contrato completo de
baseline/executor. Depois implementar release gerenciado e upgrade local
separados, com digests próprios revisados e teste da equivalência do produto.

Adotar uma raiz nova não pode ser apresentado como cadeia v1–v5 executada no
Supabase. Enquanto isso não estiver resolvido e validado, **V6 BLOQUEADA**.

Referências:
[Privilégios Supabase](https://supabase.com/docs/guides/database/postgres/roles-superuser),
[ownership PostgreSQL 17](https://www.postgresql.org/docs/17/sql-alterfunction.html),
[v4](recovery-integrity-v4-phase-2a.md), [v5](invitation-lifecycle-v5.md).
