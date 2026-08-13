begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '39000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'persona-creator@test.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '39000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'persona-reader@test.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('39000000-1000-4000-8000-000000000001', 'Persona Organization', 'persona-organization');
insert into public.departments (id, organization_id, name, slug) values
  ('39000000-1100-4000-8000-000000000001', '39000000-1000-4000-8000-000000000001', 'Persona Department', 'persona-department');

insert into public.platform_style_personas (id, slug, name, description, style_rules, avoid_rules, created_by) values
  ('39000000-2000-4000-8000-000000000001', 'kapitaen-klar', 'Kapitän Klar', 'Direkt und anfeuernd wie ein Kapitän.', '{"sentenceLength":"short","energy":4,"humour":"light","formality":"casual","perspective":"we","bannedPhrases":[],"additionalInstructions":""}', '{Ironie}', '39000000-0000-4000-8000-000000000001');

-- RLS: select is unrestricted for any authenticated user, no organizational scope involved.
set local role authenticated;
select set_config('request.jwt.claim.sub', '39000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.platform_style_personas where id = '39000000-2000-4000-8000-000000000001'), 1, 'any authenticated user can read a platform persona, independent of organization membership');

-- RLS: no write policy exists for authenticated -- only service_role may write.
select throws_ok(
  $$insert into public.platform_style_personas (slug, name, description, style_rules, created_by) values ('blocked-write', 'Blocked write', 'Must use privileged API', '{}', '39000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'negative: authenticated role cannot insert a platform persona directly'
);
select throws_ok(
  $$update public.platform_style_personas set name = 'Renamed' where id = '39000000-2000-4000-8000-000000000001'$$,
  '42501', null, 'negative: authenticated role cannot update a platform persona directly'
);
select throws_ok(
  $$delete from public.platform_style_personas where id = '39000000-2000-4000-8000-000000000001'$$,
  '42501', null, 'negative: authenticated role cannot delete a platform persona directly'
);

set local role postgres;

-- Slug form and length checks, mirroring content_style_profiles' own slug CHECK.
select throws_ok(
  $$insert into public.platform_style_personas (slug, name, description, style_rules, created_by) values ('Not-Lowercase', 'Invalid', 'Must fail', '{}', '39000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a slug with uppercase characters'
);
select throws_ok(
  $$insert into public.platform_style_personas (slug, name, description, style_rules, created_by) values (repeat('a', 65), 'Invalid', 'Must fail', '{}', '39000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a slug longer than 64 characters'
);

-- Field boundaries on name/description.
select throws_ok(
  $$insert into public.platform_style_personas (slug, name, description, style_rules, created_by) values ('leerer-name', '', 'Must fail', '{}', '39000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects an empty name'
);
select throws_ok(
  $$insert into public.platform_style_personas (slug, name, description, style_rules, created_by) values ('lange-beschreibung', 'Invalid', repeat('a', 501), '{}', '39000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a description longer than 500 characters'
);

-- avoid_rules cardinality/length, via the reused text_array_elements_within_length helper.
select throws_ok(
  $$insert into public.platform_style_personas (slug, name, description, style_rules, avoid_rules, created_by) values ('null-avoid-rule', 'Invalid', 'Must fail', '{}', array[null]::text[], '39000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a null element in avoid_rules'
);
select throws_ok(
  $$insert into public.platform_style_personas (slug, name, description, style_rules, avoid_rules, created_by) values ('blank-avoid-rule', 'Invalid', 'Must fail', '{}', array['   '], '39000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a whitespace-only element in avoid_rules'
);
select throws_ok(
  $$insert into public.platform_style_personas (slug, name, description, style_rules, avoid_rules, created_by) values ('too-many-avoid-rules', 'Invalid', 'Must fail', '{}', array(select 'r' || generate_series(1, 31)::text), '39000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects more than 30 avoid_rules elements'
);

-- The five hardcoded system modes stay reserved for a persona slug too.
select throws_ok(
  $$insert into public.platform_style_personas (slug, name, description, style_rules, created_by) values ('klar_erklaerend', 'Duplikat', 'Must fail', '{}', '39000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a persona shadowing a reserved system slug'
);

-- Bidirectional slug collision protection between the two tables.
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, created_by) values ('39000000-1000-4000-8000-000000000001', '39000000-1100-4000-8000-000000000001', 'kapitaen-klar', 'Kollision', 'Must fail', '{}', '39000000-0000-4000-8000-000000000001')$$,
  'P0001', 'slug kapitaen-klar is reserved by a platform persona', 'negative: a club style profile cannot reuse a slug already used by a platform persona'
);
insert into public.content_style_profiles (id, organization_id, department_id, slug, name, description, style_rules, created_by) values
  ('39000000-3000-4000-8000-000000000001', '39000000-1000-4000-8000-000000000001', '39000000-1100-4000-8000-000000000001', 'unser-vereinston', 'Unser Vereinston', 'Bereits bestehendes Vereinsprofil', '{}', '39000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.platform_style_personas (slug, name, description, style_rules, created_by) values ('unser-vereinston', 'Kollision', 'Must fail', '{}', '39000000-0000-4000-8000-000000000001')$$,
  'P0001', 'slug unser-vereinston is already used by a club style profile', 'negative: a platform persona cannot reuse a slug already used by an existing club style profile'
);

-- Duplicate slugs within the persona table itself are rejected by the plain unique constraint.
select throws_ok(
  $$insert into public.platform_style_personas (slug, name, description, style_rules, created_by) values ('kapitaen-klar', 'Duplikat', 'Must fail', '{}', '39000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'negative: database rejects a duplicate persona slug'
);

select * from finish();
rollback;
