begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

set local role postgres;

-- Ein voellig fremder Nutzer, Mitglied in KEINEM Verein dieser Testdatei -- fuer den
-- Mandantentrennung-Fund unten (request_approval durfte reviewer_snapshot nicht ungeprueft
-- uebernehmen).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000099', 'authenticated', 'authenticated', 'fremd@pgtap-route.local', '', '{}', '{}', now(), now());

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'author@pgtap-route.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'medienverantwortliche@pgtap-route.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'marketing@pgtap-route.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'outsider@pgtap-route.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('64000000-1000-4000-8000-000000000001', 'PGTAP Route Verein', 'pgtap-route-verein');
insert into public.departments (id, organization_id, name, slug) values
  ('64000000-1100-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', 'Fußball', 'fussball'),
  ('64000000-1100-4000-8000-000000000002', '64000000-1000-4000-8000-000000000001', 'Marketing', 'marketing');

insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('64000000-1000-4000-8000-000000000001', '64000000-1100-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001', 'editor'),
  ('64000000-1000-4000-8000-000000000001', '64000000-1100-4000-8000-000000000001', '64000000-0000-4000-8000-000000000002', 'approver'),
  ('64000000-1000-4000-8000-000000000001', '64000000-1100-4000-8000-000000000002', '64000000-0000-4000-8000-000000000003', 'approver'),
  ('64000000-1000-4000-8000-000000000001', '64000000-1100-4000-8000-000000000002', '64000000-0000-4000-8000-000000000004', 'viewer');

insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('64000000-2000-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-1100-4000-8000-000000000001', 'awaiting_approval', '64000000-0000-4000-8000-000000000001'),
  ('64000000-2000-4000-8000-000000000002', '64000000-1000-4000-8000-000000000001', '64000000-1100-4000-8000-000000000001', 'draft_ready', '64000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('64000000-3000-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '64000000-0000-4000-8000-000000000001'),
  ('64000000-3000-4000-8000-000000000005', '64000000-1000-4000-8000-000000000001', '64000000-2000-4000-8000-000000000002', 1, '{}', '{}', 'user', '64000000-0000-4000-8000-000000000001');

insert into public.submissions (id, organization_id, department_id, content_type, preset_slug, communication_goal, requested_formats, source_material, created_by) values
  ('64000000-2500-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-1100-4000-8000-000000000001', 'training_insight', 'training_insight', 'inform',
   '["feed_image"]'::jsonb, '{"facts":{},"observations":[],"quotes":[],"forbiddenTopics":[]}'::jsonb, '64000000-0000-4000-8000-000000000001');

insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, created_by) values
  ('64000000-2600-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-1100-4000-8000-000000000001', 'raw-media', 'orgs/route/asset.jpg', 'image/jpeg', 1024, '64000000-0000-4000-8000-000000000001');
insert into public.face_regions (id, organization_id, media_asset_id, x, y, width, height, source, subject_kind, created_by) values
  ('64000000-2700-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-2600-4000-8000-000000000001', 0.1, 0.1, 0.2, 0.2, 'manual', 'adult', '64000000-0000-4000-8000-000000000001');
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status) values
  ('64000000-2800-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-2600-4000-8000-000000000001', '{}'::jsonb, 'v1', 'orgs/route/derivative.jpg',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'image/jpeg', 512, 'ready');
insert into public.post_media (id, organization_id, post_version_id, media_derivative_id, position, role) values
  ('64000000-2900-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-3000-4000-8000-000000000001', '64000000-2800-4000-8000-000000000001', 0, 'primary');
insert into public.post_variants (id, organization_id, post_version_id, platform, format, schema_version, prompt_version, variant) values
  ('64000000-2a00-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-3000-4000-8000-000000000001', 'instagram', 'feed_image', 'v1', 'v1', '{}'::jsonb);

insert into public.approval_requests (id, organization_id, post_id, post_version_id, self_approval_allowed, allow_same_reviewer_across_stages) values
  ('64000000-4000-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-2000-4000-8000-000000000001', '64000000-3000-4000-8000-000000000001', true, false);
