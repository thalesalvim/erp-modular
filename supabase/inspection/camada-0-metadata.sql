-- INFORMAÇÕES NECESSÁRIAS DO SUPABASE — HandyHub, Camada 0
-- Execute UMA consulta numerada por vez no SQL Editor do projeto correto.
-- Apenas SELECT / WITH ... SELECT; nenhuma função de aplicação é executada.
-- Não há leitura de linhas de tenants, tenant_data ou auth.users.
-- A consulta 18 é opcional e lê somente metadados de buckets existentes.
-- Compartilhe os resultados por número, com project ref e ambiente (sem chaves).
-- Se o editor truncar resultados, exporte todos os metadados e informe a truncagem.
-- Revise defaults/expressões/definições e omita possíveis segredos antes de compartilhar.

-- 01. Contexto da coleta; current_user é a role do SQL Editor, NÃO a do navegador.
SELECT current_database() AS database_name, current_user AS inspection_role,
       current_timestamp AS inspected_at,
       current_setting('server_version') AS postgres_version;

-- 02. Schemas existentes (nomes e proprietários; sem configurações secretas).
SELECT n.nspname AS schema_name, pg_get_userbyid(n.nspowner) AS owner
FROM pg_catalog.pg_namespace n
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
ORDER BY 1;

-- 03. Inventário de tabelas e views, incluindo RLS e FORCE RLS.
SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY 1, 2;

-- 04. Estrutura completa das duas tabelas, se existirem em qualquer schema.
SELECT n.nspname AS schema_name, c.relname AS table_name, a.attnum AS ordinal_position,
       a.attname AS column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable, a.attidentity AS identity_kind,
       a.attgenerated AS generated_kind,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_or_generation_expression
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE c.relname IN ('tenants', 'tenant_data') AND c.relkind IN ('r', 'p')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY 1, 2, 3;

-- 05. Campos de associação à identidade/empresa em todas as tabelas de aplicação.
-- Inclui candidatos comuns adicionais; existência de coluna NÃO prova associação correta.
SELECT table_schema, table_name, column_name, data_type, udt_schema, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema NOT LIKE 'pg_%' AND table_schema <> 'information_schema'
  AND column_name ~* '(user_id|auth_user_id|tenant_id|tenant_slug|owner_id|company_id|organization_id|member_id)'
ORDER BY 1, 2, ordinal_position;

-- 06. PK/FK/UNIQUE/CHECK e outras constraints, inclusive dependências de auth.users.
SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname,
       con.contype, con.convalidated, con.condeferrable, con.condeferred,
       rn.nspname AS referenced_schema, rc.relname AS referenced_table,
       pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_class rc ON rc.oid = con.confrelid
LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
ORDER BY 1, 2, con.conname;

-- 07. Índices (inclui UNIQUE, validade, predicados e expressões).
SELECT n.nspname AS schema_name, c.relname AS table_name, ic.relname AS index_name,
       i.indisprimary, i.indisunique, i.indisvalid, i.indisready,
       pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
ORDER BY 1, 2, 3;

-- 08. Policies completas, inclusive Storage e policies permissivas/restritivas.
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
       qual AS using_expression, with_check AS with_check_expression
FROM pg_catalog.pg_policies
WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema'
ORDER BY schemaname, tablename, policyname;

-- 09. Roles e caminhos de herança. Não lê pg_authid/senhas.
SELECT r.rolname, r.rolsuper, r.rolinherit, r.rolbypassrls, r.rolcanlogin,
       parent.rolname AS member_of, m.admin_option
FROM pg_catalog.pg_roles r
LEFT JOIN pg_catalog.pg_auth_members m ON m.member = r.oid
LEFT JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid
WHERE r.rolname IN ('anon', 'authenticated', 'authenticator', 'service_role')
   OR pg_catalog.pg_has_role('anon', r.oid, 'MEMBER')
   OR pg_catalog.pg_has_role('authenticated', r.oid, 'MEMBER')
ORDER BY 1, member_of;

