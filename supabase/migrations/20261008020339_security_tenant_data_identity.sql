-- Add stable tenant IDs without changing the existing JSON payload or slug API.
BEGIN;

ALTER TABLE public.tenant_data
  ADD COLUMN tenant_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tenant_data AS d
    LEFT JOIN public.tenants AS t ON t.slug = d.tenant_slug
    WHERE t.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot attach tenant_data to tenants: one or more slugs have no matching tenant';
  END IF;
END
$$;

-- Preserve each existing row and payload; derive only its stable foreign key.
UPDATE public.tenant_data AS d
SET tenant_id = t.id
FROM public.tenants AS t
WHERE d.tenant_slug = t.slug
  AND d.tenant_id IS NULL;

ALTER TABLE public.tenant_data
  ALTER COLUMN tenant_id SET NOT NULL,
  ADD CONSTRAINT tenant_data_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX tenant_data_tenant_id_data_key_key
  ON public.tenant_data (tenant_id, data_key);

-- `companies` is not referenced by the current application. Add an optional
-- relationship without guessing which existing company row belongs to which
-- tenant based on names or email addresses.
ALTER TABLE public.companies
  ADD COLUMN tenant_id uuid,
  ADD CONSTRAINT companies_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
CREATE INDEX companies_tenant_id_idx ON public.companies (tenant_id);

CREATE FUNCTION private.sync_tenant_data_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  tenant_from_slug uuid;
BEGIN
  SELECT t.id INTO tenant_from_slug
  FROM public.tenants AS t
  WHERE t.slug = NEW.tenant_slug;

  IF tenant_from_slug IS NULL THEN
    RAISE EXCEPTION 'Unknown tenant for tenant_data row'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := tenant_from_slug;
  ELSIF NEW.tenant_id <> tenant_from_slug THEN
    RAISE EXCEPTION 'tenant_id and tenant_slug must identify the same tenant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.sync_tenant_data_identity()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tenant_data_sync_tenant_identity
  BEFORE INSERT OR UPDATE OF tenant_id, tenant_slug
  ON public.tenant_data
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_tenant_data_identity();

COMMIT;
