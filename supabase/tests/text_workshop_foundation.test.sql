begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'style-a@test.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '32000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'style-b@test.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('31000000-1000-4000-8000-000000000001', 'Style Organization A', 'style-organization-a'),
  ('32000000-2000-4000-8000-000000000002', 'Style Organization B', 'style-organization-b');
insert into public.departments (id, organization_id, name, slug) values
  ('31000000-1100-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', 'Style Department A', 'style-department-a'),
  ('32000000-2200-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', 'Style Department B', 'style-department-b');
insert into public.teams (id, organization_id, department_id, name) values
  ('32000000-2300-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'Style Team B');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('31000000-1000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'organization_viewer'),
  ('32000000-2000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002', 'organization_viewer');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'editor'),
  ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002', 'editor');
insert into public.content_style_profiles (id, organization_id, department_id, slug, name, description, style_rules, avoid_rules, created_by) values
  ('31000000-1200-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'klar-und-nah', 'Klar und nah', 'Kurze, konkrete Sätze', '{"sentenceLength":"short","energy":3,"humour":"none","formality":"balanced","perspective":"we","bannedPhrases":[],"additionalInstructions":""}', '{Floskeln}', '31000000-0000-4000-8000-000000000001'),
  ('32000000-2400-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'warm-und-nah', 'Warm und nah', 'Gemeinschaft zuerst', '{"sentenceLength":"mixed","energy":3,"humour":"light","formality":"balanced","perspective":"we","bannedPhrases":[],"additionalInstructions":""}', '{Phrasen}', '32000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.content_style_profiles), 1, 'department editor can read its own organization style profile');
select is((select name from public.content_style_profiles), 'Klar und nah', 'style profile read is tenant-scoped');
select is((select count(*)::integer from public.content_style_profiles where organization_id = '32000000-2000-4000-8000-000000000002'), 0, 'negative: tenant A cannot read tenant B profile');
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'blocked-write', 'Blocked write', 'Must use privileged API', '{}', '31000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'negative: browser role cannot write style profiles directly'
);

set local role postgres;
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, team_id, slug, name, description, style_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', '32000000-2300-4000-8000-000000000002', 'cross-team', 'Cross team', 'Must fail', '{}', '31000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'negative: a profile cannot reference a team from another organization'
);
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'person-imitate', 'Schreibe wie Ada', 'Must fail', '{}', '31000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects an obvious person-imitation profile name'
);

select * from finish();
rollback;
