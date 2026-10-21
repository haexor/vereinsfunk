begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-occasion.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('c5000000-1000-4000-8000-000000000001', 'PGTAP Anlass Verein', 'pgtap-anlass-verein'),
  ('c5000000-1000-4000-8000-000000000002', 'PGTAP Anlass Fremdverein', 'pgtap-anlass-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('c5000000-1100-4000-8000-000000000001', 'c5000000-1000-4000-8000-000000000001', 'Fussball', 'fussball'),
  ('c5000000-1100-4000-8000-000000000002', 'c5000000-1000-4000-8000-000000000002', 'Fussball', 'fussball');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('c5000000-1000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'organization_admin');

insert into public.fixtures (id, organization_id, department_id, is_home, opponent_name, kickoff_at, status) values
  ('c5000000-2000-4000-8000-000000000001', 'c5000000-1000-4000-8000-000000000001', 'c5000000-1100-4000-8000-000000000001', true, 'TSV Sued', now() + interval '2 days', 'scheduled'),
  ('c5000000-2000-4000-8000-000000000002', 'c5000000-1000-4000-8000-000000000002', 'c5000000-1100-4000-8000-000000000002', true, 'Fremdgegner', now() + interval '2 days', 'scheduled'),
  ('c5000000-2000-4000-8000-000000000003', 'c5000000-1000-4000-8000-000000000001', 'c5000000-1100-4000-8000-000000000001', false, 'FC Nord', now() + interval '3 days', 'scheduled');
insert into public.club_events (id, organization_id, department_id, title, category, starts_at) values
  ('c5000000-2100-4000-8000-000000000001', 'c5000000-1000-4000-8000-000000000001', null, 'Sommerfest', 'social', now() + interval '10 days');

insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('c5000000-3000-4000-8000-000000000001', 'c5000000-1000-4000-8000-000000000001', 'c5000000-1100-4000-8000-000000000001', 'draft', 'c5000000-0000-4000-8000-000000000001'),
  ('c5000000-3000-4000-8000-000000000002', 'c5000000-1000-4000-8000-000000000001', 'c5000000-1100-4000-8000-000000000001', 'draft', 'c5000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('c5000000-3100-4000-8000-000000000001', 'c5000000-1000-4000-8000-000000000001', 'c5000000-3000-4000-8000-000000000001', 1, '{}', '{}', 'user', 'c5000000-0000-4000-8000-000000000001'),
  ('c5000000-3100-4000-8000-000000000002', 'c5000000-1000-4000-8000-000000000001', 'c5000000-3000-4000-8000-000000000002', 1, '{}', '{}', 'user', 'c5000000-0000-4000-8000-000000000001');
insert into public.approval_requests (id, organization_id, post_id, post_version_id) values
  ('c5000000-3200-4000-8000-000000000001', 'c5000000-1000-4000-8000-000000000001', 'c5000000-3000-4000-8000-000000000001', 'c5000000-3100-4000-8000-000000000001'),
  ('c5000000-3200-4000-8000-000000000002', 'c5000000-1000-4000-8000-000000000001', 'c5000000-3000-4000-8000-000000000002', 'c5000000-3100-4000-8000-000000000002');

insert into public.composition_sessions (id, organization_id, department_id, post_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, target_platforms, created_by, fixture_id) values
  ('c5000000-4000-4000-8000-000000000001', 'c5000000-1000-4000-8000-000000000001', 'c5000000-1100-4000-8000-000000000001', 'c5000000-3000-4000-8000-000000000001', 'invite', '["text_post"]', '{"facts":{"opponent":"TSV Sued"},"observations":[],"quotes":[],"forbiddenTopics":[]}', '{}', 1, repeat('c', 64), array['instagram']::text[], 'c5000000-0000-4000-8000-000000000001', 'c5000000-2000-4000-8000-000000000001');
insert into public.composition_sessions (id, organization_id, department_id, post_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, target_platforms, created_by, club_event_id) values
  ('c5000000-4000-4000-8000-000000000002', 'c5000000-1000-4000-8000-000000000001', 'c5000000-1100-4000-8000-000000000001', 'c5000000-3000-4000-8000-000000000002', 'invite', '["text_post"]', '{"facts":{"title":"Sommerfest"},"observations":[],"quotes":[],"forbiddenTopics":[]}', '{}', 1, repeat('d', 64), array['instagram']::text[], 'c5000000-0000-4000-8000-000000000001', 'c5000000-2100-4000-8000-000000000001');

-- 1-3: der Anlass bleibt im eigenen Verein und ist entweder ein Spiel oder eine Veranstaltung.
select throws_ok(
  $$update public.composition_sessions set fixture_id = 'c5000000-2000-4000-8000-000000000002' where id = 'c5000000-4000-4000-8000-000000000001'$$,
  '23503', null, 'negative: a session cannot reference another club''s fixture'
);
select throws_ok(
  $$update public.composition_sessions set club_event_id = 'c5000000-2100-4000-8000-000000000001' where id = 'c5000000-4000-4000-8000-000000000001'$$,
  '23514', null, 'negative: a session references a fixture or a club event, not both'
);
select throws_ok(
  $$update public.composition_sessions set source_provenance = '[]'::jsonb where id = 'c5000000-4000-4000-8000-000000000001'$$,
  '23514', null, 'negative: source_provenance must be an object'
);

-- 4-6: eine Korrektur im Spielplan invalidiert die laufende Freigabe des Beitrags aus der Textwerkstatt.
update public.fixtures set note = 'nur eine Notiz' where id = 'c5000000-2000-4000-8000-000000000001';
select is((select invalidated_at from public.approval_requests where id = 'c5000000-3200-4000-8000-000000000001'), null,
  'an unrelated fixtures column leaves the approval open');
update public.fixtures set kickoff_at = kickoff_at + interval '1 hour' where id = 'c5000000-2000-4000-8000-000000000001';
select isnt((select invalidated_at from public.approval_requests where id = 'c5000000-3200-4000-8000-000000000001'), null,
  'a changed kickoff invalidates the approval of the linked text workshop post');
update public.club_events set location_name = 'Vereinsheim' where id = 'c5000000-2100-4000-8000-000000000001';
select isnt((select invalidated_at from public.approval_requests where id = 'c5000000-3200-4000-8000-000000000002'), null,
  'a changed event location invalidates the approval of the linked text workshop post');

-- 7: geloeschte Quellzeile laesst die Sitzung stehen und loest nur den Bezug.
delete from public.fixtures where id = 'c5000000-2000-4000-8000-000000000001';
select is((select fixture_id from public.composition_sessions where id = 'c5000000-4000-4000-8000-000000000001'), null,
  'deleting the fixture keeps the session and clears its fixture_id');

-- 8-9: Mitglieder sehen den Bezug, setzen ihn aber nicht selbst.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
select is((select club_event_id from public.composition_sessions where id = 'c5000000-4000-4000-8000-000000000002'), 'c5000000-2100-4000-8000-000000000001'::uuid,
  'a member reads the occasion of a session in their club');
select throws_ok(
  $$update public.composition_sessions set fixture_id = 'c5000000-2000-4000-8000-000000000003' where id = 'c5000000-4000-4000-8000-000000000001'$$,
  '42501', null, 'negative: members cannot set the occasion themselves'
);

select * from finish();
rollback;
