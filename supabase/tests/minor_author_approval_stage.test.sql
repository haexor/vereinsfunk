begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

set local role postgres;

-- Verein, Abteilung, Personen. minderjaehrig=Autor der Version (contributor, laut Verzeichnis
-- minderjaehrig), erwachsen=organization_admin (adulter any_with_permission-Kandidat),
-- minderjaehrig_rolle=social_manager, der/die laut Verzeichnis SELBST minderjaehrig ist (das
-- Rollenmodell schliesst das organisatorisch nicht aus -- genau der Fall, den adult_org_approvers
-- ausschliessen muss), erwachsener_autor=Kontrastfall ohne Verzeichniseintrag.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '69000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'minderjaehrig@pgtap-minor-author.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '69000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'erwachsen@pgtap-minor-author.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '69000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'minderjaehrig-rolle@pgtap-minor-author.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '69000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'erwachsener-autor@pgtap-minor-author.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('69000000-1000-4000-8000-000000000001', 'PGTAP Minderjaehrige Verfasser Verein', 'pgtap-minor-author-verein');
insert into public.departments (id, organization_id, name, slug) values
  ('69000000-1100-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', 'Jugend', 'jugend');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('69000000-1000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000002', 'organization_admin'),
  ('69000000-1000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000003', 'social_manager');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-0000-4000-8000-000000000001', 'contributor'),
  ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-0000-4000-8000-000000000004', 'contributor');

-- Verzeichnis: der Autor UND die Person mit Vereinsrolle sind beide minderjaehrig.
insert into public.directory_people (organization_id, first_name, last_name, is_minor, guardian_email, profile_id) values
  ('69000000-1000-4000-8000-000000000001', 'Mia', 'Minderjaehrig', true, 'eltern-mia@example.local', '69000000-0000-4000-8000-000000000001'),
  ('69000000-1000-4000-8000-000000000001', 'Timo', 'Rollentraeger', true, 'eltern-timo@example.local', '69000000-0000-4000-8000-000000000003');

