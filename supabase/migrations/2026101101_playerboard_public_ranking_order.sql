-- Paket 052, PR 4: geteilte Plaetze der oeffentlichen Rangliste nach Rueckennummer ordnen, wie die
-- interne Rangliste. Bisher entschied der Text des Kuerzels, sodass "#10 T. I." vor "#3 L. B." stand.
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
