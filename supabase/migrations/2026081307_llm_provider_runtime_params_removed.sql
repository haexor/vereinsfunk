begin;

-- Paket 042: temperature/max_output_tokens verlassen llm_provider_configurations. Ein Provider
-- bleibt reine Zugangs-/Routing-Konfiguration (Protokoll, Endpunkt, Modell, Prioritaet). Beide
-- Werte werden Beitrags-Einstellungen (siehe 2026081309), nicht Persona- oder Provider-Merkmale.
alter table public.llm_provider_configurations
  drop column temperature,
  drop column max_output_tokens;

commit;
