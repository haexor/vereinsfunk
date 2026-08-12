begin;

-- The CHECK added in 2026081105 predates the Anthropic adapter (apps/worker/src/textGeneration.ts,
-- GENERATORS['anthropic']) and still only let 'openai' be active. Without this, activating an
-- Anthropic configuration -- now offered in the admin form -- fails with 23514.
alter table public.llm_provider_configurations
  drop constraint llm_provider_configurations_active_implemented_adapter_check;
alter table public.llm_provider_configurations
  add constraint llm_provider_configurations_active_implemented_adapter_check
  check (not is_active or (task_kind = 'text_generation' and protocol in ('openai', 'anthropic')));

commit;