-- 10. Permissões efetivas por tabela/view (inclui PUBLIC/herança).
-- Um true é privilégio de objeto; NÃO demonstra que RLS permite uma linha.
SELECT r.rolname AS api_role, n.nspname AS schema_name, c.relname AS relation_name,
       c.relkind, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls,
       pg_catalog.pg_has_role(r.oid, c.relowner, 'USAGE') AS inherits_owner_privileges,
       pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE') AS schema_usage,
       pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT') AS can_select,
       pg_catalog.has_table_privilege(r.oid, c.oid, 'INSERT') AS can_insert,
       pg_catalog.has_table_privilege(r.oid, c.oid, 'UPDATE') AS can_update,
       pg_catalog.has_table_privilege(r.oid, c.oid, 'DELETE') AS can_delete,
       pg_catalog.has_table_privilege(r.oid, c.oid, 'TRUNCATE') AS can_truncate,
       pg_catalog.has_table_privilege(r.oid, c.oid, 'REFERENCES') AS can_reference,
       pg_catalog.has_table_privilege(r.oid, c.oid, 'TRIGGER') AS can_trigger
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_catalog.pg_roles r
WHERE r.rolname IN ('anon', 'authenticated')
  AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY 2, 3, 1;

-- 11. ACLs de tabela/view: concessões diretas a TODAS as roles, incluindo PUBLIC.
SELECT n.nspname AS schema_name, c.relname AS relation_name,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       pg_get_userbyid(acl.grantor) AS grantor, acl.privilege_type, acl.is_grantable
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
) acl
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY 1, 2, 3, 5;

-- 12. Permissões efetivas por coluna, inclusive grants somente por coluna.
SELECT r.rolname AS api_role, n.nspname AS schema_name, c.relname AS table_name,
       a.attname AS column_name,
       pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'SELECT') AS can_select,
       pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'INSERT') AS can_insert,
       pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'UPDATE') AS can_update,
       pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'REFERENCES') AS can_reference
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_catalog.pg_roles r
WHERE r.rolname IN ('anon', 'authenticated') AND a.attnum > 0 AND NOT a.attisdropped
  AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY 2, 3, a.attnum, 1;

-- 13. Functions/RPCs: assinatura, SECURITY DEFINER, owner, search_path e EXECUTE.
-- Não retorna corpo, argumento default ou configurações potencialmente secretas.
SELECT n.nspname AS schema_name, p.proname AS function_name, p.oid AS function_oid,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_catalog.pg_get_function_result(p.oid) AS return_type,
       p.prokind, p.prosecdef AS security_definer, p.provolatile, p.proleakproof,
       pg_get_userbyid(p.proowner) AS owner,
       ARRAY(SELECT setting FROM unnest(p.proconfig) AS setting
             WHERE setting LIKE 'search_path=%') AS search_path_settings,
       pg_catalog.has_schema_privilege('anon', n.oid, 'USAGE') AS anon_schema_usage,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       pg_catalog.has_schema_privilege('authenticated', n.oid, 'USAGE') AS authenticated_schema_usage,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
  AND p.prokind IN ('f', 'p')
ORDER BY 1, 2, identity_arguments;

-- 14. Triggers sem executar suas funções; inclui auth.users e tabelas de associação.
SELECT n.nspname AS schema_name, c.relname AS table_name, t.tgname AS trigger_name,
       t.tgenabled, t.tgisinternal,
       fn.nspname AS function_schema, p.proname AS function_name, p.oid AS function_oid,
       p.prosecdef AS security_definer,
       pg_catalog.pg_get_triggerdef(t.oid, true) AS definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
JOIN pg_catalog.pg_namespace fn ON fn.oid = p.pronamespace
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
ORDER BY 1, 2, 3;

-- 15. Views: owner, opções security_invoker/security_barrier e definição.
SELECT n.nspname AS schema_name, c.relname AS view_name, c.relkind,
       pg_get_userbyid(c.relowner) AS owner, c.reloptions,
       pg_catalog.pg_get_viewdef(c.oid, true) AS definition
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
  AND c.relkind IN ('v', 'm')
