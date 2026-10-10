# Permissões por tenant — Fase 1

## Estado e limites

Base auditada: `codex/camada-1-auth`, commit `668dc2979a59777cc8badb048d03ce665dcf2544`.
Branch local: `codex/tenant-permissions-phase-1`. Árvore inicialmente limpa.

Esta entrega acrescenta especificação executável, contratos e testes locais. **Não integra
as regras às páginas, endpoints ou banco. A vulnerabilidade alta do JSON continua aberta;
a Camada 1C continua reprovada.** Não utilizar a passagem dos novos testes como evidência
de proteção do staging. Nenhum acesso ao Supabase é necessário nesta fase.

Migrations existentes, sem alterações:

- `20261008020335_security_identity_memberships.sql`: memberships, roles e platform admins.
- `20261008020339_security_tenant_data_identity.sql`: identidade/FK do agregado por tenant.
- `20261008020344_security_rls_policies.sql`: RLS por linha, incluindo a policy vulnerável.

O cutover existente está em `supabase/activation/camada-1-cutover.sql`. Nenhuma migration
nova é proposta como arquivo executável nesta fase. Não executar scripts de staging:
`verify-staging-auth.mjs` e `verify-staging-onboarding.mjs` contêm mutações.

## Causa e consumidores inventariados

`tenant_data_read_members` autoriza a linha inteira para Employee. RLS por linha não
separa os campos de `payload`. `getAllTenantDataCloud()` em `src/lib/dbService.ts` seleciona
`payload` completo. `saveAllTenantDataCloud()` faz upsert substituindo o agregado completo.
Filtrar uma leitura e salvar essa resposta como agregado causaria perda de dados ocultos.

As páginas `src/app/page.tsx` e `src/app/equipe/page.tsx` são os dois consumidores diretos
em produção: carregam todas as coleções, armazenam `saas_cache_${tenantId}` em localStorage,
usam filtros por nomes e regravam o conjunto ao salvar uma coleção. Dashboards, DRE,
estoque derivado, agenda e histórico consomem o estado dessas páginas. Nomes de cliente,
vendedor ou profissional são apresentação, nunca provas de autorização.

| Domínio/chave atual | Conteúdo encontrado | Classificação e tratamento |
| --- | --- | --- |
| customers | id, name, phone, notes | Contato separado de notas privadas; vínculo de cliente atribuído ainda precisa de modelo verificável |
| employees | id, authUserId opcional, name, phone, email, roles, role, systemRole, schedule | Cadastro não equivale a membership; dados pessoais e escala separados; systemRole não concede privilégios |
| appointments | id, date, time, clientName, serviceName, professionalName, price, notes, status | Agenda própria por UUID vinculado; preço financeiro e notas em permissões distintas |
| attendances | id, date, time, clientName, serviceName, professionalName, grossValue, discount, netValue, paymentMethod, notes, status | Operação própria separada de receita/pagamento/notas |
| sales | id, date, clientName, productName, sellerName, quantity, unitPrice, total, paymentMethod, status, notes | Vendas próprias separadas de totais e notas |
| products | id, name, category, cost, price, initialStock, minStock | Catálogo público ao papel autorizado separado de custo e estoque |
| stockMoves | productName, type, quantity; coleção pouco tipada | Gerar/migrar ID estável e vínculo produto/tenant; não inferir por nome |
| services | id, name, category, duration, price, assignedRole | Catálogo; função profissional não é papel Auth |
| promotions | id, title, targetItems, duration, discountPercent, isAllPromo, active | Oferta; targetItems necessita contrato de referências antes de exposição |
| expenses | id, date, description, amount, category, isRecurrent, status | Gerencial; proibido a Employee, mesmo com grant inválido |
| rolesList | strings de funções profissionais | Migrar para id/name estáveis; nunca usar para autorização |

`employees.schedule`, listas de funções e `promotions.targetItems` **não são serializados
pelo protótipo escalar desta fase**: DTOs estruturados e validação de referências ficam
pendentes antes da integração. Isso não remove dados atuais nem funcionalidades em execução.
Campos desconhecidos do legado devem ser inventariados/preservados em migração restrita,
jamais liberados por wildcard ou descartados silenciosamente.

