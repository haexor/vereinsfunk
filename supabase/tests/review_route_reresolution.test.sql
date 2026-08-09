begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

set local role postgres;

-- Verein, Abteilung, Personen. author=Einreichender, medien=benannte Abteilungsprueferin,
-- verwalter=Abteilungsleitung (department_admin, darf neu aufloesen), org_admin=Vereinsleitung
-- (any_with_permission-Kandidatin auf Vereinsebene), aussenstehend=kein Mitglied dieses Vereins.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'author@pgtap-reresolve.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'medien@pgtap-reresolve.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'verwalter@pgtap-reresolve.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'org-admin@pgtap-reresolve.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'neue-medien@pgtap-reresolve.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('65000000-1000-4000-8000-000000000001', 'PGTAP Reresolve Verein', 'pgtap-reresolve-verein');
insert into public.departments (id, organization_id, name, slug) values
  ('65000000-1100-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', 'Fußball', 'fussball');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('65000000-1000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000004', 'organization_admin');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', 'editor'),
  ('65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', '65000000-0000-4000-8000-000000000002', 'approver'),
  ('65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', '65000000-0000-4000-8000-000000000003', 'department_admin'),
  ('65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', '65000000-0000-4000-8000-000000000005', 'approver');

-- Abteilung verlangt eine benannte Pruefstufe (Medien...002), Verein keine eigene Stufe.
insert into public.policy_settings (organization_id, scope, review_required, updated_by) values
  ('65000000-1000-4000-8000-000000000001', 'organization', false, '65000000-0000-4000-8000-000000000004');
insert into public.policy_settings (organization_id, scope, department_id, review_required, review_mode, review_stage_label, updated_by) values
  ('65000000-1000-4000-8000-000000000001', 'department', '65000000-1100-4000-8000-000000000001', true, 'named', 'Medienverantwortliche', '65000000-0000-4000-8000-000000000003');
insert into public.policy_reviewers (organization_id, policy_settings_id, kind, user_id, created_by) values
  ('65000000-1000-4000-8000-000000000001',
   (select id from public.policy_settings where organization_id = '65000000-1000-4000-8000-000000000001' and scope = 'department'),
   'user', '65000000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000003');

insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('65000000-2000-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'draft_ready', '65000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('65000000-3000-4000-8000-000000000001', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001');

set local role authenticated;

-- 1-3: authz.resolve_review_route baut aus der Richtlinie oben genau eine Stufe: named, mit der
-- explizit benannten Person (nicht mit irgendeiner Abteilungsrolle), Vereinsstufe fehlt
-- (review_required=false). Als postgres aufgerufen -- die Funktion ist bewusst nicht an
-- authenticated vergeben (siehe Test 26 unten), ihre Rueckgabe haengt nicht von auth.uid() ab.
set local role postgres;
select is(
  (select count(*)::integer from authz.resolve_review_route('65000000-3000-4000-8000-000000000001')),
  1, 'resolve_review_route returns exactly one stage when only the department requires review'
);
select is(
  (select mode::text from authz.resolve_review_route('65000000-3000-4000-8000-000000000001') limit 1),
  'named', 'the single stage uses the configured named mode'
);
select is(
  (select reviewer_user_ids from authz.resolve_review_route('65000000-3000-4000-8000-000000000001') limit 1),
  array['65000000-0000-4000-8000-000000000002'::uuid], 'the named reviewer is exactly the configured person, not every approver-capable role'
);

-- 4: request_approval() hat keinen "stages"-Parameter mehr -- ein Aufruf mit dem alten
-- Zwei-Parameter-Aufruf existiert nicht mehr (Signaturaenderung, siehe Migration).
set local role authenticated;
select throws_ok(
  $$select public.request_approval('65000000-3000-4000-8000-000000000001'::uuid, '[]'::jsonb)$$,
  '42883', null, 'the old two-argument request_approval(uuid, jsonb) no longer exists'
);

-- 5-6: request_approval() legt die vom Aufrufer NICHT beeinflussbare Route tatsaechlich an.
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
select is(
  (select rpc.result->>'status' from (select public.request_approval('65000000-3000-4000-8000-000000000001') as result) rpc),
  'awaiting_approval', 'request_approval creates a real approval request from the self-derived route'
);
select is(
  (select (reviewer_snapshot->0->>'userId')::uuid from public.approval_stages
    where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000001')),
  '65000000-0000-4000-8000-000000000002'::uuid,
  'the created stage names exactly the configured reviewer, not one the submitter could have chosen'
);

-- 7: die Stufe entscheiden, damit unten eine 'satisfied'-Stufe fuer die Neuaufloesung existiert.
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
select public.decide_approval_stage(
  (select id from public.approval_stages where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000001')),
  'approved', null
);
set local role authenticated;
select is(
  (select status::text from public.posts where id = '65000000-2000-4000-8000-000000000001'),
  'approved', 'the post is approved once the single required stage is decided'
);

-- 8-10: reresolve_approval_route -- Vorbedingungen. status muss awaiting_approval sein.
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.reresolve_approval_route((select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000001'), 'Medienverantwortliche ist ausgetreten.')$$,
  'P0001', 'invalid_status', 'reresolve_approval_route refuses a request whose post is not awaiting_approval'
);

-- Ein zweiter Beitrag fuer den eigentlichen Neuaufloesungs-Testlauf.
set local role postgres;
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('65000000-2000-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'draft_ready', '65000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('65000000-3000-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000002', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
select public.request_approval('65000000-3000-4000-8000-000000000002');

-- 9: der Autor darf seine eigene Route nicht neu aufloesen, unabhaengig von seinen Rollen -- eigene
-- Einreichung DURCH die Abteilungsleitung selbst, damit department.manage tatsaechlich vorliegt und
-- der Fehler nicht schon vorher an insufficient_permission haengen bleibt.
set local role postgres;
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('65000000-2000-4000-8000-000000000007', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'draft_ready', '65000000-0000-4000-8000-000000000003');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('65000000-3000-4000-8000-000000000007', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000007', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select public.request_approval('65000000-3000-4000-8000-000000000007');
select throws_ok(
  $$select public.reresolve_approval_route((select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000007'), 'Ich moechte selbst neu aufloesen.')$$,
  'P0001', 'author_cannot_reresolve', 'reresolve_approval_route refuses the author of the version, even with department.manage'
);

-- 10: eine zu kurze Begruendung wird abgelehnt -- nicht erst am Zod-Schema der API.
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.reresolve_approval_route((select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000002'), 'zu kurz')$$,
  'P0001', 'reason_required', 'reresolve_approval_route enforces the reason length itself, not only via the API schema'
);

-- 11: jemand ohne department.manage darf nicht neu aufloesen.
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.reresolve_approval_route((select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000002'), 'Ich bin nur Pruefer, kein Verwalter.')$$,
  'P0001', 'insufficient_permission', 'reresolve_approval_route refuses someone without department.manage'
);

-- 12-16: die eigentliche Neuaufloesung. Richtlinie aendert sich zwischen Einreichung und
-- Neuaufloesung: die alte benannte Pruefer wird durch eine neue Person ersetzt.
set local role postgres;
update public.policy_reviewers set user_id = '65000000-0000-4000-8000-000000000005'
  where policy_settings_id = (select id from public.policy_settings where organization_id = '65000000-1000-4000-8000-000000000001' and scope = 'department');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select is(
  (select (rpc.result->>'status') from (select public.reresolve_approval_route(
    (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000002'), 'Medienverantwortliche ist ausgetreten, neue Person benannt.'
  ) as result) rpc),
  'awaiting_approval', 'reresolve_approval_route succeeds for a department.manage holder who is not the author'
);
select is(
  (select (reviewer_snapshot->0->>'userId')::uuid from public.approval_stages
    where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000002') and status = 'open'),
  '65000000-0000-4000-8000-000000000005'::uuid,
  'the re-resolved stage now names the newly configured reviewer'
);
select is(
  (select count(*)::integer from public.approval_route_changes where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000002')),
  1, 'exactly one approval_route_changes row is recorded for the reresolution'
);
select is(
  (select stages_before -> 0 ? 'reviewerCount' from public.approval_route_changes
    where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000002')),
  true, 'stages_before carries a reviewer COUNT'
);
select is(
  (select stages_before::text ~ 'userId' from public.approval_route_changes
    where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000002')),
  false, 'stages_before never contains a reviewer user id (redacted projection, not a full snapshot history)'
);

-- 17: der Autor liest den Verlauf seiner eigenen Route (approval_route_changes_select).
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.approval_route_changes where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000002')),
  1, 'the author reads the route-change history of their own version'
);

-- 18: ein unbeteiligtes Mitglied ohne Organisationsrolle und ohne Pruefzuweisung sieht den Verlauf nicht.
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'unbeteiligt@pgtap-reresolve.local', '', '{}', '{}', now(), now());
insert into public.departments (id, organization_id, name, slug) values
  ('65000000-1100-4000-8000-000000000002', '65000000-1000-4000-8000-000000000001', 'Marketing', 'marketing');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000002', '65000000-0000-4000-8000-000000000006', 'viewer');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000006', true);
select is(
  (select count(*)::integer from public.approval_route_changes where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000002')),
  0, 'an uninvolved member of another department reads no route-change history'
);

-- 19: eine rejected-Stufe schliesst die Neuaufloesung ganz aus.
set local role postgres;
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('65000000-2000-4000-8000-000000000003', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'draft_ready', '65000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('65000000-3000-4000-8000-000000000003', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000003', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
select public.request_approval('65000000-3000-4000-8000-000000000003');
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000005', true);
select public.decide_approval_stage(
  (select id from public.approval_stages where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000003')),
  'rejected', 'Passt inhaltlich nicht.'
);
set local role postgres;
update public.posts set status = 'awaiting_approval' where id = '65000000-2000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.reresolve_approval_route((select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000003'), 'Ablehnung wegverwalten.')$$,
  'P0001', 'route_has_rejected_stage', 'reresolve_approval_route refuses a request whose route contains a rejected stage'
);

-- 20-22: invalidated_at wirksam machen -- ein invalidierter Medien-Zustand macht eine sonst offene
-- Stufe unentscheidbar, eine Neuaufloesung setzt invalidated_at zurueck.
set local role postgres;
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('65000000-2000-4000-8000-000000000004', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'draft_ready', '65000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('65000000-3000-4000-8000-000000000004', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000004', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
select public.request_approval('65000000-3000-4000-8000-000000000004');
set local role postgres;
update public.approval_requests set invalidated_at = now() where post_version_id = '65000000-3000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000005', true);
select ok(
  not authz.can_decide_stage((select id from public.approval_stages where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000004'))),
  'a stage of an invalidated request cannot be decided, even by the assigned reviewer'
);
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select public.reresolve_approval_route((select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000004'), 'Medium hat sich geaendert, Route neu aufgeloest.');
select is(
  (select invalidated_at from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000004'),
  null, 'reresolve_approval_route clears invalidated_at'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000005', true);
select ok(
  authz.can_decide_stage((select id from public.approval_stages where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000004'))),
  'the stage is decidable again after reresolution'
);

-- 23-25: eine Stufe MIT bereits abgegebener Entscheidung bleibt bestehen und wird nur erweitert --
-- zwei Pruefer noetig, erste Person entscheidet, dann aendert sich die Richtlinie und wird neu
-- aufgeloest: die Entscheidung darf nicht verloren gehen.
set local role postgres;
update public.policy_settings set review_minimum_approvals = 2
  where organization_id = '65000000-1000-4000-8000-000000000001' and scope = 'department';
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('65000000-2000-4000-8000-000000000005', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'draft_ready', '65000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('65000000-3000-4000-8000-000000000005', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000005', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001');
-- Zweite benannte Pruefstelle: die verwaltende Person selbst darf nicht Pruefer sein (department_admin
-- ohne eigenen Reviewer-Eintrag), also Pruefer bleiben ...005 und ...002.
insert into public.policy_reviewers (organization_id, policy_settings_id, kind, user_id, created_by) values
  ('65000000-1000-4000-8000-000000000001',
   (select id from public.policy_settings where organization_id = '65000000-1000-4000-8000-000000000001' and scope = 'department'),
   'user', '65000000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
select public.request_approval('65000000-3000-4000-8000-000000000005');
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000005', true);
select public.decide_approval_stage(
  (select id from public.approval_stages where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000005')),
  'approved', null
);
-- Ein dritter Pruefer wird zusaetzlich benannt, DANACH neu aufgeloest.
set local role postgres;
insert into public.policy_reviewers (organization_id, policy_settings_id, kind, user_id, created_by) values
  ('65000000-1000-4000-8000-000000000001',
   (select id from public.policy_settings where organization_id = '65000000-1000-4000-8000-000000000001' and scope = 'department'),
   'user', '65000000-0000-4000-8000-000000000003', '65000000-0000-4000-8000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select public.reresolve_approval_route((select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000005'), 'Ein dritter Pruefer soll ergaenzt werden.');
select is(
  (select count(*)::integer from public.approval_decisions where approval_stage_id =
    (select id from public.approval_stages where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000005'))),
  1, 'the earlier approval decision on the stage survives the reresolution'
);
select is(
  (select jsonb_array_length(reviewer_snapshot) from public.approval_stages
    where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000005')),
  3, 'the reviewer snapshot of the stage is extended (union), not replaced -- three named reviewers now'
);
select is(
  (select status::text from public.approval_stages
    where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000005')),
  'open', 'the extended stage -- being the only, lowest non-final stage -- is reopened after reresolution'
);

-- 26-27: authz.assert_valid_stage_list bleibt intern -- authenticated erreicht weder es noch
-- authz.resolve_review_route direkt (siehe auch policy_review_routes.test.sql).
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select authz.resolve_review_route('65000000-3000-4000-8000-000000000005'::uuid)$$,
  '42501', null, 'authenticated cannot call authz.resolve_review_route directly'
);
select throws_ok(
  $$select public.reresolve_approval_route('00000000-0000-0000-0000-000000000000'::uuid, 'Eine ausreichend lange Begruendung.')$$,
  'P0001', 'not_found', 'reresolve_approval_route raises not_found for a nonexistent approval_request_id'
);

-- 28-29: Mandantentrennung von approval_route_changes -- ein Mitglied eines FREMDEN Vereins liest
-- nichts, auch nicht ueber is_organization_member.
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'fremdverein@pgtap-reresolve.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('65000000-1000-4000-8000-000000000002', 'PGTAP Reresolve Fremdverein', 'pgtap-reresolve-fremdverein');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('65000000-1000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000007', 'organization_admin');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000007', true);
select is(
  (select count(*)::integer from public.approval_route_changes where organization_id = '65000000-1000-4000-8000-000000000001'),
  0, 'a member of another club reads no approval_route_changes row of this club'
);
select throws_ok(
  $$insert into public.approval_route_changes (organization_id, approval_request_id, changed_by, reason, stages_before)
    values ('65000000-1000-4000-8000-000000000001', (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000005'), auth.uid(), 'Direkter Einfuegeversuch ohne RPC.', '[]'::jsonb)$$,
  '42501', null, 'authenticated has no direct insert grant on approval_route_changes -- only reresolve_approval_route may write it'
);

-- 30-33: dieselbe Zuordnungsschluessel-Logik: eine im neuen Routing entfallene Ebene ohne
-- Entscheidung verschwindet ersatzlos, eine neu hinzugekommene Ebene wird angelegt.
set local role postgres;
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('65000000-2000-4000-8000-000000000006', '65000000-1000-4000-8000-000000000001', '65000000-1100-4000-8000-000000000001', 'draft_ready', '65000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('65000000-3000-4000-8000-000000000006', '65000000-1000-4000-8000-000000000001', '65000000-2000-4000-8000-000000000006', 1, '{}', '{}', 'user', '65000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000001', true);
select public.request_approval('65000000-3000-4000-8000-000000000006');
select is(
  (select count(*)::integer from public.approval_stages where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000006')),
  1, 'exactly one stage exists before the department stops requiring review'
);
-- Abteilung stellt Pruefpflicht ab -- Vereinsebene fordert stattdessen jetzt eine Stufe.
-- review_mode muss mit zurueckgesetzt werden: policy_settings_named_requires_review verbietet
-- review_mode='named' zusammen mit review_required=false.
set local role postgres;
update public.policy_settings set review_required = false, review_mode = null
  where organization_id = '65000000-1000-4000-8000-000000000001' and scope = 'department';
update public.policy_settings set review_required = true, review_mode = 'any_with_permission', review_stage_label = 'Verein'
  where organization_id = '65000000-1000-4000-8000-000000000001' and scope = 'organization';
set local role authenticated;
select set_config('request.jwt.claim.sub', '65000000-0000-4000-8000-000000000003', true);
select public.reresolve_approval_route((select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000006'), 'Pruefpflicht von Abteilung auf Verein verschoben.');
select is(
  (select count(*)::integer from public.approval_stages where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000006')),
  1, 'the dropped department stage disappears without a replacement, the new organization stage is the only one left'
);
select is(
  (select scope::text from public.approval_stages where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000006')),
  'organization', 'the surviving stage is the newly required organization-scope one'
);
select is(
  (select position from public.approval_stages where approval_request_id = (select id from public.approval_requests where post_version_id = '65000000-3000-4000-8000-000000000006')),
  1, 'positions stay gapless and start at 1 after the reresolution'
);

select * from finish();
rollback;
