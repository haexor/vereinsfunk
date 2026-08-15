begin;

-- Validates the NOT VALID constraints added in 2026081502 under SHARE UPDATE EXCLUSIVE, which
-- allows concurrent reads and writes, instead of the ACCESS EXCLUSIVE a combined statement holds.
alter table public.organization_brand_profiles validate constraint organization_brand_profiles_locked_fields_check;
alter table public.department_brand_profiles validate constraint department_brand_profiles_locked_fields_check;

commit;
