# Vereinsfunk – ausführbarer Umsetzungsplan

Stand: 2026-08-02. Das Repository besitzt noch keinen ersten Git-Commit (`unborn HEAD`). Deshalb enthält jedes Arbeitspaket Baseline-Hashes für seine wichtigsten Ausgangsdateien. Vor der Umsetzung müssen diese geprüft werden; bei Abweichungen gilt die jeweilige STOP-Bedingung.

## Zielbild

Vereinsfunk wird eine Content-Werkstatt für das gesamte Vereinsleben: Abteilungen erfassen echte Beobachtungen, Fakten, Zitate, Bilder und Clips; das System erstellt daraus markenkonforme Varianten, schützt Personen auf Medien, führt eine konkrete Version durch die Freigabe und veröffentlicht sie geplant auf Instagram und Facebook.

Die Systemgrenzen sind verbindlich:

- Nuxt ist die Arbeitsoberfläche.
- Supabase Auth, Postgres, RLS, Storage und Realtime sind die fachliche Source of Truth.
- Fastify ist die vertrauenswürdige Servergrenze für OAuth, Webhooks, Service-Role-Zugriffe, kurzlebige Medien-URLs und Workflow-Trigger.
- Hatchet ist die einzige technische Workflow- und Zeitplan-Engine. Hatchet-Nachrichten enthalten IDs und kleine Routing-Metadaten, keine Medien, Tokens oder vollständigen Fachobjekte.
- TypeScript-Worker führen Texterstellung, Bildbearbeitung, Remotion-Rendering, Veröffentlichung und spätere Analytics aus.
- `SocialPublisher` bleibt die Provider-Grenze; zuerst wird Meta direkt angebunden. Postiz/Mixpost werden im MVP nicht betrieben. Hive ist kein Ersatz für Hatchet und bleibt außerhalb des Systems.

## Reihenfolge und Abhängigkeiten

| Nr. | Arbeitspaket | Abhängigkeiten | Status |
|---|---|---|---|
| 001 | [Inhaltsmodell und authentische Erfassung](001-content-domain-and-authentic-capture.md) | keine | in Arbeit |
| 002 | [Private Medien, Einwilligungen und Freigabegate](002-private-media-consent-and-approval-gate.md) | 001 | in Arbeit |
| 003 | [Kreative Gesichtsverdeckung für Bilder](003-creative-face-obscuring.md) | 002 | in Arbeit |
| 004 | [Hatchet produktionsreif integrieren](004-hatchet-production-orchestration.md) | keine; parallel zu 001–003 möglich | in Arbeit |
| 005 | [Kreative Plattformvarianten und Rendering](005-creative-platform-variants-and-rendering.md) | 001, 002, 003, 004 | in Arbeit |
| 006 | [Direkte Meta-Veröffentlichung](006-direct-meta-publishing.md) | 002, 004, 005 | in Arbeit |
| 007 | [Pilotbetrieb, Messung und Go/No-Go](007-pilot-readiness-and-go-no-go.md) | 001–006 | blockiert: externe Pilot-/Provider-Gates |

Empfohlener Ablauf: zuerst 001 und den technischen Spike aus 004; danach 002 und 003; anschließend 005 und 006; zum Schluss 007. Ein Paket wird erst als abgeschlossen markiert, wenn alle Done-Kriterien erfüllt sind. Statuswerte sind `bereit`, `in Arbeit`, `blockiert`, `erledigt`.

## Zweite Serie: Produktausbau und Rückbau der Prototyp-Daten

Stand: 2026-08-04, geplant auf `b5c2eda6`. Die Pakete 001–007 bauen die Inhalts- und Veröffentlichungskette. Die Serie 008–020 macht daraus ein Produkt, das ein Verein selbst einrichten und betreiben kann, und ersetzt dabei die Prototyp-Daten durch echte Workflows.

