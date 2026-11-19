# Veo-Sync: Fehler eingrenzen

Veo hat keine offizielle API. `packages/veo-client` prüft jede Antwort mit einem Zod-Schema. Passt
die Form nicht mehr, wird die nicht lesbare Antwort nicht übernommen. Bereits durch `applyMatch`
gespeicherte Werte bleiben bestehen; der Worker markiert den Lauf als `failed` und führt keinen
Rollback der vorherigen Schreibvorgänge aus. Der Nacht-Sync (05:00 UTC) kann bis zur Schema-Anpassung
an derselben Veo-Antwort scheitern.

## Wo der Fehler sichtbar wird

- `playerboard_veo_links.last_error_code` und `consecutive_failures`; ab dem dritten Fehlversuch
  geht eine Mail an die Trainer.
- `integration_sync_runs.error_class` und `progress` je Lauf. `progress.matchesDone = 0` bei
  `matchesTotal > 0` heißt: Anmeldung und Spieleliste gingen, aber der erste Spiel-Abruf oder eine
  anschließende Analyse brach ab. Bei einem Analysefehler können Matchdaten bereits gespeichert sein.
- Worker-Log (`docker logs vereinsfunk-worker`), Meldung `veo sync failed` bzw.
  `veo match skipped` / `veo analysis skipped`. Felder:

| Feld | Bedeutung |
|---|---|
| `errorClass` | `auth_expired`, `upstream_changed`, `upstream_error`, … |
| `step` | `list`, `values`, `analysis` oder `tracks`: wo der Lauf stand |
| `veoMatchId` | Spiel, an dem er stand (Veo-ID, kein Personenbezug) |
| `status` | HTTP-Status von Veo, falls vorhanden |
| `errorMessage` | nur bei Veo-Fehlern; nennt Endpunkt und abweichende Felder |

`errorMessage` bei `upstream_changed` hat die Form
`Unexpected Veo team stats response shape: items[].stats[].value: Invalid input: expected int, received number`.
Listenindizes erscheinen als `[]`. Die Meldung enthält Pfad und Typ, nie Werte der Antwort; Meldungen
anderer Fehler (Datenbank, Laufzeit) werden bewusst nicht geloggt.

Die API schreibt dasselbe als `veo request failed` (Verbinden und Mannschaftsauswahl).

## Ursache beheben

1. Aus `errorMessage` Endpunkt und Feld ablesen, das Schema in `packages/veo-client/src/client.ts`
   (bzw. `analysis.ts`, `matchReport.ts`) anpassen, einen Test mit der geänderten Form ergänzen.
2. Prüfen, ob die Datenbank den neuen Wert aufnimmt (Spaltentyp, CHECK-Constraints, SQL-Funktionen
   `playerboard_veo_apply_match`) und ob Contracts in `packages/contracts` ihn zulassen.
3. Nach dem Merge rollt Watchtower die Images aus; der nächste Lauf holt die Spiele nach. Ein
   sofortiger Lauf geht über „Jetzt abgleichen" im PlayerBoard.

Reicht die Meldung nicht, hilft ein Blick in die Veo-Web-App: Ihr Frontend-Bundle
(`https://app.veo.co/` → `bootstrap-*.js`) zeigt, welche Felder und Parameter sie selbst nutzt.

## Beispiel: Kommazahlen in Mannschaftswerten (2026-11-17)

Veo lieferte in `POST /analysis/stats/` (`team_match`) plötzlich `value` mit Nachkommastellen. Das
Schema verlangte `z.number().int()`, der Lauf brach beim ersten Spiel mit `upstream_changed` ab.
Behoben durch `z.number()`; die Spalten sind `numeric`.
