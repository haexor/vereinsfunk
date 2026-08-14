# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch`, `git fetch origin` und `git log --oneline origin/main..HEAD`.

## Ausgangslage: Plan 042 vollständig umgesetzt (PR 1–3)

`plans/042-llm-laufzeitparameter-vom-provider-zur-sitzung.md` ist die verbindliche Beschreibung. Alle drei PRs sind umgesetzt:

- **PR 1** (`#74`, gemergt): `temperature`/`max_output_tokens` haben `llm_provider_configurations` verlassen. `temperature` ist Beitrags-Einstellung des Mitglieds (vier feste Stufen `TEXT_GENERATION_TEMPERATURE_STEPS`: 0.3 Dezent / 0.6 Ausgewogen / 0.8 Ausgeprägt / 1.0 Vollgas). Die Längengrenze ist eine betreibergepflegte **Zeichen**-Vorgabe je Ziel-Plattform (`text_generation_platform_defaults.max_characters`, kein Token-Budget). Der Ersteller wählt mehrere Ziel-Plattformen (`target_platforms`); die knappste Vorgabe gibt die Länge vor. `targetPlatforms`/`temperature` gehen als Request-Vorgabe in den `input_hash` ein (kritischer Review-Fund: ohne das lieferte ein zweites Absenden mit anderer Reglerstufe stumm den alten Kandidaten); `maxCharacters` ebenso, aber als expliziter Request-Wert oder `null` -- die daraus abgeleitete, aus den Zielplattformen bestimmte Zeichengrenze wird erst danach aufgelöst und eingefroren, zählt aber nicht in den Hash, damit ein Retry nach geänderter Plattform-Vorgabe dieselbe Sitzung findet statt eine neue anzulegen.
- **PR 2** (`#75`, gemergt): Abschnitt "Plattform-Vorgaben" in `plattform-admin/llm.vue` — Instagram/Facebook-Zeilen mit Zeichengrenze, Speichern-Button, 404-Meldung für eine fehlende Vorgabezeile.
- **PR 3** (umgesetzt, Branch `worktree-paket-042-pr3-regler-am-beitrag`, noch als PR zu erstellen/mergen): Regler am Beitrag.
  - `GET /v1/text-generation-capabilities → { temperatureSupported }` (nur `requireAuth`) — der Regler wird in `erstellen.vue` nicht angezeigt, wenn der aktive Text-Provider `anthropic` ist (sendet `temperature` nie).
  - Temperatur-Regler in `erstellen.vue`, vier Stufen mit Hinweistext.
  - `GET /v1/text-generation-platforms?organizationId&departmentId&teamId → [{ platform, available, maxCharacters, reason? }]` plus serverseitige 422-Durchsetzung (`platform_not_available`) in `POST /v1/text-workshop/sessions` — ein Mitglied kann nur Plattformen anhaken, für die ein Kanal eingerichtet ist (`resolveTextGenerationPlatformAvailability`, `apps/api/src/routes/shared.ts`, wiederverwendet `resolveAvailableChannels` aus `@vereinsfunk/domain`).
  - `provider_parameter_hash` (`apps/worker/src/textGeneration.ts`) nimmt `temperature` nur auf, wenn der Adapter sie tatsächlich sendet (`protocol === 'openai'`).
  - Step 4 (getrennte Texte je Plattform bei stark abweichender Länge) ist bewusst **nicht** Teil dieses PRs, siehe unten.

Verifiziert (PR 3): voller Gate (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`) und `pnpm db:reset && pnpm db:test` (746 pgTAP-Tests, PR 3 selbst ändert kein Schema) grün; per Playwright manuell durchgespielt (Regler unsichtbar ohne Provider/Kanal, sichtbar mit aktivem `openai`-Provider, Plattform-Auswahl korrekt ein-/ausgegraut, angelegte Sitzung trägt die richtigen Werte in der DB).

## Nächster Schritt

1. Falls noch nicht geschehen: PR für `worktree-paket-042-pr3-regler-am-beitrag` erstellen und mergen. Damit ist Plan 042 vollständig abgeschlossen bis auf den unten beschriebenen Folgepunkt.

**Als eigenes Paket auszuplanen** (nicht 042): getrennte Texte je Plattform, sobald sich die Zeichengrenzen stark unterscheiden — `GeneratedPostSchema.variants` ist dafür vorhanden und heute leer (Paket 005). Daran hängt die offene fachliche Frage, ob zwei Varianten eine gemeinsame Freigabe erhalten oder je eine eigene, und was gilt, wenn eine freigegeben und eine abgelehnt wird (Freigabekette aus 011/024 arbeitet heute auf **einer** `post_version`). Ebenfalls offen: eine **harte** Prüfung der Zeichengrenze nach der Generierung — heute nennt der System-Prompt die Grenze nur, durchgesetzt wird global über `GeneratedPostSchema.caption` (10000). Zusätzlich vorgesehen sind Twitter/X, LinkedIn und Mastodon als weitere Kanäle; jede neue Plattform braucht eine Seed-Zeile mit ihrer echten Zeichengrenze (STOP conditions in Plan 042).

Alternativ, falls zuerst anderswo weitergearbeitet werden soll: `plans/README.md` führt **038** (Hatchet produktiv betreiben) als geplant, mit dem Befund, dass `vereinsfunk-worker` in Produktion seit dem Merge von Plan 004 crash-loopt — das ist der dringlichste offene Betriebspunkt. **029** und **031** sind weiterhin als bereit markiert.
