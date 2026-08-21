begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- CHECK-Constraints greifen unabhaengig von der Rolle (anders als RLS/GRANTs); postgres ist hier
-- kein Sichtbarkeitsproblem wie bei den in feedback_pgtap_fixtures_als_postgres... beschriebenen
-- Faellen, weil keine RLS-Policy und kein GRANT gepruft wird, nur die Tabellen-CHECK selbst.
set local role postgres;

-- 1: vor Migration 2026082101 haette dieser Insert an
-- llm_provider_configurations_active_implemented_adapter_check gescheitert (nur task_kind =
-- 'text_generation' durfte aktiv sein) -- der Vision-Adapter existiert jetzt (packages/content-
-- engine, AnthropicVisionAnalysisGenerator/OpenAiCompatibleVisionAnalysisGenerator).
select lives_ok(
  $$insert into public.llm_provider_configurations (label, protocol, base_url, model, task_kind, priority, is_active)
    values ('PGTAP Vision Provider', 'anthropic', 'https://example.invalid', 'vision-test', 'vision_analysis', 200, true)$$,
  'an active vision_analysis provider with an implemented protocol may now be created'
);

-- 2: die andere, weiterhin unimplementierte Aufgabenart bleibt gesperrt -- die Migration hat das
-- Vokabular nicht pauschal geoeffnet, nur vision_analysis.
select throws_ok(
  $$insert into public.llm_provider_configurations (label, protocol, base_url, model, task_kind, priority, is_active)
    values ('PGTAP Image Provider', 'openai', 'https://example.invalid', 'image-test', 'image_generation', 201, true)$$,
  '23514', null, 'an active image_generation provider is still rejected -- only text_generation and vision_analysis are implemented'
);

-- 3-4: der Loesungsteil des Kommentars in platform_administration.test.sql ("laesst sich hier
-- nicht pruefen, solange jede aktive Zeile ausser text_generation verboten ist") -- der partielle
-- Unique-Index (task_kind, priority) where is_active (2026081305) ist je Aufgabenart getrennt:
-- eine aktive vision_analysis-Zeile darf dieselbe Prioritaet tragen wie eine aktive
-- text_generation-Zeile, ohne den Unique-Index zu verletzen.
select lives_ok(
  $$insert into public.llm_provider_configurations (label, protocol, base_url, model, task_kind, priority, is_active)
    values ('PGTAP Text Provider Same Priority', 'openai', 'https://example.invalid', 'text-test', 'text_generation', 300, true)$$,
  'an active text_generation provider can take a priority'
);
select lives_ok(
  $$insert into public.llm_provider_configurations (label, protocol, base_url, model, task_kind, priority, is_active)
    values ('PGTAP Vision Provider Same Priority', 'anthropic', 'https://example.invalid', 'vision-test-2', 'vision_analysis', 300, true)$$,
  'an active vision_analysis provider may reuse the same priority as an active text_generation provider -- the unique index is scoped per task_kind'
);

select * from finish();
rollback;
