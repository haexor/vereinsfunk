begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '73000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'defaults-reader@test.local', '', '{}', '{}', now(), now());

-- 2026081308's seed rows: Instagram's real caption limit, mirrored for Facebook (see migration).
select is((select max_characters from public.text_generation_platform_defaults where platform = 'instagram'), 2200, 'instagram ships with its real 2200 character caption limit');
select is((select max_characters from public.text_generation_platform_defaults where platform = 'facebook'), 2200, 'facebook ships with the same 2200 character limit');
-- 2026081310's seed row: the operator-chosen default for a website/blog channel (Plan 039).
select is((select max_characters from public.text_generation_platform_defaults where platform = 'website'), 5000, 'website ships with the operator-chosen 5000 character default');

-- RLS: select is unrestricted for any authenticated user (like platform_style_personas_select) --
-- the text workshop must show the value to prefill without the caller being a platform admin.
set local role authenticated;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.text_generation_platform_defaults), 3, 'any authenticated user can read all three platform defaults');

-- RLS: no write policy exists for authenticated -- only the service-role client behind
-- requirePlatformAdmin (PUT /v1/text-generation-platform-defaults/:platform) may write.
select throws_ok(
  $$update public.text_generation_platform_defaults set max_characters = 2000 where platform = 'instagram'$$,
  '42501', null, 'negative: authenticated role cannot update a platform default directly'
);
select throws_ok(
  $$insert into public.text_generation_platform_defaults (platform, max_characters) values ('threads', 2200)$$,
  '42501', null, 'negative: authenticated role cannot insert a platform default directly'
);
select throws_ok(
  $$delete from public.text_generation_platform_defaults where platform = 'instagram'$$,
  '42501', null, 'negative: authenticated role cannot delete a platform default directly'
);

set local role postgres;
select throws_ok(
  $$insert into public.text_generation_platform_defaults (platform, max_characters) values ('threads', 2200)$$,
  '23514', null, 'negative: only instagram/facebook/website are accepted platform values'
);
select throws_ok(
  $$update public.text_generation_platform_defaults set max_characters = 99 where platform = 'instagram'$$,
  '23514', null, 'negative: max_characters below 100 is rejected'
);
select throws_ok(
  $$update public.text_generation_platform_defaults set max_characters = 10001 where platform = 'instagram'$$,
  '23514', null, 'negative: max_characters above 10000 is rejected'
);

select * from finish();
rollback;
