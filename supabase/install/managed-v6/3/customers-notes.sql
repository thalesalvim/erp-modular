-- Additive managed v6/3: preserves original sources, references, rows and receipts.
-- Local certification only. A hosted execution needs separate explicit authorization.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_catalog.pg_advisory_xact_lock(731904610140001);
DO $executor$ BEGIN
 IF current_user<>'postgres' OR pg_catalog.current_setting('handyhub.managed_install',true) IS DISTINCT FROM 'pilot-v6-3'
 THEN RAISE EXCEPTION 'CUSTOMER_NOTES_INSTALL_REFUSED' USING ERRCODE='55000';END IF;
 IF pg_catalog.to_regclass('handyhub_private.customer_notes_release') IS NOT NULL
 THEN RAISE EXCEPTION 'CUSTOMER_NOTES_ALREADY_INSTALLED' USING ERRCODE='55000';END IF;
END $executor$;
-- Same command lock order: runtime -> tenant -> pilot -> membership -> customer.
-- Runtime SHARE ROW EXCLUSIVE drains writers/readers taking runtime FOR SHARE.
LOCK TABLE handyhub_private.runtime IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE handyhub_private.pilot_tenants IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.tenant_memberships IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.erp_customers,handyhub_private.customer_identity,
 handyhub_private.customer_receipts,handyhub_private.customer_audit IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM handyhub_private.runtime WHERE singleton AND maintenance)
 OR EXISTS(SELECT 1 FROM handyhub_private.pilot_tenants WHERE enabled)
 OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
     FROM pg_catalog.pg_proc p WHERE p.oid='handyhub_private.assert_integrity()'::pg_catalog.regprocedure)
    IS DISTINCT FROM '{{PRIOR_VERIFIER_BODY_SHA256}}'
 OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(handyhub_private.snapshot()::text,'UTF8')),'hex')
    <> '{{PRIOR_CUSTOMER_ROOT_SHA256}}'
 THEN RAISE EXCEPTION 'CUSTOMER_NOTES_PREFLIGHT' USING ERRCODE='55000';END IF;
 PERFORM handyhub_private.assert_integrity();
END $preflight$;

ALTER TABLE handyhub_private.customer_identity
 ADD COLUMN notes text NOT NULL DEFAULT '' CONSTRAINT customer_notes_length CHECK(pg_catalog.length(notes)<=2000);
CREATE TABLE handyhub_private.customer_notes_release(
 singleton boolean PRIMARY KEY CHECK(singleton),
 release_id text NOT NULL CHECK(release_id='managed-customer-notes-v6-3'),
 prior_root text NOT NULL CHECK(prior_root='{{PRIOR_CUSTOMER_ROOT_SHA256}}'),
 root_sha256 text NOT NULL CHECK(root_sha256 ~ '^[a-f0-9]{64}$'));
ALTER TABLE handyhub_private.customer_notes_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE handyhub_private.customer_notes_release FORCE ROW LEVEL SECURITY;
REVOKE ALL ON handyhub_private.customer_notes_release FROM PUBLIC,anon,authenticated,service_role,handyhub_customer_writer;
CREATE TRIGGER customer_notes_release_immutable BEFORE UPDATE OR DELETE ON handyhub_private.customer_notes_release
 FOR EACH ROW EXECUTE FUNCTION handyhub_private.immutable_release();
CREATE TRIGGER customer_notes_release_no_truncate BEFORE TRUNCATE ON handyhub_private.customer_notes_release
 FOR EACH STATEMENT EXECUTE FUNCTION handyhub_private.immutable_release();

