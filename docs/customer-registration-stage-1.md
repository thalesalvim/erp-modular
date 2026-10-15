# Cadastro Inteligente de Clientes — primeira etapa local

Data: 14/10/2026. Branch: `fix/convites-autorizacao-atomica`. Referência: `d457ab37292e3ba616ef37718daf6f73ae73c5ec`. Sem commit/publicação desta etapa.

**Resultado: PARCIAL.** Campos, máscaras, validação e regras preparatórias estão disponíveis. Persistência normalizada, pesquisa de conflitos e envio/decisão de revisão estão **BLOQUEADOS**. Não usar esta interface como cadastro empresarial funcional.

## Diagnóstico verificado no código

- Home e Equipe criam clientes com ID `c-${Date.now()}`, `name`, `phone` e `notes`; edição altera essas propriedades. Chamam `saveTenantData("customers", ...)`, que integra a coleção ao agregado `all_data` e faz upsert em `tenant_data` via `saveAllTenantDataCloud`.
- Leituras atuais da Home consultam o agregado e cache local por tenant. Isso não é um contrato normalizado de identidade nem proteção transacional de duplicidades. Nenhum valor novo deste formulário é inserido nesse fluxo ou no cache.
- `20261010060100_erp_domains.sql` define `erp_customers(tenant_id, id uuid, version, created_at, name)`. Contatos e notas são separados, com FKs compostas pelo tenant e ID. **CPF e nascimento não existem nesse modelo.**
- `20261010060200_erp_domain_rls.sql` aplica RLS/FORCE, identidade imutável e autorização `private.erp_can`/atribuição. Há DML por colunas de nome/telefone/notas; isso não garante CPF único, completude do titular ou exceções auditadas. Não se deve ampliar GRANTs para acomodar o formulário.
- O catálogo de permissões reserva mutações de clientes ao Owner na arquitetura atual. A matriz futura de revisão Gestor/Colaborador é uma regra distinta, ainda sem comando certificado. O arquivo TypeScript de política declara explicitamente que não é uma fronteira de segurança do frontend.
- A arquitetura gerenciada v6 permanece bloqueada; a ausência da cadeia normalizada/contratos no staging é informação documentada anteriormente, não uma nova certificação hospedada desta tarefa. Não foram executadas consultas administrativas, instalações ou alterações de Auth.

Os writers históricos permitem registros sem CPF/nascimento e nomes incompletos. Uma linha de cliente legado foi observada na lista atual do ambiente sintético; a UI não exibe CPF/nascimento. Não foram consultados documentos privados nem inferido que dados não exibidos necessariamente não existam no payload. Um inventário preciso exige futura projeção autorizada de indicadores de completude, sem devolver CPFs desnecessariamente.

## Alterações implementadas

- Nova página `/clientes/cadastro-inteligente`, protegida pelo fluxo de sessão/membership existente. Formulário remonta ao trocar UUID do usuário, tenant ou papel, e desaparece quando a identidade não está confirmada.
- Entrada no módulo Base de Clientes da Home, com aviso de que o cadastro atual continua legado. Não foram alterados seus handlers de criação, edição, exclusão ou leitura, nem a página Equipe.
- Campos obrigatórios do titular: nome completo, CPF, nascimento e telefone/WhatsApp.
- CPF: máscara, 11 dígitos, ambos os verificadores e recusa das dez sequências repetidas. Esta verificação matemática não comprova identidade ou situação cadastral.
- Nome: nome/sobrenome, Unicode e apóstrofos, até 200 caracteres, sem números. A regra sintática não comprova que o nome seja civil/completo; casos excepcionais precisam de política revisada antes do cadastro real.
- Nascimento: calendário válido, incluindo anos bissextos, sem datas futuras. Sem limite etário inventado.
- Telefone brasileiro: DDD e formatos nacionais fixo/móvel, máscara, normalização equivalente com `+55`. Não comprova titularidade, entrega ou conta WhatsApp; números internacionais fora do Brasil dependem de contrato futuro.
- Mensagens genéricas por campo, sem repetir CPF ou incluir valores em URLs/logs. Campos ficam em React state; nenhum storage, endpoint, telemetria ou transporte foi acrescentado.
- Botão **Validar campos (sem salvar)** e botão **Salvar cadastro — indisponível** sempre desabilitado. Validar nunca autoriza nem persiste.

