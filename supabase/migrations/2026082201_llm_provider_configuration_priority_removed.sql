begin;

-- Paket 050: Prioritaet entfaellt als Auswahlkriterium fuer LLM-Provider. Welche Provider fuer eine
-- Aufgabe genutzt werden, entscheidet allein noch is_active (siehe die neue
-- "Aufgaben-Zuordnung"-Karte in plattform-admin/llm.vue): fuer text_generation zaehlen kuenftig
-- alle aktiven Provider als Ensemble, fuer die uebrigen Aufgabenarten bestimmt is_active allein die
-- Teilnahme -- ein Gleichstand ist damit erlaubt statt wie bisher per Unique-Index verboten.
drop index if exists public.llm_provider_configurations_active_task_priority_unique;
alter table public.llm_provider_configurations drop column priority;

commit;
