begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

set local role postgres;

-- Zwei Vereine fuer Mandantentrennung, je ein Verein mit zwei Abteilungen fuer den Kanalbesitz-Test
-- ("ein Abteilungsadmin darf ausschliesslich Kanaele freigeben, die seine EIGENE Abteilung besitzt").
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'vereinsleitung@pgtap-channels.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000000', '65000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'fussball-admin@pgtap-channels.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'marketing-admin@pgtap-channels.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'mitglied@pgtap-channels.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000098', 'authenticated', 'authenticated', 'fremdverein@pgtap-channels.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('65000000-1000-4000-8000-000000000001', 'PGTAP Channels Verein', 'pgtap-channels-verein'),
  ('65000000-1000-4000-8000-000000000002', 'PGTAP Channels Fremdverein', 'pgtap-channels-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('65000000-1100-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', 'Fußball', 'fussball'),
  ('65000000-1100-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', 'Marketing', 'marketing'),
  ('65000000-1100-4000-8000-000000000009', '65000000-1000-4000-8000-000000000002', 'Handball', 'handball');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('65000000-1000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', 'organization_admin');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', '65000000-0000-4000-8000-000000000002', 'department_admin'),
  ('65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000002', '65000000-0000-4000-8000-000000000003', 'department_admin'),
  ('65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', '65000000-0000-4000-8000-000000000004', 'contributor'),
  ('65000000-1000-4000-8000-000000000002', '65000000-1100-4000-8000-000000000009', '65000000-0000-4000-8000-000000000098', 'department_admin');

-- Vier Kanaele: C1 vereinseigen aktiv, C2 abteilungseigen (Marketing), C3 vereinseigen mit
-- action_required, C4 vereinseigen vertraulich.
insert into public.social_connections (id, organization_id, platform, external_account_id, display_name, owner_scope, owner_department_id, status, confidential) values
  ('65000000-8000-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', 'instagram', 'ext-c1', 'Verein Instagram', 'organization', null, 'active', false),
  ('65000000-8000-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', 'facebook', 'ext-c2', 'Marketing Facebook', 'department', '65000000-1100-4000-8000-000000000002', 'active', false),
  ('65000000-8000-4000-8000-000000000003', '65000000-1000-4000-8000-000000000001', 'instagram', 'ext-c3', 'Abgelaufen', 'organization', null, 'action_required', false),
  ('65000000-8000-4000-8000-000000000004', '65000000-1000-4000-8000-000000000001', 'instagram', 'ext-c4', 'Vertraulich', 'organization', null, 'active', true);

-- 1-2: Geheimnisse ausserhalb des Lesepfads (Plan 012, "Sicherheitsbefund zuerst").
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select * from public.social_connection_secrets$$,
  '42501', null, 'authenticated cannot select from social_connection_secrets'
);
select throws_ok(
  $$select token_ciphertext from public.social_connections limit 1$$,
  '42703', null, 'token_ciphertext no longer exists as a column on social_connections'
);

set local role postgres;
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.social_connection_secrets'::regclass),
  'social_connection_secrets has FORCE ROW LEVEL SECURITY enabled'
);