| Nr. | Arbeitspaket | Abhängigkeiten | Status |
|---|---|---|---|
| 008 | [Echte Authentifizierung und Autorisierungsgrenze](008-echte-authentifizierung-und-autorisierungsgrenze.md) | keine | erledigt |
| 009 | [Onboarding: Verein anlegen](009-onboarding-verein-anlegen.md) | 008 | erledigt |
| 010 | [Abteilungen, Teams, Mitglieder und Einladungen](010-abteilungen-teams-mitglieder-einladungen.md) | 008, 009 | bereit |
| 011 | [Regelwerk: Freigaberouten, Vertrauen je Mitglied und Kontingente](011-regelwerk-richtlinien-und-kontingente.md) | 010 | bereit |
| 012 | [Kanäle und Social-Accounts](012-kanaele-und-social-accounts.md) | 011 | bereit; Meta App Review als externes Gate |
| 013 | [Marke, Branding-Assets und Schriften](013-marke-branding-assets-und-schriften.md) | 009 | bereit |
| 014 | [Integrationsrahmen und Mitgliederverzeichnis](014-integrationsrahmen-und-mitgliederverzeichnis.md) | 010 | bereit; Produktivbetrieb erst nach 020 |
| 015 | [Einwilligungsverwaltung](015-einwilligungsverwaltung.md) | 002, 014 | bereit; Produktivbetrieb erst nach 020 |
| 016 | [Auswertung: interne Kennzahlen](016-auswertung-interne-kennzahlen.md) | 011 | bereit |
| 017 | [Plattform-Insights](017-plattform-insights.md) | 006, 016 | blockiert: Meta App Review |
| 018 | [Resonanz- und Sentimentanalyse](018-resonanz-und-sentimentanalyse.md) | 017 | blockiert: Rechtsgrundlage und AVV mit LLM-Anbieter |
| 019 | [Mannschaften, Spielpläne und Veranstaltungen](019-mannschaften-spielplaene-und-veranstaltungen.md) | 014 | bereit |
| 020 | [Rechtliche Pflichten und Datenschutzbetrieb](020-rechtliche-pflichten-und-datenschutzbetrieb.md) | 009, 012, 015 | bereit |

Empfohlener Ablauf: **008 und 009 unmittelbar hintereinander** — ohne Authentifizierung lässt sich kein Prototyp-Datensatz ehrlich ersetzen, und ohne Onboarding zeigt die Oberfläche nach der Anmeldung nichts. Danach 010 und 011 als Verwaltungsgrundlage, 013 parallel dazu. Anschließend 012, dann 014 mit 019 als erstem Nutzen des Integrationsrahmens, dann 015. 016 ist ab 011 jederzeit möglich; 017 und 018 hängen an externen Gates. **020 vor dem Produktivbetrieb mit echten Personendaten.**

## Dritte Ebene: Plattform-Administration (SaaS-Betreiber)

Orthogonal zur Serie 008–020: Diese Pakete betreffen den SaaS-Betreiber selbst, nicht einen einzelnen Verein. Sie sind nicht Teil der Rückbau-Kette (keine Prototyp-Daten werden ersetzt) und können unabhängig von der Reihenfolge oben eingeschoben werden.

| Nr. | Arbeitspaket | Abhängigkeiten | Status |
|---|---|---|---|
| 021 | [Plattform-Administration](021-plattform-administration.md) | 008, 009 | in Arbeit |

### Kritischster Befund

`apps/api/src/app.ts:66-72` ist die gesamte Autorisierung der API. `requireAuth` prüft nur, **ob** ein `authorization`-Header vorhanden ist, und das ausschließlich bei `NODE_ENV === 'production'`. Der Inhalt wird nie gelesen, keine Signatur geprüft, keine Permission ausgewertet. In Entwicklung und Test ist jeder Endpunkt offen. Das behebt Paket 008 und ist der Grund, warum es zuerst kommt. **✓ Behoben in Paket 008**: echte JWT-Verifikation und `requirePermission` an allen Endpunkten, die Scope-Daten in der Anfrage tragen.

Zweitwichtigster Befund: `social_connections` gewährt `authenticated` `select` auf die ganze Tabelle einschließlich `token_ciphertext` (`202608030001:125,131`). Behoben in Paket 012.

## Rückbau-Inventar: jeder Prototyp-Datensatz und sein Ersatz

Vollständige Liste der erfundenen Daten im Anwendungscode, mit dem Paket, das sie ersetzt. Kein Eintrag darf ohne Ersatz verschwinden und keiner ohne Rückbau bleiben.

