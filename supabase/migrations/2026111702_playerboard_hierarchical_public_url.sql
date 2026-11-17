-- Public team pages move from /mannschaft/{verein}/{verein-abteilung-mannschaft-uuid} to
-- /mannschaft/{verein}/{abteilung}/{mannschaft}. The department segment is the stable
-- departments.slug, the team segment is playerboard_settings.public_slug and now holds only the
-- normalized team name. Uniqueness of the last segment is owned by an index on teams.
--
-- The whole file runs in one implicit transaction: the preflight below aborts it before anything
-- is changed, even though the helper function it needs is created first.

-- 1. The team segment: the same normalization the old generator used for the team part. Empty
--    names fall back to 'mannschaft'. Immutable so the unique index below can use it. Team inserts
--    and renames run as `authenticated` and evaluate the index expression, so the function is
--    security definer (it then needs no access to playerboard_slug_part) and executable by that role.
create or replace function authz.team_url_slug(team_name text)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select rtrim(left(coalesce(nullif(authz.playerboard_slug_part(team_name), ''), 'mannschaft'), 80), '-');
$$;
revoke all on function authz.team_url_slug(text) from public;
grant execute on function authz.team_url_slug(text) to authenticated, service_role;

-- 2. Preflight: report existing data the new address cannot represent instead of renaming it.
do $$
declare
  collisions text;
  unusable_slugs text;
begin
  select string_agg(
           format('department %s / %s: %s', organization.slug, department.slug, collided.names),
           E'\n' order by organization.slug, department.slug)
    into collisions
    from (
      select team.organization_id, team.department_id, string_agg(team.name, ', ' order by team.name) as names
        from public.teams team
       where team.archived_at is null
       group by team.organization_id, team.department_id, authz.team_url_slug(team.name)
      having count(*) > 1
    ) collided
    join public.organizations organization on organization.id = collided.organization_id
    join public.departments department
      on department.organization_id = collided.organization_id and department.id = collided.department_id;

  select string_agg(distinct format('%s slug "%s"', slugs.kind, slugs.slug), E'\n')
    into unusable_slugs
    from (
      select 'organization' as kind, organization.slug
        from public.organizations organization
        join public.playerboard_settings settings
          on settings.organization_id = organization.id and settings.scope = 'team'
      union
      select 'department', department.slug
        from public.departments department
        join public.playerboard_settings settings
          on settings.organization_id = department.organization_id
         and settings.department_id = department.id and settings.scope = 'team'
    ) slugs
   where slugs.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(slugs.slug) > 200;

  if collisions is not null or unusable_slugs is not null then
    raise exception E'hierarchical public PlayerBoard URL migration aborted, nothing was changed.\nActive teams with the same normalized name in one department (rename or archive all but one):\n%\nOrganization or department slugs that cannot form a public address (>200 characters or not [a-z0-9-]):\n%',
      coalesce(collisions, '(none)'), coalesce(unusable_slugs, '(none)');
  end if;
end;
$$;

-- 3. Two active teams in one department never share a team segment. Archived teams are exempt,
--    so a retired team does not block a new team with its name, and un-archiving into a clash is
--    rejected by the same index.
create unique index teams_active_url_slug_unique
  on public.teams (organization_id, department_id, (authz.team_url_slug(name)))
  where archived_at is null;

-- 4. The generated slug no longer depends on the department, so the department rename trigger
--    and the old two-part generator go away.
create or replace function authz.set_playerboard_public_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.scope = 'team' then
    select authz.team_url_slug(team.name)
      into new.public_slug
      from public.teams team
     where team.id = new.team_id and team.department_id = new.department_id;
  else
    new.public_slug := null;
  end if;
  return new;
end;
$$;
revoke all on function authz.set_playerboard_public_slug() from public;

create or replace function authz.refresh_playerboard_public_slugs()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.playerboard_settings
     set public_slug = public_slug
   where scope = 'team' and organization_id = new.organization_id and team_id = new.id;
  return new;
end;
$$;
revoke all on function authz.refresh_playerboard_public_slugs() from public;