insert into public.approval_stages (id, organization_id, approval_request_id, position, scope, scope_department_id, label, mode, minimum_approvals, reviewer_snapshot, status, opened_at) values
  ('64000000-5000-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-4000-4000-8000-000000000001', 1, 'department', '64000000-1100-4000-8000-000000000001',
   'Medienverantwortliche', 'named', 1, '[{"userId":"64000000-0000-4000-8000-000000000002"}]'::jsonb, 'open', now());
insert into public.approval_stages (id, organization_id, approval_request_id, position, scope, label, mode, minimum_approvals, reviewer_snapshot, status) values
  ('64000000-5000-4000-8000-000000000002', '64000000-1000-4000-8000-000000000001', '64000000-4000-4000-8000-000000000001', 2, 'organization',
   'Marketing', 'named', 1, '[{"userId":"64000000-0000-4000-8000-000000000003"}]'::jsonb, 'pending');
insert into public.approval_media_snapshots (id, organization_id, approval_request_id, media_derivative_id, position, sha256) values
  ('64000000-6000-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-4000-4000-8000-000000000001', '64000000-2800-4000-8000-000000000001', 0,
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

-- Eine zweite, unabhaengige Anfrage nur fuer den Fremdschluessel-Test unten: eine Stufe DIESER
-- Anfrage darf nicht an eine Entscheidung der ERSTEN Anfrage gehaengt werden koennen.
insert into public.approval_requests (id, organization_id, post_id, post_version_id) values
  ('64000000-4000-4000-8000-000000000002', '64000000-1000-4000-8000-000000000001', '64000000-2000-4000-8000-000000000001', '64000000-3000-4000-8000-000000000001');
insert into public.approval_stages (id, organization_id, approval_request_id, position, scope, label, mode, minimum_approvals, reviewer_snapshot, status) values
  ('64000000-5000-4000-8000-000000000003', '64000000-1000-4000-8000-000000000001', '64000000-4000-4000-8000-000000000002', 1, 'organization', 'Fremd', 'named', 1, '[]'::jsonb, 'pending');

set local role authenticated;

-- 1-3: der Marketing-Pruefer (Stufe 2, noch "pending") ist Mitglied der Abteilung Marketing, nicht
-- Fussball, und liest trotzdem Text und freigegebene Derivate des zu pruefenden Beitrags.
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.post_versions where id = '64000000-3000-4000-8000-000000000001'), 1, 'marketing reviewer without Fussball membership reads the post_version being reviewed');
select is((select count(*)::integer from public.media_derivatives where id = '64000000-2800-4000-8000-000000000001'), 1, 'marketing reviewer reads the released media derivative');
select is((select count(*)::integer from public.post_media where post_version_id = '64000000-3000-4000-8000-000000000001'), 1, 'marketing reviewer reads post_media linking the derivative to the version');

-- 4-6: ausdruecklich nicht erweitert -- Rohmedien, Gesichtsregionen und die Einreichung bleiben
-- fuer den Pruefer unerreichbar.
select is((select count(*)::integer from public.media_assets where id = '64000000-2600-4000-8000-000000000001'), 0, 'marketing reviewer does not read the original media_asset');
select is((select count(*)::integer from public.face_regions where id = '64000000-2700-4000-8000-000000000001'), 0, 'marketing reviewer does not read face_regions');
select is((select count(*)::integer from public.submissions where id = '64000000-2500-4000-8000-000000000001'), 0, 'marketing reviewer does not read the submission');

-- 7: die posts-Zeile selbst wird ueber authz.is_assigned_reviewer_of_post erreichbar.
select is((select count(*)::integer from public.posts where id = '64000000-2000-4000-8000-000000000001'), 1, 'marketing reviewer reads the posts row of the version under review');

-- 8: ein unbeteiligtes Mitglied einer anderen Abteilung (kein zugewiesener Pruefer) sieht nichts davon.
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.post_versions where id = '64000000-3000-4000-8000-000000000001'), 0, 'an uninvolved member of another department reads nothing of a not-yet-published version');

