begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

set local role postgres;

-- Paket 052, PR 4: dichte Plaetze und Reihenfolge bei Gleichstand (2026101101_playerboard_ranking_places.sql).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '52400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-pb-rank.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values ('52400000-1000-4000-8000-000000000001', 'PGTAP PB Rank', 'pgtap-pb-rank');
insert into public.departments (id, organization_id, name, slug) values
  ('52400000-1100-4000-8000-000000000001', '52400000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('52400000-1200-4000-8000-000000000001', '52400000-1000-4000-8000-000000000001', '52400000-1100-4000-8000-000000000001', 'U13');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('52400000-1000-4000-8000-000000000001', '52400000-1100-4000-8000-000000000001', '52400000-1200-4000-8000-000000000001', '52400000-0000-4000-8000-000000000001', 'team_manager');
insert into public.playerboard_point_categories (id, organization_id, scope, name, value_min, value_max) values
  ('52400000-4000-4000-8000-000000000001', '52400000-1000-4000-8000-000000000001', 'organization', 'Einsatz', 0, 10);
insert into public.playerboard_trainings (id, organization_id, department_id, team_id, training_date, status) values
  ('52400000-5000-4000-8000-000000000001', '52400000-1000-4000-8000-000000000001', '52400000-1100-4000-8000-000000000001', '52400000-1200-4000-8000-000000000001', current_date - 1, 'saved');
insert into public.playerboard_settings (organization_id, scope, department_id, team_id, public_points_enabled, public_slug, updated_by) values
  ('52400000-1000-4000-8000-000000000001', 'team', '52400000-1100-4000-8000-000000000001', '52400000-1200-4000-8000-000000000001', true, 'u13', '52400000-0000-4000-8000-000000000001');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
begin
  perform public.playerboard_create_player('52400000-1200-4000-8000-000000000001', 'Ada', 'Arnold', 1990, false, null, 10, null, '52400000-0000-4000-8000-000000000001');
  perform public.playerboard_create_player('52400000-1200-4000-8000-000000000001', 'Ben', 'Berg', 1990, false, null, 9, null, '52400000-0000-4000-8000-000000000001');
  perform public.playerboard_create_player('52400000-1200-4000-8000-000000000001', 'Cem', 'Celik', 1990, false, null, 3, null, '52400000-0000-4000-8000-000000000001');
  perform public.playerboard_create_player('52400000-1200-4000-8000-000000000001', 'Dana', 'Dorn', 1990, false, null, 4, null, '52400000-0000-4000-8000-000000000001');
end;
$$;

-- Summen 10, 8, 8, 3: Ada vorn, Ben und Cem teilen Platz 2, Dana folgt ohne Luecke auf Platz 3.
set local role postgres;
insert into public.playerboard_point_entries (organization_id, training_id, player_id, category_id, value, created_by)
select '52400000-1000-4000-8000-000000000001', '52400000-5000-4000-8000-000000000001', player.id, '52400000-4000-4000-8000-000000000001', points.value, '52400000-0000-4000-8000-000000000001'
  from (values ('Ada', 10), ('Ben', 8), ('Cem', 8), ('Dana', 3)) as points(first_name, value)
  join public.directory_people person on person.organization_id = '52400000-1000-4000-8000-000000000001' and person.first_name = points.first_name
  join public.playerboard_players player on player.directory_person_id = person.id;

-- 1: dichte Plaetze ohne Luecke nach einem Gleichstand.
select results_eq(
  $$select rows.jersey_number, rows.rank from authz.playerboard_ranking_rows('52400000-1200-4000-8000-000000000001', null, null) rows order by rows.rank, rows.jersey_number$$,
  $$values (10, 1::bigint), (3, 2::bigint), (9, 2::bigint), (4, 3::bigint)$$,
  'a tie shares the place and the next place follows without a gap'
);

-- 2-3: oeffentlich dieselben Plaetze, geteilte Plaetze nach Rueckennummer statt nach Text des Kuerzels.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select results_eq(
  $$select rank, label from public.playerboard_public_ranking('pgtap-pb-rank', 'u13')$$,
  $$values (1::bigint, '#10 A. A.'::text), (2::bigint, '#3 C. C.'::text), (2::bigint, '#9 B. B.'::text), (3::bigint, '#4 D. D.'::text)$$,
  'the public ranking uses the same places and orders a tie by jersey number'
);
select is(
  (select max(rank) from public.playerboard_public_ranking('pgtap-pb-rank', 'u13')), 3::bigint,
  'four players with one tie end on place three, not four'
);

select * from finish();
rollback;
