# Meus Agendamentos — leitura isolada e validação PostgreSQL

Data: 14/10/2026. Branch: `fix/convites-autorizacao-atomica`.
HEAD preservado: `95eeed56d91937d33383dd8b71cdead55717f41f` (backlog publicado).

## Diagnóstico corrigido do Docker

Docker Desktop **4.95.0** está instalado por usuário e estava aberto. A CLI não
está no PATH desta sessão nem na pasta padrão de Program Files. Seu caminho é:

```text
%USERPROFILE%/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe
```

O diagnóstico anterior não examinou essa instalação por usuário. Consulta dos
registros de instalação/processos fora do sandbox permitiu encontrá-la; não foi
necessário instalar, reiniciar ou modificar Docker/WSL/Windows. O sandbox também
limitou a primeira consulta de serviços; a inspeção externa de leitura distinguiu
isso de serviço parado. Nenhum PATH global foi alterado.

- CLI/Engine: **29.8.2**.
- Contexto: `desktop-linux`; endpoint **efetivamente validado**:
  `npipe:////./pipe/dockerDesktopLinuxEngine`.
- Engine: Linux x86_64; WSL `docker-desktop` em execução, versão **2**.
- Sem overrides de conexão Docker na sessão; o harness recusa overrides/contextos
  não autorizados e fixa `--host` em todos os comandos.
- Não foi encontrada instalação PostgreSQL Windows independente pelos comandos
  e registros consultados. Ela não é necessária: o container utiliza PostgreSQL nativo.
- Imagem existente, sem pull:
  `postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`.
  O RepoDigest canônico é `postgres@sha256:...` (sem a tag); digest e AMD64 conferidos.

Se o Desktop estiver fechado em outra retomada: abrir **Docker Desktop** pelo
menu Iniciar, aguardar o Engine Linux ficar ativo e repetir a validação do
endpoint/contexto. Não reinstalar, habilitar recursos Windows ou reiniciar WSL
automaticamente. O harness falha fechado se não conseguir provar o destino local.

## Contrato implementado

Página separada: **`/meus-agendamentos`**. A navegação/agenda gerencial existente
não foi alterada. O acesso ao piloto é pelo endereço direto, no servidor local
que estiver executando estes arquivos; previews antigos não recebem a mudança.

Endpoint: **`GET /api/agenda/own?tenantId=<UUID>`**.

### Ativação bloqueada por padrão

Página e GET exigem exclusivamente a variável **server-side**
`HANDYHUB_OWN_AGENDA_ENABLED` com valor exatamente `'true'`. Ausência, string
vazia, `'false'`, espaços, diferenças de caixa ou qualquer outro valor desativam
o lote. Não existe variável pública correspondente nem configuração pelo cliente.
Não definir a variável como true antes da certificação hospedada descrita abaixo.

O GET devolve 404 com corpo vazio e `private, no-store` antes de criar o cliente
Supabase. A página agora é Server Component: usa `connection()` para avaliar a
flag por requisição e `notFound()` antes de renderizar a interface autenticada.
A interface anterior foi movida, sem ampliar acesso, para `OwnAgendaView.tsx`.
Query, cookies, headers, RSC e chamadas diretas não alteram a flag do servidor.

Dependência indispensável além dos dez arquivos originais: `src/proxy.ts`.
O proxy compartilhado já consultava Auth antes das rotas. Agora bloqueia somente
esses dois caminhos desativados antes do refresh da sessão, mantendo o fluxo
anterior das demais rotas. Página e GET conservam os próprios gates mesmo sem
passar pelo proxy. Desativar a flag também impede novas leituras do lote; não
apaga informações que já tenham sido entregues anteriormente ao navegador.

Com a flag habilitada, o contrato de autorização continua sendo:

1. Valida UUID e rejeita parâmetros extras/duplicados, inclusive seletores de ator/papel.
2. Confirma o usuário com `auth.getUser()` no cliente SSR da sessão; não usa service_role.
3. Consulta membership ativa atual do mesmo usuário/tenant.
4. Chama somente `erp_read_own_appointments({p_tenant}, {get:true})`. O banco
   revalida permissões, status do tenant e vínculo Auth/profissional por UUID.
5. Valida exatamente seis campos e impede propagação de dados privados/schema drift.

```json
{
  "status": "ready",
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000010331",
      "date": "2026-10-10",
      "time": "09:00:00",
      "clientName": "Cliente sintético",
      "serviceName": "Serviço sintético",
      "status": "Agendado"
    }
  ]
}
```