| Ort | Was dort erfunden ist | Ersetzt durch |
|---|---|---|
| `apps/web/app/composables/useDemoData.ts` | Organisation „SV Nordstadt 1921“, vier Abteilungen als Strings, vier Beitragsentwürfe mit Datum als Text | ✓ 008: Datei vollständig gelöscht; alle drei Konsumenten (`layouts/default.vue:5`, `pages/index.vue:4`, `pages/beitraege.vue:3`) auf `useSession()`/`useScope()` umgestellt; `drafts` zum benannten Empty State, bis 009/010 echte Daten liefern. |
| `layouts/default.vue:5,43-57` | Organisation und Abteilungsliste aus dem Demo-Composable | ✓ 008 (Identität und Scope aus `useSession()`/`useScope()`), 010 (Abteilungsverwaltung/-CRUD steht noch aus) |
| `layouts/default.vue:81` | „Lena Müller / Social Managerin“ hartkodiert | ✓ 008 |
| `layouts/default.vue:13` | `badge: 2` bei Freigaben | ✓ 008 (kein Badge statt erfundener Zahl) |
| `pages/index.vue:5` | `firstName = 'Lena'` | ✓ 008 |
| `pages/index.vue:4` (`drafts`) | „Aktuelle Beiträge“-Liste aus dem Demo-Composable | ✓ 008 (Empty State), 009/010 (echte Liste steht noch aus) |
| `pages/index.vue:10-15` | vier Kennzahlen inkl. „Reichweite 24,8k +18 %“ | ✓ 009 (drei echte Zählwerte: Veröffentlicht, Offene Freigaben, Geplant nächste 7 Tage), 016 (weitere Kennzahlen), 017 (Reichweite) |
| `pages/index.vue:17-25,32` | erfundene Woche, „Sonntag, 2. August“ | ✓ 009 (echte `scheduled_for`-Daten der laufenden Woche in Vereinszeitzone, echtes formatiertes Datum), 019 (Anlassvorschläge) |
| `pages/index.vue:77-86` | statische „Idee für diese Woche“, toter `?type=`-Parameter | ✓ 009 (Nächste-Schritte-Karte aus `organization_brand_profiles`/`organization_profiles`/`organization_onboarding`), 019 (Anlassvorschläge) |
| `pages/index.vue:88-95` | „18 / 24 Beiträge“, „3 / 4 Abteilungen aktiv“, fester `w-3/4`-Balken | ✓ 009 (entfällt ersatzlos), 016 |
| `pages/beitraege.vue:3` | Liste aus dem Demo-Composable | ✓ 008 (Empty State), 010 (echte Liste steht noch aus) |
| `pages/erstellen.vue:14` | `useState('content-scope')`, das nirgends gesetzt wird | ✓ 008 |
| `pages/erstellen.vue:25-29,41,47` | `localPreview()` erzeugt eine Vorschau ohne API und ohne Persistenz | ✓ 008 (entfällt vollständig) |
| `pages/erstellen.vue:12` | leere Felder `title`, `date`, `location` bei jedem Beitrag neu | 019 (vorbelegt mit Herkunftsangabe) |
| `pages/freigaben.vue:3-6` | zwei erfundene Beiträge, „Minderjährige · Einwilligung geprüft“ als Text | 015 |
| `pages/freigaben.vue:7,12` | Freigabe nur im lokalen State, kein Serveraufruf | 015 |
| `pages/kalender.vue:1` | fest „August 2026“, fünf Fantasietermine, hartkodierte Vorlauftage | ✓ 009 (echte `posts.scheduled_for`, navigierbarer Monat, Empty State — der Plan zu 009 listete diese Zeile bereits in seinem eigenen Rückbau-Abschnitt, diese Tabelle hier nicht; beim Abgleich in der Adversarial-Phase von 009 nachgezogen), 019 (echte Anlässe/Spielpläne als Inhalt der Termine) |
| `pages/auswertung.vue:1` | vier erfundene Plattformkennzahlen, `bars`-Array ohne Skala und Quelle | 016, 017 |
| `pages/marke.vue:1` | Farben und Tonalität im lokalen State, „Speichern“ setzt nur ein Flag | ✓ 009 (`PUT /v1/organizations/:id/brand`, echter Ladezustand, echte Fehler), 013 (Schrift-Upload, Abteilungsbranding) |
| `pages/mitglieder.vue:1` | vier hartkodierte Namen, „Einladen“ ohne Handler | 010 |
| `pages/einstellungen.vue:1` | fünf behauptete Einstellungen, jeder Button ohne Handler | 011 (Freigabe, Minderjährige), 012 (Kanäle), 020 (Löschfrist) |
| `apps/web/nuxt.config.ts:14-21` | Schriften von `fonts.googleapis.com` bei jedem Aufruf | 013, geprüft in 020 |
| `packages/config/src/index.ts:17-20` | `PUBLISHING_PROVIDER: 'mixpost'`, Mixpost-URL und -Token — widerspricht der Meta-Entscheidung | 012 |
| `packages/domain/src/index.ts:47-87` | `mergeEffectiveConfig` existiert korrekt, wird aber nur von Tests aufgerufen | 011 |
| `post_versions.effective_config_snapshot` | Spalte ist `not null` und wird von nichts gefüllt | 011, 013 |
| `evaluateMediaGate` `consentValid` | Blocker existiert, Wert wird nie bestimmt | 015 |
| `WorkflowNameSchema` `collect-analytics` | Name reserviert, Workflow nicht implementiert | 017 |
| `apps/api/src/app.ts:29-32` | `LocalUploadService` liefert `https://storage.invalid/...` | 002 (008 hat die Route nur mit echter Autorisierung versehen, den Stub aber nicht ersetzt — bleibt offen) |
| `apps/api/src/app.ts:70-100` | `/v1/submissions` persistiert nichts | 011 (008 hat die Route nur mit echter Autorisierung versehen, die Persistenz aber nicht ergänzt — bleibt offen) |
| `README.md:35` | „funktioniert im lokalen Demo-Modus auch ohne Datenbank und API“ | ✓ 008 (Aussage entfernt) |

