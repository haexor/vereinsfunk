begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '78000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-twitterlinkedin.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('78000000-1000-4000-8000-000000000001', 'PGTAP Twitter LinkedIn Verein', 'pgtap-twitterlinkedin-verein');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('78000000-1000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000001', 'organization_admin');

-- 1-2: a twitter/linkedin channel is accepted like instagram/facebook (external_account_id
-- required, no website_url) -- unlike a website channel, both entered via OAuth.
insert into public.social_connections (id, organization_id, platform, external_account_id, display_name, owner_scope) values
  ('78000000-8000-4000-8000-000000000001', '78000000-1000-4000-8000-000000000001', 'twitter', 'x-account-1', 'Verein auf X', 'organization'),
  ('78000000-8000-4000-8000-000000000002', '78000000-1000-4000-8000-000000000001', 'linkedin', 'li-org-1', 'Verein auf LinkedIn', 'organization');
select is((select count(*)::integer from public.social_connections where platform in ('twitter', 'linkedin')), 2,
  'twitter and linkedin channels are accepted');
select throws_ok(
  $$insert into public.social_connections (organization_id, platform, external_account_id, display_name, owner_scope)
    values ('78000000-1000-4000-8000-000000000001', 'mastodon', 'mastodon-1', 'Nicht unterstuetzt', 'organization')$$,
  '23514', null, 'negative: a still-unsupported platform (mastodon) remains rejected'
);

-- 3-4: oauth_states/oauth_pending_connections widen to twitter/linkedin (unlike website, which
-- Plan 039 deliberately left out -- a website channel never originates from OAuth).
select lives_ok(
  format($$insert into public.oauth_states (organization_id, platform, owner_scope, nonce, code_verifier, created_by, expires_at)
    values ('78000000-1000-4000-8000-000000000001', 'twitter', 'organization', 'pgtap-twitter-nonce', 'a-pkce-verifier', %L, now() + interval '10 minutes')$$, '78000000-0000-4000-8000-000000000001'),
  'oauth_states accepts platform=twitter with a PKCE code_verifier'
);
select lives_ok(
  format($$insert into public.oauth_pending_connections (organization_id, platform, owner_scope, available_accounts, created_by, expires_at)
    values ('78000000-1000-4000-8000-000000000001', 'linkedin', 'organization', '[]'::jsonb, %L, now() + interval '10 minutes')$$, '78000000-0000-4000-8000-000000000001'),
  'oauth_pending_connections accepts platform=linkedin'
);

-- 5: code_verifier stays null for a provider without PKCE (Meta/LinkedIn) -- no CHECK ties it to a
-- specific platform, the route decides.
insert into public.oauth_states (organization_id, platform, owner_scope, nonce, created_by, expires_at) values
  ('78000000-1000-4000-8000-000000000001', 'linkedin', 'organization', 'pgtap-linkedin-nonce', '78000000-0000-4000-8000-000000000001', now() + interval '10 minutes');
select is((select code_verifier from public.oauth_states where nonce = 'pgtap-linkedin-nonce'), null,
  'code_verifier stays null for a LinkedIn oauth_states row');

-- 6: website still never reaches oauth_states -- Plan 039's exclusion is unchanged by this package.
select throws_ok(
  format($$insert into public.oauth_states (organization_id, platform, owner_scope, nonce, created_by, expires_at)
    values ('78000000-1000-4000-8000-000000000001', 'website', 'organization', 'pgtap-website-nonce-045', %L, now() + interval '10 minutes')$$, '78000000-0000-4000-8000-000000000001'),
  '23514', null, 'negative: oauth_states still rejects platform=website'
);

-- 7-8: publications widens to twitter/linkedin -- unlike website, which Plan 039 deliberately kept
-- out until its own delivery mechanism exists.
insert into public.departments (id, organization_id, name, slug) values
  ('78000000-1100-4000-8000-000000000001', '78000000-1000-4000-8000-000000000001', 'Marketing', 'marketing');
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('78000000-2000-4000-8000-000000000001', '78000000-1000-4000-8000-000000000001', '78000000-1100-4000-8000-000000000001', 'draft', '78000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('78000000-3000-4000-8000-000000000001', '78000000-1000-4000-8000-000000000001', '78000000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '78000000-0000-4000-8000-000000000001');
select lives_ok(
  $$insert into public.publications (organization_id, post_version_id, social_connection_id, platform, scheduled_for, idempotency_key)
    values ('78000000-1000-4000-8000-000000000001', '78000000-3000-4000-8000-000000000001', '78000000-8000-4000-8000-000000000001', 'twitter', now(), 'publish:twitter:pgtap-045')$$,
  'publications accepts platform=twitter'
);
select throws_ok(
  $$insert into public.publications (organization_id, post_version_id, social_connection_id, platform, scheduled_for, idempotency_key)
    values ('78000000-1000-4000-8000-000000000001', '78000000-3000-4000-8000-000000000001', '78000000-8000-4000-8000-000000000002', 'website', now(), 'publish:website:pgtap-045')$$,
  '23514', null, 'negative: publications still rejects platform=website (Plan 039, no delivery mechanism yet)'
);

-- 9: composition_sessions.target_platforms accepts twitter/linkedin.
select lives_ok(
  $$insert into public.composition_sessions (organization_id, department_id, preset_slug, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, target_platforms, created_by) values
    ('78000000-1000-4000-8000-000000000001', '78000000-1100-4000-8000-000000000001', 'training-update', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('b', 64), array['twitter', 'linkedin'], '78000000-0000-4000-8000-000000000001')$$,
  'composition_sessions accepts twitter and linkedin as target_platforms'
);

-- 10: policy_settings.default_target_platforms accepts twitter/linkedin.
select lives_ok(
  $$insert into public.policy_settings (organization_id, scope, default_target_platforms, updated_by)
    values ('78000000-1000-4000-8000-000000000001', 'organization', array['twitter', 'linkedin'], '78000000-0000-4000-8000-000000000001')$$,
  'policy_settings.default_target_platforms accepts twitter and linkedin'
);

-- 11: the seeded text_generation_platform_defaults rows (see text_generation_platform_defaults.test.sql
-- for the exact values) exist for both new platforms.
select is((select count(*)::integer from public.text_generation_platform_defaults where platform in ('twitter', 'linkedin')), 2,
  'text_generation_platform_defaults has a seeded row for both twitter and linkedin');

select * from finish();
rollback;