-- 9: nach "skipped" verliert der Pruefer den Zugriff wieder.
set local role postgres;
update public.approval_stages set status = 'skipped' where id = '64000000-5000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.post_versions where id = '64000000-3000-4000-8000-000000000001'), 0, 'the marketing reviewer loses access once their stage is skipped');

-- 10: der Autor liest reason und decided_by einer Entscheidung, auch ohne Organisationsrolle oder
-- Zugriff auf die pruefende Abteilung ausserhalb seiner eigenen.
set local role postgres;
insert into public.approval_decisions (id, organization_id, approval_request_id, approval_stage_id, post_version_id, decided_by, decision, reason) values
  ('64000000-7000-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-4000-4000-8000-000000000001', '64000000-5000-4000-8000-000000000001',
   '64000000-3000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000002', 'changes_requested', 'Bitte Ergebnis pruefen.');
set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000001', true);
select is((select reason from public.approval_decisions where id = '64000000-7000-4000-8000-000000000001'), 'Bitte Ergebnis pruefen.', 'the author reads the rejection reason of their own version');

-- 11: ein unbeteiligtes Mitglied liest dieselbe Entscheidung nicht.
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.approval_decisions where id = '64000000-7000-4000-8000-000000000001'), 0, 'an uninvolved member does not read the same decision');

-- 12-13: authz.can_decide_stage -- allow_same_reviewer_across_stages = false schliesst denselben
-- Pruefer auf einer AEUSSEREN Stufe aus, nachdem er auf der INNEREN entschieden hat.
set local role postgres;
update public.approval_stages set status = 'open', reviewer_snapshot = '[{"userId":"64000000-0000-4000-8000-000000000002"}]'::jsonb where id = '64000000-5000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000002', true);
select ok(not authz.can_decide_stage('64000000-5000-4000-8000-000000000002'), 'the reviewer of the inner stage cannot decide the outer stage once allow_same_reviewer_across_stages is false');

set local role postgres;
update public.approval_requests set allow_same_reviewer_across_stages = true where id = '64000000-4000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000002', true);
select ok(authz.can_decide_stage('64000000-5000-4000-8000-000000000002'), 'the same reviewer CAN decide the outer stage once allow_same_reviewer_across_stages is true');

-- 14: Selbstfreigabe -- self_approval_allowed = false schliesst den Autor aus dem Pruferkreis aus.
set local role postgres;
update public.approval_requests set self_approval_allowed = false where id = '64000000-4000-4000-8000-000000000001';
update public.approval_stages set reviewer_snapshot = '[{"userId":"64000000-0000-4000-8000-000000000001"},{"userId":"64000000-0000-4000-8000-000000000002"}]'::jsonb, status = 'open' where id = '64000000-5000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000001', true);
select ok(not authz.can_decide_stage('64000000-5000-4000-8000-000000000001'), 'the author cannot decide their own stage when self_approval_allowed is false, even if listed in reviewer_snapshot');

-- 15: eine noch nicht offene Stufe kann von niemandem entschieden werden.
set local role postgres;
update public.approval_stages set status = 'pending' where id = '64000000-5000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000002', true);
select ok(not authz.can_decide_stage('64000000-5000-4000-8000-000000000002'), 'a stage that is not open yet cannot be decided by anyone');

-- 16-18: Constraint-Regressionen aus dem Datenmodell.
set local role postgres;
select throws_ok(
  $$insert into public.approval_decisions (organization_id, approval_request_id, approval_stage_id, post_version_id, decided_by, decision)
    values ('64000000-1000-4000-8000-000000000001', '64000000-4000-4000-8000-000000000001', '64000000-5000-4000-8000-000000000001', '64000000-3000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000002', 'approved')$$,
  '23505', null, 'a second decision by the same person on the same stage violates the unique index'
);
select throws_ok(
  $$insert into public.approval_decisions (organization_id, approval_request_id, approval_stage_id, post_version_id, decided_by, decision)
    values ('64000000-1000-4000-8000-000000000001', '64000000-4000-4000-8000-000000000001', '64000000-5000-4000-8000-000000000003', '64000000-3000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000004', 'approved')$$,
  '23503', null, 'a decision referencing a stage that belongs to a DIFFERENT approval_request violates the foreign key'
);
select throws_ok(
  $$insert into public.approval_decisions (organization_id, approval_request_id, post_version_id, decided_by, decision)
    values ('64000000-1000-4000-8000-000000000001', '64000000-4000-4000-8000-000000000001', '64000000-3000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000004', 'approved')$$,
  '23502', null, 'a decision without approval_stage_id violates not null'
);

