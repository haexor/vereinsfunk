begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-website.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('76000000-1000-4000-8000-000000000001', 'PGTAP Website Verein', 'pgtap-website-verein'),
  ('76000000-1000-4000-8000-000000000002', 'PGTAP Website Fremdverein', 'pgtap-website-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('76000000-1100-4000-8000-000000000001', '76000000-1000-4000-8000-000000000001', 'Marketing', 'marketing');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('76000000-1000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001', 'organization_admin');

-- 1: a website channel needs no external_account_id and no social_connection_secrets row.
insert into public.social_connections (id, organization_id, platform, website_url, display_name, owner_scope) values
  ('76000000-8000-4000-8000-000000000001', '76000000-1000-4000-8000-000000000001', 'website', 'https://verein.example/blog', 'Vereinsblog', 'organization');
select is((select count(*)::integer from public.social_connection_secrets where social_connection_id = '76000000-8000-4000-8000-000000000001'), 0,
  'a website channel has no social_connection_secrets row');

-- 2: an instagram/facebook channel still requires external_account_id.
select throws_ok(
  $$insert into public.social_connections (organization_id, platform, external_account_id, display_name, owner_scope)
    values ('76000000-1000-4000-8000-000000000001', 'instagram', null, 'Ohne Konto', 'organization')$$,
  '23514', null, 'negative: an instagram channel without external_account_id is rejected'
);

-- 3-4: website_url and external_account_id are mutually exclusive, not just one-sidedly enforced.
select throws_ok(
  $$insert into public.social_connections (organization_id, platform, external_account_id, website_url, display_name, owner_scope)
    values ('76000000-1000-4000-8000-000000000001', 'website', 'ext-should-not-exist', 'https://verein.example/zweitblog', 'Blog mit Konto-ID', 'organization')$$,
  '23514', null, 'negative: a website channel with an external_account_id is rejected'
);
select throws_ok(
  $$insert into public.social_connections (organization_id, platform, external_account_id, website_url, display_name, owner_scope)
    values ('76000000-1000-4000-8000-000000000001', 'instagram', 'ext-with-url', 'https://verein.example/sollte-nicht-gehen', 'Instagram mit URL', 'organization')$$,
  '23514', null, 'negative: an instagram channel with a website_url is rejected'
);

-- 5: a website_url must be https.
select throws_ok(
  $$insert into public.social_connections (organization_id, platform, website_url, display_name, owner_scope)
    values ('76000000-1000-4000-8000-000000000001', 'website', 'http://verein.example/unsicher', 'Unsicherer Blog', 'organization')$$,
  '23514', null, 'negative: a non-https website_url is rejected'
);

-- 6-7: max_characters stays within the same 100..10000 span as text_generation_platform_defaults.
select throws_ok(
  $$update public.social_connections set max_characters = 99 where id = '76000000-8000-4000-8000-000000000001'$$,
  '23514', null, 'negative: max_characters below 100 is rejected'
);
select throws_ok(
  $$update public.social_connections set max_characters = 10001 where id = '76000000-8000-4000-8000-000000000001'$$,
  '23514', null, 'negative: max_characters above 10000 is rejected'
);
update public.social_connections set max_characters = 1500 where id = '76000000-8000-4000-8000-000000000001';
select is((select max_characters from public.social_connections where id = '76000000-8000-4000-8000-000000000001'), 1500,
  'a per-channel max_characters within range is accepted');

-- 8-9: oauth_states/oauth_pending_connections stay instagram/facebook-only -- a website channel
-- never originates from the OAuth callback.
select throws_ok(
  format($$insert into public.oauth_states (organization_id, platform, owner_scope, nonce, created_by, expires_at)
    values ('76000000-1000-4000-8000-000000000001', 'website', 'organization', 'pgtap-website-nonce', %L, now() + interval '10 minutes')$$, '76000000-0000-4000-8000-000000000001'),
  '23514', null, 'negative: oauth_states still rejects platform=website'
);
select throws_ok(
  format($$insert into public.oauth_pending_connections (organization_id, platform, owner_scope, available_accounts, created_by, expires_at)
    values ('76000000-1000-4000-8000-000000000001', 'website', 'organization', '[]'::jsonb, %L, now() + interval '10 minutes')$$, '76000000-0000-4000-8000-000000000001'),
  '23514', null, 'negative: oauth_pending_connections still rejects platform=website'
);

-- 10-11: the same address cannot be added twice for the same club, but any number of distinct
-- addresses -- and the very same address for a DIFFERENT club -- are fine (Entwurfsentscheidung 4).
select throws_ok(
  $$insert into public.social_connections (organization_id, platform, website_url, display_name, owner_scope)
    values ('76000000-1000-4000-8000-000000000001', 'website', 'https://verein.example/blog', 'Zweiter Eintrag', 'organization')$$,
  '23505', null, 'negative: the same website_url twice for one club violates the unique index'
);
insert into public.social_connections (id, organization_id, platform, website_url, display_name, owner_scope, owner_department_id) values
  ('76000000-8000-4000-8000-000000000002', '76000000-1000-4000-8000-000000000001', 'website', 'https://marketing.verein.example/blog', 'Abteilungsblog', 'department', '76000000-1100-4000-8000-000000000001'),
  ('76000000-8000-4000-8000-000000000003', '76000000-1000-4000-8000-000000000002', 'website', 'https://verein.example/blog', 'Fremdvereins-Blog mit derselben Adresse', 'organization', null);
select is((select count(*)::integer from public.social_connections where platform = 'website'), 3,
  'a department-owned blog and the same address under a different club are both accepted');

-- 12: composition_sessions.target_platforms now accepts website (Plan 039 closes the dead end from
-- Plan 042 PR 3 for a club without an Instagram/Facebook channel).
insert into public.composition_sessions (id, organization_id, department_id, preset_slug, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, target_platforms, created_by) values
  ('76000000-4000-4000-8000-000000000001', '76000000-1000-4000-8000-000000000001', '76000000-1100-4000-8000-000000000001', 'training-update', 'inform', '["text_post"]', '{"facts":{"title":"Blog"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), array['website']::text[], '76000000-0000-4000-8000-000000000001');
select is((select target_platforms from public.composition_sessions where id = '76000000-4000-4000-8000-000000000001'), array['website']::text[],
  'a composition session may target website alone, with no Instagram/Facebook channel required');

select * from finish();
rollback;
