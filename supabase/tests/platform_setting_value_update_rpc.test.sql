begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-platform-setting-rpc.local', '', '{}', '{}', now(), now());

-- 1-2: a non-null value round-trips through the text-parameter + ::jsonb cast unchanged.
select is(
  (public.update_platform_setting_value('max_organizations_per_owner', '5', '71000000-0000-4000-8000-000000000001')).value,
  '5'::jsonb,
  'a plain number value is stored as the equivalent jsonb value'
);
select is(
  (select value from public.platform_settings where key = 'max_organizations_per_owner'),
  '5'::jsonb,
  'the row itself reflects the update'
);

-- 3-4: resetting agent_llm_provider_configuration_id to the jsonb null literal ("no override")
-- must not violate the column's `not null` constraint -- this is the bug this RPC exists to avoid
-- (PostgREST maps a JSON null in an update body to SQL NULL regardless of column type).
select lives_ok(
  $$select public.update_platform_setting_value('agent_llm_provider_configuration_id', 'null', null)$$,
  'setting the jsonb null literal via the text-parameter path does not violate the not-null constraint'
);
select is(
  (select value from public.platform_settings where key = 'agent_llm_provider_configuration_id'),
  'null'::jsonb,
  'the stored value is the jsonb null literal, not a missing/SQL-NULL row'
);

-- 5: an unknown key updates no row and returns null instead of erroring. is() compares composite
-- rows with `=`, which yields NULL (not true) for two NULL records -- ok()/is null sidesteps that.
select ok(
  public.update_platform_setting_value('unknown_key', '1', null) is null,
  'an unknown key returns null instead of erroring'
);

-- 6: only the service role may call the function directly -- the route's own
-- requirePlatformAdmin check is what actually gates this for a browser-facing admin.
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.update_platform_setting_value('max_organizations_per_owner', '5', null)$$,
  '42501', null, 'authenticated cannot call update_platform_setting_value directly'
);

select * from finish();
rollback;