-- 19-20: policy_settings' review_mode/review_required-CHECK und channel_quotas' Unique-Index gegen
-- zwei vereinsweite Zeilen fuer denselben Kanal und dieselbe Periode.
select throws_ok(
  $$insert into public.policy_settings (organization_id, scope, review_mode, review_required, updated_by)
    values ('64000000-1000-4000-8000-000000000001', 'organization', 'named', false, '64000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'review_mode = named without review_required = true violates the check constraint'
);
insert into public.channel_quotas (organization_id, scope, period, max_publications) values
  ('64000000-1000-4000-8000-000000000001', 'organization', 'day', 3);
select throws_ok(
  $$insert into public.channel_quotas (organization_id, scope, period, max_publications) values ('64000000-1000-4000-8000-000000000001', 'organization', 'day', 5)$$,
  '23505', null, 'a second organization-wide quota for the same channel and period violates the unique index'
);

-- 21: policy_reviewers' CHECK verweigert eine widersprüchliche Feldkombination.
insert into public.policy_settings (organization_id, scope, department_id, review_required, updated_by) values
  ('64000000-1000-4000-8000-000000000001', 'department', '64000000-1100-4000-8000-000000000001', true, '64000000-0000-4000-8000-000000000001')
  on conflict do nothing;
select throws_ok(
  $$insert into public.policy_reviewers (organization_id, policy_settings_id, kind, user_id, role, created_by)
    values ('64000000-1000-4000-8000-000000000001', (select id from public.policy_settings where organization_id = '64000000-1000-4000-8000-000000000001' and scope = 'department' limit 1),
            'user', '64000000-0000-4000-8000-000000000001', 'approver', '64000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'policy_reviewers rejects kind=user together with a role'
);

-- 22: member_review_trust' Unique-Index gegen zwei Zeilen fuer dieselbe Person auf Vereinsebene.
insert into public.member_review_trust (organization_id, scope, user_id, review_requirement, granted_by) values
  ('64000000-1000-4000-8000-000000000001', 'organization', '64000000-0000-4000-8000-000000000001', 'waived', '64000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.member_review_trust (organization_id, scope, user_id, review_requirement, granted_by)
    values ('64000000-1000-4000-8000-000000000001', 'organization', '64000000-0000-4000-8000-000000000001', 'always', '64000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'a second organization-level trust row for the same person violates the unique index'
);

-- 23-24: count_publications_in_period zaehlt queued/published, nicht failed/cancelled.
-- token_ciphertext/token_key_version leben seit Paket 012 in social_connection_secrets, nicht mehr
-- hier -- diese Zeile braucht kein Geheimnis, nur eine gueltige social_connections-Zeile als FK-Ziel.
insert into public.social_connections (id, organization_id, platform, external_account_id, display_name) values
  ('64000000-8000-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', 'instagram', 'ext-1', 'SV Route');
-- publications hat unique(organization_id, platform, post_version_id, social_connection_id) -- vier
-- Zeilen fuer denselben Kanal brauchen deshalb vier verschiedene Versionen, nicht denselben Post.
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('64000000-3000-4000-8000-000000000002', '64000000-1000-4000-8000-000000000001', '64000000-2000-4000-8000-000000000001', 2, '{}', '{}', 'user', '64000000-0000-4000-8000-000000000001'),
  ('64000000-3000-4000-8000-000000000003', '64000000-1000-4000-8000-000000000001', '64000000-2000-4000-8000-000000000001', 3, '{}', '{}', 'user', '64000000-0000-4000-8000-000000000001'),
  ('64000000-3000-4000-8000-000000000004', '64000000-1000-4000-8000-000000000001', '64000000-2000-4000-8000-000000000001', 4, '{}', '{}', 'user', '64000000-0000-4000-8000-000000000001');
insert into public.publications (organization_id, post_version_id, social_connection_id, platform, status, idempotency_key) values
  ('64000000-1000-4000-8000-000000000001', '64000000-3000-4000-8000-000000000001', '64000000-8000-4000-8000-000000000001', 'instagram', 'published', 'pub:1'),
  ('64000000-1000-4000-8000-000000000001', '64000000-3000-4000-8000-000000000002', '64000000-8000-4000-8000-000000000001', 'instagram', 'queued', 'pub:2'),
  ('64000000-1000-4000-8000-000000000001', '64000000-3000-4000-8000-000000000003', '64000000-8000-4000-8000-000000000001', 'instagram', 'failed', 'pub:3'),
  ('64000000-1000-4000-8000-000000000001', '64000000-3000-4000-8000-000000000004', '64000000-8000-4000-8000-000000000001', 'instagram', 'cancelled', 'pub:4');
select is(
  public.count_publications_in_period('64000000-1000-4000-8000-000000000001', null, null, '64000000-8000-4000-8000-000000000001', 'day', now()),
  2, 'count_publications_in_period counts queued and published, not failed or cancelled'
);
select is(
  public.count_publications_in_period('64000000-1000-4000-8000-000000000001', null, null, '64000000-8000-4000-8000-000000000001', 'month', now() - interval '40 days'),
  0, 'count_publications_in_period respects the reference period and does not count last month''s activity'
);

-- 26: count_publications_in_period hat keinen legitimen Aufrufer ausser schedule_publication()
-- (SECURITY DEFINER) -- ein direkter RPC-Aufruf durch authenticated wuerde die
-- Veroeffentlichungszahl eines FREMDEN Vereins offenlegen und ist deshalb nicht mehr vergeben.
set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.count_publications_in_period('64000000-1000-4000-8000-000000000001', null, null, '64000000-8000-4000-8000-000000000001', 'day', now())$$,
  '42501', null, 'authenticated cannot call count_publications_in_period directly anymore'
);

-- 27, 29: Paket 024 zieht request_approval() den "stages"-Parameter komplett -- die Funktion leitet
-- die Route seither ausschliesslich selbst ab (authz.resolve_review_route), ein eingeschleuster
-- Pruefer oder eine leere Stufenliste sind seitdem STRUKTURELL unmoeglich statt nur GEPRUEFT. Die
-- Pruefungen selbst leben jetzt in authz.assert_valid_stage_list, herausgeloest, damit
-- reresolve_approval_route dieselbe Fassung benutzt (Plan 024, "Kein Duplikat") -- als
-- security-definer-Funktion ohne Grant an authenticated (siehe Test unten) direkt nur als postgres
-- pruefbar, wie jede rein interne Bausteinfunktion.
set local role postgres;
select throws_ok(
  $$select authz.assert_valid_stage_list(
    '64000000-1000-4000-8000-000000000001'::uuid, '64000000-0000-4000-8000-000000000001'::uuid,
    false, false, false, true,
    jsonb_build_array(jsonb_build_object(
      'position', 1, 'scope', 'organization', 'scopeDepartmentId', null, 'scopeTeamId', null,
      'label', 'Eingeschleust', 'mode', 'named', 'minimumApprovals', 1, 'isMinorStage', false,
      'reviewerSnapshot', jsonb_build_array(jsonb_build_object('userId', '64000000-0000-4000-8000-000000000099')),
      'deadlineHours', null
    ))
  )$$,
  'P0001', 'invalid_reviewer_snapshot', 'assert_valid_stage_list rejects a reviewer_snapshot naming someone who is not even a member of this organization'
);
select throws_ok(
  $$select authz.assert_valid_stage_list(
    '64000000-1000-4000-8000-000000000001'::uuid, '64000000-0000-4000-8000-000000000001'::uuid,
    false, false, true, true, '[]'::jsonb
  )$$,
  'P0001', 'review_required', 'assert_valid_stage_list rejects an empty stage list when review is actually required'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select authz.assert_valid_stage_list(
    '64000000-1000-4000-8000-000000000001'::uuid, '64000000-0000-4000-8000-000000000001'::uuid,
    false, false, false, true, '[]'::jsonb
  )$$,
  '42501', null, 'authenticated cannot call authz.assert_valid_stage_list directly -- only request_approval/reresolve_approval_route may'
);
select throws_ok(
  $$select authz.resolve_review_route('64000000-3000-4000-8000-000000000005'::uuid)$$,
  '42501', null, 'authenticated cannot call authz.resolve_review_route directly -- it would expose reviewer identities for any post_version_id without an access check'
);

-- 28: policy_reviewers.created_by ist wie policy_settings.updated_by und member_review_trust.
-- granted_by nicht vereinsweit lesbar -- eine administrative Handlung einer konkreten Person.
select is(
  has_column_privilege('authenticated', 'public.policy_reviewers', 'created_by', 'SELECT'),
  false, 'authenticated cannot see who created a policy_reviewers row'
);
select ok(
  has_column_privilege('authenticated', 'public.policy_reviewers', 'user_id', 'SELECT'),
  'authenticated can still read who the reviewer is'
);

-- 30-42: Mandantentrennung der vier neuen Tabellen (AGENTS.md: "Neue exponierte Tabellen brauchen
-- RLS sowie positive und negative Isolationstests"). Dafuer ein ZWEITER Verein mit eigenem
-- Mitglied -- mit nur einem Verein im Datensatz war Mandantentrennung nicht pruefbar. Ausserdem ein
-- Abteilungsverwalter OHNE Organisationsrolle: er ist der Fall, an dem sich
-- is_organization_member von is_any_member_of_organization unterscheidet.
set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'abteilungsleitung@pgtap-route.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000098', 'authenticated', 'authenticated', 'fremdverein@pgtap-route.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('64000000-1000-4000-8000-000000000002', 'PGTAP Route Fremdverein', 'pgtap-route-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('64000000-1100-4000-8000-000000000009', '64000000-1000-4000-8000-000000000002', 'Handball', 'handball');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('64000000-1000-4000-8000-000000000001', '64000000-1100-4000-8000-000000000001', '64000000-0000-4000-8000-000000000005', 'department_admin'),
  ('64000000-1000-4000-8000-000000000002', '64000000-1100-4000-8000-000000000009', '64000000-0000-4000-8000-000000000098', 'department_admin');

-- Je eine echte Zeile der drei uebrigen neuen Tabellen im ERSTEN Verein (channel_quotas hat oben
-- schon eine vereinsweite Zeile).
insert into public.policy_reviewers (organization_id, policy_settings_id, kind, user_id, created_by) values
  ('64000000-1000-4000-8000-000000000001',
   (select id from public.policy_settings where organization_id = '64000000-1000-4000-8000-000000000001' and scope = 'department' limit 1),
   'user', '64000000-0000-4000-8000-000000000002', '64000000-0000-4000-8000-000000000001');
insert into public.member_review_trust (organization_id, scope, department_id, user_id, review_requirement, reason, granted_by) values
  ('64000000-1000-4000-8000-000000000001', 'department', '64000000-1100-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001',
   'waived', 'Langjaehrige Medienverantwortliche.', '64000000-0000-4000-8000-000000000005');

set local role authenticated;

-- 30-31: channel_quotas. Der Abteilungsverwalter ohne Organisationsrolle darf ein Kontingent seiner
-- Ebene anlegen (channel_quotas_insert) und muss es deshalb auch lesen koennen -- mit
-- is_organization_member waere schon das "insert ... returning" der API an der Select-Policy
-- gescheitert (eigener Review-Fund).
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from public.channel_quotas where organization_id = '64000000-1000-4000-8000-000000000001'), 1,
  'a department admin without an organization role reads the channel quota of their own club');
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000098', true);
select is((select count(*)::integer from public.channel_quotas where organization_id = '64000000-1000-4000-8000-000000000001'), 0,
  'a member of another club reads no channel_quotas row of this club');

-- 32-33: approval_stages -- der zugewiesene Pruefer des eigenen Vereins liest seine Stufe, das
-- Mitglied des fremden Vereins keine.
-- Nutzer ...0002 steht seit Test 12 im reviewer_snapshot dieser Stufe (siehe update dort).
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.approval_stages where id = '64000000-5000-4000-8000-000000000002'), 1,
  'a reviewer named in reviewer_snapshot reads their own stage');
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000098', true);
select is((select count(*)::integer from public.approval_stages where organization_id = '64000000-1000-4000-8000-000000000001'), 0,
  'a member of another club reads no approval_stages row of this club');