drop trigger departments_refresh_playerboard_public_slug on public.departments;
drop function authz.playerboard_team_public_slug(uuid, uuid);

-- 5. The index above owns uniqueness. This constraint cannot see archived_at and would block
--    renaming an active team to the name of a retired one; resolution filters archived teams.
alter table public.playerboard_settings drop constraint playerboard_settings_organization_id_public_slug_key;

-- 6. Rewrite the existing team slugs with the new generator. Only existing rows are touched; no
--    settings row is created and no switch or name format changes.
update public.playerboard_settings
   set public_slug = public_slug
 where scope = 'team';

-- 7. Resolution by all three segments. The old two-argument functions are dropped, not
--    overloaded, so the two-segment lookup does not survive in the database.
drop function public.playerboard_public_team_info(text, text);
drop function public.playerboard_public_trainings(text, text);
drop function public.playerboard_public_training(text, text, uuid);
drop function public.playerboard_public_ranking(text, text, date, date);
drop function public.playerboard_public_photos(text, text, date, date);
drop function public.playerboard_public_veo_stats(text, text, date, date);
drop function authz.playerboard_public_team(text, text);

create function authz.playerboard_public_team(org_slug text, department_slug text, team_slug text)
returns table (organization_id uuid, department_id uuid, team_id uuid, organization_name text, team_name text,
               points_enabled boolean, veo_stats_enabled boolean, photos_enabled boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization.id, team.department_id, team.id, organization.name, team.name,
         coalesce(settings.public_points_enabled, false), coalesce(settings.public_veo_stats_enabled, false),
         coalesce(settings.public_photos_enabled, false)
    from public.organizations organization
    join public.departments department
      on department.organization_id = organization.id and department.archived_at is null
    join public.teams team
      on team.organization_id = organization.id and team.department_id = department.id and team.archived_at is null
    join public.playerboard_settings settings
      on settings.organization_id = organization.id and settings.scope = 'team'
     and settings.team_id = team.id and settings.public_slug = team_slug
   where organization.slug = org_slug
     and department.slug = department_slug
     and authz.module_enabled(organization.id, team.department_id, team.id, 'playerboard')
     and authz.resolve_playerboard_setting(organization.id, team.department_id, team.id, 'public_sharing_allowed') = 'true';
$$;
revoke all on function authz.playerboard_public_team(text, text, text) from public;

-- Also returns the internal ids the API needs for brand colors and season start. The function is
-- service_role only; the route never forwards the ids.
create function public.playerboard_public_team_info(org_slug text, department_slug text, team_slug text)
returns table(
  organization_name text,
  team_name text,
  points_enabled boolean,
  trainings_enabled boolean,
  veo_stats_enabled boolean,
  photos_enabled boolean,
  organization_id uuid,
  department_id uuid,
  team_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select team.organization_name,
         team.team_name,
         team.points_enabled,
         coalesce(settings.public_trainings_enabled, false),
         team.veo_stats_enabled,
         team.photos_enabled,
         team.organization_id,
         team.department_id,
         team.team_id
    from authz.playerboard_public_team(org_slug, department_slug, team_slug) team
    join public.playerboard_settings settings
      on settings.organization_id = team.organization_id
     and settings.scope = 'team'
     and settings.team_id = team.team_id
   where team.points_enabled
      or settings.public_trainings_enabled
      or team.veo_stats_enabled
      or team.photos_enabled;
$$;
revoke all on function public.playerboard_public_team_info(text, text, text) from public;
grant execute on function public.playerboard_public_team_info(text, text, text) to service_role;

create function public.playerboard_public_trainings(org_slug text, department_slug text, team_slug text)
returns table(training_id uuid, training_date date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select training.id, training.training_date
    from authz.playerboard_public_team(org_slug, department_slug, team_slug) team
    join public.playerboard_settings settings
      on settings.organization_id = team.organization_id
     and settings.scope = 'team'
     and settings.team_id = team.team_id
    join public.playerboard_trainings training
      on training.organization_id = team.organization_id
     and training.team_id = team.team_id
   where settings.public_trainings_enabled
     and training.status = 'saved'
   order by training.training_date desc, training.created_at desc, training.id desc;
$$;
revoke all on function public.playerboard_public_trainings(text, text, text) from public;
grant execute on function public.playerboard_public_trainings(text, text, text) to service_role;

create function public.playerboard_public_training(org_slug text, department_slug text, team_slug text, target_training_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'trainingDate', training.training_date,
           'entries', coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'label', coalesce(
                          public.playerboard_public_label(player.directory_person_id, player.jersey_number, team.team_id),
                          case when player.jersey_number is null then 'Unbekannt' else '#' || player.jersey_number::text end
                        ),
                        'category', category.name,
                        'value', entry.value
                      )
                      order by category.sort_order, category.name, player.jersey_number nulls last, entry.id
                    )
               from public.playerboard_point_entries entry
               join public.playerboard_players player
                 on player.organization_id = entry.organization_id
                and player.id = entry.player_id
                and player.team_id = team.team_id
               join public.playerboard_point_categories category
                 on category.organization_id = entry.organization_id
                and category.id = entry.category_id
              where entry.organization_id = training.organization_id
                and entry.training_id = training.id
           ), '[]'::jsonb)
         )
    from authz.playerboard_public_team(org_slug, department_slug, team_slug) team
    join public.playerboard_settings settings
      on settings.organization_id = team.organization_id
     and settings.scope = 'team'
     and settings.team_id = team.team_id
    join public.playerboard_trainings training
      on training.organization_id = team.organization_id
     and training.team_id = team.team_id
     and training.id = target_training_id
   where settings.public_trainings_enabled
     and training.status = 'saved';
