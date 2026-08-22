begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

-- CHECK-Constraints greifen unabhaengig von der Rolle (anders als RLS/GRANTs); postgres ist hier
-- kein Sichtbarkeitsproblem wie bei den in feedback_pgtap_fixtures_als_postgres... beschriebenen
-- Faellen, weil keine RLS-Policy und kein GRANT gepruft wird, nur die Tabellen-CHECK selbst.
set local role postgres;

-- 1: vor Migration 2026082101 haette dieser Insert an
-- llm_provider_configurations_active_implemented_adapter_check gescheitert (nur task_kind =
-- 'text_generation' durfte aktiv sein) -- der Vision-Adapter existiert jetzt (packages/content-
-- engine, AnthropicVisionAnalysisGenerator/OpenAiCompatibleVisionAnalysisGenerator).
select lives_ok(
  $$insert into public.llm_provider_configurations (label, protocol, base_url, model, task_kind, is_active)
    values ('PGTAP Vision Provider', 'anthropic', 'https://example.invalid', 'vision-test', 'vision_analysis', true)$$,
  'an active vision_analysis provider with an implemented protocol may now be created'
);

-- 2: die andere, weiterhin unimplementierte Aufgabenart bleibt gesperrt -- die Migration hat das
-- Vokabular nicht pauschal geoeffnet, nur vision_analysis.
select throws_ok(
  $$insert into public.llm_provider_configurations (label, protocol, base_url, model, task_kind, is_active)
    values ('PGTAP Image Provider', 'openai', 'https://example.invalid', 'image-test', 'image_generation', true)$$,
  '23514', null, 'an active image_generation provider is still rejected -- only text_generation and vision_analysis are implemented'
);

select * from finish();
rollback;