-- Existing technical role remains NOLOGIN/NOBYPASSRLS and is not a table owner.
-- CREATE exists only inside this installer transaction, revoked before postflight.
GRANT CREATE ON SCHEMA public TO handyhub_customer_writer;
SET LOCAL ROLE handyhub_customer_writer;
CREATE OR REPLACE FUNCTION public.hh_customer_read(p_tenant uuid,p_customer uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $read$
DECLARE result jsonb;BEGIN
 PERFORM handyhub_private.customer_context(p_tenant);
 IF p_customer IS NULL THEN
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',x.id,'version',x.version,'fullName',x.name) ORDER BY x.created_at,x.id),'[]'::jsonb) INTO result
  FROM (SELECT * FROM public.erp_customers WHERE tenant_id=p_tenant ORDER BY created_at,id LIMIT 100) x;
  RETURN pg_catalog.jsonb_build_object('items',result);
 END IF;
 SELECT pg_catalog.jsonb_build_object('id',c.id,'version',c.version,'draft',pg_catalog.jsonb_build_object('fullName',c.name,'cpf',i.cpf,'birthDate',i.birth_date::text,'phone',i.phone,'notes',i.notes)) INTO result
 FROM public.erp_customers c JOIN handyhub_private.customer_identity i ON (i.tenant_id,i.customer_id)=(c.tenant_id,c.id)
 WHERE c.tenant_id=p_tenant AND c.id=p_customer;
 IF result IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501';END IF;
 RETURN result;
END $read$;

CREATE OR REPLACE FUNCTION public.hh_customer_write(p_tenant uuid,p_operation uuid,p_data jsonb,p_customer uuid DEFAULT NULL,p_expected bigint DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $write$
DECLARE n jsonb;sig text;has_notes boolean;notes_value text;old_receipt handyhub_private.customer_receipts;next_id uuid;previous bigint;next_v bigint;event uuid;result jsonb;warning boolean;BEGIN
 PERFORM handyhub_private.customer_context(p_tenant);
 IF p_operation IS NULL OR (p_customer IS NULL AND p_expected IS NOT NULL) OR (p_customer IS NOT NULL AND (p_expected IS NULL OR p_expected<1)) THEN RAISE EXCEPTION 'INVALID_CUSTOMER_FIELDS' USING ERRCODE='22023';END IF;
 -- Keep the v6/2 normalized four-field payload/fingerprint EXACTLY for old commands.
 IF p_data IS NULL OR pg_catalog.jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'INVALID_CUSTOMER_FIELDS' USING ERRCODE='22023';END IF;
 has_notes:=p_data ? 'notes';
 IF has_notes AND (pg_catalog.jsonb_typeof(p_data->'notes')<>'string' OR pg_catalog.length(p_data->>'notes')>2000)
 THEN RAISE EXCEPTION 'INVALID_CUSTOMER_FIELDS' USING ERRCODE='22023';END IF;
 n:=handyhub_private.customer_validate(p_data-'notes');
 notes_value:=CASE WHEN has_notes THEN p_data->>'notes' ELSE '' END;
 -- Domain separation only for the new explicit-notes contract, including empty notes.
 IF has_notes THEN n:=n||pg_catalog.jsonb_build_object('notes',notes_value,'contract','managed-customer-notes-v6-3');END IF;
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
 INSERT INTO handyhub_private.customer_identity AS existing(tenant_id,customer_id,cpf,birth_date,phone,notes)
 VALUES(p_tenant,next_id,n->>'cpf',(n->>'birthDate')::date,n->>'phone',notes_value)
 ON CONFLICT(tenant_id,customer_id) DO UPDATE SET cpf=EXCLUDED.cpf,birth_date=EXCLUDED.birth_date,phone=EXCLUDED.phone,
 notes=CASE WHEN has_notes THEN EXCLUDED.notes ELSE existing.notes END;
 INSERT INTO handyhub_private.customer_audit(tenant_id,customer_id,actor,action,previous_version,next_version,reviewed)
 VALUES(p_tenant,next_id,handyhub_private.actor(),CASE WHEN p_customer IS NULL THEN 'create' ELSE 'update' END,previous,next_v,warning) RETURNING id INTO event;
 IF warning THEN INSERT INTO handyhub_private.customer_review_reasons VALUES(event,p_tenant,pg_catalog.btrim(p_reason));END IF;
 result:=pg_catalog.jsonb_build_object('id',next_id,'version',next_v,'auditId',event);
 INSERT INTO handyhub_private.customer_receipts VALUES(p_tenant,handyhub_private.actor(),p_operation,sig,result);
 RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'CUSTOMER_CPF_CONFLICT' USING ERRCODE='23505';
END $write$;

SET LOCAL ROLE postgres;
REVOKE CREATE ON SCHEMA public FROM handyhub_customer_writer;

-- New active verifier; both earlier immutable reference rows remain unchanged.
CREATE OR REPLACE FUNCTION handyhub_private.assert_integrity() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $assert$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM handyhub_private.release WHERE singleton AND release_id='managed-customer-foundation-v6-1' AND baseline_sha256='f2c205f6706bb26d45db2ed44a6c3512081b7ee7e177927434c86047a14ed3d6' AND root_sha256='4c6b61962c9401cce052bf037544d68997e14c89aa6e23b165546cf93f907a3d')
 OR NOT EXISTS(SELECT 1 FROM handyhub_private.customer_release WHERE singleton AND prior_root='4c6b61962c9401cce052bf037544d68997e14c89aa6e23b165546cf93f907a3d' AND root_sha256='{{PRIOR_CUSTOMER_ROOT_SHA256}}')
 OR NOT EXISTS(SELECT 1 FROM handyhub_private.customer_notes_release WHERE singleton AND release_id='managed-customer-notes-v6-3' AND prior_root='{{PRIOR_CUSTOMER_ROOT_SHA256}}' AND root_sha256='{{NOTES_ROOT_SHA256}}')
 OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(handyhub_private.snapshot()::text,'UTF8')),'hex')<>'{{NOTES_ROOT_SHA256}}'
 THEN RAISE EXCEPTION 'MANAGED_CUSTOMER_NOTES_INTEGRITY' USING ERRCODE='55000';END IF;
END $assert$;
{{SEAL_AND_POSTFLIGHT}}
COMMIT;
