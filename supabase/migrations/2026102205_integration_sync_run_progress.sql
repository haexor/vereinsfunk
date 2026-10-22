-- Spec 002: Fortschritt eines laufenden Abgleichs fuer die Anzeige im PlayerBoard. Ein Veo-Lauf
-- dauert mit Positionsdaten bis zu zehn Minuten; ohne Zwischenstand sah er wie haengend aus. Der
-- Worker schreibt den Stand per Service-Rolle, die API liest ihn mit den Laeufen. Er ist nur eine
-- Anzeige: kein Fachwert haengt daran, und ein Lauf endet unabhaengig davon. Der Inhalt bleibt
-- nach dem Ende stehen, damit die Liste zeigt, wie viele Analysen auf den naechsten Lauf warten.
alter table public.integration_sync_runs
  add column progress jsonb
    check (progress is null or (jsonb_typeof(progress) = 'object' and pg_column_size(progress) <= 2048));
