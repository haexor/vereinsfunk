begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- Paket 046: mehrere LLM-Provider koennen gleichzeitig einen Vorschlag liefern.
-- create_text_generation_session erzeugt dafuer eine ganze Runde (mehrere generation_candidates,
-- eine je uebergebenem Provider) statt genau eines Kandidaten. Diese Datei deckt genau das ab, was
-- text_workshop_foundation.test.sql (Ensemble-Groesse 1 ueberall) nicht pruefen kann: echten
-- Mehrfach-Fan-out, das rundenweite Alles-oder-nichts-Limit, den Status-Race-Fix zwischen
-- gleichzeitig fertigwerdenden Geschwister-Kandidaten, und die Recovery-Sonderbehandlung
-- (genau ein Ersatzkandidat, in derselben Runde wie der festgefahrene).

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '46000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ensemble@test.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('46000000-1000-4000-8000-000000000001', 'Ensemble Organization', 'ensemble-organization');
insert into public.departments (id, organization_id, name, slug) values
  ('46000000-1100-4000-8000-000000000001', '46000000-1000-4000-8000-000000000001', 'Ensemble Department', 'ensemble-department');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', 'editor');
insert into public.llm_provider_configurations (id, label, protocol, base_url, model, priority) values
  ('46000000-4000-4000-8000-000000000001', 'Ensemble Provider A', 'openai', 'https://provider-a.example.test', 'model-a', 100),
  ('46000000-4000-4000-8000-000000000002', 'Ensemble Provider B', 'openai', 'https://provider-b.example.test', 'model-b', 200),
  ('46000000-4000-4000-8000-000000000003', 'Ensemble Provider C', 'openai', 'https://provider-c.example.test', 'model-c', 300);

-- ===========================================================================================
-- Fan-out: ein Aufruf mit drei Providern erzeugt drei Kandidaten und drei Outbox-Eintraege,
-- alle in derselben Runde.
-- ===========================================================================================
select lives_ok(
  $$select public.create_text_generation_session(
    '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', null,
    'inform', '["text_post"]'::jsonb,
    '{"facts":{"title":"Ensembletraining"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{}'::jsonb, '{}'::jsonb, array['instagram']::text[], 2200, 0.6, 1,
    encode(sha256('ensemble-fan-out'::bytea), 'hex'), encode(sha256('ensemble-fan-out-candidate'::bytea), 'hex'), 'initial', null,
    '46000000-0000-4000-8000-000000000001', gen_random_uuid(), 'ensemble-fan-out',
    array['46000000-4000-4000-8000-000000000001', '46000000-4000-4000-8000-000000000002', '46000000-4000-4000-8000-000000000003']::uuid[]
  )$$,
  'a round with three providers succeeds'
);
select id as ensemble_session_id from public.composition_sessions where organization_id = '46000000-1000-4000-8000-000000000001' and input_hash = encode(sha256('ensemble-fan-out'::bytea), 'hex') \gset
select is((select count(*)::integer from public.generation_candidates where composition_session_id = :'ensemble_session_id'), 3, 'three providers produce three candidate rows');
select is((select count(distinct provider_configuration_id)::integer from public.generation_candidates where composition_session_id = :'ensemble_session_id'), 3, 'each candidate is assigned a distinct provider');
select is((select count(distinct round_input_hash)::integer from public.generation_candidates where composition_session_id = :'ensemble_session_id'), 1, 'all three candidates of one round share the same round_input_hash');
select is((select count(distinct input_hash)::integer from public.generation_candidates where composition_session_id = :'ensemble_session_id'), 3, 'each candidate still has its own unique input_hash despite sharing a round');
select is((select count(*)::integer from public.workflow_outbox where workflow_name = 'generate-text-post' and entity_id = :'ensemble_session_id'::uuid), 3, 'each candidate of the round gets its own outbox delivery');
select is((select count(distinct payload->>'idempotencyKey')::integer from public.workflow_outbox where workflow_name = 'generate-text-post' and entity_id = :'ensemble_session_id'::uuid), 3, 'each delivery carries a distinct idempotencyKey so Hatchet cannot dedupe siblings against each other');
select is((select candidate_count from public.composition_sessions where id = :'ensemble_session_id'), 3, 'candidate_count reflects the whole round, not just one row');

-- A repeated call with the identical round hash is idempotent: it returns the existing three
-- candidates instead of creating a fourth set.
select lives_ok(
  $$select public.create_text_generation_session(
    '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', null,
    'inform', '["text_post"]'::jsonb,
    '{"facts":{"title":"Ensembletraining"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{}'::jsonb, '{}'::jsonb, array['instagram']::text[], 2200, 0.6, 1,
    encode(sha256('ensemble-fan-out'::bytea), 'hex'), encode(sha256('ensemble-fan-out-candidate'::bytea), 'hex'), 'initial', null,
    '46000000-0000-4000-8000-000000000001', gen_random_uuid(), 'ensemble-fan-out-retry',
    array['46000000-4000-4000-8000-000000000001', '46000000-4000-4000-8000-000000000002', '46000000-4000-4000-8000-000000000003']::uuid[]
  )$$,
  'retrying the exact same round is idempotent'
);
select is((select count(*)::integer from public.generation_candidates where composition_session_id = :'ensemble_session_id'), 3, 'a retried round does not create additional candidates');

