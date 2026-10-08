begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

set local role postgres;

-- Paket 052, PR 3: Einwilligungsstand des Kaders (2026101001_playerboard_photo_consents.sql).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '52300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-pb-consent.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values ('52300000-1000-4000-8000-000000000001', 'PGTAP PB Consent', 'pgtap-pb-consent');
insert into public.departments (id, organization_id, name, slug) values
  ('52300000-1100-4000-8000-000000000001', '52300000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('52300000-1200-4000-8000-000000000001', '52300000-1000-4000-8000-000000000001', '52300000-1100-4000-8000-000000000001', 'U13'),
  ('52300000-1200-4000-8000-000000000002', '52300000-1000-4000-8000-000000000001', '52300000-1100-4000-8000-000000000001', 'U15');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('52300000-1000-4000-8000-000000000001', '52300000-1100-4000-8000-000000000001', '52300000-1200-4000-8000-000000000001', '52300000-0000-4000-8000-000000000001', 'team_manager');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
-- Ada: volljaehrig, Website-Einwilligung. Ben: nur Social Media. Cem: minderjaehrig, selbst
-- unterschrieben. Dana: andere Mannschaft.
do $$
begin
  perform public.playerboard_create_player('52300000-1200-4000-8000-000000000001', 'Ada', 'Arnold', 1990, false, null, 1, null, '52300000-0000-4000-8000-000000000001');
  perform public.playerboard_create_player('52300000-1200-4000-8000-000000000001', 'Ben', 'Berg', 1990, false, null, 2, null, '52300000-0000-4000-8000-000000000001');
  perform public.playerboard_create_player('52300000-1200-4000-8000-000000000001', 'Cem', 'Celik', 2014, true, null, 3, null, '52300000-0000-4000-8000-000000000001');
  perform public.playerboard_create_player('52300000-1200-4000-8000-000000000002', 'Dana', 'Dorn', 1990, false, null, 4, null, '52300000-0000-4000-8000-000000000001');
end;
$$;

set local role postgres;
select set_config('request.jwt.claim.role', 'authenticated', true);
insert into public.consent_records (id, organization_id, directory_person_id, scope, scope_structured, origin, signer_role, created_by)
select record.id, '52300000-1000-4000-8000-000000000001', person.id, record.label, record.scope_structured::jsonb, 'paper', record.signer_role, '52300000-0000-4000-8000-000000000001'
  from (values
    ('52300000-6000-4000-8000-000000000001'::uuid, 'Ada', 'Website Training', '{"purposes": ["website"], "platforms": null, "mediaKinds": ["photo"], "contexts": ["training"], "namingAllowed": false, "departmentIds": null}', 'self'),
    ('52300000-6000-4000-8000-000000000002'::uuid, 'Ben', 'Nur Social Media', '{"purposes": ["social_media"], "platforms": null, "mediaKinds": ["photo"], "contexts": null, "namingAllowed": false, "departmentIds": null}', 'self'),
    ('52300000-6000-4000-8000-000000000003'::uuid, 'Cem', 'Website, selbst', '{"purposes": ["website"], "platforms": null, "mediaKinds": ["photo"], "contexts": null, "namingAllowed": false, "departmentIds": null}', 'self'),
    ('52300000-6000-4000-8000-000000000004'::uuid, 'Dana', 'Website', '{"purposes": ["website"], "platforms": null, "mediaKinds": ["photo"], "contexts": null, "namingAllowed": false, "departmentIds": null}', 'self')
  ) as record(id, first_name, label, scope_structured, signer_role)
  join public.directory_people person
    on person.organization_id = '52300000-1000-4000-8000-000000000001' and person.first_name = record.first_name;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- 1: genau der Kader der angefragten Mannschaft.
select is((select count(*)::integer from public.playerboard_team_photo_consents('52300000-1200-4000-8000-000000000001')), 3,
  'the list covers exactly the squad of the requested team');

-- 2-4: dieselbe Gueltigkeitspruefung wie im Foto-Review.
select is(
  (select consent.consent_record_id from public.playerboard_team_photo_consents('52300000-1200-4000-8000-000000000001') consent
     join public.directory_people person on person.id = consent.directory_person_id where person.first_name = 'Ada'),
  '52300000-6000-4000-8000-000000000001'::uuid, 'a website consent for photos counts');
select is(
  (select consent.consent_record_id from public.playerboard_team_photo_consents('52300000-1200-4000-8000-000000000001') consent
     join public.directory_people person on person.id = consent.directory_person_id where person.first_name = 'Ben'),
  null, 'a social media consent does not cover the public team page');
select is(
  (select consent.consent_record_id from public.playerboard_team_photo_consents('52300000-1200-4000-8000-000000000001') consent
     join public.directory_people person on person.id = consent.directory_person_id where person.first_name = 'Cem'),
  null, 'a minor needs a guardian signature');

-- 5: ein Widerruf wirkt sofort.
set local role postgres;
update public.consent_records set revoked_at = now(), revoked_by = 'self' where id = '52300000-6000-4000-8000-000000000001';
set local role service_role;
select is(
  (select count(*)::integer from public.playerboard_team_photo_consents('52300000-1200-4000-8000-000000000001') where consent_record_id is not null),
  0, 'a revoked consent no longer counts');

-- 6-7: nur die API ruft die Funktion auf.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '52300000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.playerboard_team_photo_consents('52300000-1200-4000-8000-000000000001')$$, '42501', null,
  'even a coach cannot call the function directly');
set local role anon;
select throws_ok($$select * from public.playerboard_team_photo_consents('52300000-1200-4000-8000-000000000001')$$, '42501', null,
  'anon cannot call the function');

select * from finish();
rollback;
