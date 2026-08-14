# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch`, `git fetch origin` und `git log --oneline origin/main..HEAD`. Paket 042 ist abgeschlossen: PR #74 (PR 1) und #75 (PR 2) sind gemergt, **PR #76 (PR 3)** ist offen und trägt bereits seine Review-Fixes — falls noch nicht gemergt, das zuerst klären.

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

1. **`social_connections` kennt heute keinen Anlageweg ohne OAuth.** Zeilen entstehen ausschließlich in `apps/api/src/routes/channelOAuth.ts:198`; eine `POST /v1/channels`-Route existiert nicht, und `token_ciphertext` ist `not null`. Beides ist Teil von PR 1.
2. **Der Plattform-CHECK steht an sieben Stellen in SQL.** Ein übersehener schlägt erst beim ersten echten Blog-Beitrag zu, nicht beim Anlegen des Kanals — die Liste steht im Plan unter „Current state".

Der **Auslieferungsmechanismus** (wie der Beitrag auf die Vereinsseite kommt: Feed, Webhook, CMS-Plugin, Einbettcode) ist bewusst **nicht** Teil von 039 und braucht erst eine Ausgangslage-Recherche und eine Betreiberentscheidung.

### Danach / alternativ

- **Getrennte Texte je Plattform** (Paket 042, Step 4): `GeneratedPostSchema.variants` ist vorhanden und leer. Daran hängt die offene fachliche Frage, ob zwei Varianten eine gemeinsame Freigabe erhalten oder je eine eigene, und was gilt, wenn eine freigegeben und eine abgelehnt wird — die Freigabekette aus 011/024 arbeitet heute auf **einer** `post_version`. Ebenfalls offen: eine **harte** Prüfung der Zeichengrenze nach der Generierung; heute nennt der System-Prompt sie nur, durchgesetzt wird global über `GeneratedPostSchema.caption`.
- **Paket 038** (Hatchet produktiv betreiben) bleibt der dringlichste **Betriebs**punkt: `vereinsfunk-worker` crash-loopt in Produktion seit dem Merge von Plan 004.
- **029** und **031** sind weiterhin als bereit markiert.
