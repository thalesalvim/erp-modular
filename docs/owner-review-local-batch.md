# Retomada da avaliação do proprietário — lote local

Registro da validação anterior à publicação em 14/10/2026. Branch: `fix/convites-autorizacao-atomica`. Referência inicial preservada durante a implementação: `95eeed56d91937d33383dd8b71cdead55717f41f`.

**Resultado: PARCIAL.** O lote de apresentação e seleção transicional está disponível para revisão. Não certifica a persistência empresarial, a instalação gerenciada v6, a DRE ou a conclusão da Fase 2A.

## Recuperação e preservação

O estado interrompido foi inspecionado antes de prosseguir, incluindo os diffs e os arquivos novos. O backlog contém 31 IDs únicos: os 26 anteriores e HH-27 a HH-31 (consumo de produtos, categorias persistentes, déficit de estoque por 24 horas, calculadoras e orçamentos).

A comparação SHA-256 dos 216 arquivos do inventário inicial desta tarefa apontou alterações adicionais somente em `src/app/page.tsx` e `docs/BACKLOG-HANDYHUB.md`. Os arquivos criados neste lote são enumerados abaixo. Os ajustes anteriores de CSS, login, agrupamento do menu e seus testes/documentação foram preservados; o diff completo contra HEAD inclui esse trabalho anterior e não deve ser tratado como um único lote.

As 17 migrations SQL históricas são byte a byte idênticas aos blobs de `e46d15d`. `.gitkeep` também permaneceu idêntico. As migrations v3/v4/v5, os manifestos, a arquitetura v6, a integração separada de Meus Agendamentos, os sete JPGs, o RAR e os demais arquivos preexistentes não foram modificados. Os 15 handlers `onSubmit` da Home permanecem textualmente idênticos ao início deste lote. Isso demonstra preservação de handlers, não aprovação de todas as escritas legadas.

## Arquivos deste lote

Alterados:

- `docs/BACKLOG-HANDYHUB.md`: 31 requisitos, evidências, dependências e estados; registro original separado da retomada.
- `src/app/page.tsx`: seletor em agenda/atendimento, novas entradas sem pré-seleção do cache, link Sobre Nós e aviso/guard para escala ausente.

Criados:

- `src/app/sobre/page.tsx`.
- `src/components/customers/CustomerSelect.tsx`.
- `src/components/customers/useCustomerOptions.ts`.
- `src/lib/customers/selection.ts`.
- `tests/customer-selection.test.mjs`.
- `docs/owner-review-local-batch.md`.

## Resultado funcional delimitado

| Item | Resultado | Evidência e limite |
| --- | --- | --- |
| Sobre Nós | Concluído como página informativa | Contatos oficiais, link Ajuda no menu, retorno ao sistema e layout desktop/móvel. Android/iPhone têm instruções de atalho e aviso explícito de que PWA/offline não estão certificados. Instalação em aparelho físico pendente. |
| Seleção de clientes | Parcial | Lista confirmada por leitura com sessão normal e tenant selecionado, sem fallback para cache; homônimos/IDs repetidos ficam indisponíveis; vazio/erro/negação separados. Escrita continua por nome, sem contrato normalizado por UUID. |
| Escala ausente | Parcial | Ausência, lista vazia ou estrutura não-array não criam horários e não quebram o renderer; mensagem honesta. Configuração de jornada/intervalos e saneamento persistente não implementados. |
| DRE | Correção bloqueada | Conflito de campos e atualização otimista comprovados. Nenhuma permissão/plano foi alterado; trocar precedência isoladamente permitiria confiar em estado ainda não confirmado pelo servidor. |
| Convites | Integração bloqueada no preview | Guard de template e ausência de credencial administrativa deliberados. Não comprova ausência atual de SMTP hospedado. Nenhum envio realizado. |
| Categorias, consumo, estoque 24 h, calculadoras, orçamentos | Não implementados | Novos contratos/regras e validação normalizada são necessários; não foram criadas telas com salvamento fictício. |

### Seleção: garantias e limites

O hook consulta a fonte existente com identidade autenticada e membership atual. Respostas atrasadas são descartadas; troca de usuário, tenant ou objeto de membership invalida as opções. Falha ou estrutura ausente retorna indisponível, não uma lista vazia autorizada nem dados do cache compartilhado.

As opções expõem somente nome operacional e identificador local opaco; CPF, telefone, notas e identificadores originais não são renderizados. Nomes equivalentes após normalização Unicode/case/trim e IDs repetidos são desabilitados. A escolha habilitada é convertida ao nome exato exigido pelo handler legado.