Outros caminhos: acesso direto ao PostgREST de `tenant_data` contorna qualquer filtro React.
Não há outro consumidor de `all_data` em `src` além do dbService e dessas duas páginas.
`/master` e APIs Master usam contratos de tenants/identidade, não esse payload; manter sua
autorização separada. Auth e `getTenantFromCloud` também leem resumo de tenants, incluindo
owner_email/monthly_fee/due_day: esses campos precisam de revisão específica na Fase 2.
`companies` tem policies por papel, mas não é substituto automático dos domínios.
Testes `security-foundation` e scripts de verificação de staging dependem do agregado e
precisarão de adaptação posterior. Nenhum desses consumidores foi modificado agora.

## Decisões de autorização

Fonte formal: `src/lib/permissions/policy.ts`, catálogo `PERMISSIONS`.

- Owner tem autoridade sobre o catálogo empresarial **somente no tenant da membership ativa**.
- Manager e Employee começam com zero grants; o Owner habilita explicitamente uma permissão
  dentro do teto indicado. O conjunto de grants é por papel e tenant nesta proposta; exceções
  por colaborador não são presumidas. A configuração de papel nunca altera `membership.role`.
- Permissões financeiras de Manager são delegáveis, porém desligadas por padrão.
- Employee nunca recebe despesas, custos, margens, notas privadas ou cadastros confidenciais
  de colegas. Grants corrompidos além do teto são negados pelo avaliador.
- Manager não subdelega nesta fase. A política futura de subdelegação requer decisão de produto;
  a ausência dessa decisão significa negação, inclusive se Manager possuir a permissão.
- Master/Platform Admin não é TenantRole, não pode ser delegado e não ganha poderes neste
  catálogo. Acesso Master continua em seu fluxo existente. Uma pessoa com ambos os papéis
  deve passar separadamente pela autorização correspondente à operação.
- Módulo habilitado controla disponibilidade, nunca concede grant. Não há wildcard, herança
  implícita de permissões, confiança em user_metadata ou autorização baseada em nome.
- Novas mutações de domínios estão reservadas a Owner no catálogo inicial. Manager/Employee
  não recebem escrita até definição de campos, transições e limites; isso **não altera agora**
  os writes legados de Manager. Resolver essa diferença antes de integrar para evitar regressão.

### Matriz formal de leitura

Todas as linhas exigem tenant ativo, membership ativa da identidade autenticada, tenant
consistente e revisão atual. `O` = Owner; `D` = delegável, inicialmente desligada;
`—` = proibida. Owner também respeita o escopo pessoal quando escolhe uma permissão pessoal;
para acesso amplo deve usar a permissão tenant correspondente. Campos não listados são negados.

| Permissão | Escopo | Campos | Owner | Manager | Employee |
| --- | --- | --- | --- | --- | --- |
| `customers.read` | tenant | id, name, phone | O | D | — |
| `customers.read_assigned` | assigned | id, name | O | D | D |
| `customers.private_notes.read` | tenant | id, notes | O | — | — |
| `employees.read` | tenant | id, name | O | D | — |
| `employees.read_own` | own | id, name | O | D | D |
| `employees.private.read` | tenant | id, phone, email, authUserId | O | — | — |
| `appointments.read` | tenant | id, date, time, clientName, serviceName, professionalName, status | O | D | — |
| `appointments.read_own` | own | id, date, time, clientName, serviceName, status | O | D | D |
| `finance.appointments.read` | tenant | id, price | O | D | — |
| `appointments.private_notes.read` | tenant | id, notes | O | — | — |
| `attendances.read` | tenant | id, date, time, clientName, serviceName, professionalName, status | O | D | — |
| `attendances.read_own` | own | id, date, time, clientName, serviceName, status | O | D | D |
| `attendances.private_notes.read` | tenant | id, notes | O | — | — |
| `finance.attendances.read` | tenant | id, grossValue, discount, netValue, paymentMethod | O | D | — |
| `sales.read` | tenant | id, date, clientName, productName, sellerName, quantity, status | O | D | — |
| `sales.read_own` | own | id, date, productName, quantity, status | O | D | D |
| `sales.private_notes.read` | tenant | id, notes | O | — | — |
| `finance.sales.read` | tenant | id, unitPrice, total, paymentMethod | O | D | — |
| `products.read` | tenant | id, name, category, price | O | D | D |
| `finance.products.cost.read` | tenant | id, cost | O | D | — |
| `products.stock.read` | tenant | id, initialStock, minStock | O | D | — |
| `stockMoves.read` | tenant | id, productName, type, quantity | O | D | — |
| `services.read` | tenant | id, name, category, duration, price, assignedRole | O | D | D |
| `promotions.read` | tenant | id, title, duration, discountPercent, isAllPromo, active | O | D | D |
| `finance.expenses.read` | tenant | id, date, description, amount, category, isRecurrent, status | O | D | — |
| `rolesList.read` | tenant | id, name | O | D | — |

