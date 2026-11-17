-- Organization and department slugs are public URL segments (/mannschaft/{verein}/{abteilung}/...).
-- They were generated with lower() + [^a-z0-9]+ -> '-', so "Fußball" became "fu-ball" and
-- "Müller" became "m-ller". authz.url_slug transliterates German characters first (ä -> ae,
-- ö -> oe, ü -> ue, ß -> ss) and drops remaining diacritics ("é" -> "e") instead of turning them
-- into separators. create_organization and create_department use it from now on; the bodies below
-- are the previous definitions (2026081302 and 2026082403) with only the slug expressions replaced.
-- Team slugs use the same generator (authz.playerboard_slug_part now delegates to it), so all three
-- URL segments are produced by one rule. All three columns keep their ^[a-z0-9]+(-[a-z0-9]+)*$ check.

create or replace function authz.url_slug(source text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select trim(both '-' from regexp_replace(
    regexp_replace(
      normalize(replace(replace(replace(replace(lower(source), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'), NFKD),
      '[\u0300-\u036f]', '', 'g'),
    '[^a-z0-9]+', '-', 'g'));
$$;
revoke all on function authz.url_slug(text) from public;

create or replace function public.create_organization(
  organization_name text,
  first_department_name text,
  organization_timezone text default 'Europe/Berlin'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_user uuid := auth.uid();
  new_organization_id uuid;
  new_department_id uuid;
  base_slug text;
  candidate_slug text;
  department_slug text;
  suffix integer := 0;
  owner_count integer;
  max_organizations_per_owner integer;
begin
  if acting_user is null then
    raise exception 'authentication required';
  end if;
  if char_length(trim(coalesce(organization_name, ''))) = 0 then
    raise exception 'organization name is required';
  end if;
  if char_length(trim(coalesce(first_department_name, ''))) = 0 then
    raise exception 'first department name is required';
  end if;

  select (value::text)::integer into max_organizations_per_owner
  from public.platform_settings where key = 'max_organizations_per_owner';
  if max_organizations_per_owner is null then
    max_organizations_per_owner := 3;
  end if;

  perform pg_advisory_xact_lock(hashtext('create_organization:' || acting_user::text));

  select count(*) into owner_count
  from public.organization_memberships
  where user_id = acting_user
    and role = 'organization_owner'
    and (expires_at is null or expires_at > now());
  if owner_count >= max_organizations_per_owner then
    raise exception 'organization limit reached for this account';
  end if;

  base_slug := authz.url_slug(organization_name);
  if base_slug = '' then base_slug := 'verein'; end if;
  candidate_slug := base_slug;

  loop
    begin
      insert into public.organizations (name, slug, timezone)
      values (trim(organization_name), candidate_slug, organization_timezone)
      returning id into new_organization_id;
      exit;
    exception when unique_violation then
      suffix := suffix + 1;
      candidate_slug := base_slug || '-' || suffix;
    end;
  end loop;

  insert into public.organization_profiles (organization_id) values (new_organization_id);
  insert into public.organization_onboarding (organization_id) values (new_organization_id);
  insert into public.organization_brand_profiles (organization_id) values (new_organization_id);
  insert into public.organization_subscriptions (organization_id, plan_key) values (new_organization_id, 'free');
  insert into public.retention_settings (organization_id, updated_by) values (new_organization_id, acting_user);
  insert into public.processing_records (organization_id, purpose, legal_basis, data_categories, subject_categories, retention_note) values
    (new_organization_id, 'Beitragserstellung und Freigabe', 'Vertragserfuellung / berechtigtes Interesse -- bitte durch den Verein bestaetigen oder anpassen', array['Beitragstexte', 'Bildmaterial'], array['Mitglieder', 'Verzeichnispersonen'], 'Bis zur Loeschung des Vereinskontos'),
    (new_organization_id, 'Medienverarbeitung (Anonymisierung, Rendering)', 'Vertragserfuellung / berechtigtes Interesse -- bitte durch den Verein bestaetigen oder anpassen', array['Bildmaterial', 'Videomaterial'], array['Mitglieder', 'Verzeichnispersonen'], 'Gemaess Aufbewahrungsfrist fuer Rohmedien'),
    (new_organization_id, 'Einwilligungsverwaltung', 'Einwilligung -- bitte durch den Verein bestaetigen oder anpassen', array['Einwilligungserklaerungen', 'Kontaktdaten Erziehungsberechtigter'], array['Verzeichnispersonen', 'Erziehungsberechtigte'], 'Gemaess gesetzlicher Aufbewahrungsfrist fuer Nachweise'),
    (new_organization_id, 'Mitgliederverzeichnis', 'Vertragserfuellung / berechtigtes Interesse -- bitte durch den Verein bestaetigen oder anpassen', array['Stammdaten', 'Kontaktdaten'], array['Mitglieder', 'Verzeichnispersonen'], 'Bis zum Austritt bzw. Loeschung des Vereinskontos');

  department_slug := authz.url_slug(first_department_name);
  if department_slug = '' then department_slug := 'abteilung'; end if;

  insert into public.departments (organization_id, name, slug)
  values (new_organization_id, trim(first_department_name), department_slug)
  returning id into new_department_id;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (new_organization_id, acting_user, 'organization_owner');

  insert into public.department_memberships (organization_id, department_id, user_id, role)
  values (new_organization_id, new_department_id, acting_user, 'department_admin');

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id)
  values (new_organization_id, acting_user, 'organization.created', 'organization', new_organization_id, gen_random_uuid());

  return new_organization_id;
end;
$$;

revoke all on function public.create_organization(text, text, text) from public;
grant execute on function public.create_organization(text, text, text) to authenticated;

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

  base_slug := authz.url_slug(department_name);
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

-- Team segment: same rule as above. Previously "Mädchen" became "madchen"; now "maedchen". The unique
-- index below is built on authz.team_url_slug, whose result changes for such names, so it is rebuilt.
-- Two active teams of one department that now normalize to the same segment (e.g. "Mädchen" and
-- "Maedchen") abort the migration before anything is changed.
do $$
declare
  collisions text;
begin
  select string_agg(format('department %s: %s', collided.department_id, collided.names), E'\n')
    into collisions
    from (
      select team.department_id, string_agg(team.name, ', ' order by team.name) as names
        from public.teams team
       where team.archived_at is null
       group by team.organization_id, team.department_id,
                rtrim(left(coalesce(nullif(authz.url_slug(team.name), ''), 'mannschaft'), 80), '-')
      having count(*) > 1
    ) collided;
  if collisions is not null then
    raise exception E'team URL slug migration aborted, nothing was changed.\nActive teams that now share one address (rename or archive all but one):\n%', collisions;
  end if;
end;
$$;

create or replace function authz.playerboard_slug_part(source text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select authz.url_slug(source);
$$;
revoke all on function authz.playerboard_slug_part(text) from public;

reindex index public.teams_active_url_slug_unique;

update public.playerboard_settings
   set public_slug = public_slug
 where scope = 'team';


-- Repair existing slugs that were generated from the name with the old rule. Slugs that do not match
-- the old rule (set by hand, or carrying a collision suffix) are left alone. A repaired slug that
-- collides gets the same numeric suffix create_organization / create_department would add.
do $$
declare
  target record;
  base_slug text;
  candidate_slug text;
  suffix integer;
begin
  for target in
    select id, name, slug from public.organizations
     where slug = trim(both '-' from regexp_replace(lower(trim(name)), '[^a-z0-9]+', '-', 'g'))
       and authz.url_slug(name) <> ''
       and authz.url_slug(name) <> slug
     order by created_at, id
  loop
    base_slug := authz.url_slug(target.name);
    candidate_slug := base_slug;
    suffix := 0;
    while exists (select 1 from public.organizations where slug = candidate_slug and id <> target.id) loop
      suffix := suffix + 1;
      candidate_slug := base_slug || '-' || suffix;
    end loop;
    update public.organizations set slug = candidate_slug where id = target.id;
  end loop;

  for target in
    select id, organization_id, name, slug from public.departments
     where slug = trim(both '-' from regexp_replace(lower(trim(name)), '[^a-z0-9]+', '-', 'g'))
       and authz.url_slug(name) <> ''
       and authz.url_slug(name) <> slug
     order by created_at, id
  loop
    base_slug := authz.url_slug(target.name);
    candidate_slug := base_slug;
    suffix := 0;
    while exists (
      select 1 from public.departments
       where organization_id = target.organization_id and slug = candidate_slug and id <> target.id
    ) loop
      suffix := suffix + 1;
      candidate_slug := base_slug || '-' || suffix;
    end loop;
    update public.departments set slug = candidate_slug where id = target.id;
  end loop;
end;
$$;
