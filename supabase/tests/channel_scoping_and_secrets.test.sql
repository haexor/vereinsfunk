begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

set local role postgres;

-- Zwei Vereine fuer Mandantentrennung, je ein Verein mit zwei Abteilungen fuer den Kanalbesitz-Test
-- ("ein Abteilungsadmin darf ausschliesslich Kanaele freigeben, die seine EIGENE Abteilung besitzt").
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'vereinsleitung@pgtap-channels.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'fussball-admin@pgtap-channels.local', '', '{}', '{}', now(), now()),
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

-- 1-3: Geheimnisse ausserhalb des Lesepfads (Plan 012, "Sicherheitsbefund zuerst").
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

-- 12-13: C1 ist bereits organisationsweit freigegeben (Test 4) -- Einplanen auf P1 gelingt.
select is(
  (select status from public.schedule_publication('65000000-3000-4000-8000-000000000001'::uuid, '65000000-8000-4000-8000-000000000001'::uuid, null)),
  'queued', 'schedule_publication succeeds once an organization-wide channel_scopes grant exists'
);
set local role postgres;
select is((select status from public.posts where id = '65000000-2000-4000-8000-000000000001'), 'scheduled', 'the post moves to scheduled after a successful schedule_publication call');

-- 14: C3 (action_required) ist ebenfalls organisationsweit freigegeben, aber sein Status blockiert.
insert into public.channel_scopes (organization_id, social_connection_id, scope, department_id, team_id, created_by) values
  ('65000000-1000-4000-8000-000000000001', '65000000-8000-4000-8000-000000000003', 'organization', null, null, '65000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.schedule_publication('65000000-3000-4000-8000-000000000002'::uuid, '65000000-8000-4000-8000-000000000003'::uuid, null)$$,
  'P0001', 'channel_not_allowed', 'schedule_publication rejects a channel whose status is not active'
);

-- 15-16: require_channel_responsible blockt einen Kanal ohne verantwortliche Person, erlaubt ihn
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

-- 17-19: authz.post_is_not_confidential_only. C4 braucht ebenfalls eine verantwortliche Person --
-- require_channel_responsible aus Test 15-16 gilt vereinsweit fort.
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

-- 20-22: posts_select -- ein Beitrag, der ausschliesslich einen vertraulichen Kanal bedient, bleibt
-- bei der abteilungsweiten Sichtbarkeit (Plan 012, "Datenmodell"). Marketing (dept A2) hat keine
-- Mitgliedschaft in Fussball und keinen zugewiesenen Pruefer -- reiner Sichtbarkeitstest ueber
-- posts_visible_org_wide.
set local role postgres;
update public.posts set status = 'published' where id in ('65000000-2000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000004');
-- Die Vereinszeile existiert bereits aus Test 15-16; policy_settings_org_unique laesst je Verein
-- ohnehin nur eine zu, deshalb hier nur ein update statt eines zweiten insert.
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

-- 23-24: set_policy_setting rejects the two channel flags outside organization scope, but accepts
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

-- 25-27: flag_channels_needing_reconnect markiert nur Verbindungen, deren Token bald ablaeuft.
set local role postgres;
update public.social_connections set token_expires_at = now() + interval '2 days' where id = '65000000-8000-4000-8000-000000000001';
update public.social_connections set token_expires_at = now() + interval '30 days' where id = '65000000-8000-4000-8000-000000000002';
select is(public.flag_channels_needing_reconnect(), 1, 'flag_channels_needing_reconnect flags exactly the one connection expiring within the warning window');
select is((select status from public.social_connections where id = '65000000-8000-4000-8000-000000000001'), 'action_required',
  'the soon-to-expire connection is flagged action_required');
select is((select status from public.social_connections where id = '65000000-8000-4000-8000-000000000002'), 'active',
  'a connection expiring well outside the warning window is left active');

-- 28-30: cleanup_expired_oauth_state raeumt nur abgelaufene Zwischenzustaende weg.
insert into public.oauth_states (id, organization_id, platform, owner_scope, owner_department_id, nonce, created_by, expires_at) values
  ('65000000-9000-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', 'instagram', 'organization', null, 'expired-nonce', '65000000-0000-4000-8000-000000000001', now() - interval '1 hour'),
  ('65000000-9000-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', 'instagram', 'organization', null, 'fresh-nonce', '65000000-0000-4000-8000-000000000001', now() + interval '10 minutes');
insert into public.oauth_pending_connections (id, organization_id, platform, owner_scope, owner_department_id, available_accounts, created_by, expires_at) values
  ('65000000-9100-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', 'instagram', 'organization', null, '[]'::jsonb, '65000000-0000-4000-8000-000000000001', now() - interval '1 hour');