### Matriz de escrita e delegação

Para cada domínio acima, as ações `create`, `update`, `delete` possuem permissões separadas
(`finance.expenses.*` para despesas). Escopo tenant, apenas Owner no teto inicial; campos de
patch ainda **não aprovados**. A decisão de papel não autoriza gravar: API futura precisa de
schema explícito por ação, validação dos valores, versão esperada, RLS USING/WITH CHECK e FK
composta tenant/registro. `RecordCommand` é envelope de contrato, não parser de input nem
mecanismo de persistência. Não implementar endpoint genérico que aceite um patch arbitrário.
Identidade, tenant, atribuição, vínculo Auth e role exigem comandos privilegiados separados.

| Configuração | Owner | Manager | Employee |
| --- | --- | --- | --- |
| Substituir grants de Manager/Employee no próprio tenant | Dentro do teto fixo | Negado | Negado |
| Elevar papel, conceder Owner ou Master | Fora deste contrato | Negado | Negado |
| Configurar outro tenant | Negado | Negado | Negado |
| Reatribuir profissional / editar Auth / alterar role via cadastro | Fora deste contrato | Negado | Negado |

`planDelegation` retorna apenas um plano sem IO com `expectedRevision`; não persiste nada.
A futura escrita deverá comparar/incrementar revisão atomicamente, revalidar Owner no banco,
e registrar ator UUID, tenant, papel alvo, diferenças de permissões, revisão, timestamp e
resultado. Não guardar cookies, tokens, links ou conteúdo privado. Revogação usa grants vazios.

## Contratos e fronteira de confiança

`AuthorizationContext` só poderá ser construído no servidor após validar sessão e consultar
membership, tenant e configuração atuais. A tipagem **não autentica os argumentos**. Não
aceitar esse objeto do cliente; não aceitar grants/role/revisão de JWT antigo. `RecordScope`
vem de relações persistidas verificadas, nunca de `subjectUserId` enviado pelo navegador.

`own`: vínculo profissional do registro ao Auth UUID autenticado. `assigned`: relação de
atribuição explícita e atual no mesmo tenant. Colaborador sem conta Auth tem UUID empresarial,
mas vínculo Auth nulo: não pode logar e não satisfaz escopo pessoal de ninguém. Owner autorizado
pode gerenciar seu cadastro. Backfill por nome deve falhar se ambíguo; não inventar vínculos.
Usar FKs compostas `(tenant_id, entity_id)` e unicidade de vínculo conforme regra aprovada.

`Decision` e `ReadResult` são uniões discriminadas: negação `{status:'denied',code:'ACCESS_DENIED'}`
sem `items`; lista autorizada vazia tem `status:'allowed',items:[]`. Falha de transporte precisa
ser erro independente, jamais transformada em `[]`. Nada ausente autoriza exclusão.
`ReadDTO` só contém campos da permissão; `projectRecord` projeta campos escalares permitidos e
rejeita campos obrigatórios ausentes, valores aninhados e números não finitos. É protótipo para
uso futuro no servidor, não filtro de tela nem leitor seguro de `all_data`. Tipos/validadores
por domínio, valores de enum, datas, quantias e relacionamentos serão necessários na integração.
Não passar objetos de SDK/JSON legado diretamente ao browser, SSR ou caches.

Permissões por campo não são automaticamente implementadas por RLS de linha. Campos sensíveis
precisam de tabelas separadas, views seguras ou funções restritas/DTOs de servidor combinados
com remoção da leitura direta indevida. Separar apenas `data_key` não resolve registros próprios.
Antes de expor dados ao Employee, fechar acesso ao agregado legado e testar PostgREST, views,
RPCs, joins, realtime, SSR e todos os endpoints. Nunca usar service_role como bypass empresarial.

## Revogação, sessões e caches