Não se criou uma segunda fonte de verdade: não existe rascunho salvo, cópia de coleção empresarial ou conversão de IDs. Recarregar/sair descartou os valores nos ensaios realizados. O navegador/sistema pode ter mecanismos próprios de restauração de páginas; o produto não acrescentou persistência e a fronteira remonta o formulário ao mudar a identidade/tenant/papel.

## Regras preparatórias de duplicidade

`src/lib/customers/registration.ts` recebe snapshots explicitamente delimitados **somente nos testes**; não busca banco ou cache. Retorna apenas indicadores, sem campos dos registros conflitantes.

| Condição | Regra local testada | Estado na tela real |
| --- | --- | --- |
| CPF igual no mesmo tenant | Bloqueio para qualquer perfil; nenhuma justificativa libera | Consulta/constraint ainda ausentes |
| Nome semelhante | Alerta; normalização de acentos/case, ordem de termos ou até duas edições em nomes de pelo menos oito caracteres | Instrução visível; pesquisa real não conectada |
| Telefone compartilhado | Alerta, sem bloqueio automático por telefone | Instrução visível; pesquisa real não conectada |
| Colaborador com alerta | Preparar solicitação de revisão | Não envia solicitação |
| Gestor com alerta | Justificativa obrigatória para preparar revisão | Campo em memória, não concede exceção |
| Dono | Revisar conflitos; unificação futura separada | Nenhuma unificação ou decisão persistida |
| Catálogo ausente, misto, de outro tenant ou ID de edição desconhecido | Indisponível; não interpretar como ausência de duplicidades | Nenhum catálogo é carregado nesta etapa |
| Registros antigos incompletos | Revisão parcial, sem inventar CPF/nascimento ou alterar dados | Consulta legada preservada |

O mínimo local de dez caracteres para a justificativa é um critério técnico preparatório; qualidade da justificativa, auditoria e aprovação precisam do futuro contrato. O detector de nomes é uma heurística de alerta, com falsos positivos/negativos possíveis, nunca uma razão para unificar ou bloquear CPF distinto automaticamente.

**Todas as decisões do helper retornam `canPersist=false`, inclusive para Dono sem conflitos.** Papel/membership do navegador ou snapshot fornecido pelo chamador não são autorização de escrita. O servidor futuro deve carregar identidade, vínculos e permissões confiáveis, revalidar após locks e recusar claims arbitrárias.

## Dados legados e identidade futura

Consultas existentes não foram condicionadas aos quatro campos novos; não há bloqueio retroativo, backfill, alteração de IDs ou migração de cadastros reais. Os controles legados de gravação continuam existindo e não ganharam garantias de CPF/nascimento neste lote. Não preencher documentos fictícios para regularizar registros antigos.

O cliente normalizado deve manter UUID como identidade principal, com escopo `(tenant_id, id)`. CPF é atributo protegido, com unicidade **dentro da empresa**, nunca chave global de pessoa/tenant ou parâmetro para enumerar clientes de outras empresas.

Uma atualização segura requer mapeamento revisado `legacy_id → customer_uuid`, proveniência e versão esperada; CPF/nascimento atualizados transacionalmente, com revalidação de permissão, auditoria e conflitos. Não excluir o registro antigo, nem sobrescrever referências de agenda/atendimento/venda por comparação de nomes. Edição deve excluir da detecção apenas o próprio UUID confirmado pelo servidor, não um ID informado sem verificação.

## Modelo futuro de dependentes (proposta, não implementado)

