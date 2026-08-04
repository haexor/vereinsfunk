-- Deterministic local demo data. Never use these identities in staging or production.
-- confirmation_token/recovery_token/email_change_token_new/email_change have no column
-- default and stay NULL unless set explicitly; GoTrue's password grant then fails with
-- "converting NULL to string is unsupported" while scanning the user row.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'authenticated', 'authenticated', 'lena@example.local', crypt('local-demo-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Lena Müller"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'authenticated', 'authenticated', 'jonas@example.local', crypt('local-demo-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Jonas Weber"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into public.profiles (id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Lena Müller'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Jonas Weber')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug) values
  ('11111111-1111-4111-8111-111111111111', 'SV Nordstadt 1921', 'sv-nordstadt'),
  ('99999999-9999-4999-8999-999999999999', 'TSV Südstadt', 'tsv-suedstadt')
on conflict (id) do nothing;

insert into public.departments (id, organization_id, name, slug) values
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Fußball', 'fussball'),
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Handball', 'handball'),
  ('88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999', 'Fußball', 'fussball')
on conflict (id) do nothing;

insert into public.organization_memberships (organization_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'organization_owner'),
  ('99999999-9999-4999-8999-999999999999', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'organization_owner')
on conflict do nothing;

insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'department_admin')
on conflict do nothing;

insert into public.organization_brand_profiles (organization_id, primary_color, accent_color, tone)
values ('11111111-1111-4111-8111-111111111111', '#163a2c', '#caff4a', 'nahbar')
on conflict (organization_id) do nothing;
