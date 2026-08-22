begin;

-- Loest 2026081910 ab: die Ensemble-Groesse ist kein separater, vom Betreiber gepflegter Zahlenwert
-- mehr, sondern ergibt sich direkt aus der Anzahl aktiver text_generation-Provider (siehe
-- resolveTextGenerationProviderConfigurationIds, apps/api/src/routes/shared.ts).
delete from public.platform_settings where key = 'text_generation_ensemble_size';

commit;
