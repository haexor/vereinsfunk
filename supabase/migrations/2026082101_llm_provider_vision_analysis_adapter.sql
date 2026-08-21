begin;

-- Paket 048, PR 2: der Vision-Adapter existiert jetzt tatsaechlich (packages/content-engine,
-- AnthropicVisionAnalysisGenerator/OpenAiCompatibleVisionAnalysisGenerator), deshalb darf ein
-- vision_analysis-Provider ab jetzt aktiviert werden -- bis hierher (PR 1) war task_kind nur ins
-- Vokabular aufgenommen, aber wie image_generation/video_generation von der Aktivierung
-- ausgeschlossen (siehe llm_provider_configurations_task_kind_check aus 2026082007).
alter table public.llm_provider_configurations
  drop constraint llm_provider_configurations_active_implemented_adapter_check;
alter table public.llm_provider_configurations
  add constraint llm_provider_configurations_active_implemented_adapter_check
  check (not is_active or (task_kind in ('text_generation', 'vision_analysis') and protocol in ('openai', 'anthropic')));

commit;
