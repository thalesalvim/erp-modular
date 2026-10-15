# Instalador gerenciado — fundação do piloto v6/1

15/10/2026, revisão local 2. Escopo da etapa 1/3: **fundação executável e validada localmente**.
Não certifica instalação hospedada nem equivale ao ERP completo v1–v5.

## Entrega e limite

Release em `supabase/install/managed-v6/1`, montado offline por
`scripts/managed_v6_release.py`. O manifesto fixa os bytes SQL, as fontes
históricas e os fingerprints independentes de baseline/raiz. Duas instalações
limpas independentes reproduziram a referência, revertendo DDL antes do selo.
O instalador nunca aprende uma referência do banco de destino.

Pré-requisito: baseline de aplicação + identidade + políticas da Camada 1 com
cutover já realizado e perfil PostgreSQL 17.11 exatamente revisado. Uma base
vazia sem essas dependências, um estado misto ou uma baseline diferente são
recusados; nenhuma baseline é recriada automaticamente.

A nova raiz é `handyhub_private.release`, release
`managed-customer-foundation-v6-1`. Nenhum selo v1–v5/C1 é inserido ou substituído.
O desenho v6 amplo anterior e todos os experimentos permanecem preservados.
Esta raiz deliberadamente não instala convites, finanças, agenda ou o contrato
de clientes. Não se deve executar as migrations históricas sobre ela.

O lote usa uma transação, advisory lock de instalador, locks SHARE UPDATE
EXCLUSIVE na baseline, timeouts, preflight e postflight. Preserva todos os ACLs,
políticas, funções e atributos anteriores; nenhum grant global é revogado.
Não altera registros existentes, Auth, roles do provedor ou dados legados.
O trigger novo bloqueia INSERT/UPDATE/DELETE de memberships somente para tenants
explicitamente habilitados no piloto, verificando o tenant antigo e o novo.
TRUNCATE é recusado se atingir piloto ativo. Só a sessão operacional postgres
sem SET ROLE de API pode administrar essa identidade; nenhuma RPC de identidade
do piloto é instalada nesta etapa. service_role continua sem acesso aos novos
objetos privados. Fora do piloto, os comandos SQL anteriores continuam válidos.

Não se promete instalação sem qualquer bloqueio: o FK novo e os triggers exigem
locks breves que podem aguardar/bloquear DML em tenants/memberships até commit.
SELECT e escrita JSON continuam, como comprovado com conexões simultâneas.
O timeout cancela o lote e reverte mudanças se a janela não estiver disponível.

O executor é `postgres` NOSUPERUSER com privilégios efetivos comprovados.
O novo reader é NOLOGIN/NOBYPASSRLS/NOINHERIT, sem criação/replicação e separado
do owner. Helpers privados retornam somente a identidade ou o booleano Owner
ativo, usando auth.uid() e o acesso já existente do metadata owner. O reader não
recebe USAGE em Auth nem SELECT/grants/políticas novos nas tabelas da baseline.

`hh_customer_access` é uma sondagem de permissão, não uma autorização reutilizável
ou comando de cadastro. Só permite o teto Owner para read/create/update, tenant
ativo, membership ativa e piloto habilitado. A instalação termina em manutenção
e com zero tenants habilitados. A etapa 2 deve revalidar e bloquear recursos no
próprio comando transacional; não pode confiar em uma sondagem anterior.

## Reprodução local

Comandos autossuficientes do Lote 1, usando Python e o Docker local já instalados:

```powershell
python -B scripts/managed_v6_release.py
python -B scripts/test-managed-v6.py
```

O teste procura a CLI no PATH ou na instalação por usuário do Docker Desktop.
Se necessário, informe o executável local com `--docker`; não altere o PATH global.
As regras específicas de `.gitattributes` mantêm LF nos dois scripts Python,
na fixture JSON e nos manifestos históricos v4/v5 hashados pelo release,
inclusive em checkouts Windows com `core.autocrlf=true`. A regra SQL permanece.
Não normalizar nem recalcular hashes para aceitar bytes diferentes.

Regressões históricas adicionais citadas abaixo foram executadas anteriormente
por `scripts/test-customer-contract-regressions.py`, pertencente ao Lote 5.
Esse runner não é dependência nem comando autossuficiente do Lote 1; sua
reprodução exige revisão separada do Lote 5. Seus resultados anteriores não
devem ser apresentados como testes reexecutados nesta consolidação.

O harness existente valida endpoint local, imagem por digest, rede none, tmpfs,
sem portas/volumes externos e cleanup por IDs/labels próprios. Não baixa imagem.
O teste compara inventários completos antes/depois. Usa usuários/dados sintéticos.
`--review` imprime candidatos de duas construções próprias e não altera manifesto.
Não usar esse modo contra um destino; o programa não aceita DSN ou projeto remoto.

