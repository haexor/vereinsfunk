-- Paket 052, PR 2: Datenbankseitige Bausteine fuer die PlayerBoard-API.

-- 1. Upload-Abschluss ----------------------------------------------------------------------------
-- Ein Foto entsteht als Reservierung (Zeile + signierte Upload-URL) und gilt erst nach
-- POST .../complete als hochgeladen. Nicht abgeschlossene Reservierungen zaehlen wie bei
-- media_assets ('initiated') auf das Kontingent, erscheinen aber nirgends und sind nie oeffentlich.
alter table public.playerboard_training_photos add column upload_completed_at timestamptz;
alter table public.playerboard_training_photos drop constraint if exists playerboard_training_photos_check;
alter table public.playerboard_training_photos add constraint playerboard_training_photos_public_requires_review
  check (not public or (consent_review_status = 'approved' and all_recognizable_people_listed and upload_completed_at is not null));

create or replace function public.playerboard_photo_insert_defaults() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.public := false;
  new.consent_review_status := 'pending';
  new.all_recognizable_people_listed := false;
  new.consent_reviewed_by := null;
  new.consent_reviewed_at := null;
  new.upload_completed_at := null;
  return new;
end;
$$;

-- Ein Review setzt ein abgeschlossenes Hochladen voraus; sonst wuerde eine leere Reservierung
-- freigegeben.
create or replace function public.playerboard_photo_review_requires_upload() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.consent_review_status = 'approved' and old.consent_review_status <> 'approved' and new.upload_completed_at is null then
    raise exception 'photo_upload_incomplete';
  end if;
  return new;
end;
$$;
create trigger playerboard_training_photos_review_requires_upload
  before update on public.playerboard_training_photos
  for each row execute function public.playerboard_photo_review_requires_upload();