-- 4-6: Constraint-Regressionen aus dem Datenmodell.
select throws_ok(
  $$insert into public.channel_scopes (organization_id, social_connection_id, scope, department_id, team_id, created_by)
    values ('65000000-1000-4000-8000-000000000001', '65000000-8000-4000-8000-000000000001', 'department', null, null, '65000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'channel_scopes rejects scope=department without a department_id'
);
select throws_ok(
  $$insert into public.social_connections (organization_id, platform, external_account_id, display_name, owner_scope, owner_department_id)
    values ('65000000-1000-4000-8000-000000000001', 'instagram', 'ext-bad', 'Ohne Abteilung', 'department', null)$$,
  '23514', null, 'social_connections_owner_check rejects owner_scope=department without owner_department_id'
);
insert into public.channel_scopes (organization_id, social_connection_id, scope, department_id, team_id, created_by) values
  ('65000000-1000-4000-8000-000000000001', '65000000-8000-4000-8000-000000000001', 'organization', null, null, '65000000-0000-4000-8000-000000000001');
select throws_ok(
  format($$insert into public.channel_scopes (organization_id, social_connection_id, scope, department_id, team_id, created_by)
    values ('65000000-1000-4000-8000-000000000001', '65000000-8000-4000-8000-000000000001', 'organization', null, null, %L)$$, '65000000-0000-4000-8000-000000000001'),
  '23505', null, 'a second organization-wide channel_scopes row for the same connection violates the unique index'
);

-- 7-9: channel_scopes_insert -- massgeblich ist der Kanalbesitz, nicht die Ziel-Scope-Berechtigung
-- (Plan 012, "Zuordnung und Verantwortung").
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
insert into public.channel_scopes (organization_id, social_connection_id, scope, department_id, team_id, created_by) values
  ('65000000-1000-4000-8000-000000000001', '65000000-8000-4000-8000-000000000002', 'department', '65000000-1100-4000-8000-000000000002', null, '65000000-0000-4000-8000-000000000003');
select ok(true, 'the marketing admin grants scope for the channel their own department owns');

select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.channel_scopes (organization_id, social_connection_id, scope, department_id, team_id, created_by)
    values ('65000000-1000-4000-8000-000000000001', '65000000-8000-4000-8000-000000000002', 'department', '65000000-1100-4000-8000-000000000001', null, '65000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'the Fussball admin cannot grant scope for a channel owned by the Marketing department'
);

select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
insert into public.channel_scopes (organization_id, social_connection_id, scope, department_id, team_id, created_by) values
  ('65000000-1000-4000-8000-000000000001', '65000000-8000-4000-8000-000000000001', 'department', '65000000-1100-4000-8000-000000000001', null, '65000000-0000-4000-8000-000000000001');
select ok(true, 'the organization admin grants a department-level scope for the org-owned channel');

-- 10: Mandantentrennung -- ein Mitglied des Fremdvereins liest keine channel_scopes-Zeile.
set local role postgres;
insert into public.social_connections (id, organization_id, platform, external_account_id, display_name, owner_scope) values
  ('65000000-8000-4000-8000-000000000009', '65000000-1000-4000-8000-000000000002', 'instagram', 'ext-fremd', 'Fremd', 'organization');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000098', true);
select is((select count(*)::integer from public.channel_scopes where organization_id = '65000000-1000-4000-8000-000000000001'), 0,
  'a member of another club reads no channel_scopes row of this club');

-- Vier separate Posts (jeweils status='approved'), damit schedule_publication-Faelle sich nicht
-- gegenseitig durch Statuswechsel beeinflussen.
set local role postgres;
insert into public.posts (id, organization_id, department_id, status, created_by, current_version_id) values
  ('65000000-2000-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000001'),
  ('65000000-2000-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000002'),
  ('65000000-2000-4000-8000-000000000003', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000003'),
  ('65000000-2000-4000-8000-000000000004', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000004');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('65000000-3000-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001'),
  ('65000000-3000-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000002', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001'),
  ('65000000-3000-4000-8000-000000000003', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000003', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001'),
  ('65000000-3000-4000-8000-000000000004', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000004', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001');

-- 11: kein channel_scopes-Eintrag deckt Post P2 (Fussball) fuer C3 -- schedule_publication lehnt ab,
-- bevor der Statuscheck des Kanals ueberhaupt greift.
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.schedule_publication('65000000-3000-4000-8000-000000000002'::uuid, '65000000-8000-4000-8000-000000000003'::uuid, null)$$,
  'P0001', 'channel_not_allowed', 'schedule_publication rejects a channel with no channel_scopes grant covering the post''s department'
);

-- 12: C1 ist bereits organisationsweit freigegeben (Test 4) -- Einplanen auf P1 gelingt.
select is(
  (select status from public.schedule_publication('65000000-3000-4000-8000-000000000001'::uuid, '65000000-8000-4000-8000-000000000001'::uuid, null)),
  'queued', 'schedule_publication succeeds once an organization-wide channel_scopes grant exists'
);
set local role postgres;
select is((select status from public.posts where id = '65000000-2000-4000-8000-000000000001'), 'scheduled', 'the post moves to scheduled after a successful schedule_publication call');

-- 13: C3 (action_required) ist ebenfalls organisationsweit freigegeben, aber sein Status blockiert.
insert into public.channel_scopes (organization_id, social_connection_id, scope, department_id, team_id, created_by) values
  ('65000000-1000-4000-8000-000000000001', '65000000-8000-4000-8000-000000000003', 'organization', null, null, '65000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.schedule_publication('65000000-3000-4000-8000-000000000002'::uuid, '65000000-8000-4000-8000-000000000003'::uuid, null)$$,
  'P0001', 'channel_not_allowed', 'schedule_publication rejects a channel whose status is not active'
);

-- 14-15: require_channel_responsible blockt einen Kanal ohne verantwortliche Person, erlaubt ihn
-- sobald eine gesetzt ist.
set local role postgres;
insert into public.policy_settings (organization_id, scope, require_channel_responsible, updated_by) values
  ('65000000-1000-4000-8000-000000000001', 'organization', true, '65000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.schedule_publication('65000000-3000-4000-8000-000000000003'::uuid, '65000000-8000-4000-8000-000000000001'::uuid, null)$$,
  'P0001', 'channel_not_allowed', 'schedule_publication rejects a channel without a responsible person when the policy requires one'
);
set local role postgres;
update public.social_connections set responsible_profile_id = '65000000-0000-4000-8000-000000000001' where id = '65000000-8000-4000-8000-000000000001';
set local role authenticated;
select is(
  (select status from public.schedule_publication('65000000-3000-4000-8000-000000000003'::uuid, '65000000-8000-4000-8000-000000000001'::uuid, null)),
  'queued', 'schedule_publication succeeds once the required responsible person is set'
);

-- 16-17: authz.post_is_not_confidential_only. C4 braucht ebenfalls eine verantwortliche Person --
-- require_channel_responsible aus Test 14-15 gilt vereinsweit fort.
set local role postgres;
insert into public.channel_scopes (organization_id, social_connection_id, scope, department_id, team_id, created_by) values
  ('65000000-1000-4000-8000-000000000001', '65000000-8000-4000-8000-000000000004', 'organization', null, null, '65000000-0000-4000-8000-000000000001');
update public.social_connections set responsible_profile_id = '65000000-0000-4000-8000-000000000001' where id = '65000000-8000-4000-8000-000000000004';
set local role authenticated;
select is(
  (select status from public.schedule_publication('65000000-3000-4000-8000-000000000004'::uuid, '65000000-8000-4000-8000-000000000004'::uuid, null)),
  'queued', 'scheduling P4 exclusively on the confidential channel succeeds'
);
select is(authz.post_is_not_confidential_only('65000000-1000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000004'),
  false, 'a post published only to a confidential channel has no non-confidential publication');
select is(authz.post_is_not_confidential_only('65000000-1000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000001'),
  true, 'a post published to a non-confidential channel has a non-confidential publication');

-- 18-20: posts_select -- ein Beitrag, der ausschliesslich einen vertraulichen Kanal bedient, bleibt
-- bei der abteilungsweiten Sichtbarkeit (Plan 012, "Datenmodell"). Marketing (dept A2) hat keine
-- Mitgliedschaft in Fussball und keinen zugewiesenen Pruefer -- reiner Sichtbarkeitstest ueber
-- posts_visible_org_wide.
set local role postgres;
update public.posts set status = 'published' where id in ('65000000-2000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000004');
insert into public.policy_settings (organization_id, scope, posts_visible_org_wide, updated_by) values
  ('65000000-1000-4000-8000-000000000001', 'organization', true, '65000000-0000-4000-8000-000000000001')
  on conflict do nothing;
update public.policy_settings set posts_visible_org_wide = true where organization_id = '65000000-1000-4000-8000-000000000001' and scope = 'organization';
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.posts where id = '65000000-2000-4000-8000-000000000004'), 0,
  'a post published only to a confidential channel is not visible org-wide to a non-department member');
select is((select count(*)::integer from public.posts where id = '65000000-2000-4000-8000-000000000001'), 1,
  'a post published to a non-confidential channel is still visible org-wide (regression check)');
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.posts where id = '65000000-2000-4000-8000-000000000004'), 1,
  'a member of the owning department still sees the post regardless of channel confidentiality');

