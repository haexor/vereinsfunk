begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '52700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-pb-slug.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug)
values ('52700000-1000-4000-8000-000000000001', 'PGTAP PB Slug', 'pgtap-pb-slug');
insert into public.departments (id, organization_id, name, slug)
values ('52700000-1100-4000-8000-000000000001', '52700000-1000-4000-8000-000000000001', 'abcdefghijklmnopqrs B', 'pb-slug-dept');
insert into public.teams (id, organization_id, department_id, name)
values ('52700000-1200-4000-8000-000000000001', '52700000-1000-4000-8000-000000000001', '52700000-1100-4000-8000-000000000001', 'Team Name');
insert into public.playerboard_settings (organization_id, scope, department_id, team_id, public_slug, updated_by)
values ('52700000-1000-4000-8000-000000000001', 'team', '52700000-1100-4000-8000-000000000001', '52700000-1200-4000-8000-000000000001', 'ignored-manual-slug', '52700000-0000-4000-8000-000000000001');

select is(
  (select public_slug from public.playerboard_settings where team_id = '52700000-1200-4000-8000-000000000001'),
  'abcdefghijklmnopqrs-team-name-52700000-1200-4000-8000-000000000001',
  'generated slugs trim a hyphen left by truncating the department name'
);

update public.teams set name = 'U15' where id = '52700000-1200-4000-8000-000000000001';
select is(
  (select public_slug from public.playerboard_settings where team_id = '52700000-1200-4000-8000-000000000001'),
  'abcdefghijklmnopqrs-u15-52700000-1200-4000-8000-000000000001',
  'renaming a team refreshes its generated slug'
);

update public.departments set name = 'Handball' where id = '52700000-1100-4000-8000-000000000001';
select is(
  (select public_slug from public.playerboard_settings where team_id = '52700000-1200-4000-8000-000000000001'),
  'handball-u15-52700000-1200-4000-8000-000000000001',
  'renaming a department refreshes generated slugs for its teams'
);

select * from finish();
rollback;