select throws_ok(
  $$select public.create_text_generation_session(
    '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', null,
    'inform', '["text_post"]'::jsonb, '{"facts":{"title":"x"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{}'::jsonb, '{}'::jsonb, array['instagram']::text[], 2200, 0.6, 1,
    encode(sha256('ensemble-empty-round'::bytea), 'hex'), encode(sha256('ensemble-empty-round-candidate'::bytea), 'hex'), 'initial', null,
    '46000000-0000-4000-8000-000000000001', gen_random_uuid(), 'ensemble-empty-round', array[]::uuid[]
  )$$,
  'P0001', 'invalid_provider_configuration_ids',
  'negative: an empty provider array is rejected instead of silently creating zero candidates'
);

-- ===========================================================================================
-- Rundenweites Alles-oder-nichts-Limit: nahe am Deckel reicht das Kontingent nicht mehr fuer
-- eine volle Dreier-Runde -- die gesamte Anfrage wird abgelehnt, keine Teilrunde entsteht.
-- ===========================================================================================
insert into public.composition_sessions (id, organization_id, department_id, team_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, status, candidate_count, created_by) values
  ('46000000-2000-4000-8000-000000000001', '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', null, 'inform', '["text_post"]', '{"facts":{"title":"Limittraining"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, encode(sha256('ensemble-limit-session'::bytea), 'hex'), 'queued', 6, '46000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.create_text_generation_session(
    '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', null,
    'inform', '["text_post"]'::jsonb, '{"facts":{"title":"Limittraining"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{}'::jsonb, '{}'::jsonb, array['instagram']::text[], 2200, 0.6, 1,
    encode(sha256('ensemble-limit-session'::bytea), 'hex'), encode(sha256('ensemble-limit-round'::bytea), 'hex'), 'revise', 'Kuerzer bitte',
    '46000000-0000-4000-8000-000000000001', gen_random_uuid(), 'ensemble-limit-round',
    array['46000000-4000-4000-8000-000000000001', '46000000-4000-4000-8000-000000000002', '46000000-4000-4000-8000-000000000003']::uuid[]
  )$$,
  'P0001', 'composition_session_candidate_limit_reached',
  'negative: a round of three is rejected entirely when only two slots remain, not silently shrunk to two'
);
select is((select candidate_count from public.composition_sessions where id = '46000000-2000-4000-8000-000000000001'), 6, 'a rejected round leaves candidate_count untouched');
select is((select count(*)::integer from public.generation_candidates where composition_session_id = '46000000-2000-4000-8000-000000000001'), 0, 'a rejected round creates no partial candidates');

-- ===========================================================================================
-- Status-Aggregat: zwei gleichzeitig fertigwerdende Geschwister-Kandidaten duerfen sich nicht
-- gegenseitig mit "..._update_lost" aus dem Tritt bringen (der urspruengliche Fund dieses Pakets).
-- ===========================================================================================
-- Sekundaer nach id sortiert, nicht weil die Reihenfolge fachlich etwas bedeutet, sondern weil
-- alle drei Zeilen derselben Transaktion denselben now() tragen (Postgres friert now() je
-- Transaktion ein) -- ohne Tiebreak waere die Zuordnung zu a/b/c nicht reproduzierbar.
select id as status_a_id, provider_configuration_id as status_a_provider from public.generation_candidates where composition_session_id = :'ensemble_session_id' order by created_at, id limit 1 \gset
select id as status_b_id from public.generation_candidates where composition_session_id = :'ensemble_session_id' and id <> :'status_a_id' order by created_at, id limit 1 \gset
select id as status_c_id from public.generation_candidates where composition_session_id = :'ensemble_session_id' and id not in (:'status_a_id', :'status_b_id') \gset
select public.acquire_generation_candidate(:'status_a_id', :'ensemble_session_id', '46000000-1000-4000-8000-000000000001');
select public.acquire_generation_candidate(:'status_b_id', :'ensemble_session_id', '46000000-1000-4000-8000-000000000001');
select lives_ok(
  format($$select public.mark_generation_candidate_ready('%s', '%s', (select generation_lease_token from public.generation_candidates where id = '%s'), '{}'::jsonb, '%s', 'model-a', repeat('a', 64), 'v1')$$, :'status_a_id', :'ensemble_session_id', :'status_a_id', :'status_a_provider'),
  'the first candidate of a round can be marked ready while its siblings are still pending/generating'
);
select is((select status::text from public.composition_sessions where id = :'ensemble_session_id'), 'generating', 'the session stays generating while unfinished siblings remain in the round, not candidate_ready yet');
select lives_ok(
  format($$select public.mark_generation_candidate_failed('%s', '%s', (select generation_lease_token from public.generation_candidates where id = '%s'), 'provider_error')$$, :'status_b_id', :'ensemble_session_id', :'status_b_id'),
  'a second, concurrently finishing sibling of the same round can also be marked failed without the exception the original single-candidate precondition would have raised'
);
select is((select status::text from public.composition_sessions where id = :'ensemble_session_id'), 'queued', 'the third candidate is still pending, so the session reflects that instead of jumping ahead');
select public.acquire_generation_candidate(:'status_c_id', :'ensemble_session_id', '46000000-1000-4000-8000-000000000001');
select public.mark_generation_candidate_failed(:'status_c_id'::uuid, :'ensemble_session_id'::uuid, (select generation_lease_token from public.generation_candidates where id = :'status_c_id'), 'provider_error');
select is((select status::text from public.composition_sessions where id = :'ensemble_session_id'), 'candidate_ready', 'once every candidate of the round is terminal and at least one is ready, the session becomes candidate_ready');