-- 34-35: policy_reviewers -- vereinsweit lesbar (jede Ebene soll die volle Freigaberoute sehen),
-- aber nicht ueber die Vereinsgrenze.
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.policy_reviewers where organization_id = '64000000-1000-4000-8000-000000000001'), 1,
  'any member of the club reads the reviewer assignments of the club');
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000098', true);
select is((select count(*)::integer from public.policy_reviewers where organization_id = '64000000-1000-4000-8000-000000000001'), 0,
  'a member of another club reads no policy_reviewers row of this club');

-- 36-38: member_review_trust ist enger als die uebrigen drei -- nur die Person selbst und wer die
-- betroffene Ebene verwaltet.
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from public.member_review_trust where department_id = '64000000-1100-4000-8000-000000000001'), 1,
  'the admin of the department reads the trust row of that department');
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.member_review_trust), 0,
  'a member of the same club without management permission and without an own row reads no trust row');
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000098', true);
select is((select count(*)::integer from public.member_review_trust where organization_id = '64000000-1000-4000-8000-000000000001'), 0,
  'a member of another club reads no member_review_trust row of this club');

-- 39-40: assert_valid_stage_list muss die STRUKTUR der Stufenliste pruefen, nicht nur ihren Inhalt
-- (Paket 024: aus request_approval herausgeloest, siehe Test 27/29 oben). decide_approval_stage
-- sucht die Folgestufe ueber position + 1: mit den Positionen 1 und 3 wuerde Stufe 3 nie oeffnen und
-- der Beitrag nach Stufe 1 sofort auf 'approved' gehen -- so liesse sich jede aeussere Stufe
-- ueberspringen, auch die unbefreibare Minderjaehrigenstufe.
set local role postgres;
select throws_ok(
  $$select authz.assert_valid_stage_list(
    '64000000-1000-4000-8000-000000000001'::uuid, '64000000-0000-4000-8000-000000000001'::uuid,
    true, false, false, true,
    jsonb_build_array(
      jsonb_build_object('position', 1, 'scope', 'department', 'scopeDepartmentId', '64000000-1100-4000-8000-000000000001', 'scopeTeamId', null,
        'label', 'Abteilung', 'mode', 'named', 'minimumApprovals', 1, 'isMinorStage', false,
        'reviewerSnapshot', jsonb_build_array(jsonb_build_object('userId', '64000000-0000-4000-8000-000000000002')), 'deadlineHours', null),
      jsonb_build_object('position', 3, 'scope', 'organization', 'scopeDepartmentId', null, 'scopeTeamId', null,
        'label', 'Minderjährigenschutz', 'mode', 'named', 'minimumApprovals', 1, 'isMinorStage', true,
        'reviewerSnapshot', jsonb_build_array(jsonb_build_object('userId', '64000000-0000-4000-8000-000000000003')), 'deadlineHours', null)
    )
  )$$,
  'P0001', 'invalid_stage_positions', 'assert_valid_stage_list rejects a gap in the stage positions that would silently skip the outer stage'
);
select throws_ok(
  $$select authz.assert_valid_stage_list(
    '64000000-1000-4000-8000-000000000001'::uuid, '64000000-0000-4000-8000-000000000001'::uuid,
    false, false, false, true,
    jsonb_build_array(jsonb_build_object(
      'position', 1, 'scope', 'department', 'scopeDepartmentId', '64000000-1100-4000-8000-000000000001', 'scopeTeamId', null,
      'label', 'Ohne Pruefer', 'mode', 'named', 'minimumApprovals', 1, 'isMinorStage', false,
      'reviewerSnapshot', '[]'::jsonb, 'deadlineHours', null
    ))
  )$$,
  'P0001', 'empty_reviewer_snapshot', 'assert_valid_stage_list rejects a stage without any reviewer, which nobody could ever decide'
);
set local role authenticated;

