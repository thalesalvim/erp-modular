-- Managed customer pilot, additive LOCAL release. Never run against hosted DBs automatically.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_catalog.pg_advisory_xact_lock(731904610140001);
DO $preflight$ BEGIN
 IF current_user<>'postgres' OR pg_catalog.current_setting('handyhub.managed_install',true) IS DISTINCT FROM 'pilot-v6-2'
 THEN RAISE EXCEPTION 'CUSTOMER_INSTALL_REFUSED' USING ERRCODE='55000'; END IF;
 IF pg_catalog.to_regclass('handyhub_private.customer_release') IS NOT NULL
 THEN RAISE EXCEPTION 'CUSTOMER_ALREADY_INSTALLED' USING ERRCODE='55000';END IF;
 PERFORM handyhub_private.assert_integrity();
 IF NOT EXISTS(SELECT 1 FROM handyhub_private.release WHERE release_id='managed-customer-foundation-v6-1' AND root_sha256='4c6b61962c9401cce052bf037544d68997e14c89aa6e23b165546cf93f907a3d')
 OR EXISTS(SELECT 1 FROM handyhub_private.pilot_tenants WHERE enabled)
 OR NOT EXISTS(SELECT 1 FROM handyhub_private.runtime WHERE singleton AND maintenance)
 THEN RAISE EXCEPTION 'CUSTOMER_INSTALL_REFUSED' USING ERRCODE='55000'; END IF;
END $preflight$;
LOCK TABLE public.tenants,public.tenant_memberships,public.tenant_data IN SHARE ROW EXCLUSIVE MODE;
SELECT handyhub_private.assert_integrity();

CREATE ROLE handyhub_customer_writer NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT handyhub_customer_writer TO postgres WITH INHERIT FALSE, SET TRUE;
GRANT USAGE ON SCHEMA public,handyhub_private TO handyhub_customer_writer;
GRANT EXECUTE ON FUNCTION handyhub_private.actor(),handyhub_private.owner_active(uuid) TO handyhub_customer_writer;

CREATE TABLE public.erp_customers(
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 PRIMARY KEY(tenant_id,id));
CREATE TABLE handyhub_private.customer_identity(
 tenant_id uuid NOT NULL,customer_id uuid NOT NULL,cpf text NOT NULL,birth_date date NOT NULL,phone text NOT NULL,
 PRIMARY KEY(tenant_id,customer_id),UNIQUE(tenant_id,cpf),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES public.erp_customers(tenant_id,id));
CREATE TABLE handyhub_private.customer_receipts(
 tenant_id uuid NOT NULL,actor uuid NOT NULL,operation_id uuid NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,
 PRIMARY KEY(tenant_id,actor,operation_id));
CREATE TABLE handyhub_private.customer_audit(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),tenant_id uuid NOT NULL,customer_id uuid NOT NULL,
 actor uuid NOT NULL,action text NOT NULL,previous_version bigint,next_version bigint NOT NULL,
 reviewed boolean NOT NULL DEFAULT false,recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp());
CREATE TABLE handyhub_private.customer_review_reasons(
 audit_id uuid PRIMARY KEY REFERENCES handyhub_private.customer_audit(id),tenant_id uuid NOT NULL,reason text NOT NULL);
CREATE TABLE handyhub_private.customer_release(
 singleton boolean PRIMARY KEY CHECK(singleton),prior_root text NOT NULL,root_sha256 text NOT NULL);

DO $tables$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['public.erp_customers','handyhub_private.customer_identity','handyhub_private.customer_receipts','handyhub_private.customer_audit','handyhub_private.customer_review_reasons','handyhub_private.customer_release'] LOOP
  EXECUTE 'ALTER TABLE '||n||' ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE '||n||' FORCE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON '||n||' FROM PUBLIC,anon,authenticated,service_role,handyhub_customer_writer';
  IF n<>'handyhub_private.customer_release' THEN
   EXECUTE 'CREATE POLICY customer_owner ON '||n||' TO handyhub_customer_writer USING(handyhub_private.owner_active(tenant_id)) WITH CHECK(handyhub_private.owner_active(tenant_id))';
  END IF;
 END LOOP;
