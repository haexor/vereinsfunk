# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch`, `git fetch origin` und `git log --oneline origin/main..HEAD`. Falls PR #74 (Plan 042 PR 1, Branch `worktree-paket-042-llm-runtime-params`) noch nicht gemergt ist, das zuerst klären — PR 2 und PR 3 setzen darauf auf.

## Ausgangslage: Plan 042 PR 1 offen (PR #74), Code-Review abgearbeitet

`plans/042-llm-laufzeitparameter-vom-provider-zur-sitzung.md` ist die verbindliche Beschreibung; sie wurde am 2026-08-14 nachträglich verschriftlicht, weil beim Code-Review von PR #74 auffiel, dass dieses Paket als einziges keine committete Plandatei hatte.

PR 1 verschiebt `temperature` und die Längengrenze aus `llm_provider_configurations`:

- **`temperature`** ist Beitrags-Einstellung des Mitglieds, begrenzt auf vier feste Stufen (`TEXT_GENERATION_TEMPERATURE_STEPS`: 0.3 Dezent / 0.6 Ausgewogen / 0.8 Ausgeprägt / 1.0 Vollgas).
- **Die Längengrenze** ist eine betreibergepflegte **Zeichen**-Vorgabe je Ziel-Plattform (`text_generation_platform_defaults.max_characters`, für jedes Mitglied lesbar, nur über Service-Role hinter `requirePlatformAdmin` schreibbar). Kein Token-Budget: die Plattform weist einen zu langen Beitrag ab, Tokens lassen sich darauf nicht verlässlich umrechnen.
- Der Ersteller wählt **mehrere** Ziel-Plattformen (`target_platforms`); die knappste Vorgabe gibt die Länge vor.
- Alle drei Werte werden bei Sitzungsanlage auf `composition_sessions` eingefroren.

**Abweichungen von der Ausplanung**: `drop function` + `create function` statt `create or replace` (die drei neuen RPC-Parameter werden mittig eingefügt, Postgres erkennt das sonst nicht als Ersatz — Muster aus `2026081204`); `apps/web/app/pages/plattform-admin/llm.vue` musste wegen des Contracts-Breaking-Change (`runtimeParameters` entfällt) schon in PR 1 mechanisch mit.

**Aus dem Code-Review nachgezogen** (Commits `6c932e1d`, `67423ef7` und die Folgecommits vom 14.08.): der kritische Fund war der `input_hash` ohne die drei neuen Felder — der `if found`-Zweig von `create_text_generation_session` gibt für einen bekannten Hash die vorhandene Sitzung samt Kandidat zurück und ignoriert die übergebenen Laufzeitwerte, also lieferte ein zweites Absenden desselben Materials mit anderer Reglerstufe stumm den alten Kandidaten. Außerdem `maybeSingle()`+404 statt `single()` auf dem PUT, die vier Kopien von `instagram`/`facebook` zu einer `SocialPlatformSchema` in `primitives.ts` zusammengeführt (die Kanal-Domäne und die Textwerkstatt teilen die Menge jetzt bewusst — ein Zwischenstand hatte sie getrennt, was mit der Kanal-Bindung aus PR 3 falsch wäre), Zeichenspanne und Defaults einmal in den Contracts, eingefrorene Werte in `GET /v1/text-workshop/sessions/:id`, Routentests für beide neuen Endpunkte.

**Bewusst nicht gemacht**: keine Datenmigration der alten Provider-Werte — `temperature 0.2` ist in der neuen Skala kein legaler Wert mehr, und das alte Token-Limit ist ohnehin durch eine Zeichengrenze ersetzt, die der Plattform-Admin in PR 2 pflegt.

Verifiziert: voller Gate (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`) und `pnpm db:reset && pnpm db:test` (746 pgTAP-Tests) auf dem aktuellen Stand, nach jeder Änderungsrunde.

## Nächster Schritt

1. PR #74 mergen.
2. **PR 2** (klein): Vorgaben-Abschnitt in `plattform-admin/llm.vue` — die API-Hälften `GET`/`PUT /v1/text-generation-platform-defaults` existieren seit PR 1 und haben noch keinen Konsumenten.
3. **PR 3**: Regler am Beitrag in `erstellen.vue`. Zwei Punkte vorher klären bzw. beachten:
   - **Entschieden (2026-08-14)**: Läuft für die Textgenerierung ein Anbieter mit `anthropic`-Protokoll, wird der Regler ausgegraut oder nicht angezeigt — der Adapter sendet `temperature` bewusst nicht. Dafür braucht es eine neue schmale Leseroute `GET /v1/text-generation-capabilities → { temperatureSupported: boolean }` (nur `requireAuth`), weil `GET /v1/llm-providers` hinter `requirePlatformAdmin` liegt und die Textwerkstatt ein normales Mitglied benutzt. Nur ein Boolean, damit die Antwort weder Anbieter noch Endpunkt verrät.
   - **Entschieden**: Die Plattform-Auswahl ist im Formular sichtbar, Mehrfachauswahl, beide vorausgewählt — aber **nur Plattformen, auf die der Scope veröffentlichen kann** (Kanäle aus Paket 012, Delegation/Einschränkung aus 011/023). Dafür fehlt eine Leseroute `GET /v1/text-generation-platforms?scope`, und `POST /v1/text-workshop/sessions` muss dieselbe Auflösung serverseitig durchsetzen (422 `platform_not_available`). Details: Plan 042, PR 3, Step 3.
   - Ebenfalls in PR 3: `provider_parameter_hash` nimmt `temperature` heute auch für `anthropic`-Provider auf, die sie nie senden — die Provenienz behauptet damit etwas Falsches.

**Als eigenes Paket auszuplanen** (nicht 042): getrennte Texte je Plattform, sobald sich die Zeichengrenzen stark unterscheiden — `GeneratedPostSchema.variants` ist dafür vorhanden und heute leer (Paket 005). Daran hängt die offene fachliche Frage, ob zwei Varianten eine gemeinsame Freigabe erhalten oder je eine eigene, und was gilt, wenn eine freigegeben und eine abgelehnt wird (Freigabekette aus 011/024 arbeitet heute auf **einer** `post_version`). Ebenfalls offen: eine **harte** Prüfung der Zeichengrenze nach der Generierung — heute nennt der System-Prompt die Grenze nur, durchgesetzt wird global über `GeneratedPostSchema.caption` (2200). Zusätzlich vorgesehen sind Twitter/X, LinkedIn und Mastodon als weitere Kanäle; jede neue Plattform braucht eine Seed-Zeile mit ihrer echten Zeichengrenze (STOP conditions in Plan 042).

Alternativ, falls zuerst anderswo weitergearbeitet werden soll: `plans/README.md` führt **038** (Hatchet produktiv betreiben) als geplant, mit dem Befund, dass `vereinsfunk-worker` in Produktion seit dem Merge von Plan 004 crash-loopt — das ist der dringlichste offene Betriebspunkt. **029** und **031** sind weiterhin als bereit markiert.
