-- Paket 052, PR 4: Platzierung der Rangliste.
--
-- 1. Dichte Plaetze (Betreiberentscheidung 2026-10-08): bei Gleichstand teilen sich Spieler einen
--    Platz, der naechste Platz folgt ohne Luecke -- 1, 1, 2, 2, 2, 2, 3, 3, 3, 4 statt
--    1, 1, 3, 3, 3, 3, 7, 7, 7, 10. So sind Gold, Silber und Bronze immer die Plaetze 1 bis 3.
create or replace function authz.playerboard_ranking_rows(target_team_id uuid, from_date date, to_date date)
returns table (player_id uuid, directory_person_id uuid, jersey_number integer, rank bigint, total bigint, category_totals jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with entries as (
    select entry.player_id, entry.category_id, sum(entry.value)::bigint as points
      from public.playerboard_point_entries entry
      join public.playerboard_trainings training
        on training.organization_id = entry.organization_id and training.id = entry.training_id
     where training.team_id = target_team_id
       and training.status = 'saved'
       and (from_date is null or training.training_date >= from_date)
       and (to_date is null or training.training_date <= to_date)
     group by entry.player_id, entry.category_id
  ), totals as (
    select player.id as player_id, player.directory_person_id, player.jersey_number,
           coalesce(sum(entries.points), 0)::bigint as total,
           coalesce(jsonb_object_agg(entries.category_id, entries.points) filter (where entries.category_id is not null), '{}'::jsonb) as category_totals
      from public.playerboard_players player
      left join entries on entries.player_id = player.id
     where player.team_id = target_team_id
     group by player.id, player.directory_person_id, player.jersey_number, player.active
    having player.active or count(entries.category_id) > 0
  )
  select totals.player_id, totals.directory_person_id, totals.jersey_number,
         dense_rank() over (order by totals.total desc), totals.total, totals.category_totals
    from totals;
$$;
revoke all on function authz.playerboard_ranking_rows(uuid, date, date) from public;

-- 2. Geteilte Plaetze der oeffentlichen Rangliste nach Rueckennummer ordnen, wie die interne
--    Rangliste. Bisher entschied der Text des Kuerzels, sodass "#10 T. I." vor "#3 L. B." stand.
create or replace function public.playerboard_public_ranking(org_slug text, team_slug text, from_date date default null, to_date date default null)
returns table (rank bigint, label text, total bigint, category_totals jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rows.rank,
         public.playerboard_public_label(rows.directory_person_id, rows.jersey_number),
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