Zu den Zeilenangaben: die **offenen** Zeilen dieser Tabelle zeigen auf den aktuellen Stand und sind gegen den Code geprüft. Die mit ✓ markierten Zeilen beschreiben einen Zustand, den Paket 008 beseitigt hat — ihre Zeilennummern beziehen sich auf den Baseline-Commit `b5c2eda6` und zeigen heute auf anderen oder gelöschten Code. Sie bleiben als Nachweis stehen, was ersetzt wurde, und sind nicht als Sprungziel gedacht.

`supabase/seed.sql` bleibt bewusst erhalten. Es ist ein **Entwicklungs-Seed** für den lokalen Stack und wird in den Paketen 009, 010, 014 und 019 erweitert. Es darf nie Datenquelle für Anwendungscode sein und nie in Staging oder Produktion laufen — das steht bereits in seiner ersten Zeile und gilt weiter.

### Regel für den Rückbau

> Kein erfundener Wert wird durch einen Platzhalter, eine Null oder einen grauen Balken ersetzt. Existiert eine Zahl noch nicht, steht dort ein benannter leerer Bereich mit Begründung. Eine Null ist eine Falschaussage; ein leerer Bereich ist eine Information.

## Übergreifende Regeln der zweiten Serie

Ergänzend zu den Regeln der ersten Serie:

- **Vererbung verschärft nur.** Verein setzt den Rahmen, Abteilung und Team dürfen ausschließlich strenger werden. Eine untere Ebene hebt keine Pflicht auf und erweitert keine Erlaubnis. Umgesetzt in `resolveEffectiveConfig`, nicht in jedem Endpunkt neu.
- **Jeder Knoten kann eine Prüfstufe für alles unter sich verlangen.** Die Freigaberoute eines Beitrags ist die geordnete Kette dieser Stufen von innen nach außen, sequenziell abzuarbeiten. Stufen sind additiv: jede Ebene kann eine hinzufügen, keine entfernen.
- **Eine Befreiung von der Prüfpflicht wirkt nur nach unten.** Was auf Abteilungsebene gewährt wird, entfällt Abteilungs- und Teamstufen, niemals die Vereinsstufe.
- **Keine Befreiung entfällt die Minderjährigenstufe.** Das ist die Bedingung dafür, dass Spieler und Eltern überhaupt selbst einreichen dürfen: Vertrauen gilt der Person, nicht dem Risiko für Dritte.
- **Eine Permission gilt nur im Scope ihrer Rolle und für Ziele auf oder unterhalb dieser Ebene.** Ein Abteilungsadmin verändert nichts in einer fremden Abteilung. Umgesetzt in `assertScopedPermission`.
- **Niemand vergibt eine Rolle, die mächtiger ist als die eigene.**
- **Prüfer dürfen abteilungsfremd sein, sehen aber nur die Version.** Ein Marketing-Prüfer erhält Zugriff auf Text und freigegebene Derivate des zu prüfenden Beitrags — nie auf Rohmedien, Gesichtsregionen oder Personendaten.
- **Kein Format wird ungeprüft durchgereicht.** SVG wird geparst, gegen eine Allowlist gefiltert und neu serialisiert; ausgeliefert wird ausschließlich das Ergebnis.
- **Zeit gehört in die Vereinszeitzone.** Speicherung bleibt `timestamptz` in UTC; Tagesgrenzen, Kontingentperioden und Anzeigen richten sich nach `organizations.timezone`.
- **Kein Import löscht und kein Import ändert die Struktur.** Fehlende Datensätze werden stillgelegt, unbekannte Abteilungen erzeugen Konflikte, jede Übernahme ist zweistufig mit Trockenlauf.
- **Datenminimierung durch Schema.** Was ein Zod-Schema an der Integrationsgrenze nicht kennt, kommt nicht ins System. Das ist keine Disziplinfrage.
- **Geheimnisse verlassen die Service Role nicht.** Tokens, Zugangsdaten und Einwilligungsnachweise sind für `authenticated` nie lesbar.
- **Fristen werden von Jobs eingehalten, nicht von Vorsätzen.** Jede Aufbewahrungszusage in der Oberfläche braucht einen Cron und einen Test.

## Entschiedene Produktfragen

| Frage | Entscheidung | Betrifft |
|---|---|---|
| Datenquelle der Auswertung | zweistufig: interne Kennzahlen zuerst, Plattform-Insights hinter derselben Grenze nach dem App Review | 016, 017 |
| Einwilligungen | Registratur für Papiererklärungen **und** digitaler Einwilligungsprozess, plus Übernahme aus Drittsystemen | 015 |
| Drittsysteme | nicht nur Personen: Mannschaften, Spielpläne, Ergebnisse und Veranstaltungen; viele Quellen über einen gemeinsamen Rahmen statt Einzelimporte | 014, 019 |
| Schriftarten | kuratierte Auswahl als Standard **und** Upload eigener Schriften mit Lizenzbestätigung | 013 |
| Sentimentanalyse | eigenes späteres Paket mit eigenem Rechts-Gate | 018 |
| Freigabe | jeder Knoten bestimmt für alles unter sich, wer einreichen darf und ob geprüft wird — bis auf die einzelne Person. Mehrstufige Route: Trainer → Medienverantwortliche → Marketing. Prüfer dürfen abteilungsfremd sein. Minderjährigenstufe ist unbefreibar. | 011 |
| SVG-Logos | unterstützt, aber nur nach Allowlist-Sanitisierung mit eigenem Modul `packages/svg-safe` und Testkorpus bekannter Payloads | 009, 013 |

## Offene Entscheidungen der zweiten Serie

Diese Punkte sind in den jeweiligen Paketen begründet und brauchen eine Festlegung, bevor das Paket umgesetzt wird:

