begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

set local role postgres;

-- Test personas. handle_new_user() (2026080401_auth_bootstrap.sql) mirrors each auth.users
-- row into public.profiles automatically -- platform_admins.user_id references profiles(id),
-- so no separate profiles insert is needed here.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'defaultadmin@pgtap-platform.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'secondadmin@pgtap-platform.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'quotaowner@pgtap-platform.local', '', '{}', '{}', now(), now());

-- 1-2: authenticated has no privilege at all on platform_admins -- denied before RLS is even
-- evaluated (no GRANT was issued to authenticated/anon anywhere in the migration).
set local role authenticated;
select throws_ok(
  $$select * from public.platform_admins$$,
  '42501', null, 'authenticated cannot select from platform_admins'
);
select throws_ok(
  $$insert into public.platform_admins (user_id) values ('50000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'authenticated cannot insert into platform_admins'
);
set local role postgres;

-- 3-4: bootstrap_platform_admin
select throws_ok(
  $$select public.bootstrap_platform_admin('unknown@pgtap-platform.local')$$,
  'P0001', null, 'bootstrap_platform_admin rejects an unknown email'
);
select lives_ok(
  $$select public.bootstrap_platform_admin('defaultadmin@pgtap-platform.local')$$,
  'bootstrap_platform_admin succeeds for a known email'
);

-- 5: the created row is actually the default admin.
select is(
  (select is_default_admin from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000001'),
  true, 'the bootstrapped admin is the default admin'
);

-- 6: calling bootstrap again is a no-op (idempotent) -- still exactly one default admin.
select lives_ok(
  $$select public.bootstrap_platform_admin('secondadmin@pgtap-platform.local')$$,
  'a second bootstrap call does not raise'
);
select is(
  (select count(*)::integer from public.platform_admins where is_default_admin),
  1, 'still exactly one default admin after a second bootstrap call'
);
select is(
  (select count(*)::integer from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000002'),
  0, 'the second bootstrap call did not add secondadmin as a (non-default) admin either'
);

-- 7: the partial unique index rejects a second default admin, even inserted directly.
select throws_ok(
  $$insert into public.platform_admins (user_id, is_default_admin) values ('50000000-0000-4000-8000-000000000002', true)$$,
  '23505', null, 'a second default admin violates the partial unique index'
);

-- 8-10: add_platform_admin
select throws_ok(
  $$select public.add_platform_admin('unknown@pgtap-platform.local', '50000000-0000-4000-8000-000000000001')$$,
  'P0001', null, 'add_platform_admin rejects an unknown email'
);
select lives_ok(
  $$select public.add_platform_admin('secondadmin@pgtap-platform.local', '50000000-0000-4000-8000-000000000001')$$,
  'add_platform_admin succeeds for a known email'
);
select is(
  (select created_by from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000002'),
  '50000000-0000-4000-8000-000000000001', 'the new admin records who added it'
);
select lives_ok(
  $$select public.add_platform_admin('secondadmin@pgtap-platform.local', '50000000-0000-4000-8000-000000000001')$$,
  'calling add_platform_admin again for the same email does not raise (on conflict do nothing)'
);
select is(
  (select count(*)::integer from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000002'),
  1, 'still exactly one row for the same admin after the repeated call'
);

-- 11-12: the default admin cannot be deleted, a non-default admin can.
select throws_ok(
  $$delete from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'deleting the default admin is rejected'
);
select lives_ok(
  $$delete from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000002'$$,
  'deleting a non-default admin succeeds'
);

-- 13: platform_settings has no privilege for authenticated either.
set local role authenticated;
select throws_ok(
  $$select * from public.platform_settings$$,
  '42501', null, 'authenticated cannot select from platform_settings'
);
set local role postgres;

-- 14: the seeded default limit is present.
select is(
  (select (value::text)::integer from public.platform_settings where key = 'max_organizations_per_owner'),
  3, 'the seeded max_organizations_per_owner default is 3'
);

-- 15-16: create_organization() actually reads platform_settings, not a hardcoded constant --
-- lowering the limit to 1 blocks a second organization for a fresh owner.
update public.platform_settings set value = '1'::jsonb where key = 'max_organizations_per_owner';
set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000003', true);
select isnt(
  public.create_organization('PGTAP Platform Quota Org A', 'Abteilung'),
  null, 'the first organization succeeds under a lowered limit of 1'
);
select throws_ok(
  $$select public.create_organization('PGTAP Platform Quota Org B', 'Abteilung')$$,
  'P0001', null, 'a second organization fails once platform_settings lowers the limit to 1'
);
set local role postgres;
update public.platform_settings set value = '3'::jsonb where key = 'max_organizations_per_owner';

-- 17-18: organization_setting_overrides has no privilege for authenticated; postgres CRUD works.
set local role authenticated;
select throws_ok(
  $$select * from public.organization_setting_overrides$$,
  '42501', null, 'authenticated cannot select from organization_setting_overrides'
);
set local role postgres;
select lives_ok(
  $$insert into public.organization_setting_overrides (organization_id, key, value)
    select id, 'example_key', '"example_value"'::jsonb from public.organizations
    where slug = 'pgtap-platform-quota-org-a'$$,
  'postgres can insert an organization setting override'
);
select is(
  (select value from public.organization_setting_overrides ovr
     join public.organizations org on org.id = ovr.organization_id
   where org.slug = 'pgtap-platform-quota-org-a' and ovr.key = 'example_key'),
  '"example_value"'::jsonb, 'the override was actually persisted'
);

-- 19-21: subscription_plans has no privilege for authenticated; the seeded plan exists and
-- new organizations are assigned to it.
set local role authenticated;
select throws_ok(
  $$select * from public.subscription_plans$$,
  '42501', null, 'authenticated cannot select from subscription_plans'
);
set local role postgres;
select is(
  (select row(price_cents, is_active) from public.subscription_plans where name = 'Standard'),
  row(0, true), 'the seeded Standard plan has price 0 and is active'
);
select is(
  (select org.subscription_plan_id from public.organizations org where org.slug = 'pgtap-platform-quota-org-a'),
  (select id from public.subscription_plans where name = 'Standard'),
  'a newly created organization is assigned the Standard plan'
);

-- 22-23: llm_provider_configurations / llm_provider_secrets have no privilege for authenticated.
set local role authenticated;
select throws_ok(
  $$select * from public.llm_provider_configurations$$,
  '42501', null, 'authenticated cannot select from llm_provider_configurations'
);
select throws_ok(
  $$select * from public.llm_provider_secrets$$,
  '42501', null, 'authenticated cannot select from llm_provider_secrets'
);
set local role postgres;

-- 24: llm_provider_secrets actually has FORCE ROW LEVEL SECURITY set (structural regression
-- guard -- in this local, superuser-owned test harness FORCE cannot be demonstrated
-- behaviorally, since superusers always bypass RLS regardless; see plan document).
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.llm_provider_secrets'::regclass),
  'llm_provider_secrets has FORCE ROW LEVEL SECURITY enabled'
);

-- 25: postgres CRUD smoke on llm_provider_configurations + llm_provider_secrets.
select lives_ok(
  $$with cfg as (
      insert into public.llm_provider_configurations (label, protocol, base_url, model)
      values ('PGTAP Test Provider', 'anthropic', 'https://example.invalid', 'claude-test')
      returning id
    )
    insert into public.llm_provider_secrets (llm_provider_configuration_id, api_key_ciphertext, key_version)
    select id, '\x00', 'v1' from cfg$$,
  'postgres can insert an llm provider configuration with its secret row'
);

select * from finish();
rollback;
