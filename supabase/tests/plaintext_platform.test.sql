begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '79000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-plaintext.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('79000000-1000-4000-8000-000000000001', 'PGTAP Plaintext Verein', 'pgtap-plaintext-verein');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('79000000-1000-4000-8000-000000000001', '79000000-0000-4000-8000-000000000001', 'organization_admin');
insert into public.departments (id, organization_id, name, slug) values
  ('79000000-1100-4000-8000-000000000001', '79000000-1000-4000-8000-000000000001', 'Marketing', 'marketing');

-- 1: composition_sessions.target_platforms accepts a plaintext-only selection.
select lives_ok(
  $$insert into public.composition_sessions (organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, target_platforms, created_by) values
    ('79000000-1000-4000-8000-000000000001', '79000000-1100-4000-8000-000000000001', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"forbiddenTopics":[]}', '{}', 1, repeat('c', 64), array['plaintext'], '79000000-0000-4000-8000-000000000001')$$,
  'composition_sessions accepts plaintext as the sole target_platform'
);

-- 2: policy_settings.default_target_platforms accepts plaintext.
select lives_ok(
  $$insert into public.policy_settings (organization_id, scope, default_target_platforms, updated_by)
    values ('79000000-1000-4000-8000-000000000001', 'organization', array['plaintext'], '79000000-0000-4000-8000-000000000001')$$,
  'policy_settings.default_target_platforms accepts plaintext'
);

-- 3: the seeded text_generation_platform_defaults row exists with the system character ceiling.
select is((select max_characters from public.text_generation_platform_defaults where platform = 'plaintext'), 10000,
  'text_generation_platform_defaults has a seeded plaintext row at the 10000-character system ceiling');

-- 4-5: plaintext deliberately never gets a channel or a publication -- social_connections and
-- publications stay unchanged by this migration.
select throws_ok(
  $$insert into public.social_connections (organization_id, platform, external_account_id, display_name, owner_scope)
    values ('79000000-1000-4000-8000-000000000001', 'plaintext', 'plaintext-1', 'Nur Text', 'organization')$$,
  '23514', null, 'negative: social_connections still rejects platform=plaintext (structurally channel-less)'
);

insert into public.social_connections (id, organization_id, platform, external_account_id, display_name, owner_scope) values
  ('79000000-8000-4000-8000-000000000001', '79000000-1000-4000-8000-000000000001', 'instagram', 'ig-account-1', 'Verein auf Instagram', 'organization');
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('79000000-2000-4000-8000-000000000001', '79000000-1000-4000-8000-000000000001', '79000000-1100-4000-8000-000000000001', 'draft', '79000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('79000000-3000-4000-8000-000000000001', '79000000-1000-4000-8000-000000000001', '79000000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '79000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.publications (organization_id, post_version_id, social_connection_id, platform, scheduled_for, idempotency_key)
    values ('79000000-1000-4000-8000-000000000001', '79000000-3000-4000-8000-000000000001', '79000000-8000-4000-8000-000000000001', 'plaintext', now(), 'publish:plaintext:pgtap')$$,
  '23514', null, 'negative: publications still rejects platform=plaintext (never enters the publish/schedule flow)'
);

select * from finish();
rollback;