-- 41: policy_reviewers.user_id verweist nur auf public.profiles und kann deshalb keinen
-- zusammengesetzten Fremdschluessel auf den Verein tragen -- policy_reviewers_insert prueft die
-- Mitgliedschaft stattdessen selbst.
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$insert into public.policy_reviewers (organization_id, policy_settings_id, kind, user_id, created_by)
    values ('64000000-1000-4000-8000-000000000001',
            (select id from public.policy_settings where organization_id = '64000000-1000-4000-8000-000000000001' and scope = 'department' limit 1),
            'user', '64000000-0000-4000-8000-000000000098', '64000000-0000-4000-8000-000000000005')$$,
  '42501', null, 'policy_reviewers rejects a reviewer from another club'
);

-- 42: dieselbe Luecke bei set_member_review_trust -- eine Vertrauenszeile fuer eine vereinsfremde
-- Person waere fuer diese Person sogar lesbar (member_review_trust_select, "user_id = auth.uid()").
select throws_ok(
  $$select public.set_member_review_trust(
    '64000000-1000-4000-8000-000000000001'::uuid, 'department', '64000000-1100-4000-8000-000000000001'::uuid, null,
    '64000000-0000-4000-8000-000000000098'::uuid, true, 'waived', null, null
  )$$,
  'P0001', 'user_not_a_member', 'set_member_review_trust rejects a target person from another club'
);