1. Cada pessoa atendida tem UUID e histórico próprios no tenant; distinguir titular de dependente sem reutilizar o CPF ou UUID do responsável.
2. Relação explícita titular-responsável → dependente, com FKs compostas pelo tenant para impedir vínculos entre empresas. Cardinalidade, troca de responsável e exigência de documentos de dependentes precisam de decisão; não presumir CPF obrigatório/emprestado para eles.
3. Agenda, atendimento e venda referenciam a pessoa atendida. Pagador/responsável pode ser relação distinta, sem transferir ou juntar históricos automaticamente.
4. Eventos/saldo de fidelidade são individuais e auditáveis. Fórmula, expiração, resgate e ajustes não foram definidos; não inventados nesta tarefa.
5. Observações pertencem à pessoa atendida e têm projeção/permissão separadas. Notas não devem vazar para dependentes/responsáveis ou profissionais sem acesso autorizado.
6. Unificação futura precisa de autorização do Dono, plano de vínculos/históricos, auditoria e rollback. Nenhuma operação de merge foi implementada.

## Próximo contrato de persistência e seus gates

1. Resolver/certificar a trajetória gerenciada antes de instalar domínios em staging; preservar v1–v5 e suas âncoras. Não supor que uma migration posterior corrige falhas da instalação anterior.
2. Desenhar migration **aditiva** de CPF/nascimento, controle de completude e revisão, com transição de integridade revisada. Preservar registros antigos inicialmente incompletos.
3. Unicidade transacional por tenant no banco, canonicalização de CPF e política de proteção/ACLs de coluna. Definir armazenamento protegido e recuperação sem expor CPF em logs, notas ou DTOs gerais.
4. Comando específico criar/atualizar titular: validações iguais no servidor, UUID/versionamento, `auth.uid()`/membership fresco, tenant ativo, permissões e idempotência. Nunca usar service role no navegador ou a matriz local para contornar RLS.
5. Projeção mínima de alertas e indicador de completude; CPF inteiro apenas quando estritamente necessário e autorizado. A pesquisa por CPF não pode enumerar outro tenant.
6. Workflow auditado de revisão: Colaborador solicita; Gestor justifica exceções de nome/telefone; Dono revisa. Não herdar permissão atual de criação/atualização só porque pode revisar.
7. PostgreSQL descartável: CPF duplicado sob concorrência, autorização/negação por ator, isolamento, revogação após lock, dados legados, upgrade/rollback e integridade histórica. Só depois conectar a interface a comandos certificados.

## Resultados efetivamente executados

### Revisão do Lote 3 para publicação — 15/10/2026

Base desta revisão: `6985c9124af8fdb4709b29c1faaeab1d0b9ff94d`.
São sete arquivos, dependentes apenas do Auth/membership, navegação e código
legado já versionados. C1/O1 e a instalação gerenciada não são dependências da
preparação; continuam sendo trabalhos separados e não habilitam esta interface.

O conjunto originalmente documentado como 87 testes foi reexecutado com os sete
testes novos do gate de Meus Agendamentos, totalizando **94/94**. Foi acrescentada
uma regressão de compatibilidade da página com o Next, elevando o conjunto final
a **95 testes** e os específicos de Cadastro Inteligente de 20 para 21.

**Problema comprovado e corrigido:** a página exportava, além do componente
padrão, `CustomerPreparationBoundary` para uso dos testes. Um build mínimo real
do Next 16.3.8/webpack recusou esse export com `TS2344`. A função agora é privada;
os testes alcançam o mesmo boundary pelo componente padrão, sem alterar sua
lógica. O mesmo build isolado passou após a correção. A fixture usa contexto Auth
sintético, sem SDK, credenciais, .env ou rede Supabase. Não foi um build integral
do ERP nem uma certificação de Preview hospedado.

TypeScript completo e lint direcionado passaram. Na Home, a comparação do lint
com o HEAD encontrou os mesmos **41 erros e 19 avisos**, inclusive o mesmo
conjunto de diagnósticos ignorando apenas o deslocamento de linhas. A única
mudança da Home permanece o aviso com link: removidas essas quatro linhas, seus
bytes correspondem ao HEAD. Nenhum handler legado foi alterado.

