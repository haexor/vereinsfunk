-- Eine neue Abteilung ist eine Aenderung der Vereinsstruktur. Abteilungsadmins duerfen ihre
-- eigene Abteilung verwalten, aber keine weiteren Abteilungen fuer den Verein anlegen.
create or replace function public.create_department(target_organization_id uuid, department_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_slug text;
  candidate_slug text;
  suffix integer := 0;
  new_department_id uuid;
begin
  if not authz.has_organization_permission(target_organization_id, 'organization.manage') then
    raise exception 'insufficient_permission';
  end if;
  if char_length(trim(coalesce(department_name, ''))) = 0 then
    raise exception 'department name is required';
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(trim(department_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'abteilung'; end if;
  candidate_slug := base_slug;

  loop
    begin
      insert into public.departments (organization_id, name, slug)
      values (target_organization_id, trim(department_name), candidate_slug)
      returning id into new_department_id;
      exit;
    exception when unique_violation then
      suffix := suffix + 1;
      -- Schuetzt gegen eine Endlosschleife, falls eine andere Unique-Bedingung auf
      -- public.departments verletzt wird, die der Slug-Suffix nicht beheben kann.
      if suffix > 100 then
        raise exception 'could not generate a unique department slug';
      end if;
      candidate_slug := base_slug || '-' || suffix;
    end;
  end loop;

  return new_department_id;
end;
$$;

revoke all on function public.create_department(uuid, text) from public;
grant execute on function public.create_department(uuid, text) to authenticated, service_role;
