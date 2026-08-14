# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch`, `git fetch origin` und `git log --oneline origin/main..HEAD`. Paket 042 ist vollständig abgeschlossen: PR #74 (PR 1), #75 (PR 2) und #76 (PR 3, samt Review-Fixes) sind alle gemergt.

## Ausgangslage: Paket 042 abgeschlossen, Paket 039 ausgeplant

`plans/042-llm-laufzeitparameter-vom-provider-zur-sitzung.md` ist umgesetzt. `temperature` ist eine Beitrags-Einstellung des Mitglieds (vier feste Stufen), die Längengrenze eine betreibergepflegte **Zeichen**-Vorgabe je Ziel-Plattform, und die Zielplattform-Auswahl ist auf das begrenzt, worauf der Scope tatsächlich veröffentlichen kann (422 `platform_not_available`). Step 4 des Plans — getrennte Texte je Plattform — ist bewusst ein eigenes Folgepaket geblieben.

### Aus dem Code-Review von PR #76 nachgezogen (Commit `4cac8c0c`)

- **`no_channel` verdeckte richtlinienbedingte Ausschlüsse.** Beide Vergleichsauflösungen trugen `require_channel_responsible`, also meldete die Route für einen existierenden Kanal ohne verantwortliche Person „kein Kanal eingerichtet" — der Verein hätte einen zweiten Kanal angelegt statt die Person einzutragen. Die Vergleichsauflösung lässt jetzt **alle** Richtlinien fallen.
- **Regression bei der Zeichengrenze.** Eine fehlende `text_generation_platform_defaults`-Zeile zählte über den eingesetzten Fallback in der `min()`-Bildung mit und zog eine höher gesetzte Vorgabe herunter. `resolveTextGenerationPlatformAvailability` gibt `maxCharacters` jetzt als `number | null` zurück; der Fallback sitzt beim Aufrufer, der ihn wirklich braucht (Anzeige), nicht in der geteilten Auflösung.
- **`GET /v1/text-generation-capabilities`** wählt den Provider mit demselben `llm_provider_secrets!inner`-Join wie `loadActiveTextProvider()` im Worker — ohne ihn meldete die Route das Protokoll einer Zeile, die nie generiert.
- `providerSendsTemperature()` als **eine** Quelle statt zweier `protocol === 'openai'`-Vergleiche in API und Worker; `toChannelCandidates()` mit `routes/channels.ts` geteilt.
- Drei Ehrlichkeitsfehler in `erstellen.vue`: pauschaler Erklärtext statt des tatsächlichen Grundes, „Modell unterstützt das nicht" bei bloß fehlgeschlagener Abfrage (samt stillem Verlust der gewählten Stufe), ausgeblendetes Feld nach Ladefehler.
- **Test-Fake für `policy_settings`** bildet beide Lesearten ab (Array *und* `maybeSingle`). Vorher lief jeder Test mit `require_channel_responsible = false`, egal was seine Vorrichtung behauptete.

## Nächster Schritt

**Paket 039** (`plans/039-vereins-website-als-kanal.md`, am 2026-08-14 ausgeplant) ist der fachlich dringlichste Punkt, weil Paket 042 eine Sackgasse hinterlassen hat: seit PR 3 verlangt `targetPlatforms` mindestens einen Eintrag und die Route lehnt jede Plattform ohne Kanal ab — **ein Verein ohne Instagram- oder Facebook-Kanal kann die Textwerkstatt damit überhaupt nicht mehr benutzen.**

Betreiberentscheidung vom 2026-08-14: der eigene Blog ist **ein Kanal wie jeder andere**. Vom Vereins-Admin angelegt, über `channel_scopes` den Abteilungen zugeteilt, mit eigener Längengrenze unterhalb der harten Obergrenze (`MaxCharactersSchema`, 100–10000). Damit braucht die Textwerkstatt keinen Sonderfall — `resolveAvailableChannels` beantwortet die Frage für einen Blog wie für Instagram, und die Sackgasse löst sich als Nebenwirkung.

Zwei Dinge sind beim Umsetzen wichtig:

1. **`social_connections` kennt heute keinen Anlageweg ohne OAuth.** Zeilen entstehen ausschließlich in `apps/api/src/routes/channelOAuth.ts:198`; eine `POST /v1/channels`-Route existiert nicht. Das Token selbst liegt seit Paket 012 auf der getrennten Tabelle `social_connection_secrets`, nicht auf `social_connections` — ein Website-Kanal braucht dort einfach keine Zeile. Beides ist Teil von PR 1.
2. **Der Plattform-CHECK steht an sieben Stellen in SQL.** Ein übersehener schlägt erst beim ersten echten Blog-Beitrag zu, nicht beim Anlegen des Kanals — die Liste steht im Plan unter „Current state".

Der **Auslieferungsmechanismus** (wie der Beitrag auf die Vereinsseite kommt: Feed, Webhook, CMS-Plugin, Einbettcode) ist bewusst **nicht** Teil von 039 und braucht erst eine Ausgangslage-Recherche und eine Betreiberentscheidung.

### Danach / alternativ

- **Paket 043** (Einstellungen eines früheren Beitrags erneut laden). Ersetzt das früher vorgesehene „Pro-Plattform-Varianten"-Paket: Betreiberentscheidung vom 2026-08-14 ist, dass eine gemeinsame Plattformauswahl **einen** Beitrag mit der Grenze des restriktivsten Mediums ergibt (Blog + X ⇒ 280 Zeichen, auf beiden gleich veröffentlicht) und ein eigener Text je Plattform über je eine eigene Sitzung entsteht. `GeneratedPostSchema.variants` bleibt damit leer, und die offene Frage nach zwei Freigaben an einer `post_version` entfällt ersatzlos. Zu bauen ist nur die Bequemlichkeit: die Einstellungen eines früheren Beitrags zurückholen, Plattformauswahl ändern, erneut erzeugen.
- **Paket 044** (`plans/044-zielplattformen-vorgaben-und-harte-laengengrenze.md`, ebenfalls am 2026-08-14 ausgeplant). Zwei Betreiberentscheidungen: **keine** Plattform ist ab Werk vorausgewählt (Verein/Abteilung können eigene Vorgaben setzen, sonst startet die Auswahl leer), und die Zeichengrenze wird **hart** durchgesetzt statt nur im System-Prompt erbeten. PR 2 daraus ist P1 — die Zusicherung „höchstens N Zeichen" ist heute schlicht unwahr, und mit einer 280-Zeichen-Plattform wird daraus ein Beitrag, der erst beim Veröffentlichen scheitert, nachdem Ersteller und Prüfer ihre Arbeit hineingesteckt haben.
- **Paket 038** (Hatchet produktiv betreiben) bleibt der dringlichste **Betriebs**punkt: `vereinsfunk-worker` crash-loopt in Produktion seit dem Merge von Plan 004.
- **029** und **031** sind weiterhin als bereit markiert.