- Carregar grants/membership atuais em cada operação; cache de autorização no máximo por request.
- Revisão deve mudar atomicamente com grant, role, ativação ou vínculo relevante. Comparar com
  armazenamento atual, não apenas duas cópias antigas no cliente. Sessão Auth válida não mantém
  autorização revogada; sessão inválida falha antes de construir o contexto.
- Troca de tenant cancela requests pendentes, limpa estado/cache e revalida membership; rejeitar
  respostas atrasadas do tenant/revisão anterior. Reatribuição usa relações atuais.
- Preferir dados sensíveis somente em memória, respostas `private, no-store`; não reutilizar cache
  compartilhado. Se cache específico for necessário, chave inclui user+tenant+revisão e invalidação.
- Remover caches legados `saas_cache_*` na futura integração e no logout. Não se pode recuperar
  dados já vazados no navegador. Limpeza de cache não substitui autorização.
- Não derivar DELETE de resposta vazia/parcial/negada; mutação unitária explícita com versão esperada.
  Conflito devolve `VERSION_CONFLICT`, sem sobrescrever coleções completas.

## Questões de produto pendentes (negação por padrão)

1. Subdelegação de Manager: quais alvos, quem revoga grants derivados e como limitar a cadeia?
2. Escritas de Manager/Employee: campos, cancelamentos, descontos, exclusões e reatribuições.
3. Employee pode ver contato do cliente atribuído, agenda compartilhada, diretório/escala,
   valores próprios ou saldo de estoque? Até decisão, permissões correspondentes inexistentes.
4. Contratos de escalas, funções profissionais e alvos de promoções; confidencialidade de notas
   hoje genéricas. Nenhuma nota genérica é presumida pública.
5. Permissões adicionais por pessoa ou apenas por papel; configurações iniciais de tenants legados
   e transição do Manager atual sem financeiro automático. Não promover grants via migração implícita.
6. Aprovação dos campos administrativos do resumo de tenants, retenção e acesso à auditoria.

## Checkpoints seguintes, não executados

Fase 2: aprovar pendências necessárias; projetar esquema/RLS e persistência de grants/revisões,
validadores e comandos unitários. Testar em banco local com dados sintéticos. Não aplicar remoto.
Depois: conversor com IDs/FKs verificáveis, reconciliação por contagens/totais, APIs servidor,
adaptadores das duas páginas, remoção de writes agregados e caches, cutover autorizado e testes
reais com identidades. Evitar dual-write; preferir janela curta de escrita suspensa e reconciliação.
Rollback não pode reabrir JSON a Employee; após novas escritas não restaurar snapshot perdendo
operações. Manter manutenção restritiva ou correção adiante se não existir retorno seguro.

Riscos: perda por regravar dados filtrados, dupla fonte de verdade, atribuição por nomes duplicados,
regressão de Manager, omissão de campos estruturados, vazamento em DTOs/caches/SQL direto,
revogação não atômica, agregações financeiras que revelem custos por diferença. Nenhum desses
riscos é resolvido por esconder abas. Não liberar DRE/margens a Employee por combinação de grants.

## Aceitação e evidências

Testes novos são **unidade/contrato local**, não comprovação de RLS remoto:

- Teto de cada permissão por papel, default deny, papel Master desconhecido, wildcard negado.
- Grants financeiros explícitos para Manager; Employee proibido mesmo com grants corrompidos.
- Owner limitado ao tenant; C não autoriza A/B para todas as permissões e papéis.
- Delegação Owner limitada e atômica no plano; Manager sem autopromoção ou subdelegação.
- Membership inativa, identidade divergente, tenant inativo e revisão antiga negados.
- Registros próprios/atribuídos por UUID; sem Auth, nomes iguais e outros profissionais negados.
- Projeções não serializam campos extras/privados e rejeitam valores aninhados inesperados.
- Contratos TypeScript recusam campos proibidos, nome como UUID e dados em resultado negado.

Ainda exigidos antes de fechar a vulnerabilidade: testes negativos RLS com identidades reais,
Employee não lê despesas/custos/notas/colegas em SQL/PostgREST/API/SSR, Owner preserva operações
e totais, Manager segue configuração efetiva, A/B isolados de C, ataques de troca de tenant,
role/atribuição forjada, sessão revogada, corrida de grants/writes e cache após troca de usuário.
Testar os endpoints existentes para ausência de campos proibidos e migração/rollback sem perda.