**Limite de segurança:** nenhum botão, submit, endpoint novo ou fallback do
formulário preparatório grava clientes. Salvar não possui handler; validar impede
a submissão nativa e só atualiza erros em memória. Campos não têm `name`, nem há
action, fetch, storage ou transporte de CPF/nascimento. O helper sempre retorna
`canPersist=false`; snapshots de outro tenant são recusados somente no ensaio
local, sem representar enforcement ou isolamento hospedado.

Isso não é bloqueio global dos cadastros existentes: Home e Equipe mantêm seus
writers legados de clientes. Não foram executados nem passaram a receber dados
deste formulário. Desabilitar esses fluxos exigiria outra revisão/autorização.

**Preview automático:** publicará uma rota de preparação acessível após o fluxo
Auth/membership existente, sem adicionar capacidade de gravação ou consulta de
clientes. Não há variável, parâmetro ou papel que habilite Salvar nesta versão.
A avaliação deve continuar exclusivamente com dados fictícios. Auth e seus
acessos normais à rede pertencem ao fluxo existente; não foram certificados no
Preview por esta revisão. A fundação v6 publicada não fornece o contrato de
persistência de clientes, e nenhuma instalação hospedada é autorizada aqui.

As 20 migrations, a fundação v6, o Lote 2 e os demais lotes permanecem preservados.
Sem staging, commit, push, deploy, operações de banco ou alterações de ambiente.

### Evidências da implementação original — 14/10/2026

- **20 testes novos**, cobrindo CPF, máscaras, campos ausentes, calendário, nomes, telefone compartilhado, duplicidade CPF, snapshots de outro tenant, legado/edição, perfis, submit real local, boundary e ausência de transporte/persistência.
- Com regressões de seleção, navegação, autorização, callback, senha, permissões e integração local pendente de agenda: **87/87 aprovados; 0 falhas; 0 ignorados**. Os 13 testes de Meus Agendamentos permanecem não versionados e não são dependência destes fontes.
- TypeScript `--noEmit --incremental false`: aprovado.
- ESLint dos quatro arquivos novos de código/teste: aprovado, sem avisos.
- Lint da Home: 41 erros e 19 avisos preexistentes, sem aumento; execução completa desse arquivo continua reprovada. `git diff --check` e inspeção de whitespace dos novos arquivos aprovados.
- Preservação: SHA-256 de 222 arquivos iniciais confirmou mudanças somente em Home e backlog. Os 15 handlers de submissão da Home são idênticos ao HEAD-base; os 33 arquivos não rastreados iniciais, migrations/manifestos v1–v5, documento v6, evidências e backups permaneceram intactos.
- Navegador real, sessão sintética Dono: entrada pela lista atual; quatro campos ausentes; CPF repetido; data válida/futura por teclado; máscaras CPF/telefone; validação sem salvar; botão Salvar desabilitado; descarte ao recarregar e sair/retornar. Nenhum formulário legado foi submetido.
- Desktop 1280×720 e viewport móvel 390×844: sem overflow horizontal; campos com alvo de toque maior que 44 px; Tab do nome para CPF; quatro erros no móvel. São viewports, não aparelhos físicos. Perfis Gestor/Colaborador e troca de identidade foram exercidos com boundary/componentes reais e contexto controlado, não novas sessões reais desses perfis.

O preenchimento automatizado ISO do controle nativo de data não funcionou; a operação foi concluída por teclado, sem alterar o banco ou flexibilizar a validação. A leitura automatizada do valor do telefone foi inconclusiva; a aparência foi conferida visualmente com amostra fictícia, sem inferir defeito da máscara.

**Não executados:** PostgreSQL/Docker, gravações empresariais, busca de CPF hospedada, unificação, dependentes completos, revisão persistida ou testes de RLS do contrato novo. Não há schema/comando novo a testar nesta etapa; testes locais não certificam enforcement no servidor nem RLS hospedada.