-- 21-22: set_policy_setting rejects the two channel flags outside organization scope, but accepts
-- them at organization scope (Plan 012: "eine Abteilung darf sich diese Erlaubnis nicht selbst geben").
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.set_policy_setting('65000000-1000-4000-8000-000000000001'::uuid, 'department', '65000000-1100-4000-8000-000000000001'::uuid, null, 'allow_department_owned_channels', true)$$,
  'P0001', 'organization_only_flag', 'set_policy_setting rejects allow_department_owned_channels at department scope'
);
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
select is(
  (select allow_department_owned_channels from public.set_policy_setting('65000000-1000-4000-8000-000000000001'::uuid, 'organization', null, null, 'allow_department_owned_channels', true)),
  true, 'set_policy_setting accepts allow_department_owned_channels at organization scope'
);

-- 23-24: flag_channels_needing_reconnect markiert nur Verbindungen, deren Token bald ablaeuft.
set local role postgres;
update public.social_connections set token_expires_at = now() + interval '2 days' where id = '65000000-8000-4000-8000-000000000001';
update public.social_connections set token_expires_at = now() + interval '30 days' where id = '65000000-8000-4000-8000-000000000002';
select is(public.flag_channels_needing_reconnect(), 1, 'flag_channels_needing_reconnect flags exactly the one connection expiring within the warning window');
select is((select status from public.social_connections where id = '65000000-8000-4000-8000-000000000001'), 'action_required',
  'the soon-to-expire connection is flagged action_required');