`200` com `items: []` significa leitura autorizada sem agendamentos próprios.
`400 / INVALID_REQUEST`, `401 / AUTH_REQUIRED`, `403 / ACCESS_DENIED` e
`503 / AGENDA_UNAVAILABLE` são resultados distintos, sem coleção de sucesso.
SQLSTATE `42501` é negação; RPC ausente, manutenção, falha de transporte ou DTO
inválido não viram lista vazia. Mensagens internas, credenciais e tokens não são
devolvidos nem registrados pelo endpoint. Respostas usam `private, no-store`.

Esta RPC é **própria**, inclusive para Dono/Gestor. Não substitui a agenda geral,
não autoriza leitura de financeiro/notas/catálogos e não habilita writes.
Data/hora permanecem locais, sem conversão de fuso. A projeção não possui versão,
preço ou seletor de profissional, portanto não serve para edição/finalização.

O estado do piloto é separado das coleções `appointments` legadas e seus saves.
Não consulta `tenant_data`, não usa fallback/caches localStorage e não escreve no
agregado. O filho da página é remontado por usuário/tenant (inclusive A → B → A);
pedidos antigos são abortados/descartados. Atualização limpa o resultado exibido
enquanto uma nova autorização é consultada. Não existem ações de criação, edição,
exclusão ou finalização nesta tela.