-- 43-44: eine Frist darf weder zustimmen noch blockieren (Plan 011: "Keine automatische Freigabe
-- nach Fristablauf"). mark_stalled_approval_stages() markiert die ueberschrittene Stufe, und der
-- zugewiesene Pruefer kann sie danach weiterhin entscheiden -- mit "status = 'open'" in
-- can_decide_stage waere sie ab dem ersten Scheduler-Lauf dauerhaft unentscheidbar geworden.
set local role postgres;
update public.approval_stages
set status = 'open', deadline_at = now() - interval '1 hour', reviewer_snapshot = '[{"userId":"64000000-0000-4000-8000-000000000003"}]'::jsonb
where id = '64000000-5000-4000-8000-000000000002';
select is(public.mark_stalled_approval_stages(), 1, 'mark_stalled_approval_stages marks exactly the one stage whose deadline has passed');

set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000003', true);
select ok(authz.can_decide_stage('64000000-5000-4000-8000-000000000002'),
  'the assigned reviewer can still decide a stage that was marked stalled after its deadline passed');

-- 45: count_publications_for_quotas beantwortet die Auslastung ALLER Kontingente eines Vereins in
-- einer Abfrage -- GET /v1/analytics/summary rief count_publications_in_period vorher je
-- Kontingentzeile einzeln auf. Ohne eigene Mitgliedschaftspruefung, deshalb wie die gezaehlte
-- Funktion selbst kein Grant an authenticated.
select throws_ok(
  $$select * from public.count_publications_for_quotas('64000000-1000-4000-8000-000000000001', now())$$,
  '42501', null, 'authenticated cannot call count_publications_for_quotas directly'
);

-- 46-47: eine Zeile je Kontingent des Vereins, und darin exakt die Zahl des Einzelaufrufs. Eine
-- zweite Kopie der Perioden-/Statusregeln waere genau die Stelle, an der die Auswertung und die
-- Sperre in schedule_publication() auseinanderlaufen wuerden.
set local role postgres;
select is(
  (select count(*)::integer from public.count_publications_for_quotas('64000000-1000-4000-8000-000000000001', now())),
  1, 'count_publications_for_quotas returns exactly one row per quota of the club'
);
select is(
  (select used from public.count_publications_for_quotas('64000000-1000-4000-8000-000000000001', now())),
  public.count_publications_in_period('64000000-1000-4000-8000-000000000001', null, null, null, 'day', now()),
  'count_publications_for_quotas reports the same usage as the per-quota call it batches'
);

select * from finish();
rollback;
