# HandyHub — pré-requisitos de cutover da Camada 1

O código da branch `codex/camada-1-auth` usa Supabase Auth, sessão SSR,
memberships e Master autorizado no servidor. O cutover foi aplicado e testado
somente em `handyhub-staging` em 08/10/2026; veja
[o relatório do staging](camada-1b-cutover-staging.md).
Production continua com o código e o banco anteriores. Este arquivo descreve
pré-requisitos futuros; não constitui autorização para alterar Production.

## Sequência segura

1. Criar um projeto Supabase de staging por processo aprovado pelo responsável
   e apontar Preview/Development a esse projeto. Não reutilizar `handyhub-db`
   nesses ambientes. Não iniciar Preview se a URL/configuração separada faltar.
2. Configurar `NEXT_PUBLIC_APP_ENV` e as credenciais públicas corretas em cada
   ambiente. A validação local já rejeita o host Production em local/Preview e
   exige o host auditado em Production. Preview recebeu configuração própria
   de staging na preparação anterior. Production não foi alterada e ainda
   precisa de configuração explícita para receber a nova versão.
3. Implementar login, convite e recuperação via Supabase Auth no servidor e
   validar que a sessão do app corresponda ao JWT enviado ao banco. Migrar o
   login próprio sem copiar senha ou hash para metadata Auth.
4. Para cada tenant, validar o proprietário responsável e provisionar um
   usuário Auth confirmado. Criar membership por `user_id` e `tenant_id`
   através de operação confiável do servidor. Nunca aceitar role/tenant
   arbitrários do navegador.
5. Provisionar `platform_admins` somente pelo fluxo operacional privilegiado
   do servidor. Não reutilizar `localStorage`, parâmetro de URL, `SUPER_ADMIN`
   enviado pelo cliente ou a credencial literal de `/master`.
6. Adaptar o cliente para consultar pelo `tenant_id` da membership. Como
   `all_data` reúne cadastros, operações e configurações num JSON só, validar
   a matriz de cargos em operações do servidor antes de permitir escrita por
   funcionários ou segmentar essas estruturas em etapa própria.
7. Testar localmente contra staging fechado ou em Preview isolado: anon sem
   leitura/escrita; usuário A só lê/edita A; usuário B só lê/edita B;
   funcionário sem operações administrativas; platform admin somente pelo
   caminho privilegiado aprovado. Incluir mapeamento explícito das rows de
   `companies` que serão usadas; `tenant_id` delas é nullable e rows sem mapa
   serão negadas pelo RLS.
8. Verificar backup/restauração, Auth confirmado, associação ativa de Dono
   para cada tenant, payloads preservados e destinos dos três ambientes. Fazer
   revisão humana da lista de memberships sem expor credenciais.
9. Validar transporte real de convite e recuperação, templates e callbacks
   nos domínios aprovados. Sem SMTP, tokens reais validam o mecanismo no staging,
   mas a entrega permanece obrigatória antes de Production.
10. Somente no projeto Production aprovado, após a nova versão depender de
   Auth, executar manualmente `activation/camada-1-cutover.sql`. A sessão
   precisa definir `handyhub.cutover_ready = 'yes'`. O script aborta se não
   houver platform admin confirmado ou se algum tenant não tiver Dono Auth
   ativo. Ele habilita RLS, revoga acesso anon e aplica grants restritos.
   FORCE foi avaliado separadamente: as roles API não são owners nem têm
   BYPASSRLS, e FORCE não restringe roles que já possuem BYPASSRLS. Não foi
   habilitado no staging; não substitui a proteção das chaves privilegiadas.
11. Validar no projeto alvo as permissões anon/authenticated e o isolamento
    A/B; então executar smoke tests autenticados, observar logs e confirmar
    que os fluxos de gestão operam sob os grants escolhidos.

Se qualquer pré-condição falhar, não executar o cutover. Uma volta atrás
exigiria um procedimento de recuperação revisado com backup; não é um passo
automático nem parte das migrations aditivas da Camada 0.5.

## Decisões de autorização

| Papel | Acesso preparado após ativação |
|---|---|
| `owner` (Dono) | Lê tenant/memberships próprios e lê/escreve os dados JSON e empresas do próprio tenant; atualiza campos de perfil limitados |
| `manager` (Gestor) | Lê o próprio tenant e lê/escreve dados operacionais e empresas do tenant |
| `employee` (Funcionário/Colaborador) | Leitura do próprio tenant, memberships próprias e dados operacionais; escrita no JSON único negada |
| `platform_admin` | Acesso à plataforma através de identidade Auth separada; sem tabela/credencial controlável diretamente no navegador |
| `anon` | Sem grants de tabela nas três tabelas públicas após cutover |

Memberships e administradores de plataforma são criados pelo servidor. A
policy de INSERT de tenant permite somente platform admin; nenhum tenant user
pode criar ou promover sua própria membership via PostgREST.