ORDER BY 1, 2;

-- 16. Default privileges: não substituem os grants efetivos de objetos já existentes.
SELECT pg_get_userbyid(d.defaclrole) AS owner, n.nspname AS schema_name, d.defaclobjtype,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type, acl.is_grantable
FROM pg_catalog.pg_default_acl d
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) acl
ORDER BY 1, 2, 3, 4, 5;

-- 17. Sequences: inventário e privilégios; não usa nextval nem lê valores.
SELECT n.nspname AS schema_name, c.relname AS sequence_name, r.rolname AS api_role,
       pg_catalog.has_sequence_privilege(r.oid, c.oid, 'USAGE') AS can_use,
       pg_catalog.has_sequence_privilege(r.oid, c.oid, 'SELECT') AS can_select,
       pg_catalog.has_sequence_privilege(r.oid, c.oid, 'UPDATE') AS can_update
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_catalog.pg_roles r
WHERE c.relkind = 'S' AND r.rolname IN ('anon', 'authenticated')
  AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
ORDER BY 1, 2, 3;

-- 18. OPCIONAL: metadados de Storage; execute somente se 03 confirmar storage.buckets.
-- Não lê storage.objects, arquivos ou owner_id de usuários.
-- to_jsonb tolera diferenças de colunas entre versões do Storage.
SELECT to_jsonb(b)->>'id' AS bucket_id, to_jsonb(b)->>'name' AS bucket_name,
       to_jsonb(b)->>'public' AS public,
       to_jsonb(b)->>'file_size_limit' AS file_size_limit,
       to_jsonb(b)->'allowed_mime_types' AS allowed_mime_types
FROM storage.buckets b
ORDER BY bucket_id;

-- 19. Configuração SQL do PostgREST: apenas schemas expostos e nomes de hooks.
-- GoTrue/Auth e configurações Vercel não são comprovados por este resultado.
-- Nunca retorna jwt_secret, passwords ou configurações de provedores.
SELECT COALESCE(d.datname, 'ALL DATABASES') AS database_name,
       CASE WHEN s.setrole = 0 THEN 'ALL ROLES' ELSE pg_get_userbyid(s.setrole) END AS role_name,
       setting AS safe_setting
FROM pg_catalog.pg_db_role_setting s
LEFT JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
CROSS JOIN LATERAL unnest(s.setconfig) AS setting
WHERE split_part(setting, '=', 1) IN ('pgrst.db_schemas', 'pgrst.db_extra_search_path', 'pgrst.db_pre_request')
ORDER BY 1, 2, 3;

-- 20. Dependências catalogadas de policies sobre funções e outras relações.
-- Dependências dentro de SQL dinâmico/funções PLpgSQL podem não aparecer aqui.
SELECT n.nspname AS schema_name, c.relname AS table_name, pol.polname AS policy_name,
       d.refclassid::regclass::text AS dependency_catalog,
       fn.nspname AS function_schema, p.proname AS function_name, p.oid AS function_oid,
       rn.nspname AS referenced_schema, rc.relname AS referenced_relation
FROM pg_catalog.pg_policy pol
JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_policy'::regclass AND d.objid = pol.oid
LEFT JOIN pg_catalog.pg_proc p ON d.refclassid = 'pg_catalog.pg_proc'::regclass AND p.oid = d.refobjid
LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid = p.pronamespace
LEFT JOIN pg_catalog.pg_class rc ON d.refclassid = 'pg_catalog.pg_class'::regclass AND rc.oid = d.refobjid
LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
ORDER BY 1, 2, 3;

-- 21. Privilégios efetivos de schema, inclusive capacidade de criar objetos.
SELECT r.rolname AS api_role, n.nspname AS schema_name,
       pg_get_userbyid(n.nspowner) AS owner,
       pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE') AS can_use_schema,
       pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE') AS can_create_objects
FROM pg_catalog.pg_namespace n
CROSS JOIN pg_catalog.pg_roles r
WHERE r.rolname IN ('anon', 'authenticated')
  AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
ORDER BY 2, 1;