Na revisão final foram retiradas quatro pré-seleções que liam `customers[0]` do cache gerencial. Avisos também deixaram de repetir nomes históricos não confirmados. A edição preserva o registro anterior até uma escolha explícita, sem transformá-lo em opção válida.

**Limitação obrigatória:** nomes continuam sendo referências de escrita; não há proteção transacional contra mudança do catálogo entre leitura e submissão. A Home e a página Equipe ainda possuem outros fluxos legados e cache compartilhado. Este lote não certifica o isolamento global desses fluxos nem as políticas do agregado remoto. A próxima evolução exige leitura mínima e associação normalizada por UUID; não foi criado endpoint de escrita.

### DRE

Em `src/app/page.tsx`, `updateCompanyInMasterDb` mistura `currentCompany` com novos campos e publica o estado local antes de confirmar o resultado da atualização no servidor. A alteração de plano envia `plan_name`, enquanto `hasDREAccess` prioriza `planName`. O botão de alteração não aguarda a confirmação e pode anunciar sucesso antes de uma negação por RLS.

Uma prova controlada usando o initializer real de `hasDREAccess` retornou: Ultra/Ultra libera; Pro/Pro nega; `planName=Pro` com `plan_name=Ultra` nega. A causa do campo antigo está demonstrada, mas priorizar o novo campo não comprova contratação nem autorização. Solução pendente: confirmação autoritativa de assinatura/entitlement e autorização do relatório no servidor, com testes de sucesso e negação. Não foi clicado upgrade nem enviado comando de plano.

### Escala e convites

Dados antigos podem não ter `schedule`; os defaults só existem na criação de novos colaboradores. O renderer agora recebe array validado ou lista vazia, com aviso. Não foram inventados turnos, folgas ou intervalos, nem executados os controles que salvam escala.

`src/app/api/team/invite/route.ts` exige `AUTH_INVITE_TEMPLATE_MODE=token_hash` antes de criar autorização ou chamar Auth Admin. O preview não recebe essa flag nem chave administrativa. Documentos da camada 1C registram entrega real anterior por SMTP/Resend; o estado hospedado atual não foi consultado nesta tarefa. Configurar envio continua dependendo de template, origem, SMTP e RPCs instaladas/certificadas; não basta ativar a flag.

## Validações executadas

| Verificação | Resultado |
| --- | --- |
| Node: seleção, navegação visual, autorização, callback, senha, permissões e own-agenda | **67/67 aprovados; 0 falhas; 0 ignorados**. Desses, 13 pertencem ao arquivo novo. |
| TypeScript `--noEmit --incremental false` | Aprovado. |
| ESLint dos novos fontes/teste | 0 erros, 0 avisos. |
| ESLint da Home | **Não aprovado:** 41 erros preexistentes; 19 avisos. Baseline desta tarefa: 41 erros e 20 avisos. Sem supressões ou aumento de erros. |
| `git diff --check` | Aprovado após remover linha em branco extra ao final do backlog. Avisos Git de conversão LF/CRLF em arquivos não-SQL não são alteração de migrations. |
| Preservação SHA-256 / blobs | 216 arquivos iniciais conferidos; somente os dois arquivos existentes autorizados alterados nesta tarefa; 17 SQL históricos intactos. |
| Preservação dos handlers de submissão | 15/15 idênticos ao início deste lote. |

Os testes exercem código real de projeção, hook e componente, com transporte/effects controlados nos cenários de atraso e falha. As regressões de permissões/own-agenda incluem mocks e contratos locais. **Não equivalem a novos ensaios PostgreSQL, certificação de RLS hospedada ou gravação real.**

### Navegador real

Preview em checkout descartável local, com dependências já instaladas e apenas configuração pública do ambiente de teste identificado. O original não foi iniciado com `next dev`, evitando alterações geradas em seus arquivos. A autenticação usou contas sintéticas existentes; não foram provisionados usuários ou empresas.