select public.cleanup_expired_oauth_state();
select is((select count(*)::integer from public.oauth_states where id = '65000000-9000-4000-8000-000000000001'), 0, 'cleanup_expired_oauth_state removes an expired oauth_states row');
select is((select count(*)::integer from public.oauth_states where id = '65000000-9000-4000-8000-000000000002'), 1, 'cleanup_expired_oauth_state leaves a not-yet-expired oauth_states row');
select is((select count(*)::integer from public.oauth_pending_connections where id = '65000000-9100-4000-8000-000000000001'), 0, 'cleanup_expired_oauth_state removes an expired oauth_pending_connections row');

-- 31: leere allowedChannelIds-Liste heisst "nichts erlaubt", nicht "keine Einschraenkung" (Plan 011,
-- "Zusammenfuehrung der Ebenen"). C4 ist vereinsweit freigegeben, aktiv und hat eine verantwortliche
-- Person -- alle Pruefungen vor der Kanalliste sind also erfuellt, es kann nur an ihr scheitern.
set local role postgres;
insert into public.posts (id, organization_id, department_id, status, created_by, current_version_id) values
  ('65000000-2000-4000-8000-000000000005', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000005');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('65000000-3000-4000-8000-000000000005', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000005', 1, '{}', '{"config": {"allowedChannelIds": []}}', 'user', '65000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.schedule_publication('65000000-3000-4000-8000-000000000005'::uuid, '65000000-8000-4000-8000-000000000004'::uuid, null)$$,
  'P0001', 'channel_not_allowed', 'schedule_publication rejects every channel when allowedChannelIds is an empty list'
);

-- 32-39: Paket 002 -- schedule_publication ist jetzt die Durchsetzungsgrenze fuer den
-- konservativen Medien-Gate-Kern (scan_pending, derivative_stale, face_pending, consent_invalid).
-- Ein eigener Kanal C5 statt Wiederverwendung von C1/C4: C1 wird von Test 23-24 absichtlich auf
-- 'action_required' gesetzt, ein spaeteres schedule_publication auf C1 wuerde sonst an dessen
-- Kanalstatus scheitern, nicht am hier zu pruefenden Medien-Gate. Sieben neue Beitraege (P6-P12),
-- damit keiner der Faelle sich durch einen vorherigen Statuswechsel eines anderen Falls beeinflusst.
set local role postgres;
insert into public.social_connections (id, organization_id, platform, external_account_id, display_name, owner_scope, status, responsible_profile_id) values
  ('65000000-8000-4000-8000-000000000005', '65000000-1000-4000-8000-000000000001', 'instagram', 'ext-c5', 'Medien-Gate-Test', 'organization', 'active', '65000000-0000-4000-8000-000000000001');
insert into public.channel_scopes (organization_id, social_connection_id, scope, department_id, team_id, created_by) values
  ('65000000-1000-4000-8000-000000000001', '65000000-8000-4000-8000-000000000005', 'organization', null, null, '65000000-0000-4000-8000-000000000001');