`--preflight-only` e `--print-sql` do montador apenas imprimem SQL revisado, sem
conectar. O operador deve fornecer, em execução futura expressamente autorizada,
`SET handyhub.managed_install='pilot-v6-1'`. Não há executor remoto automático.
Não encadear essa saída a um banco hospedado nesta etapa.

O postflight também confere independentemente o corpo do verificador raiz,
excluído do fingerprint para evitar autorreferência. Owner/ACL/configuração desse
verificador entram no fingerprint; seus bytes entram no manifesto externo.
Não há proteção absoluta contra o administrador que controla toda a raiz.

## Evidências e bloqueios

- **22/22 testes da fundação**, sem falhas ou ignorados na execução final:
  instalação fechada, preservação de dados/Auth, perfis/tenants, negação de DML
  e impersonação de role técnica, adulterações e sombras temporárias, reinstall,
  imutabilidade, revogação/suspensão/manutenção, preflight somente leitura,
  baseline insegura, executor/ack, rollback tardio, retry após rollback,
  corpo do verificador, identidade ausente, manifesto ausente/adulterado e saída
  SQL binária UTF-8/LF no Windows; preservação integral do contrato anterior,
  continuidade SQL de empresas/identidade/JSON e lock concorrente controlado.
- **76/76 regressões históricas PostgreSQL** e **25/25 verificações Node/PGlite**
  relacionadas aprovadas; sintaxe Python, manifesto e whitespace verificados.

O perfil reproduz todos os 148 itens observados no staging em 15/10: 19 roles
alcançadas pelo grafo, 24 vínculos, configs, ACLs de banco/schema/objeto/coluna e
defaults. A baseline é reconstruída das fontes históricas intactas; metadados
observados são comparados integralmente antes de calcular a âncora local.
Duas construções independentes reproduziram a baseline e a raiz. O manifesto
preserva também a referência da revisão local 1, que nunca foi instalada.
Não houve substituição do hash esperado por um digest aprendido do destino.

Libraries supautils/safeupdate são registradas como metadados, não carregadas no
PostgreSQL vanilla. O harness troca a sessão para authenticator antes de SET ROLE,
sem inicializar essas libraries ausentes. Não certifica seus hooks privilegiados,
GoTrue/Storage/Realtime completos, JWT assinado, PostgREST ou backup hospedado.
O teste de exclusão Auth usa apenas o FK/cascade sintético: fora do piloto funciona;
no piloto ativo é recusado até existir procedimento operacional autorizado.
Convites v3 continuam ausentes nesse perfil antes/depois; nenhum e-mail é enviado.
Ativação concorrente do piloto e novos comandos de identidade não são APIs
certificadas desta etapa: não habilitar um tenant por SQL improvisado. Exigem
revisão da transição e drenagem dos writers antes do próximo lote funcional.
Esta fixture não é um manifesto universal Supabase.
Campos/grants/roles adicionais no destino provocam recusa, sem remoção ou reseal.
Nova qualificação de 15/10, só por SELECT em transação READ ONLY: executor,
privilégios básicos, estado fresh e perfil passaram. O preflight seria aceito
com o acknowledgement explícito; não se executou seu DO nem o instalador hospedado.
A âncora da baseline reproduzida localmente é
`f2c205f6706bb26d45db2ed44a6c3512081b7ee7e177927434c86047a14ed3d6`;
a raiz da revisão 2 é
`4c6b61962c9401cce052bf037544d68997e14c89aa6e23b165546cf93f907a3d`.
Staging permaneceu com três tenants, 13 memberships, dois admins, duas linhas
legadas e zero objetos/roles da raiz nova. Um tenant ativo está sem JSON legado.
Nenhum foi habilitado ou alterado.

Antes de instalar: reconferir perfil fresco, comprovar backup/restore disponível,
autorizar a breve janela de DDL e a execução. Supautils/GRANT SET/transferência
de ownership e criação de triggers só serão certificados no provedor mediante
instalação autorizada. Alterações de perfil exigem revisão explícita das fontes,
reconstrução independente e preservação das referências anteriores.

Rollback antes de commit é integral e testado. Depois do commit não existe down
certificado: recuperação é correção forward revisada ou restauração autorizada,
considerando indisponibilidade e eventuais dados posteriores. Não apagar a raiz.

Próximo lote, somente após autorização: contrato nativo de clientes com UUID,
CPF único por tenant, campos privados e RPCs de criação/consulta/edição. Usar
tenant sintético vazio, bloquear sua escrita legada e certificar o navegador
antes de habilitar Salvar. Não implementar importação/reconciliação nem KMS.
