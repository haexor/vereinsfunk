begin;

-- Validates the NOT VALID constraint added in 2026081105 under SHARE UPDATE EXCLUSIVE, which
-- allows concurrent reads and writes, instead of the ACCESS EXCLUSIVE a combined statement holds.
alter table public.llm_provider_configurations
  validate constraint llm_provider_configurations_active_implemented_adapter_check;

commit;