-- Die oeffentliche Fotofunktion zeigt nur abgeschlossene Uploads (zusaetzlich zum CHECK oben).
create or replace function public.playerboard_public_photos(org_slug text, team_slug text, from_date date default null, to_date date default null)
returns table (photo_id uuid, storage_path text, training_date date, uploaded_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select photo.id, photo.storage_path, training.training_date, photo.uploaded_at
    from authz.playerboard_public_team(org_slug, team_slug) team
    join public.playerboard_trainings training on training.team_id = team.team_id and training.status = 'saved'
    join public.playerboard_training_photos photo
      on photo.organization_id = training.organization_id and photo.training_id = training.id
   where team.photos_enabled
     and photo.public
     and photo.upload_completed_at is not null
     and photo.consent_review_status = 'approved'
     and photo.all_recognizable_people_listed
     and (from_date is null or training.training_date >= from_date)
     and (to_date is null or training.training_date <= to_date)
     and not exists (
       select 1 from public.playerboard_training_photo_people link
        where link.organization_id = photo.organization_id and link.photo_id = photo.id
          and not authz.playerboard_photo_consent_valid(link.consent_record_id, link.directory_person_id, training.department_id)
     )
   order by training.training_date desc, photo.uploaded_at desc;
$$;

-- 2. Reservierung eines Foto-Uploads mit Kontingentpruefung -------------------------------------
-- Gleiches Muster und gleiche Sperre wie reserve_storage_upload() (Paket 021): Pruefung und
-- Reservierung in einer Transaktion, sonst lassen zwei parallele Uploads beide die Grenze passieren.
-- Nur fuer die API (service_role), die training.manage vorher selbst prueft.
create or replace function public.playerboard_reserve_photo_upload(
  target_photo_id uuid, target_training_id uuid, target_content_type text, announced_bytes integer, target_uploaded_by uuid
) returns public.playerboard_training_photos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  training public.playerboard_trainings;
  effective record;
  department_limit_bytes bigint;
  team_limit_bytes bigint;
  used bigint;
  extension text := case target_content_type when 'image/png' then 'png' when 'image/webp' then 'webp' else 'jpg' end;
  result public.playerboard_training_photos;
begin
  select * into training from public.playerboard_trainings where id = target_training_id;
  if not found then
    raise exception 'training_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(training.organization_id::text, 2));

  if exists (select 1 from public.organization_subscriptions where organization_id = training.organization_id) then
    select storage_bytes into effective from public.effective_limits(training.organization_id);

    select storage_bytes into team_limit_bytes from public.storage_limits
     where organization_id = training.organization_id and scope = 'team' and team_id = training.team_id;
    if team_limit_bytes is not null then
      used := public.storage_usage_bytes(training.organization_id, training.department_id, training.team_id);
      if used + announced_bytes > team_limit_bytes then
        raise exception 'storage_limit_reached: team/%/%', team_limit_bytes, used;
      end if;
    end if;

    select storage_bytes into department_limit_bytes from public.storage_limits
     where organization_id = training.organization_id and scope = 'department' and department_id = training.department_id and team_id is null;
    if department_limit_bytes is not null then
      used := public.storage_usage_bytes(training.organization_id, training.department_id, null);
      if used + announced_bytes > department_limit_bytes then
        raise exception 'storage_limit_reached: department/%/%', department_limit_bytes, used;
      end if;
    end if;

    used := public.storage_usage_bytes(training.organization_id, null, null);
    if used + announced_bytes > effective.storage_bytes then
      raise exception 'storage_limit_reached: organization/%/%', effective.storage_bytes, used;
    end if;
  end if;

  insert into public.playerboard_training_photos (id, organization_id, training_id, storage_path, content_type, size_bytes, uploaded_by)
  values (
    target_photo_id, training.organization_id, training.id,
    training.organization_id::text || '/' || training.team_id::text || '/' || training.id::text || '/' || target_photo_id::text || '.' || extension,
    target_content_type, announced_bytes, target_uploaded_by
  )
  returning * into result;
  return result;
end;
$$;
revoke all on function public.playerboard_reserve_photo_upload(uuid, uuid, text, integer, uuid) from public;
grant execute on function public.playerboard_reserve_photo_upload(uuid, uuid, text, integer, uuid) to service_role;

-- 2b. Upload-Abschluss mit Ist-Groesse und erneuter Kontingentpruefung ----------------------------
-- Die Reservierung bleibt bis zum Abschluss in size_bytes. Der Abschluss laeuft deshalb unter
-- derselben Vereins-Sperre, ersetzt die Reservierung nur innerhalb ihrer Grenze und prueft die
-- drei Kontingentebenen erneut. So kann ein Upload weder die Reservierung vergroessern noch eine
-- zwischenzeitlich verbrauchte Grenze umgehen.
create or replace function public.playerboard_complete_photo_upload(target_photo_id uuid, actual_size integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  photo public.playerboard_training_photos;
  training public.playerboard_trainings;
  effective record;
  department_limit_bytes bigint;
  team_limit_bytes bigint;
  used bigint;
begin
  if actual_size is null or actual_size <= 0 then
    raise exception 'invalid_upload_size';
  end if;

  select * into photo from public.playerboard_training_photos where id = target_photo_id;
  if not found then
    raise exception 'photo_not_found';
  end if;
  select * into training from public.playerboard_trainings
   where organization_id = photo.organization_id and id = photo.training_id;
  if not found then
    raise exception 'training_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(photo.organization_id::text, 2));
  select * into photo from public.playerboard_training_photos where id = target_photo_id for update;
  if photo.upload_completed_at is not null then
    return false;
  end if;
  if actual_size > photo.size_bytes then
    raise exception 'photo_size_exceeds_reservation';
  end if;

  if exists (select 1 from public.organization_subscriptions where organization_id = photo.organization_id) then
    select storage_bytes into effective from public.effective_limits(photo.organization_id);

    select storage_bytes into team_limit_bytes from public.storage_limits
     where organization_id = photo.organization_id and scope = 'team' and team_id = training.team_id;
    if team_limit_bytes is not null then
      used := public.storage_usage_bytes(photo.organization_id, training.department_id, training.team_id)
        - photo.size_bytes + actual_size;
      if used > team_limit_bytes then
        raise exception 'storage_limit_reached: team/%/%', team_limit_bytes, used;
      end if;
    end if;

    select storage_bytes into department_limit_bytes from public.storage_limits
     where organization_id = photo.organization_id and scope = 'department'
       and department_id = training.department_id and team_id is null;
    if department_limit_bytes is not null then
      used := public.storage_usage_bytes(photo.organization_id, training.department_id, null)
        - photo.size_bytes + actual_size;
      if used > department_limit_bytes then
        raise exception 'storage_limit_reached: department/%/%', department_limit_bytes, used;
      end if;
    end if;

    used := public.storage_usage_bytes(photo.organization_id, null, null) - photo.size_bytes + actual_size;
    if used > effective.storage_bytes then
      raise exception 'storage_limit_reached: organization/%/%', effective.storage_bytes, used;
    end if;
  end if;

  update public.playerboard_training_photos
     set size_bytes = actual_size, upload_completed_at = now()
   where id = photo.id;
  return true;
end;
$$;
revoke all on function public.playerboard_complete_photo_upload(uuid, integer) from public;
grant execute on function public.playerboard_complete_photo_upload(uuid, integer) to service_role;

-- 3. Spieler neu anlegen: Verzeichnisperson und Kader-Eintrag in einer Transaktion ---------------
-- Nur fuer die API (service_role), die training.manage auf der Mannschaft vorher prueft und
-- is_minor serverseitig aus dem Geburtsjahr herleitet (wie POST .../directory-people).
create or replace function public.playerboard_create_player(
  target_team_id uuid, target_first_name text, target_last_name text, target_birth_year integer,
  target_is_minor boolean, target_email text, target_jersey_number integer, target_position text, target_created_by uuid
) returns public.playerboard_players
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  team public.teams;
  person_id uuid;
  result public.playerboard_players;
begin
  select * into team from public.teams where id = target_team_id;
  if not found then
    raise exception 'team_not_found';
  end if;
  insert into public.directory_people (organization_id, department_id, team_id, first_name, last_name, birth_year, is_minor, status, email)
  values (team.organization_id, team.department_id, team.id, btrim(target_first_name), btrim(target_last_name), target_birth_year,
          coalesce(target_is_minor, false), 'active', nullif(lower(btrim(target_email)), ''))
  returning id into person_id;
  insert into public.playerboard_players (organization_id, department_id, team_id, directory_person_id, jersey_number, position, created_by)
  values (team.organization_id, team.department_id, team.id, person_id, target_jersey_number, nullif(btrim(target_position), ''), target_created_by)
  returning * into result;
  return result;
end;
$$;
revoke all on function public.playerboard_create_player(uuid, text, text, integer, boolean, text, integer, text, uuid) from public;
grant execute on function public.playerboard_create_player(uuid, text, text, integer, boolean, text, integer, text, uuid) to service_role;

-- 4. Punkte eines Trainings in einem Schritt -----------------------------------------------------
-- security invoker: RLS und die Konsistenz-Trigger greifen wie bei einzelnen Schreibvorgaengen,
-- aber alles oder nichts. entries: [{"playerId", "categoryId", "value"}], value null = loeschen.
create or replace function public.playerboard_set_training_points(target_training_id uuid, entries jsonb)
returns setof public.playerboard_point_entries
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  training public.playerboard_trainings;
  entry jsonb;
begin
  select * into training from public.playerboard_trainings where id = target_training_id;
  if not found or not authz.has_playerboard_team_permission(training.team_id, 'training.manage') then
    raise exception 'insufficient_permission';
  end if;
  if coalesce(jsonb_typeof(entries), '') <> 'array' then
    raise exception 'invalid_entries';
  end if;
  for entry in select value from jsonb_array_elements(entries) loop
    if entry->'value' is null or jsonb_typeof(entry->'value') = 'null' then
      delete from public.playerboard_point_entries
       where training_id = training.id
         and player_id = (entry->>'playerId')::uuid
         and category_id = (entry->>'categoryId')::uuid;
    else
      insert into public.playerboard_point_entries (organization_id, training_id, player_id, category_id, value, created_by)
      values (training.organization_id, training.id, (entry->>'playerId')::uuid, (entry->>'categoryId')::uuid, (entry->>'value')::integer, auth.uid())
      on conflict (training_id, player_id, category_id) do update set value = excluded.value;
    end if;
  end loop;
  return query select * from public.playerboard_point_entries where training_id = training.id;
end;
$$;
revoke all on function public.playerboard_set_training_points(uuid, jsonb) from public;
grant execute on function public.playerboard_set_training_points(uuid, jsonb) to authenticated;

-- 5. Speicher-Aufschluesselung mit Trainingsfotos ------------------------------------------------
drop function public.storage_usage_breakdown(uuid, uuid, uuid);
create function public.storage_usage_breakdown(
  target_organization uuid, target_department uuid default null, target_team uuid default null
) returns table (own_uploads bigint, rendered_media bigint, brand_assets bigint, training_photos bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    coalesce((
      select sum(asset.byte_size) from public.media_assets asset
       where asset.organization_id = target_organization
         and target_team is null
         and (target_department is null or asset.department_id = target_department)
         and asset.upload_status <> 'deleted'
    ), 0),
    coalesce((
      select sum(derivative.byte_size)
        from public.media_derivatives derivative
        join public.media_assets asset
          on asset.organization_id = derivative.organization_id and asset.id = derivative.media_asset_id
       where derivative.organization_id = target_organization
         and target_team is null
         and (target_department is null or asset.department_id = target_department)
         and asset.upload_status <> 'deleted'
    ), 0),
    coalesce((
      select sum(brand.byte_size) from public.brand_assets brand
       where brand.organization_id = target_organization
         and (target_department is null or brand.department_id = target_department)
         and (target_team is null or brand.team_id = target_team)
    ), 0),
    coalesce((
      select sum(photo.size_bytes)
        from public.playerboard_training_photos photo
        join public.playerboard_trainings training
          on training.organization_id = photo.organization_id and training.id = photo.training_id
       where photo.organization_id = target_organization
         and (target_department is null or training.department_id = target_department)
         and (target_team is null or training.team_id = target_team)
    ), 0);
$$;
revoke all on function public.storage_usage_breakdown(uuid, uuid, uuid) from public;
grant execute on function public.storage_usage_breakdown(uuid, uuid, uuid) to service_role;

-- 6. Sicht auf die Kennzahlen fuer die API -------------------------------------------------------
-- Die API unterscheidet "darf nicht sehen" (403) von "nichts da" (leere Liste). Der Aufruf laeuft
-- mit dem Nutzer-Token, das Ergebnis haengt also an auth.uid().
create or replace function public.playerboard_can_view_stats(target_team_id uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select authz.can_view_playerboard_stats(target_team_id);
$$;
revoke all on function public.playerboard_can_view_stats(uuid) from public;
grant execute on function public.playerboard_can_view_stats(uuid) to authenticated;