-- Kein policy_settings-Eintrag auf irgendeiner Ebene: review_required ist ueberall NULL/false.
-- Trotzdem muss die Minderjaehrige-Verfasser:in-Stufe erscheinen (feste Plattformregel).
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('69000000-2000-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'draft_ready', '69000000-0000-4000-8000-000000000001'),
  ('69000000-2000-4000-8000-000000000002', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'draft_ready', '69000000-0000-4000-8000-000000000004');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('69000000-3000-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', '69000000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '69000000-0000-4000-8000-000000000001'),
  ('69000000-3000-4000-8000-000000000002', '69000000-1000-4000-8000-000000000001', '69000000-2000-4000-8000-000000000002', 1, '{}', '{}', 'user', '69000000-0000-4000-8000-000000000004');

-- 1-4: authz.resolve_review_route baut fuer den minderjaehrigen Autor genau eine Stufe -- ohne
-- jede review_required-Einstellung, unwaivable, mit ausschliesslich erwachsenen Pruefer:innen.
select is(
  (select count(*)::integer from authz.resolve_review_route('69000000-3000-4000-8000-000000000001')),
  1, 'resolve_review_route returns exactly one stage for a minor author when nothing else requires review'
);
select is(
  (select is_minor_stage from authz.resolve_review_route('69000000-3000-4000-8000-000000000001') limit 1),
  true, 'the stage is flagged is_minor_stage (same unwaivable enforcement path as the media stage)'
);
select is(
  (select label from authz.resolve_review_route('69000000-3000-4000-8000-000000000001') limit 1),
  'Minderjährige:r Verfasser:in', 'the label distinguishes the author-minor reason from the media-minor stage'
);
select is(
  (select reviewer_user_ids from authz.resolve_review_route('69000000-3000-4000-8000-000000000001') limit 1),
  array['69000000-0000-4000-8000-000000000002'::uuid],
  'the reviewer pool contains only the adult organization_admin, excluding the minor social_manager'
);

-- 5: die Stufe ueberlebt einen vereinsweiten Waiver fuer den Autor -- unwaivable, exakt wie die
-- Medien-Minderjaehrigenstufe.
insert into public.member_review_trust (organization_id, scope, user_id, review_requirement, granted_by) values
  ('69000000-1000-4000-8000-000000000001', 'organization', '69000000-0000-4000-8000-000000000001', 'waived', '69000000-0000-4000-8000-000000000002');
select is(
  (select count(*)::integer from authz.resolve_review_route('69000000-3000-4000-8000-000000000001')),
  1, 'the author-minor stage survives an organization-wide waiver for the author'
);

-- 6: Kontrastfall -- ein erwachsener Autor unter derselben Richtlinie bekommt gar keine Stufe.
select is(
  (select count(*)::integer from authz.resolve_review_route('69000000-3000-4000-8000-000000000002')),
  0, 'an adult author under the same policy configuration gets an empty route (no over-triggering)'
);

-- 7-8: request_approval() als der minderjaehrige Autor selbst -- der Beitrag haengt tatsaechlich
-- in awaiting_approval, wird nicht stillschweigend approved.
set local role authenticated;
select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000001', true);
select public.request_approval('69000000-3000-4000-8000-000000000001');
select is(
  (select status from public.posts where id = '69000000-2000-4000-8000-000000000001'),
  'awaiting_approval', 'request_approval leaves the post awaiting approval instead of auto-approving it'
);
select is(
  (select requires_minor_approval from public.approval_requests where post_version_id = '69000000-3000-4000-8000-000000000001'),
  true, 'the created approval_request is flagged requires_minor_approval'
);

set local role postgres;

-- 9: die alte 6-Parameter-Fassung von assert_valid_stage_list existiert nicht mehr.
select throws_ok(
  $$select authz.assert_valid_stage_list(
    '69000000-1000-4000-8000-000000000001'::uuid, '69000000-0000-4000-8000-000000000001'::uuid,
    false, false, true, '[]'::jsonb
  )$$,
  '42883', null, 'the old six-argument assert_valid_stage_list no longer exists'
);

-- 10: eine leere Stufenliste ist ein Fehler, sobald author_is_minor wahr ist -- auch ohne jede
-- review_required-Einstellung und ohne contains_minors. minor_stage_present ist bei einer leeren
-- Liste zwangslaeufig false, deshalb greift derselbe Fehler wie in Test 11 (minor_stage_required
-- kommt vor der review_required-Pruefung).
select throws_ok(
  $$select authz.assert_valid_stage_list(
    '69000000-1000-4000-8000-000000000001'::uuid, '69000000-0000-4000-8000-000000000001'::uuid,
    false, true, false, true, '[]'::jsonb
  )$$,
  'P0001', 'minor_stage_required', 'assert_valid_stage_list requires a minor-flagged stage when the author is a minor, even with an otherwise empty route'
);

-- 11: eine Stufenliste ohne isMinorStage=true ist ebenfalls ein Fehler, wenn author_is_minor wahr
-- ist -- Verteidigung in der Tiefe, falls resolve_review_route je eine unpassende Route liefern
-- wuerde.
select throws_ok(
  $$select authz.assert_valid_stage_list(
    '69000000-1000-4000-8000-000000000001'::uuid, '69000000-0000-4000-8000-000000000001'::uuid,
    false, true, false, true,
    '[{"position":1,"scope":"department","label":"Abteilung","mode":"any_with_permission","minimumApprovals":1,"isMinorStage":false,"reviewerSnapshot":[{"userId":"69000000-0000-4000-8000-000000000002"}]}]'::jsonb
  )$$,
  'P0001', 'minor_stage_required', 'assert_valid_stage_list rejects a route without a minor-flagged stage when the author is a minor'
);

-- 12: dieselbe leere Route ist erlaubt, wenn der Autor NICHT minderjaehrig ist und auch sonst
-- nichts Freigabe verlangt -- author_is_minor ist der einzige neue Ausloeser, kein genereller
-- Zwang.
select lives_ok(
  $$select authz.assert_valid_stage_list(
    '69000000-1000-4000-8000-000000000001'::uuid, '69000000-0000-4000-8000-000000000001'::uuid,
    false, false, false, true, '[]'::jsonb
  )$$,
  'assert_valid_stage_list accepts an empty route when neither contains_minors nor author_is_minor nor any_review_required apply'
);

select * from finish();
rollback;