$$;
revoke all on function public.playerboard_public_training(text, text, text, uuid) from public;
grant execute on function public.playerboard_public_training(text, text, text, uuid) to service_role;

create function public.playerboard_public_ranking(org_slug text, department_slug text, team_slug text, from_date date default null, to_date date default null)
returns table (rank bigint, label text, total bigint, category_totals jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rows.rank,
         public.playerboard_public_label(rows.directory_person_id, rows.jersey_number, team.team_id),
         rows.total,
         coalesce((
           select jsonb_agg(jsonb_build_object('category', category.name, 'points', (rows.category_totals->>category.id::text)::bigint)
                            order by case category.scope when 'organization' then 0 when 'department' then 1 else 2 end, category.sort_order, category.name)
             from public.playerboard_point_categories category
            where rows.category_totals ? category.id::text
         ), '[]'::jsonb)
    from authz.playerboard_public_team(org_slug, department_slug, team_slug) team
    cross join lateral authz.playerboard_ranking_rows(team.team_id, from_date, to_date) rows
   where team.points_enabled
   order by rows.rank, rows.jersey_number nulls last, 2;
$$;
revoke all on function public.playerboard_public_ranking(text, text, text, date, date) from public;
grant execute on function public.playerboard_public_ranking(text, text, text, date, date) to service_role;

create function public.playerboard_public_photos(org_slug text, department_slug text, team_slug text, from_date date default null, to_date date default null)
returns table (photo_id uuid, storage_path text, training_date date, uploaded_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select photo.id, photo.storage_path, training.training_date, photo.uploaded_at
    from authz.playerboard_public_team(org_slug, department_slug, team_slug) team
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
revoke all on function public.playerboard_public_photos(text, text, text, date, date) from public;
grant execute on function public.playerboard_public_photos(text, text, text, date, date) to service_role;

create function public.playerboard_public_veo_stats(org_slug text, department_slug text, team_slug text, from_date date default null, to_date date default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select authz.playerboard_veo_matches_json(team.team_id, from_date, to_date, true)
      from authz.playerboard_public_team(org_slug, department_slug, team_slug) team
     where team.veo_stats_enabled
  ), '[]'::jsonb);
$$;
revoke all on function public.playerboard_public_veo_stats(text, text, text, date, date) from public;
grant execute on function public.playerboard_public_veo_stats(text, text, text, date, date) to service_role;