-- ===========================================================================================
-- Recovery-Sonderfall: p_triggered_by = 'automatic_recovery' darf eine 'initial'-Runde auf einer
-- bereits bestehenden Sitzung ersetzen (der in diesem Paket gefundene, unabhaengige Bug), und der
-- Ersatzkandidat reiht sich ueber p_round_input_hash in dieselbe Runde ein wie das Original.
-- ===========================================================================================
insert into public.composition_sessions (id, organization_id, department_id, team_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, status, candidate_count, created_by) values
  ('46000000-3000-4000-8000-000000000001', '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', null, 'inform', '["text_post"]', '{"facts":{"title":"Recoverytraining"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, encode(sha256('ensemble-recovery-session'::bytea), 'hex'), 'generating', 1, '46000000-0000-4000-8000-000000000001');
insert into public.generation_candidates (id, organization_id, composition_session_id, generation_intent, status, input_hash, round_input_hash, provider_configuration_id, generation_lease_token, updated_at) values
  ('46000000-3010-4000-8000-000000000001', '46000000-1000-4000-8000-000000000001', '46000000-3000-4000-8000-000000000001', 'initial', 'generating', encode(sha256('ensemble-recovery-original'::bytea), 'hex'), encode(sha256('ensemble-recovery-round'::bytea), 'hex'), '46000000-4000-4000-8000-000000000001', gen_random_uuid(), now() - interval '20 minutes');
select throws_ok(
  $$select public.create_text_generation_session(
    '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', null,
    'inform', '["text_post"]'::jsonb, '{"facts":{"title":"Recoverytraining"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{}'::jsonb, '{}'::jsonb, array['instagram']::text[], 2200, 0.6, 1,
    encode(sha256('ensemble-recovery-session'::bytea), 'hex'), encode(sha256('ensemble-recovery-member-retry'::bytea), 'hex'), 'initial', null,
    '46000000-0000-4000-8000-000000000001', gen_random_uuid(), 'ensemble-recovery-member-retry',
    array['46000000-4000-4000-8000-000000000002']::uuid[]
  )$$,
  'P0001', 'composition_session_generation_conflict',
  'negative: a MEMBER-triggered initial round on an already-existing session without a matching round still conflicts, exactly as before this package'
);
select lives_ok(
  $$select public.create_text_generation_session(
    '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', null,
    'inform', '["text_post"]'::jsonb, '{"facts":{"title":"Recoverytraining"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{}'::jsonb, '{}'::jsonb, array['instagram']::text[], 2200, 0.6, 1,
    encode(sha256('ensemble-recovery-session'::bytea), 'hex'), encode(sha256('46000000-3010-4000-8000-000000000001:recovery'::bytea), 'hex'), 'initial', null,
    '46000000-0000-4000-8000-000000000001', gen_random_uuid(), 'ensemble-recovery-attempt',
    array['46000000-4000-4000-8000-000000000001']::uuid[], 'automatic_recovery', encode(sha256('ensemble-recovery-round'::bytea), 'hex')
  )$$,
  'a RECOVERY-triggered initial round on the same already-existing session succeeds -- the bug this package fixes alongside the ensemble feature'
);
select is((select count(*)::integer from public.generation_candidates where composition_session_id = '46000000-3000-4000-8000-000000000001'), 2, 'recovery adds exactly one replacement candidate, not a whole new ensemble round');
select is((select count(distinct round_input_hash)::integer from public.generation_candidates where composition_session_id = '46000000-3000-4000-8000-000000000001'), 1, 'the recovery replacement joins the original stalled candidate''s round instead of starting a fresh one');

select * from finish();
rollback;
