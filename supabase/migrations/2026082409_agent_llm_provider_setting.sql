begin;

-- Die Auswahl referenziert bewusst nur eine bestehende LLM-Konfiguration. API-Schluessel
-- bleiben ausschliesslich in llm_provider_secrets und werden nie in platform_settings oder an
-- den Browser geschrieben. NULL erhaelt den bisherigen Deployment-Fallback (OPENAI_API_KEY).
insert into public.platform_settings (key, value)
values ('agent_llm_provider_configuration_id', 'null'::jsonb)
on conflict (key) do nothing;

commit;