select is((select status from public.social_connections where id = '65000000-8000-4000-8000-000000000002'), 'active',
  'a connection expiring well outside the warning window is left active');

-- 25-27: cleanup_expired_oauth_state raeumt nur abgelaufene Zwischenzustaende weg.
insert into public.oauth_states (id, organization_id, platform, owner_scope, owner_department_id, nonce, created_by, expires_at) values
  ('65000000-9000-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', 'instagram', 'organization', null, 'expired-nonce', '65000000-0000-4000-8000-000000000001', now() - interval '1 hour'),
  ('65000000-9000-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', 'instagram', 'organization', null, 'fresh-nonce', '65000000-0000-4000-8000-000000000001', now() + interval '10 minutes');
insert into public.oauth_pending_connections (id, organization_id, platform, owner_scope, owner_department_id, available_accounts, created_by, expires_at) values
  ('65000000-9100-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', 'instagram', 'organization', null, '[]'::jsonb, '65000000-0000-4000-8000-000000000001', now() - interval '1 hour');
select public.cleanup_expired_oauth_state();
select is((select count(*)::integer from public.oauth_states where id = '65000000-9000-4000-8000-000000000001'), 0, 'cleanup_expired_oauth_state removes an expired oauth_states row');
select is((select count(*)::integer from public.oauth_states where id = '65000000-9000-4000-8000-000000000002'), 1, 'cleanup_expired_oauth_state leaves a not-yet-expired oauth_states row');
select is((select count(*)::integer from public.oauth_pending_connections where id = '65000000-9100-4000-8000-000000000001'), 0, 'cleanup_expired_oauth_state removes an expired oauth_pending_connections row');

select * from finish();
rollback;