- Dono: agenda e atendimento exibiram o seletor; no código final, novo agendamento inicia vazio e aceita opção cadastrada mediante escolha explícita. Formulários fechados sem submissão. Sobre Nós acessível pelo menu; escala ausente mostrou aviso sem preencher horários.
- Gestor: agenda e seletor visíveis; 12 módulos e ausência de Meus Planos, mantendo o perfil existente. Dono possui 13 módulos. Esta inspeção antecedeu a remoção final da pré-seleção, coberta posteriormente por testes e pelos perfis Dono/Funcionário.
- Funcionário: 7 módulos, ausência de gerenciamento/financeiro exclusivos e presença de Sobre Nós. Novo agendamento vazio exige seleção; catálogo da empresa atual disponível. Sem submissão.
- Segundo tenant: lista de clientes vazia confirmada, sem reaproveitamento da opção da primeira empresa; estado vazio explícito e formulário obrigatório. O ensaio compara essas fixtures, não todos os tenants ou políticas possíveis.
- Desktop 1280×720 e viewport móvel 390×844: página Sobre Nós sem overflow horizontal; seletor com altura mínima de 44 px. Não são aparelhos físicos.
- Fixture exclusivamente local sem gravações: escolha explícita, homônimos, vazio, negação, erro de leitura e troca de listas. Essa fixture existe somente na cópia descartável, não no produto/repositório.

### Não executados / pendências

- Instalação PWA/atalho em Android/iPhone físicos, offline, teclado virtual e matriz completa de temas/dispositivos.
- Submissão/persistência de agenda ou atendimento; associação por UUID e conflitos sob concorrência.
- PostgreSQL/Docker, migrations, testes históricos SQL completos ou novos testes hospedados de RLS.
- SMTP/convite real, alteração de plano, regras DRE/CMV, configuração/salvamento de escalas.
- Correção dos 41 erros históricos de lint e extensão dos seletores para Equipe.
- Perfil gerenciado v6 continua bloqueado; nenhuma instalação foi realizada.

## Estado do backlog

31 IDs preservados: **1 implementado (HH-26, conteúdo/links), 17 parciais e 13 ausentes**. A página Sobre Nós não torna HH-25 ou HH-23 completos, pois instalação/PWA não foram certificados. O inventário e os critérios individuais estão em `BACKLOG-HANDYHUB.md`.

## Reprodução e revisão

Na raiz do projeto, sem instalar dependências:

```powershell
node --test tests/customer-selection.test.mjs tests/visual-navigation.test.mjs tests/auth-authorization.test.mjs tests/auth-callback.test.mjs tests/password-context.test.mjs tests/tenant-permissions.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/app/page.tsx src/app/sobre/page.tsx src/components/customers src/lib/customers tests/customer-selection.test.mjs
git diff --check
```

O comando ESLint completo acima retorna erro pela dívida existente da Home; lint apenas dos cinco fontes/teste novos passa.

Preview atual: **http://localhost:3303/** e **http://localhost:3303/sobre**. Sobre Nós é público; a Home exige sessão normal do ambiente de teste. Avaliar seleção abrindo Novo Agendamento ou Novo Atendimento; não confirmar salvamento nesta revisão. Localhost não funciona em outro celular; uma exposição de rede não foi configurada.

Capturas e registros locais (fora do repositório):

`.codex/visualizations/2026/10/13/01a136d8-db52-76b2-98af-f22395bbd77a/owner-review-1792009382693/`, sob o diretório pessoal do executor.

Incluem `about-desktop.jpg`, `about-mobile.jpg`, `owner-appointment-mobile.jpg`, `employee-appointment-mobile.jpg`, `owner-b-empty-mobile.jpg`, `schedule-missing-mobile.jpg`, comparação de lint, prova da DRE e inventário de preservação. Capturas antigas anteriores às últimas correções são identificadas na análise; não representam submissões bem-sucedidas.

Não houve staging, commit, push, PR, merge, deploy, envio de e-mail, alteração de configuração hospedada ou escrita empresarial remota. As chamadas normais de login/logout e leituras do ambiente de teste não foram confundidas com ausência de acesso à rede. O próximo lote depende de revisão e autorização do proprietário; não foi iniciado.

Na consolidação posterior, os dois lotes serão publicados separadamente mediante nova autorização. O comando de testes de reprodução acima exclui os 13 testes locais de Meus Agendamentos: eles pertencem à integração pendente e não serão incluídos nestes commits. Os 67 resultados anteriores permanecem como registro histórico; a seleção publicada corresponde a 54 testes, com verificação em cópia contendo exclusivamente os arquivos staged. Nenhuma conclusão funcional parcial foi promovida a completa.

Validação da consolidação efetivamente executada: 54/54 testes aprovados e TypeScript aprovado na cópia isolada do staging atual. Lint dos novos fontes/teste: zero erros e avisos; Home: 41 erros e 19 avisos preexistentes. `git diff --cached --check` aprovado. Os oito arquivos staged foram inspecionados sem credenciais; Meus Agendamentos e v6 não estão na cópia. A autorização DRE e o writer do plano são idênticos à referência anterior. Não foram instaladas dependências nem acessados bancos durante esses testes.