- **Freigabe ganz abschaltbar?** Paket 011 legt „keine Prüfstufe auf keiner Ebene“ so aus, dass der Autor selbst veröffentlichen darf — es bleibt eine menschliche Entscheidung, nur keine zweite. Vollautomatisches Publizieren ohne Menschen bleibt ausgeschlossen. Diese Auslegung berührt die dokumentierte Produktgrenze und sollte bestätigt werden.
- **Jahr des 18. Geburtstags**: Paket 014 speichert nur das Geburtsjahr. Empfehlung ist, das gesamte Jahr als minderjährig zu behandeln und im Zweifel die strengere Freigaberoute zu nehmen.
- **Prüfer verlässt den Verein oder fällt aus**: Paket 011 markiert betroffene Stufen als `stalled` und erlaubt ein bewusstes, auditiertes Neuauflösen der Route. Ob es zusätzlich eine automatische Eskalation an die übergeordnete Ebene nach Fristablauf geben soll, ist offen. Eine automatische **Freigabe** nach Fristablauf ist ausgeschlossen.
- **Einwilligungstext je Verein oder global** (Paket 015) — beeinflusst, ob `text_version` global oder pro Verein geführt wird.
- **Aufbewahrung von Einwilligungsnachweisen**: Vorschlag fünf Jahre ab Ende der Gültigkeit (Paket 020).
- **E-Mail-Versand**: eigener Anbieter oder Supabase Auth Invite (Paket 010). Empfehlung eigener Versand, weil Einladungen auch an bestehende Nutzer gehen. Beschaffungsentscheidung.
- **Abteilungsbranding per Default erlaubt oder gesperrt** (Paket 013).
- **Verlegte Spiele**: ob ein bereits veröffentlichter Ankündigungsbeitrag automatisch als überholt markiert wird (Paket 019).

Anwaltliche Prüfung ist für Einwilligungstext, Datenschutzerklärung, AVV und die Lizenzbestätigung für Schriften Voraussetzung, nicht Option. Der Beschaffungsvorlauf ist größer als der Entwicklungsaufwand.

## Architekturfluss

```text
Nuxt
  │ Auth-Sitzung / Nutzeraktionen
  ▼
Fastify API ───────────────► Supabase Auth + Postgres + RLS
  │                               │
  │ signierte Uploads             ├── private Originale
  │ OAuth / Webhooks              └── private, abgeleitete Medien
  │
  └── ID-basierter Trigger ─► Hatchet ─► TypeScript Worker
                                  │          ├── ContentGenerator
                                  │          ├── FaceDetector / ImageAnonymizer
                                  │          ├── Remotion
                                  │          └── SocialPublisher → Meta Graph API
                                  │
                                  └──── Status/Fehler nur über Worker/API zurück nach Supabase
```

## Übergreifende Regeln

- Keine erfundenen Vereinsfakten: Texte dürfen nur bestätigte Angaben, Beobachtungen und freigegebene Zitate verwenden. Fehlende Angaben werden als offen markiert.
- Originalmedien bleiben privat. Veröffentlichbar sind ausschließlich geprüfte, unveränderliche Derivate.
- Keine Gesichtserkennung oder biometrischen Profile; nur Gesichtserkennung im Sinn von Lokalisierung (Bounding Boxes).
- Jede Freigabe bindet exakt eine unveränderliche `post_version` und die Prüfsummen ihrer Medien-Derivate.
- Externe Aktionen sind idempotent, auditierbar und nach einem unklaren Provider-Ergebnis erst zu reconciliieren, nicht blind zu wiederholen.
- Jede mandantenbezogene Tabelle trägt `organization_id`, verwendet zusammengesetzte Fremdschlüssel und besitzt positive wie negative RLS-Tests.
- Kinder erfordern eine ausdrücklich bestätigte Medienentscheidung und die strengere Freigaberoute.
- Produkttexte sprechen von „Gesicht verdeckt“, nicht von automatisch hergestellter Rechtssicherheit. Kleidung, Kontext und Umgebung können weiterhin identifizieren.

## Globale Verifikation

Nach jedem Paket mindestens:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Bei Datenbankänderungen zusätzlich:

```bash
pnpm db:start
pnpm db:reset
pnpm db:test
```

Wenn ein externer Sandbox-Zugang nötig ist, dokumentiert der Executor die manuell geprüften Fälle, verwendete API-Version, App-Berechtigungen und das Datum in dem im Paket genannten Evidence-Dokument. Geheimnisse, Tokens und echte Kindermedien dürfen niemals eingecheckt werden.

## Bewusst nicht eingeplant

- Eigener Postiz- oder Mixpost-Betrieb im MVP
- Hive als Agenten-Orchestrierung
- Vollautomatisches Publizieren ohne menschliche Freigabe
- Gesichtserkennung, Personenabgleich oder biometrische Datenhaltung
- Automatisches Face-Tracking in Videos im MVP
- Weitere Netzwerke vor nachgewiesenem Pilotnutzen
