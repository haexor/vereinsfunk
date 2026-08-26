begin;

-- Review PR #181: doNotMention (das manuelle "Nicht erwähnen"-Freitextfeld) ist entfernt --
-- SourceMaterialSchema (packages/contracts/src/content.ts) traegt es nicht mehr. Was tatsaechlich
-- in composition_sessions.source_material/submissions.source_material liegt, ist die um die zum
-- Anlagezeitpunkt geltende organisationsweite Sperrliste ergaenzte Eingabe (StoredSourceMaterialSchema)
-- -- ausschliesslich serverseitig gesetzt (textGenerationSessions.ts, routes/content.ts), nie Teil
-- der Nutzer- oder Agent-Eingabe. Beide CHECKs folgen dem Feldwechsel, sonst schlaegt jede Sitzungs-/
-- Beitragserzeugung an der Datenbank fehl.

-- Bestandszeilen zuerst auf die neue Form bringen, bevor der CHECK unten sie verlangt -- sonst
-- schlaegt VALIDATE CONSTRAINT an jeder vorhandenen Zeile fehl, die noch doNotMention statt
-- forbiddenTopics traegt (oder, bei composition_sessions, ueberhaupt zum ersten Mal gegen diese
-- Form geprueft wird -- die Tabelle hatte bislang keinen eigenen source_material-CHECK). Migriert
-- vorhandenes doNotMention 1:1 nach forbiddenTopics; ohne rekonstruierbaren Wert bleibt die
-- dokumentierte Rueckfalloption [] (leere Sperrliste).
update public.composition_sessions
set source_material = jsonb_build_object(
  'facts', case when jsonb_typeof(source_material->'facts') = 'object' then source_material->'facts' else '{}'::jsonb end,
  'observations', case when jsonb_typeof(source_material->'observations') = 'array' then source_material->'observations' else '[]'::jsonb end,
  'quotes', case when jsonb_typeof(source_material->'quotes') = 'array' then source_material->'quotes' else '[]'::jsonb end,
  'forbiddenTopics', case
    when jsonb_typeof(source_material->'forbiddenTopics') = 'array' then source_material->'forbiddenTopics'
    when jsonb_typeof(source_material->'doNotMention') = 'array' then source_material->'doNotMention'
    else '[]'::jsonb
  end
)
where not (
  jsonb_typeof(source_material) = 'object'
  and source_material ?& array['facts', 'observations', 'quotes', 'forbiddenTopics']
  and jsonb_typeof(source_material->'facts') = 'object'
  and jsonb_typeof(source_material->'observations') = 'array'
  and jsonb_typeof(source_material->'quotes') = 'array'
  and jsonb_typeof(source_material->'forbiddenTopics') = 'array'
);

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

update public.submissions
set source_material = jsonb_build_object(
  'facts', case when jsonb_typeof(source_material->'facts') = 'object' then source_material->'facts' else '{}'::jsonb end,
  'observations', case when jsonb_typeof(source_material->'observations') = 'array' then source_material->'observations' else '[]'::jsonb end,
  'quotes', case when jsonb_typeof(source_material->'quotes') = 'array' then source_material->'quotes' else '[]'::jsonb end,
  'forbiddenTopics', case
    when jsonb_typeof(source_material->'forbiddenTopics') = 'array' then source_material->'forbiddenTopics'
    when jsonb_typeof(source_material->'doNotMention') = 'array' then source_material->'doNotMention'
    else '[]'::jsonb
  end
)
where not (
  jsonb_typeof(source_material) = 'object'
  and source_material ?& array['facts', 'observations', 'quotes', 'forbiddenTopics']
  and jsonb_typeof(source_material->'facts') = 'object'
  and jsonb_typeof(source_material->'observations') = 'array'
  and jsonb_typeof(source_material->'quotes') = 'array'
  and jsonb_typeof(source_material->'forbiddenTopics') = 'array'
);

-- Denselben Typ-Prüfungen wie composition_sessions unterworfen (vorher liess submissions_material_check
-- z. B. einen String statt eines Arrays fuer forbiddenTopics unbemerkt durch).
alter table public.submissions drop constraint submissions_material_check;
alter table public.submissions add constraint submissions_material_check check (
  jsonb_typeof(source_material) = 'object'
  and source_material ?& array['facts', 'observations', 'quotes', 'forbiddenTopics']
  and jsonb_typeof(source_material->'facts') = 'object'
  and jsonb_typeof(source_material->'observations') = 'array'
  and jsonb_typeof(source_material->'quotes') = 'array'
  and jsonb_typeof(source_material->'forbiddenTopics') = 'array'
) not valid;
alter table public.submissions validate constraint submissions_material_check;

commit;
