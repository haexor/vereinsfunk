begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

-- 2026101916: authz.is_user_member_of_organization beantwortet die Mitgliedschaftsfrage nur noch
-- fuer Vereine, denen der Aufrufer selbst angehoert.
set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'a8000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'mitglied@pgtap-membership-oracle.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a8000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'kollegin@pgtap-membership-oracle.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a8000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'fremd@pgtap-membership-oracle.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('a8000000-1000-4000-8000-000000000001', 'PGTAP Mitgliedschaft', 'pgtap-mitgliedschaft');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('a8000000-1000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('a8000000-1000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002', 'organization_viewer');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8000000-0000-4000-8000-000000000001', true);
select is(authz.is_user_member_of_organization('a8000000-0000-4000-8000-000000000002', 'a8000000-1000-4000-8000-000000000001'), true,
  'a member can check the membership of a colleague in the same club');

select set_config('request.jwt.claim.sub', 'a8000000-0000-4000-8000-000000000003', true);
select is(authz.is_user_member_of_organization('a8000000-0000-4000-8000-000000000002', 'a8000000-1000-4000-8000-000000000001'), false,
  'negative: an outsider cannot probe who belongs to a foreign club');

set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select is(authz.is_user_member_of_organization('a8000000-0000-4000-8000-000000000002', 'a8000000-1000-4000-8000-000000000001'), true,
  'the service role still resolves memberships');

select * from finish();
rollback;
