-- Public dashboard URLs are generated from the organization, department and team names.
-- The team UUID suffix keeps same-named teams unique within a club.
create or replace function authz.playerboard_slug_part(source text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select trim(both '-' from regexp_replace(
    normalize(replace(translate(lower(source), 'äöü', 'aou'), 'ß', 'ss'), NFKD),
    '[^a-z0-9]+', '-', 'g'));
$$;
revoke all on function authz.playerboard_slug_part(text) from public;

create or replace function authz.playerboard_team_public_slug(target_department_id uuid, target_team_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select left(coalesce(nullif(authz.playerboard_slug_part(department.name), ''), 'abteilung'), 20)
      || '-' || left(coalesce(nullif(authz.playerboard_slug_part(team.name), ''), 'mannschaft'), 20)
      || '-' || team.id::text
    from public.teams team
    join public.departments department
      on department.organization_id = team.organization_id and department.id = team.department_id
   where team.id = target_team_id and team.department_id = target_department_id;
$$;
revoke all on function authz.playerboard_team_public_slug(uuid, uuid) from public;

alter table public.playerboard_settings
  add column public_player_name_format text not null default 'initials'
  check (public_player_name_format in ('initials', 'first_name_last_initial', 'full_name'));

create or replace function authz.set_playerboard_public_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.scope = 'team' then
    new.public_slug := authz.playerboard_team_public_slug(new.department_id, new.team_id);
  else
    new.public_slug := null;
  end if;
  return new;
end;
$$;
revoke all on function authz.set_playerboard_public_slug() from public;

create trigger playerboard_settings_public_slug_generated
before insert or update of scope, organization_id, department_id, team_id, public_slug
on public.playerboard_settings
for each row execute function authz.set_playerboard_public_slug();

-- Recompute historical hand-entered slugs and future slugs after a name change.
update public.playerboard_settings
   set public_slug = public_slug
 where scope = 'team';

create or replace function authz.refresh_playerboard_public_slugs()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'departments' then
    update public.playerboard_settings settings
       set public_slug = settings.public_slug
      from public.teams team
     where settings.scope = 'team'
       and settings.organization_id = new.organization_id
       and team.organization_id = new.organization_id
       and team.department_id = new.id
       and settings.team_id = team.id;
  else
    update public.playerboard_settings
       set public_slug = public_slug
     where scope = 'team' and organization_id = new.organization_id and team_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function authz.refresh_playerboard_public_slugs() from public;

create trigger departments_refresh_playerboard_public_slug
after update of name on public.departments
for each row when (old.name is distinct from new.name)
execute function authz.refresh_playerboard_public_slugs();
create trigger teams_refresh_playerboard_public_slug
after update of name on public.teams
for each row when (old.name is distinct from new.name)
execute function authz.refresh_playerboard_public_slugs();

-- Keep the existing two-argument function for other callers, and add a team-scoped variant for
-- public dashboard responses so a player listed in multiple teams gets each team's chosen format.
create or replace function public.playerboard_public_label(
  target_directory_person_id uuid, target_jersey_number integer, target_team_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select concat_ws(' ',
           case when target_jersey_number is not null then '#' || target_jersey_number::text end,
           case coalesce(settings.public_player_name_format, 'initials')
             when 'full_name' then concat_ws(' ', btrim(person.first_name), btrim(person.last_name))
             when 'first_name_last_initial' then concat_ws(' ', btrim(person.first_name), upper(left(btrim(person.last_name), 1)) || '.')
             else upper(left(btrim(person.first_name), 1)) || '. ' || upper(left(btrim(person.last_name), 1)) || '.'
           end)
    from public.directory_people person
    left join public.playerboard_settings settings
      on settings.scope = 'team' and settings.team_id = target_team_id
   where person.id = target_directory_person_id;
$$;
revoke all on function public.playerboard_public_label(uuid, integer, uuid) from public;
grant execute on function public.playerboard_public_label(uuid, integer, uuid) to service_role;

-- Ranking entries use the selected team's display format.
create or replace function public.playerboard_public_ranking(org_slug text, team_slug text, from_date date default null, to_date date default null)
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
    from authz.playerboard_public_team(org_slug, team_slug) team
    cross join lateral authz.playerboard_ranking_rows(team.team_id, from_date, to_date) rows
   where team.points_enabled
   order by rows.rank, rows.jersey_number nulls last, 2;
$$;
revoke all on function public.playerboard_public_ranking(text, text, date, date) from public;
grant execute on function public.playerboard_public_ranking(text, text, date, date) to service_role;

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

-- Veo values also use the same team-specific format. Internal callers keep names as before.
create or replace function authz.playerboard_veo_matches_json(
  target_team_id uuid, from_date date, to_date date, public_labels boolean
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(match_json order by kickoff_at desc), '[]'::jsonb)
    from (
      select fixture.kickoff_at,
             jsonb_build_object(
               'fixtureId', fixture.id,
               'kickoffAt', fixture.kickoff_at,
               'opponentName', fixture.opponent_name,
               'isHome', fixture.is_home,
               'ownScore', case when fixture.is_home is false then fixture.away_score else fixture.home_score end,
               'opponentScore', case when fixture.is_home is false then fixture.home_score else fixture.away_score end,
               'teamStats', coalesce((
                 select jsonb_agg(jsonb_build_object('teamAssociation', stat.team_association, 'statType', stat.stat_type,
                                                     'category', stat.category, 'value', stat.value)
                                  order by stat.category, stat.stat_type, stat.team_association)
                   from public.playerboard_veo_match_stats stat
                  where stat.fixture_id = mapped.fixture_id), '[]'::jsonb),
               'players', coalesce((
                 select jsonb_agg(
                          case when public_labels then jsonb_build_object(
                            'jerseyNumber', assignment.veo_jersey_number,
                            'label', coalesce(public.playerboard_public_label(player.directory_person_id, assignment.veo_jersey_number, target_team_id),
                                              '#' || assignment.veo_jersey_number::text),
                            'stats', stats.items)
                          else jsonb_build_object(
                            'jerseyNumber', assignment.veo_jersey_number,
                            'playerId', assignment.player_id,
                            'name', case when person.id is null then null else concat_ws(' ', person.first_name, person.last_name) end,
                            'matchedManually', assignment.matched_manually,
                            'stats', stats.items)
                          end
                          order by assignment.veo_jersey_number)
                   from public.playerboard_veo_player_assignments assignment
                   left join public.playerboard_players player on player.id = assignment.player_id
                   left join public.directory_people person on person.id = player.directory_person_id
                   cross join lateral (
                     select coalesce(jsonb_agg(jsonb_build_object('statType', stat.stat_type, 'category', stat.category, 'value', stat.value)
                                               order by stat.stat_type), '[]'::jsonb) as items
                       from public.playerboard_veo_player_stats stat
                      where stat.assignment_id = assignment.id
                   ) stats
                  where assignment.fixture_id = mapped.fixture_id
                    and (not public_labels or stats.items <> '[]'::jsonb)), '[]'::jsonb)
             ) - case when public_labels then 'fixtureId' else '' end as match_json
        from public.playerboard_veo_matches mapped
        join public.fixtures fixture on fixture.id = mapped.fixture_id
        join public.organizations organization on organization.id = mapped.organization_id
       where mapped.team_id = target_team_id
         and (from_date is null or (fixture.kickoff_at at time zone organization.timezone)::date >= from_date)
         and (to_date is null or (fixture.kickoff_at at time zone organization.timezone)::date <= to_date)
    ) matches;
$$;
revoke all on function authz.playerboard_veo_matches_json(uuid, date, date, boolean) from public;
