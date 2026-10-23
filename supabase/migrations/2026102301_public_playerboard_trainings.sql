-- Öffentliche Trainings je Mannschaft, mit derselben anonymisierten Grenze wie die öffentliche
-- Rangliste und Veo-Ausgabe. Die SQL-Funktionen geben nie Spieler- oder Verzeichnis-IDs zurück.

alter table public.playerboard_settings
  add column if not exists public_trainings_enabled boolean;

do $$
declare
  constraint_name text;
begin
  select con.conname
    into constraint_name
    from pg_constraint con
   where con.conrelid = 'public.playerboard_settings'::regclass
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%public_points_enabled%'
   limit 1;
  if constraint_name is not null then
    execute format('alter table public.playerboard_settings drop constraint %I', constraint_name);
  end if;
end;
$$;

alter table public.playerboard_settings
  add constraint playerboard_settings_public_fields_scope_check
  check (
    scope = 'team'
    or (
      public_trainings_enabled is null
      and public_points_enabled is null
      and public_veo_stats_enabled is null
      and public_photos_enabled is null
      and public_slug is null
    )
  );

-- The return shape changes, so replace the old metadata function explicitly.
drop function if exists public.playerboard_public_team_info(text, text);

create function public.playerboard_public_team_info(org_slug text, team_slug text)
returns table(
  organization_name text,
  team_name text,
  points_enabled boolean,
  trainings_enabled boolean,
  veo_stats_enabled boolean,
  photos_enabled boolean
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
         team.photos_enabled
    from authz.playerboard_public_team(org_slug, team_slug) team
    join public.playerboard_settings settings
      on settings.organization_id = team.organization_id
     and settings.scope = 'team'
     and settings.team_id = team.team_id
   where team.points_enabled
      or settings.public_trainings_enabled
      or team.veo_stats_enabled
      or team.photos_enabled;
$$;
revoke all on function public.playerboard_public_team_info(text, text) from public;
grant execute on function public.playerboard_public_team_info(text, text) to service_role;

create or replace function public.playerboard_public_trainings(org_slug text, team_slug text)
returns table(training_id uuid, training_date date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select training.id, training.training_date
    from authz.playerboard_public_team(org_slug, team_slug) team
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
revoke all on function public.playerboard_public_trainings(text, text) from public;
grant execute on function public.playerboard_public_trainings(text, text) to service_role;

create or replace function public.playerboard_public_training(org_slug text, team_slug text, target_training_id uuid)
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
                          public.playerboard_public_label(player.directory_person_id, player.jersey_number),
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
    from authz.playerboard_public_team(org_slug, team_slug) team
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
revoke all on function public.playerboard_public_training(text, text, uuid) from public;
grant execute on function public.playerboard_public_training(text, text, uuid) to service_role;
