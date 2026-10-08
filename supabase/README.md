# HandyHub — banco e segurança

## Estado real após a Camada 0.5

Projeto `handyhub-db` (`qmfwsnhpmsonndhgqsyi`), PostgreSQL 17.11. As três
migrations versionadas foram aplicadas ao projeto remoto em 8 de outubro de
2026. O relatório completo está em `../docs/camada-0.5-relatorio.md`.

`tenant_memberships` liga `auth.users.id` a `tenants.id`, com papéis `owner`,
`manager` e `employee`; `platform_admins` separa a função da plataforma.
`tenant_data` agora possui `tenant_id` obrigatório, FK e índice único por
tenant/chave. O payload existente foi preservado e o slug segue compatível
com a aplicação atual por meio do trigger `private.sync_tenant_data_identity`.
`companies.tenant_id` é nullable: a linha de teste existente ficou sem
associação, pois não havia relação segura para inferi-la.

RLS está habilitado em `tenant_memberships` e `platform_admins`, sem FORCE.
Isso permite que os helpers `SECURITY DEFINER`, pertencentes ao papel confiável
que aplica migrations, consultem as tabelas sem recursão; `anon` e
`authenticated` continuam sujeitos às policies e grants. O papel
`supabase_admin` mantém defaults amplos porque a conexão disponível não tem
permissão para alterá-los. Os defaults do papel `postgres` foram endurecidos.

As policies de `tenants`, `tenant_data` e `companies` estão criadas, mas RLS
continua **desabilitado** nelas até o cutover da Camada 1. Os grants atuais
dessas tabelas também continuam amplos para `anon` e `authenticated`.
Portanto, o banco de produção ainda permite acesso entre empresas; a existência
das policies dormantes e da FK não fecha esse acesso.

O estado anterior foi guardado em `baseline/public-before-0.5.sql`, com dados
sintéticos para testes locais. Use esse arquivo somente no PGlite de teste;
nunca o aplique ao projeto remoto. A ativação é outra operação, documentada em
`../docs/camada-1-cutover.md` e guardada por confirmação em
`activation/camada-1-cutover.sql`. Ela não foi executada.

## Verificação

`node --test tests/security-foundation.test.mjs` usa PGlite local para aplicar
a baseline, as três migrations e simular o cutover com duas empresas e usuários
fictícios. O teste verifica RLS, isolamento, cargos, associação de membership,
compatibilidade do slug e acesso privilegiado do servidor. Ele não testa
usuários nem linhas empresariais reais na produção.