END $tables$;
GRANT SELECT,INSERT,UPDATE ON public.erp_customers,handyhub_private.customer_identity TO handyhub_customer_writer;
GRANT SELECT,INSERT ON handyhub_private.customer_receipts,handyhub_private.customer_audit,handyhub_private.customer_review_reasons TO handyhub_customer_writer;
CREATE TRIGGER customer_audit_immutable BEFORE UPDATE OR DELETE ON handyhub_private.customer_audit FOR EACH ROW EXECUTE FUNCTION handyhub_private.immutable_release();
CREATE TRIGGER customer_audit_no_truncate BEFORE TRUNCATE ON handyhub_private.customer_audit FOR EACH STATEMENT EXECUTE FUNCTION handyhub_private.immutable_release();
CREATE TRIGGER customer_receipt_immutable BEFORE UPDATE OR DELETE ON handyhub_private.customer_receipts FOR EACH ROW EXECUTE FUNCTION handyhub_private.immutable_release();
CREATE TRIGGER customer_receipt_no_truncate BEFORE TRUNCATE ON handyhub_private.customer_receipts FOR EACH STATEMENT EXECUTE FUNCTION handyhub_private.immutable_release();
CREATE TRIGGER customer_release_immutable BEFORE UPDATE OR DELETE ON handyhub_private.customer_release FOR EACH ROW EXECUTE FUNCTION handyhub_private.immutable_release();
CREATE TRIGGER customer_release_no_truncate BEFORE TRUNCATE ON handyhub_private.customer_release FOR EACH STATEMENT EXECUTE FUNCTION handyhub_private.immutable_release();

-- Lock and revalidate inside every command; a prior boolean probe is never sufficient.
CREATE FUNCTION handyhub_private.customer_context(t uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $context$
BEGIN
 IF handyhub_private.actor() IS NULL OR NOT handyhub_private.owner_active(t) THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM handyhub_private.runtime WHERE singleton FOR SHARE;
 PERFORM 1 FROM public.tenants WHERE id=t FOR NO KEY UPDATE;
 PERFORM 1 FROM handyhub_private.pilot_tenants WHERE tenant_id=t FOR SHARE;
 PERFORM 1 FROM public.tenant_memberships WHERE tenant_id=t AND user_id=handyhub_private.actor() FOR SHARE;
 PERFORM handyhub_private.assert_integrity();
 IF NOT handyhub_private.owner_active(t)
 OR NOT EXISTS(SELECT 1 FROM handyhub_private.runtime WHERE singleton AND NOT maintenance)
 OR NOT EXISTS(SELECT 1 FROM handyhub_private.pilot_tenants WHERE tenant_id=t AND enabled)
 OR pg_catalog.current_setting('session_replication_role')<>'origin'
 THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
END $context$;
REVOKE ALL ON FUNCTION handyhub_private.customer_context(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION handyhub_private.customer_context(uuid) TO handyhub_customer_writer;

-- Derived from C1 validation: two CPF check digits, canonical fields, server calendar.
CREATE FUNCTION handyhub_private.customer_validate(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $validate$
DECLARE c text;n text;ph text;d date;s int;v int;i int;k int; BEGIN
 IF p IS NULL OR pg_catalog.jsonb_typeof(p)<>'object'
 OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p))<>4
 OR NOT(p ?& ARRAY['fullName','cpf','birthDate','phone'])
 OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p) x WHERE pg_catalog.jsonb_typeof(x.value)<>'string')
 THEN RAISE EXCEPTION 'INVALID_CUSTOMER_FIELDS' USING ERRCODE='22023'; END IF;
 n:=pg_catalog.regexp_replace(pg_catalog.btrim(p->>'fullName'),'\s+',' ','g');
 c:=pg_catalog.regexp_replace(p->>'cpf','[^0-9]','','g');
 ph:=pg_catalog.regexp_replace(p->>'phone','[^0-9]','','g');
 IF ph~'^55[0-9]{10,11}$' THEN ph:=pg_catalog.substr(ph,3); END IF;
 IF (p->>'cpf')!~'^([0-9]{11}|[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2})$' OR c~'^([0-9])\1{10}$'
 OR pg_catalog.length(n)>200 OR n!~'^[[:alpha:]][[:alpha:] ''’-]+ [[:alpha:]][[:alpha:] ''’-]+$'
 OR (p->>'phone')!~'^[0-9 ()+.-]+$' OR ph!~'^[1-9][0-9](9[0-9]{8}|[2-5][0-9]{7})$'
 OR ph~'^([0-9])\1+$' OR (p->>'birthDate')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 THEN RAISE EXCEPTION 'INVALID_CUSTOMER_FIELDS' USING ERRCODE='22023'; END IF;
 FOR k IN 9..10 LOOP
  s:=0;FOR i IN 1..k LOOP s:=s+pg_catalog.substr(c,i,1)::int*(k+2-i);END LOOP;
  v:=(s*10)%11;IF v=10 THEN v:=0;END IF;
  IF v<>pg_catalog.substr(c,k+1,1)::int THEN RAISE EXCEPTION 'INVALID_CUSTOMER_FIELDS' USING ERRCODE='22023';END IF;
 END LOOP;
 BEGIN d:=(p->>'birthDate')::date;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_CUSTOMER_FIELDS' USING ERRCODE='22023';END;
 IF d>CURRENT_DATE OR pg_catalog.date_part('year',d)<1 THEN RAISE EXCEPTION 'INVALID_CUSTOMER_FIELDS' USING ERRCODE='22023';END IF;
 RETURN pg_catalog.jsonb_build_object('fullName',n,'cpf',c,'birthDate',d::text,'phone','+55'||ph);