## Arquivos e reprodução

Novos: `src/lib/customers/registration.ts`, `src/components/customers/CustomerRegistrationPreparation.tsx`, `src/app/clientes/cadastro-inteligente/page.tsx`, `tests/customer-registration.test.mjs` e este documento. Alterados: link/aviso de clientes em `src/app/page.tsx` e evidência em `docs/BACKLOG-HANDYHUB.md`.

```powershell
node --test tests/customer-registration.test.mjs tests/customer-selection.test.mjs tests/visual-navigation.test.mjs tests/auth-authorization.test.mjs tests/auth-callback.test.mjs tests/password-context.test.mjs tests/tenant-permissions.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/app/clientes/cadastro-inteligente/page.tsx src/components/customers/CustomerRegistrationPreparation.tsx src/lib/customers/registration.ts tests/customer-registration.test.mjs
git diff --check
```

Na implementação original, o comando acima continha 74 cenários; os 87 incluíam
também `tests/own-agenda.test.mjs`. Atualmente esse teste já é versionado e possui
20 casos. Para reproduzir o conjunto final desta revisão, acrescente-o ao comando
acima: são 95 testes, incluindo a nova regressão do export da página. Lint da Home
tem dívida preexistente documentada; não foram suprimidas regras.

Referência oficial consultada para a fronteira de autorização: [Supabase — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). GRANTs e políticas são controles do banco; a preparação local não os substitui. Nenhuma API ou configuração Supabase nova foi implementada.

Preview: **http://localhost:3303/clientes/cadastro-inteligente** em cópia local, com sessão normal já existente do ambiente sintético. Também acessível por Home → Base de Clientes → Preparar cadastro inteligente. Use dados fictícios, clique Validar e observe a indicação de que nada foi salvo. Não confirmar ações de cadastro na tela legada durante esta avaliação.

Capturas fora do repositório: `customer-preparation-desktop.jpg`, `customer-preparation-mobile.jpg` e `customer-preparation-errors-mobile.jpg`, no diretório de evidências local `customer-registration-1792018518062`. Nenhuma contém CPF preenchido.

Não houve commit, push, deploy, PR, merge, migration, instalação v6, alteração de configurações Auth ou escrita empresarial hospedada. As 33 entradas não rastreadas iniciais e todos os trabalhos preexistentes são preservados. A autenticação/leitura normal do preview existente não equivale a ausência de acesso à rede.

## Validação final para publicação — 15/10/2026

- Build integral de produção do ERP aprovado com **Next 16.3.8 / Turbopack padrão**: compilação, TypeScript e geração das 14 páginas estáticas, incluindo `/clientes/cadastro-inteligente`.
- A cópia isolada continha todos os arquivos versionados do HEAD `6985c9124af8fdb4709b29c1faaeab1d0b9ff94d`, acrescidos exclusivamente dos sete arquivos deste lote. Não foram utilizados os experimentos C1/O1, mocks de Auth, arquivos `.env` ou credenciais hospedadas.
- Execução equivalente a `npm run build` (`next build`), com dependências já instaladas, `NODE_ENV=production` e configuração de aplicação local sintética. O destino Supabase era um servidor de recusa em loopback, que recebeu **zero requisições**; Meus Agendamentos permaneceu desativado.
- A primeira tentativa encontrou uma limitação do Turbopack com `node_modules` vinculado para fora da raiz temporária. A repetição com cópia física das mesmas dependências passou, sem instalar pacotes ou alterar o código/configuração do ERP.
- Reexecutados: **95/95 testes**, sendo **21 específicos**, TypeScript sem emissão e lint dos arquivos novos de código/teste. A dívida de lint preexistente da Home permanece conforme a revisão acima; seus writers continuam inalterados.
- Esse build confirma compatibilidade do código completo, não autenticação hospedada, persistência de clientes ou instalação de contratos. Salvar continua desabilitado e CPF/nascimento permanecem somente em memória. Não foram executados migrations, acessos ao Supabase hospedado ou deploy manual.
