-- Canonical bounded contract: application baseline, identity boundary and root.
-- No row values, passwords, JWTs or PostgreSQL OIDs enter the fingerprint.
WITH RECURSIVE role_scope(name) AS (
 SELECT pg_catalog.unnest(ARRAY['postgres','anon','authenticated','service_role','authenticator',
 'supabase_admin','supabase_auth_admin','handyhub_managed_reader']::text[])
 UNION
 SELECT r.rolname::pg_catalog.text COLLATE "default" FROM role_scope s
 JOIN pg_catalog.pg_roles a ON a.rolname=s.name
 JOIN pg_catalog.pg_auth_members m ON m.member=a.oid OR m.roleid=a.oid
 JOIN pg_catalog.pg_roles r ON r.oid=m.member OR r.oid=m.roleid
), relations AS (
 SELECT c.*,n.nspname FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','private','handyhub_private')
 AND c.relkind IN ('r','p','v','m','S','f')
), entries(key,value) AS (
 SELECT 'server',pg_catalog.to_jsonb(pg_catalog.current_setting('server_version_num'))
 UNION ALL
 SELECT 'database',pg_catalog.jsonb_build_array(pg_catalog.pg_get_userbyid(d.datdba),
 d.datacl::text,d.encoding,d.datcollate,d.datctype)
 FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()
 UNION ALL
 SELECT 'schema/'||n.nspname,pg_catalog.jsonb_build_array(pg_catalog.pg_get_userbyid(n.nspowner),n.nspacl::text)
 FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('public','private','auth','handyhub_private')
 UNION ALL
 SELECT 'relation/'||r.nspname||'.'||r.relname,pg_catalog.jsonb_build_array(
 r.relkind,r.relpersistence,pg_catalog.pg_get_userbyid(r.relowner),r.relrowsecurity,r.relforcerowsecurity,r.relacl::text,r.reloptions)
 FROM relations r
 UNION ALL
 SELECT 'column/'||r.nspname||'.'||r.relname||'/'||a.attnum,pg_catalog.jsonb_build_array(
 a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
 pg_catalog.pg_get_expr(d.adbin,d.adrelid),a.attacl::text,cn.nspname,c.collname)
 FROM relations r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
 LEFT JOIN pg_catalog.pg_collation c ON c.oid=a.attcollation
 LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=c.collnamespace
 UNION ALL
 SELECT 'constraint/'||r.nspname||'.'||r.relname||'/'||c.conname,pg_catalog.jsonb_build_array(
 pg_catalog.pg_get_constraintdef(c.oid,true),c.convalidated,c.condeferrable,c.condeferred)
 FROM relations r JOIN pg_catalog.pg_constraint c ON c.conrelid=r.oid
 UNION ALL
 SELECT 'index/'||r.nspname||'.'||i.relname,pg_catalog.jsonb_build_array(
 pg_catalog.pg_get_indexdef(x.indexrelid),x.indisvalid,x.indisready,x.indisunique,x.indisprimary)
 FROM relations r JOIN pg_catalog.pg_index x ON x.indrelid=r.oid
 JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid
 UNION ALL
 SELECT 'policy/'||r.nspname||'.'||r.relname||'/'||p.polname,pg_catalog.jsonb_build_array(
 p.polcmd,p.polpermissive,(SELECT pg_catalog.array_agg(CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x) END ORDER BY x::pg_catalog.regrole::text) FROM pg_catalog.unnest(p.polroles) x),
 pg_catalog.pg_get_expr(p.polqual,p.polrelid),pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
 FROM relations r JOIN pg_catalog.pg_policy p ON p.polrelid=r.oid
 UNION ALL
 SELECT 'trigger/'||r.nspname||'.'||r.relname||'/'||t.tgname,pg_catalog.jsonb_build_array(
 pg_catalog.pg_get_triggerdef(t.oid,true),t.tgenabled)
 FROM relations r JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.oid AND NOT t.tgisinternal
 UNION ALL
 SELECT 'sequence/'||r.nspname||'.'||r.relname,pg_catalog.jsonb_build_array(
 pg_catalog.format_type(s.seqtypid,NULL),s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle)
 FROM relations r JOIN pg_catalog.pg_sequence s ON s.seqrelid=r.oid
 UNION ALL
 SELECT 'function/'||n.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
 pg_catalog.jsonb_build_array(pg_catalog.pg_get_userbyid(p.proowner),p.proacl::text,p.prosecdef,p.proconfig,
 pg_catalog.pg_get_function_result(p.oid),l.lanname,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
 CASE WHEN n.nspname='handyhub_private' AND p.proname='assert_integrity' THEN '<root-body-reviewed-in-release>'
 ELSE pg_catalog.pg_get_functiondef(p.oid) END)
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN ('public','private','handyhub_private') OR (n.nspname='auth' AND p.proname='uid')
 UNION ALL
 SELECT 'auth.users',pg_catalog.jsonb_build_array(pg_catalog.pg_get_userbyid(c.relowner),c.relkind,
 c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
 (SELECT pg_catalog.jsonb_object_agg(a.attname,a.attacl::text ORDER BY a.attname)
 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND a.attacl IS NOT NULL))
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='auth' AND c.relname='users'
 UNION ALL
 SELECT 'role/'||r.rolname,pg_catalog.jsonb_build_array(r.rolsuper,r.rolinherit,r.rolcreaterole,
 r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolbypassrls,r.rolconfig,r.rolconnlimit)
 FROM pg_catalog.pg_roles r JOIN role_scope s ON s.name=r.rolname
 UNION ALL
 SELECT 'edge/'||p.rolname||'/'||c.rolname||'/'||g.rolname,pg_catalog.jsonb_build_array(m.admin_option,m.inherit_option,m.set_option)
 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles p ON p.oid=m.roleid
 JOIN pg_catalog.pg_roles c ON c.oid=m.member JOIN pg_catalog.pg_roles g ON g.oid=m.grantor
 WHERE p.rolname IN (SELECT name FROM role_scope) OR c.rolname IN (SELECT name FROM role_scope)
 UNION ALL
 SELECT 'default/'||pg_catalog.pg_get_userbyid(d.defaclrole)||'/'||coalesce(n.nspname,'*')||'/'||d.defaclobjtype::pg_catalog.text,
 pg_catalog.to_jsonb(d.defaclacl::text)
 FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
 WHERE n.nspname IN ('public','private','handyhub_private') OR d.defaclnamespace=0
)
SELECT pg_catalog.jsonb_object_agg(key,value ORDER BY key) AS snapshot FROM entries