END $validate$;
REVOKE ALL ON FUNCTION handyhub_private.customer_validate(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION handyhub_private.customer_validate(jsonb) TO handyhub_customer_writer;

CREATE FUNCTION handyhub_private.customer_similar(a text,b text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $similar$
DECLARE x text;y text;prev int[];next_row int[];i int;j int;sa text;sb text;BEGIN
 x:=pg_catalog.lower(pg_catalog.translate(a,'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
 y:=pg_catalog.lower(pg_catalog.translate(b,'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
 x:=pg_catalog.btrim(pg_catalog.regexp_replace(x,'[^[:alpha:] ]',' ','g'));y:=pg_catalog.btrim(pg_catalog.regexp_replace(y,'[^[:alpha:] ]',' ','g'));
 x:=pg_catalog.regexp_replace(x,'\s+',' ','g');y:=pg_catalog.regexp_replace(y,'\s+',' ','g');
 SELECT pg_catalog.string_agg(w,' ' ORDER BY w) INTO sa FROM pg_catalog.regexp_split_to_table(x,' ') w;
 SELECT pg_catalog.string_agg(w,' ' ORDER BY w) INTO sb FROM pg_catalog.regexp_split_to_table(y,' ') w;
 IF x=y OR sa=sb THEN RETURN true;END IF;
 IF LEAST(pg_catalog.length(x),pg_catalog.length(y))<8 OR pg_catalog.abs(pg_catalog.length(x)-pg_catalog.length(y))>2 THEN RETURN false;END IF;
 SELECT pg_catalog.array_agg(n ORDER BY n) INTO prev FROM pg_catalog.generate_series(0,pg_catalog.length(y)) n;
 FOR i IN 1..pg_catalog.length(x) LOOP next_row:=ARRAY[i];FOR j IN 1..pg_catalog.length(y) LOOP
 next_row:=next_row||LEAST(next_row[j]+1,prev[j+1]+1,prev[j]+CASE WHEN pg_catalog.substr(x,i,1)=pg_catalog.substr(y,j,1) THEN 0 ELSE 1 END);
 END LOOP;prev:=next_row;END LOOP;RETURN prev[pg_catalog.length(y)+1]<=2;
END $similar$;
REVOKE ALL ON FUNCTION handyhub_private.customer_similar(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION handyhub_private.customer_similar(text,text) TO handyhub_customer_writer;

CREATE FUNCTION public.hh_customer_read(p_tenant uuid,p_customer uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $read$
DECLARE result jsonb;BEGIN
 PERFORM handyhub_private.customer_context(p_tenant);
 IF p_customer IS NULL THEN
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',x.id,'version',x.version,'fullName',x.name) ORDER BY x.created_at,x.id),'[]'::jsonb) INTO result
  FROM (SELECT * FROM public.erp_customers WHERE tenant_id=p_tenant ORDER BY created_at,id LIMIT 100) x;
  RETURN pg_catalog.jsonb_build_object('items',result);
 END IF;
 SELECT pg_catalog.jsonb_build_object('id',c.id,'version',c.version,'draft',pg_catalog.jsonb_build_object('fullName',c.name,'cpf',i.cpf,'birthDate',i.birth_date::text,'phone',i.phone)) INTO result
 FROM public.erp_customers c JOIN handyhub_private.customer_identity i ON (i.tenant_id,i.customer_id)=(c.tenant_id,c.id)
 WHERE c.tenant_id=p_tenant AND c.id=p_customer;
 IF result IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501';END IF;
 RETURN result;
END $read$;

CREATE FUNCTION public.hh_customer_write(p_tenant uuid,p_operation uuid,p_data jsonb,p_customer uuid DEFAULT NULL,p_expected bigint DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $write$
DECLARE n jsonb;sig text;old_receipt handyhub_private.customer_receipts;next_id uuid;previous bigint;next_v bigint;event uuid;result jsonb;warning boolean;BEGIN
 PERFORM handyhub_private.customer_context(p_tenant);
 IF p_operation IS NULL OR (p_customer IS NULL AND p_expected IS NOT NULL) OR (p_customer IS NOT NULL AND (p_expected IS NULL OR p_expected<1)) THEN RAISE EXCEPTION 'INVALID_CUSTOMER_FIELDS' USING ERRCODE='22023';END IF;
 n:=handyhub_private.customer_validate(p_data);
 sig:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((n||pg_catalog.jsonb_build_object('id',p_customer,'version',p_expected,'reason',p_reason))::text,'UTF8')),'hex');
 SELECT * INTO old_receipt FROM handyhub_private.customer_receipts WHERE tenant_id=p_tenant AND actor=handyhub_private.actor() AND operation_id=p_operation;
 IF FOUND THEN
  IF old_receipt.fingerprint<>sig THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='40001';END IF;
  RETURN old_receipt.result;
 END IF;
 IF p_customer IS NOT NULL THEN
  SELECT version INTO previous FROM public.erp_customers WHERE tenant_id=p_tenant AND id=p_customer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501';END IF;
  IF previous<>p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM handyhub_private.customer_identity WHERE tenant_id=p_tenant AND customer_id IS DISTINCT FROM p_customer AND cpf=n->>'cpf') THEN RAISE EXCEPTION 'CUSTOMER_CPF_CONFLICT' USING ERRCODE='23505';END IF;
 SELECT EXISTS(SELECT 1 FROM public.erp_customers c JOIN handyhub_private.customer_identity i ON (i.tenant_id,i.customer_id)=(c.tenant_id,c.id)
  WHERE c.tenant_id=p_tenant AND c.id IS DISTINCT FROM p_customer AND
  (handyhub_private.customer_similar(c.name,n->>'fullName') OR i.phone=n->>'phone')) INTO warning;
 IF warning AND (p_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(p_reason))<10) THEN RAISE EXCEPTION 'CUSTOMER_REVIEW_REQUIRED' USING ERRCODE='40001';END IF;
 IF p_reason IS NOT NULL AND (pg_catalog.length(p_reason)>1000 OR p_reason~'[0-9]{3}') THEN RAISE EXCEPTION 'INVALID_JUSTIFICATION' USING ERRCODE='22023';END IF;
 next_id:=COALESCE(p_customer,pg_catalog.gen_random_uuid());next_v:=COALESCE(previous,0)+1;
 IF p_customer IS NULL THEN INSERT INTO public.erp_customers(tenant_id,id,name) VALUES(p_tenant,next_id,n->>'fullName');
 ELSE UPDATE public.erp_customers SET name=n->>'fullName',version=next_v WHERE tenant_id=p_tenant AND id=next_id;END IF;
 INSERT INTO handyhub_private.customer_identity VALUES(p_tenant,next_id,n->>'cpf',(n->>'birthDate')::date,n->>'phone')
 ON CONFLICT(tenant_id,customer_id) DO UPDATE SET cpf=EXCLUDED.cpf,birth_date=EXCLUDED.birth_date,phone=EXCLUDED.phone;
 INSERT INTO handyhub_private.customer_audit(tenant_id,customer_id,actor,action,previous_version,next_version,reviewed)
 VALUES(p_tenant,next_id,handyhub_private.actor(),CASE WHEN p_customer IS NULL THEN 'create' ELSE 'update' END,previous,next_v,warning) RETURNING id INTO event;
 IF warning THEN INSERT INTO handyhub_private.customer_review_reasons VALUES(event,p_tenant,pg_catalog.btrim(p_reason));END IF;
 result:=pg_catalog.jsonb_build_object('id',next_id,'version',next_v,'auditId',event);
 INSERT INTO handyhub_private.customer_receipts VALUES(p_tenant,handyhub_private.actor(),p_operation,sig,result);
 RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'CUSTOMER_CPF_CONFLICT' USING ERRCODE='23505';
END $write$;
REVOKE ALL ON FUNCTION public.hh_customer_read(uuid,uuid),public.hh_customer_write(uuid,uuid,jsonb,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hh_customer_read(uuid,uuid),public.hh_customer_write(uuid,uuid,jsonb,uuid,bigint,text) TO authenticated;
GRANT CREATE ON SCHEMA public TO handyhub_customer_writer;
ALTER FUNCTION public.hh_customer_read(uuid,uuid) OWNER TO handyhub_customer_writer;
ALTER FUNCTION public.hh_customer_write(uuid,uuid,jsonb,uuid,bigint,text) OWNER TO handyhub_customer_writer;
REVOKE CREATE ON SCHEMA public FROM handyhub_customer_writer;

-- Pilot customers have ONE writer. Other aggregate domains/tenants are preserved.
CREATE FUNCTION handyhub_private.guard_customer_legacy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $legacy$
DECLARE t uuid;before_value jsonb;after_value jsonb;BEGIN
 IF TG_OP='TRUNCATE' THEN
  IF EXISTS(SELECT 1 FROM handyhub_private.pilot_tenants WHERE enabled) THEN RAISE EXCEPTION 'CUSTOMER_LEGACY_WRITE_BLOCKED' USING ERRCODE='42501';END IF;RETURN NULL;
 END IF;
 IF TG_OP='DELETE' THEN t:=OLD.tenant_id;ELSE t:=NEW.tenant_id;END IF;
 IF EXISTS(SELECT 1 FROM handyhub_private.pilot_tenants WHERE tenant_id=t AND enabled) THEN
  IF TG_OP<>'INSERT' AND OLD.data_key='all_data' THEN before_value:=OLD.payload->'customers';END IF;
  IF TG_OP<>'DELETE' AND NEW.data_key='all_data' THEN after_value:=NEW.payload->'customers';END IF;
  IF before_value IS DISTINCT FROM after_value THEN RAISE EXCEPTION 'CUSTOMER_LEGACY_WRITE_BLOCKED' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $legacy$;
REVOKE ALL ON FUNCTION handyhub_private.guard_customer_legacy() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER customer_legacy_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_data FOR EACH ROW EXECUTE FUNCTION handyhub_private.guard_customer_legacy();
CREATE TRIGGER customer_legacy_truncate BEFORE TRUNCATE ON public.tenant_data FOR EACH STATEMENT EXECUTE FUNCTION handyhub_private.guard_customer_legacy();

-- Preserve v6/1 reference; the active verifier now requires the independently reviewed v6/2 root.
CREATE OR REPLACE FUNCTION handyhub_private.assert_integrity() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $assert$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM handyhub_private.release WHERE singleton AND release_id='managed-customer-foundation-v6-1' AND baseline_sha256='f2c205f6706bb26d45db2ed44a6c3512081b7ee7e177927434c86047a14ed3d6' AND root_sha256='4c6b61962c9401cce052bf037544d68997e14c89aa6e23b165546cf93f907a3d')
 OR NOT EXISTS(SELECT 1 FROM handyhub_private.customer_release WHERE singleton AND prior_root='4c6b61962c9401cce052bf037544d68997e14c89aa6e23b165546cf93f907a3d' AND root_sha256='{{CUSTOMER_ROOT_SHA256}}')
 OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(handyhub_private.snapshot()::text,'UTF8')),'hex')<>'{{CUSTOMER_ROOT_SHA256}}'
 THEN RAISE EXCEPTION 'MANAGED_CUSTOMER_INTEGRITY' USING ERRCODE='55000';END IF;
END $assert$;
{{SEAL_AND_POSTFLIGHT}}
COMMIT;