Referências verificadas: [RPC histórica](../supabase/migrations/20261011020000_erp_own_appointments_read.sql),
[contrato M3](own-appointments-read-phase-2a.md), [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser)
e [RPC somente leitura](https://supabase.com/docs/reference/javascript/rpc).

## Validações realmente executadas

- Primeiro gate: **10/10** cenários PostgreSQL nativos, após a cadeia histórica
  v1/v2 → v3 → v4 → v5, antes da implementação funcional.
- Harness integrado: **11/11** testes PostgreSQL nativos aprovados, incluindo
  **13 cenários HTTP loopback** do handler real com autorização SQL real após v5.
  Uma repetição após ajustes de UUID/teste de revogação também passou.
- **13/13** testes novos Node aprovados: contrato, handler, erros, cache, troca de
  identidade/tenant, boundary da página e renderização pelo React real.
- Execução conjunta final: **55/55**, sendo **13 testes novos + 42 regressões
  preexistentes** de identidade, política e RLS/PGlite, sem falhas ou ignorados.
- TypeScript completo (`--noEmit --incremental false`), lint dos arquivos novos e
  sintaxe Python aprovados. Não foi executado build ou navegação autenticada real.
- As referências v1–v4 permanecem iguais ao manifesto revisado; o gate de integridade
  v5 passou no banco descartável após os testes.

Os cenários nativos cobriram projeção mínima, homônimos por UUID, tenant estrangeiro,
anon/sem identidade/sem membership/Master/sem grant, agenda vazia, reatribuição,
revogação, suspensão, campos privados, ACLs/papéis e integridade histórica.
Nos cenários HTTP, status 200/401/403 foram conferidos de verdade no servidor
loopback. Uma fixture legada conflitante não substituiu dados normalizados.

**Fronteira controlada:** Auth é um adaptador de teste; identidade SQL usa papéis
e claims sintéticos. O HTTP usa Node loopback e o handler Next compilado, não uma
instância completa Next/PostgREST. O React renderiza os estados realmente, mas os
testes da página controlam o contexto Auth. Isso não certifica GoTrue/JWT/cookies
reais, refresh de sessão, PostgREST hospedado ou o fluxo autenticado no navegador.

## Recursos e preservação

Todos os bancos eram sintéticos em containers com rede `none`, PGDATA em tmpfs,
imagem fixada, `--pull=never`, sem portas publicadas ou volumes externos. O servidor
HTTP de teste abriu somente loopback temporário e foi fechado em `finally`.
O harness removeu exclusivamente os IDs criados e comprovados por labels.

| Execução | Container próprio, removido ao final |
| --- | --- |
| Gate inicial | `df80f5655a3913b4f5b01e0c54a40259ea6e3baf2feffdded9d52b64f69048b2` |
| Integração inicial | `33e242c713cf17999bb7056b578c213c11808b874b5577f77c34d3a6e7b84ff6` |
| Integração final | `27f25f841ad4e7e0238328ff0584d993dd63fc670ca00e681bd0a4e3138d5ee8` |

Inventários antes/depois iguais: **0 containers, 0 volumes, 3 redes e 1 imagem**,
incluindo seus IDs. Engine ID permaneceu
`05b5d1be-15a5-46d9-a5e1-10ccc3edcce1`. Isso demonstra preservação durante a janela
observada, não estabilidade permanente do Docker.

As 17 migrations históricas, v3/v4/v5, backlog publicado e demais arquivos locais
preexistentes permanecem sem alterações. Arquivos desta integração são novos e
ficam sem commit/staging/push. Nenhum deploy, merge, PR, instalação, mudança de
configuração ou acesso a banco hospedado foi realizado. Nenhum arquivo `.env`
foi carregado pelos testes.

## Reprodução

No repositório, com o Docker Desktop Linux ativo e a imagem já disponível:

```powershell
$handyhubDockerCli = Join-Path $env:USERPROFILE 'AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
python -B scripts/test-own-agenda-integration.py --docker-cli $handyhubDockerCli
node --test tests/own-agenda.test.mjs tests/auth-authorization.test.mjs tests/tenant-permissions.test.mjs tests/tenant-domain-rls.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/proxy.ts src/app/api/agenda/own/route.ts src/app/meus-agendamentos/page.tsx src/components/agenda/OwnAgendaView.tsx src/lib/agenda tests/own-agenda.test.mjs tests/helpers/own-agenda-route.mjs tests/helpers/own-agenda-postgres.mjs
```

Em outro computador, passar a localização real da CLI ou omitir `--docker-cli`
quando ela estiver no PATH. Isso não altera o endpoint permitido ou a validação
de contexto. O manifesto obrigatório v5 é conferido antes de criar recursos.
Os testes não têm DSN remoto, não baixam imagem e não usam credenciais hospedadas.

## Revisão do Lote 2 — 15/10/2026

Base desta revisão: `557a1ad004ac02fb7ab2a4939120b53ba493e9d9`.
Reexecutados **11/11 testes PostgreSQL nativos**, incluindo os 13 cenários HTTP
loopback internos, e **55/55 testes Node/PGlite**, sem falhas ou ignorados.
TypeScript completo, lint direcionado e sintaxe Python aprovados. O container
próprio foi removido e os inventários de Engine/containers/redes/volumes/imagens
permaneceram iguais. Nenhuma sessão real, JWT assinado ou chamada hospedada foi
utilizada; os limites dos adaptadores Auth/HTTP descritos acima permanecem.

**Dependência gerenciada não satisfeita:** a RPC
`erp_read_own_appointments(uuid)` está na migration histórica
`20261011020000_erp_own_appointments_read.sql` e depende das tabelas, helpers,
políticas e vínculo Auth/profissional daquela cadeia. A fundação gerenciada
v6/1 revisão 2 não instala a agenda nem essa RPC. Sua publicação não torna o
endpoint utilizável no staging. Os registros anteriores indicam ausência dessa
estrutura hospedada; isso não foi reconfirmado nesta revisão, exclusivamente local.

Logo, não foi possível confirmar o requisito de independência de migrations
ainda não instaladas no staging. O uso hospedado continua bloqueado por
essa dependência externa ao Lote 2; a implementação local permanece PARCIAL.
Não aplicar a cadeia histórica ao perfil gerenciado nem alterar a raiz v6 para
contornar o bloqueio. É necessária uma evolução de agenda compatível com a
linhagem gerenciada e sua validação autorizada, fora deste lote.

Se a RPC estiver ausente, o endpoint retorna `503 / AGENDA_UNAVAILABLE`, conforme
regressão com resposta controlada do provedor; isso não prova instalação ou
isolamento hospedado. Paginação/limites PostgREST e o caminho completo
navegador → cookie/JWT → PostgREST → PostgreSQL continuam pendentes.

### Correção do gate de publicação — 15/10/2026

Após a correção, foram executados **20/20 testes específicos** (13 anteriores
adaptados e sete novos), **62/62 Node/regressões** no conjunto e **11/11 nativos**,
incluindo os 13 cenários HTTP internos. Os testes ativos habilitam a flag somente
em um objeto de ambiente da VM de teste; não modificam `process.env`, arquivos
de configuração ou ambientes implantados. A matriz negativa comprova zero
criações de cliente e zero consultas de sessão pelo proxy quando desativado.
Cobre valores ausentes/inválidos, tentativa por inputs da requisição, leitura
da flag a cada invocação, `notFound()` real do Next e continuidade das outras rotas.

Um Next dev real, em diretório temporário e loopback, recebeu quatro requisições
desativadas à página/GET: todas retornaram 404 vazio, sem chamadas às dependências
Supabase substituídas por armadilhas. A fixture não carregou SDK, credenciais,
arquivos .env nem banco hospedado. O processo próprio foi encerrado. Isso verifica
o caminho HTTP/Proxy do Next local, não Auth ou isolamento hospedados.

TypeScript completo, lint direcionado, sintaxe Python e whitespace passaram.
Os inventários Docker ficaram iguais e o container próprio foi removido.

Inspeção local somente dos nomes: a flag não estava no processo nem nos arquivos
.env examinados. A consulta de metadados das variáveis do projeto Vercel não
retornou os dados necessários; **produção/preview não foram confirmados**.
Nenhum valor secreto foi solicitado com decriptação ou exposto, e nenhuma
configuração de ambiente foi alterada. Antes do push com possibilidade de deploy
automático, confirmar ausência/desativação da flag em todos os alvos relevantes;
uma configuração preexistente exatamente true permitiria a ativação no servidor.

**Conferência manual anterior à publicação controlada:** o proprietário informou
que a pesquisa exata por `HANDYHUB_OWN_AGENDA_ENABLED` no projeto Vercel
`erp-modular` retornou **No Results Found** nas abas **Project** e **Shared**,
com **All Environments** selecionado. Essa é evidência manual fornecida pelo
operador, não resultado da integração que retornou 403. A revisão do repositório
não encontrou outra configuração da flag no build ou nas fontes de deploy.
Os valores true das fixtures existem somente nas VMs de teste e não configuram
ambientes. A autorização cobre commit/push na branch, inclusive a possibilidade
de Preview automático; não cobre ativação, deploy manual ou promoção a Production.

Não ativar até validar RPC, tabelas, permissões, vínculo Auth/profissional,
cookies/JWT/refresh, PostgREST e isolamento entre tenants/usuários no ambiente
autorizado. A flag não substitui nenhum desses controles nem autoriza instalação.
Código desativado por padrão pode ser versionado separadamente. A ausência da
flag foi conferida manualmente conforme registro acima; disponibilidade e
certificação funcional hospedadas continuam pendentes.

## Estado e próximo lote

**PARCIAL: leitura isolada implementada e autorizada nos ensaios locais; integração
real de sessão/HTTP do provedor ainda pendente.** Não declarar concluída a integração
operacional nem habilitar um ambiente hospedado por essa aprovação.

Próximo lote mínimo: disponibilizar Auth + PostgREST em ambiente local descartável
ou homologação explicitamente autorizada/certificada; validar instalação da RPC
e perfil de integridade sem alterar âncoras para aceitar o estado encontrado;
testar navegador → cookie/JWT → endpoint → RPC → tela, incluindo expiração/refresh,
revogação e troca de tenant. Medir limite de linhas/paginação e volume antes de uso
real; a RPC histórica não fornece paginação e limites do provedor não foram certificados.
Uma eventual entrada de menu pode ser adicionada depois dessa revisão, preservando
a agenda gerencial. Não adicionar writes, financeiro, notas ou fallback legado.

## Arquivos do lote

| Arquivo | Responsabilidade |
| --- | --- |
| [src/app/api/agenda/own/route.ts](../src/app/api/agenda/own/route.ts) | Endpoint GET autenticado |
| [src/app/meus-agendamentos/page.tsx](../src/app/meus-agendamentos/page.tsx) | Página separada e estado por identidade/tenant |
| [src/components/agenda/OwnAgendaView.tsx](../src/components/agenda/OwnAgendaView.tsx) | Projeção operacional e estados de erro/vazio |
| [src/lib/agenda/own-contract.ts](../src/lib/agenda/own-contract.ts) | Validação exata do DTO |
| [src/lib/agenda/own-client.ts](../src/lib/agenda/own-client.ts) | GET sem cache/fallback e seleção de resposta atual |
| [tests/own-agenda.test.mjs](../tests/own-agenda.test.mjs) | Regressões de contrato, HTTP controlado e React |
| [tests/helpers/own-agenda-route.mjs](../tests/helpers/own-agenda-route.mjs) | Carregamento do handler real em teste |
| [tests/helpers/own-agenda-postgres.mjs](../tests/helpers/own-agenda-postgres.mjs) | HTTP loopback com SQL nativo no recurso próprio |
| [scripts/test-own-agenda-integration.py](../scripts/test-own-agenda-integration.py) | Bootstrap v1 → v5 e regressões nativas |
| docs/own-agenda-read-integration.md | Contrato, evidências, reprodução e limites |
| [src/proxy.ts](../src/proxy.ts) (já versionado, alteração pontual) | Gate antes do refresh de sessão nos dois caminhos |