insert into public.posts (id, organization_id, department_id, status, created_by, current_version_id) values
  ('65000000-2000-4000-8000-000000000006', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000006'),
  ('65000000-2000-4000-8000-000000000007', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000007'),
  ('65000000-2000-4000-8000-000000000008', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000008'),
  ('65000000-2000-4000-8000-000000000009', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000009'),
  ('65000000-2000-4000-8000-000000000010', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000010'),
  ('65000000-2000-4000-8000-000000000011', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000011'),
  ('65000000-2000-4000-8000-000000000012', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'approved', '65000000-0000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000012');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('65000000-3000-4000-8000-000000000006', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000006', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001'),
  ('65000000-3000-4000-8000-000000000007', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000007', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001'),
  ('65000000-3000-4000-8000-000000000008', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000008', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001'),
  ('65000000-3000-4000-8000-000000000009', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000009', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001'),
  ('65000000-3000-4000-8000-000000000010', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000010', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001'),
  ('65000000-3000-4000-8000-000000000011', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000011', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001'),
  ('65000000-3000-4000-8000-000000000012', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000012', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001');

-- 32: P6 traegt kein einziges Medium (Text-only-Pilot, Plan 033) -- jeder exists()-Join auf
-- post_media laeuft ins Leere, der Gate-Check darf nichts blockieren.
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
select is(
  (select status from public.schedule_publication('65000000-3000-4000-8000-000000000006'::uuid, '65000000-8000-4000-8000-000000000005'::uuid, null)),
  'queued', 'schedule_publication succeeds for a text-only post version without any post_media row'
);

set local role postgres;
insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, scan_status, created_by) values
  ('65000000-6100-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'raw-media', 'orgs/channels/gate-scan-pending.jpg', 'image/jpeg', 1024, 'pending', '65000000-0000-4000-8000-000000000001'),
  ('65000000-6100-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'raw-media', 'orgs/channels/gate-derivative-stale.jpg', 'image/jpeg', 1024, 'clean', '65000000-0000-4000-8000-000000000001'),
  ('65000000-6100-4000-8000-000000000003', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'raw-media', 'orgs/channels/gate-face-pending.jpg', 'image/jpeg', 1024, 'clean', '65000000-0000-4000-8000-000000000001'),
  ('65000000-6100-4000-8000-000000000004', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'raw-media', 'orgs/channels/gate-consent-revoked.jpg', 'image/jpeg', 1024, 'clean', '65000000-0000-4000-8000-000000000001'),
  ('65000000-6100-4000-8000-000000000005', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'raw-media', 'orgs/channels/gate-consent-minor.jpg', 'image/jpeg', 1024, 'clean', '65000000-0000-4000-8000-000000000001'),
  ('65000000-6100-4000-8000-000000000006', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'raw-media', 'orgs/channels/gate-consent-valid.jpg', 'image/jpeg', 1024, 'clean', '65000000-0000-4000-8000-000000000001');

insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status) values
  ('65000000-6300-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', '65000000-6100-4000-8000-000000000001', '{}'::jsonb, 'v1', 'orgs/channels/gate-scan-pending-derivative.jpg', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'image/jpeg', 512, 'ready'),
  ('65000000-6300-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', '65000000-6100-4000-8000-000000000002', '{}'::jsonb, 'v1', 'orgs/channels/gate-derivative-stale-derivative.jpg', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'image/jpeg', 512, 'processing'),
  ('65000000-6300-4000-8000-000000000003', '65000000-1000-4000-8000-000000000001', '65000000-6100-4000-8000-000000000003', '{}'::jsonb, 'v1', 'orgs/channels/gate-face-pending-derivative.jpg', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'image/jpeg', 512, 'ready'),
  ('65000000-6300-4000-8000-000000000004', '65000000-1000-4000-8000-000000000001', '65000000-6100-4000-8000-000000000004', '{}'::jsonb, 'v1', 'orgs/channels/gate-consent-revoked-derivative.jpg', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'image/jpeg', 512, 'ready'),
  ('65000000-6300-4000-8000-000000000005', '65000000-1000-4000-8000-000000000001', '65000000-6100-4000-8000-000000000005', '{}'::jsonb, 'v1', 'orgs/channels/gate-consent-minor-derivative.jpg', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'image/jpeg', 512, 'ready'),
  ('65000000-6300-4000-8000-000000000006', '65000000-1000-4000-8000-000000000001', '65000000-6100-4000-8000-000000000006', '{}'::jsonb, 'v1', 'orgs/channels/gate-consent-valid-derivative.jpg', 'a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0', 'image/jpeg', 512, 'ready');

insert into public.post_media (id, organization_id, post_version_id, media_derivative_id, position, role) values
  ('65000000-6400-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000007', '65000000-6300-4000-8000-000000000001', 0, 'primary'),
  ('65000000-6400-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000008', '65000000-6300-4000-8000-000000000002', 0, 'primary'),
  ('65000000-6400-4000-8000-000000000003', '65000000-1000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000009', '65000000-6300-4000-8000-000000000003', 0, 'primary'),
  ('65000000-6400-4000-8000-000000000004', '65000000-1000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000010', '65000000-6300-4000-8000-000000000004', 0, 'primary'),
  ('65000000-6400-4000-8000-000000000005', '65000000-1000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000011', '65000000-6300-4000-8000-000000000005', 0, 'primary'),
  ('65000000-6400-4000-8000-000000000006', '65000000-1000-4000-8000-000000000001', '65000000-3000-4000-8000-000000000012', '65000000-6300-4000-8000-000000000006', 0, 'primary');

-- Eine minderjaehrige Verzeichnisperson fuer den Guardian-Fall -- die CHECK-Constraint auf
-- directory_people verlangt bei is_minor + status='active' eine guardian_email.
insert into public.directory_people (id, organization_id, first_name, last_name, is_minor, guardian_email) values
  ('65000000-6600-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', 'Mia', 'Minderjaehrig', true, 'guardian@pgtap-channels.local');

insert into public.consent_records (id, organization_id, pseudonymous_subject_ref, scope, evidence_path, created_by, revoked_at, signer_role, directory_person_id) values
  ('65000000-6500-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', 'pgtap-media-gate-revoked-subject', 'Instagram-Post', null, '65000000-0000-4000-8000-000000000001', now() - interval '1 day', null, null),
  ('65000000-6500-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', 'pgtap-media-gate-minor-subject', 'Instagram-Post', null, '65000000-0000-4000-8000-000000000001', null, 'self', '65000000-6600-4000-8000-000000000001'),
  ('65000000-6500-4000-8000-000000000003', '65000000-1000-4000-8000-000000000001', 'pgtap-media-gate-valid-subject', 'Instagram-Post', null, '65000000-0000-4000-8000-000000000001', null, null, null);

insert into public.face_regions (id, organization_id, media_asset_id, x, y, width, height, source, subject_kind, decision, consent_record_id, created_by) values
  ('65000000-6200-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', '65000000-6100-4000-8000-000000000003', 0.1, 0.1, 0.2, 0.2, 'manual', 'adult', 'pending', null, '65000000-0000-4000-8000-000000000001'),
  ('65000000-6200-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', '65000000-6100-4000-8000-000000000004', 0.1, 0.1, 0.2, 0.2, 'manual', 'adult', 'consented', '65000000-6500-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001'),
  ('65000000-6200-4000-8000-000000000003', '65000000-1000-4000-8000-000000000001', '65000000-6100-4000-8000-000000000005', 0.1, 0.1, 0.2, 0.2, 'manual', 'minor', 'consented', '65000000-6500-4000-8000-000000000002', '65000000-0000-4000-8000-000000000001'),
  ('65000000-6200-4000-8000-000000000004', '65000000-1000-4000-8000-000000000001', '65000000-6100-4000-8000-000000000006', 0.1, 0.1, 0.2, 0.2, 'manual', 'adult', 'consented', '65000000-6500-4000-8000-000000000003', '65000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);

-- 33: scan_status='pending' auf dem verknuepften media_asset blockiert hart.
select throws_ok(
  $$select public.schedule_publication('65000000-3000-4000-8000-000000000007'::uuid, '65000000-8000-4000-8000-000000000005'::uuid, null)$$,
  'P0001', 'media_gate_blocked: scan_pending', 'schedule_publication rejects a post version whose media asset scan is not clean'
);

-- 34: media_derivatives.status <> 'ready' blockiert hart.
select throws_ok(
  $$select public.schedule_publication('65000000-3000-4000-8000-000000000008'::uuid, '65000000-8000-4000-8000-000000000005'::uuid, null)$$,
  'P0001', 'media_gate_blocked: derivative_stale', 'schedule_publication rejects a post version whose media derivative is not ready'
);

-- 35: eine unentschiedene Gesichtsregion (decision='pending') blockiert hart.
select throws_ok(
  $$select public.schedule_publication('65000000-3000-4000-8000-000000000009'::uuid, '65000000-8000-4000-8000-000000000005'::uuid, null)$$,
  'P0001', 'media_gate_blocked: face_pending', 'schedule_publication rejects a post version with an undecided face region'
);

-- 36: ein widerrufener Consent-Record hinter einer "consented"-Entscheidung blockiert hart.
select throws_ok(
  $$select public.schedule_publication('65000000-3000-4000-8000-000000000010'::uuid, '65000000-8000-4000-8000-000000000005'::uuid, null)$$,
  'P0001', 'media_gate_blocked: consent_invalid', 'schedule_publication rejects a post version whose consent was revoked'
);

-- 37: eine minderjaehrige Person ohne Erziehungsberechtigten-Unterschrift blockiert hart, selbst
-- ohne Widerruf.
select throws_ok(
  $$select public.schedule_publication('65000000-3000-4000-8000-000000000011'::uuid, '65000000-8000-4000-8000-000000000005'::uuid, null)$$,
  'P0001', 'media_gate_blocked: consent_invalid', 'schedule_publication rejects consent for a minor without a guardian signer'
);

-- 38-39: sauberer Scan, fertiges Derivat, gueltiger Consent -- schedule_publication blockiert nicht.
select is(
  (select status from public.schedule_publication('65000000-3000-4000-8000-000000000012'::uuid, '65000000-8000-4000-8000-000000000005'::uuid, null)),
  'queued', 'schedule_publication succeeds once scan, derivative and consent are all clean'
);
set local role postgres;
select is((select status from public.posts where id = '65000000-2000-4000-8000-000000000012'), 'scheduled', 'the post with valid media moves to scheduled');

select * from finish();
rollback;
