begin;

-- Review PR #181: doNotMention (das manuelle "Nicht erwähnen"-Freitextfeld) ist entfernt --
-- SourceMaterialSchema (packages/contracts/src/content.ts) traegt es nicht mehr. Was tatsaechlich
-- in composition_sessions.source_material/submissions.source_material liegt, ist die um die zum
-- Anlagezeitpunkt geltende organisationsweite Sperrliste ergaenzte Eingabe (StoredSourceMaterialSchema)
-- -- ausschliesslich serverseitig gesetzt (textGenerationSessions.ts, routes/content.ts), nie Teil
-- der Nutzer- oder Agent-Eingabe. Beide CHECKs folgen dem Feldwechsel, sonst schlaegt jede Sitzungs-/
-- Beitragserzeugung an der Datenbank fehl.

alter table public.composition_sessions drop constraint composition_sessions_source_material_check;
alter table public.composition_sessions add constraint composition_sessions_source_material_check check (
  jsonb_typeof(source_material) = 'object'
  and source_material ?& array['facts', 'observations', 'quotes', 'forbiddenTopics']
  and jsonb_typeof(source_material->'facts') = 'object'
  and jsonb_typeof(source_material->'observations') = 'array'
  and jsonb_typeof(source_material->'quotes') = 'array'
  and jsonb_typeof(source_material->'forbiddenTopics') = 'array'
  and (
    source_material->'facts' <> '{}'::jsonb
    or jsonb_array_length(source_material->'observations') > 0
    or jsonb_array_length(source_material->'quotes') > 0
  )
) not valid;
alter table public.composition_sessions validate constraint composition_sessions_source_material_check;

alter table public.submissions drop constraint submissions_material_check;
alter table public.submissions add constraint submissions_material_check
  check (jsonb_typeof(source_material) = 'object' and source_material ?& array['facts', 'observations', 'quotes', 'forbiddenTopics']) not valid;
alter table public.submissions validate constraint submissions_material_check;

commit;
