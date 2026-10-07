begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

set local role postgres;

-- Paket 052, PR 2: Bausteine fuer die PlayerBoard-API (2026100901_playerboard_api_support.sql).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '52100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-pb-api.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '52100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@pgtap-pb-api.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values ('52100000-1000-4000-8000-000000000001', 'PGTAP PB API', 'pgtap-pb-api');
insert into public.departments (id, organization_id, name, slug) values
  ('52100000-1100-4000-8000-000000000001', '52100000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('52100000-1200-4000-8000-000000000001', '52100000-1000-4000-8000-000000000001', '52100000-1100-4000-8000-000000000001', 'U13');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('52100000-1000-4000-8000-000000000001', '52100000-1100-4000-8000-000000000001', '52100000-1200-4000-8000-000000000001', '52100000-0000-4000-8000-000000000001', 'team_manager'),
  ('52100000-1000-4000-8000-000000000001', '52100000-1100-4000-8000-000000000001', '52100000-1200-4000-8000-000000000001', '52100000-0000-4000-8000-000000000002', 'player');
insert into public.playerboard_point_categories (id, organization_id, scope, name, value_min, value_max) values
  ('52100000-4000-4000-8000-000000000001', '52100000-1000-4000-8000-000000000001', 'organization', 'Fairness', 0, 5);
insert into public.playerboard_trainings (id, organization_id, department_id, team_id, training_date, status) values
  ('52100000-5000-4000-8000-000000000001', '52100000-1000-4000-8000-000000000001', '52100000-1100-4000-8000-000000000001', '52100000-1200-4000-8000-000000000001', current_date - 1, 'saved');

-- 1-3: Spieler anlegen legt Verzeichnisperson und Kader-Eintrag in einem Schritt an.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select isnt(
  (select id from public.playerboard_create_player('52100000-1200-4000-8000-000000000001', ' Mia ', 'Keller', 2014, true, ' Mia@Example.local ', 7, 'Sturm', '52100000-0000-4000-8000-000000000001')),
  null, 'playerboard_create_player returns the new squad entry'
);
set local role postgres;
select results_eq(
  $$select first_name, team_id, is_minor, email from public.directory_people where organization_id = '52100000-1000-4000-8000-000000000001'$$,
  $$values ('Mia'::text, '52100000-1200-4000-8000-000000000001'::uuid, true, 'mia@example.local'::text)$$,
  'the directory person lands in the team, trimmed and with a normalized e-mail'
);
select is((select jersey_number from public.playerboard_players where organization_id = '52100000-1000-4000-8000-000000000001'), 7,
  'the squad entry carries the jersey number');

-- 4-7: Punkte eines Trainings, alles oder nichts.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '52100000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.playerboard_set_training_points('52100000-5000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('playerId', (select id from public.playerboard_players limit 1), 'categoryId', '52100000-4000-4000-8000-000000000001', 'value', 4)))),
  1, 'a coach saves the points of a training'
);
select throws_ok(
  format($$select * from public.playerboard_set_training_points('52100000-5000-4000-8000-000000000001',
    '[{"playerId": "%s", "categoryId": "52100000-4000-4000-8000-000000000001", "value": 2},
      {"playerId": "%s", "categoryId": "52100000-4000-4000-8000-000000000001", "value": 9}]')$$,
    (select id from public.playerboard_players limit 1), (select id from public.playerboard_players limit 1)),
  'P0001', 'point_value_out_of_range', 'one invalid value rejects the whole save'
);
select is((select value from public.playerboard_point_entries limit 1), 4, 'the earlier value survives a rejected save');
select is(
  (select count(*)::integer from public.playerboard_set_training_points('52100000-5000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('playerId', (select id from public.playerboard_players limit 1), 'categoryId', '52100000-4000-4000-8000-000000000001', 'value', null)))),
  0, 'a null value deletes the entry'
);

-- 8: ein Spieler speichert keine Punkte.
select set_config('request.jwt.claim.sub', '52100000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select * from public.playerboard_set_training_points('52100000-5000-4000-8000-000000000001', '[]')$$,
  'P0001', 'insufficient_permission', 'a player cannot save points'
);

-- 9: die Sichtpruefung fuer die API haengt am Aufrufer.
select ok(public.playerboard_can_view_stats('52100000-1200-4000-8000-000000000001'), 'a player may view the stats of the own team');

-- 10-11: Upload-Reservierung mit Pfad aus Verein/Mannschaft/Training, zaehlt aufs Kontingent.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (select storage_path from public.playerboard_reserve_photo_upload('52100000-7000-4000-8000-000000000001', '52100000-5000-4000-8000-000000000001', 'image/png', 2048, '52100000-0000-4000-8000-000000000001')),
  '52100000-1000-4000-8000-000000000001/52100000-1200-4000-8000-000000000001/52100000-5000-4000-8000-000000000001/52100000-7000-4000-8000-000000000001.png',
  'the reservation stores the photo under organization/team/training'
);
select is((select training_photos from public.storage_usage_breakdown('52100000-1000-4000-8000-000000000001', null, '52100000-1200-4000-8000-000000000001')), 2048::bigint,
  'the reserved bytes count as training photos in the storage breakdown');

-- 12: ein zu grosser Abschluss scheitert.
select throws_ok(
  $$select public.playerboard_complete_photo_upload('52100000-7000-4000-8000-000000000001', 2049)$$,
  'P0001', 'photo_size_exceeds_reservation', 'an upload cannot exceed its reserved size'
);

-- 13: ein Review vor abgeschlossenem Upload scheitert.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '52100000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.playerboard_review_photo_consent('52100000-7000-4000-8000-000000000001', '[]', true, false)$$,
  'P0001', 'photo_upload_incomplete', 'a photo cannot be reviewed before its upload is complete'
);

-- 14-15: der Abschluss prueft die Reservierung und ein zweiter Aufruf bleibt idempotent.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  public.playerboard_complete_photo_upload('52100000-7000-4000-8000-000000000001', 2048),
  true, 'the upload is completed after the verified size check'
);
select is(
  public.playerboard_complete_photo_upload('52100000-7000-4000-8000-000000000001', 1024),
  false, 'a repeated completion does not update the upload again'
);

-- 16-17: nach Abschluss geht der Review; oeffentlich nur mit allem zusammen.
set local role authenticated;
select is(
  (select consent_review_status from public.playerboard_review_photo_consent('52100000-7000-4000-8000-000000000001', '[]', true, true)),
  'approved', 'a completed photo without recognizable people can be approved'
);
set local role postgres;
select throws_ok(
  $$update public.playerboard_training_photos set upload_completed_at = null where id = '52100000-7000-4000-8000-000000000001'$$,
  '23514', null, 'a public photo must keep a completed upload'
);

select * from finish();
rollback;
