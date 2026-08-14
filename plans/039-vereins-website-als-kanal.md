# Plan 039: Vereinseigene Website/Blog als Kanal

> **Executor instructions**: Zwei PRs in dieser Reihenfolge. PR 1 legt Datenmodell und API, PR 2 die Oberflächen. PR 2 setzt auf dem gemergten Stand von PR 1 auf. Dieses Paket enthält **nicht** die automatische Auslieferung an die Website — siehe „Nicht enthalten“.
>
> **Drift check (run first)**: `git log --oneline -3 -- supabase/migrations apps/api/src/routes/channels.ts apps/api/src/routes/channelOAuth.ts packages/contracts/src/channels.ts` — Stand bei Ausplanung ist der Merge von PR #76 (Paket 042 PR 3). Kommt an diesen Pfaden etwas Neueres, erst prüfen, ob `social_connections` inzwischen weitere Plattformen oder einen Anlageweg ohne OAuth kennt.

## Status

- **Priority**: P2
- **Effort**: M (PR 1 L, PR 2 S)
- **Risk**: MEDIUM — eine Migration lockert `not null` auf einer Tabelle, die heute ausschließlich über den OAuth-Callback befüllt wird; die Plattform-Prüfung steht an sieben Stellen in SQL; die abgeleitete Token-Leine verändert `provider_parameter_hash`
- **Depends on**: 012 (Kanäle und Social-Accounts), 025 (Inhalts-Pipeline), 042 (Zielplattformen in der Textwerkstatt)
- **Category**: product, architecture
- **Planned at**: 2026-08-14, nach dem Code-Review von PR #76

## Why this matters

Ein Verein soll seine Beiträge auch auf der **eigenen Website oder im eigenen Blog** veröffentlichen — nicht nur auf Instagram und Facebook. Für viele Vereine ist die eigene Seite sogar das Wichtigste: sie gehört ihnen, sie überlebt jeden Plattformwechsel, und manche Vereine bedienen gar kein soziales Netzwerk.

Genau dieser Verein kann die Textwerkstatt heute **überhaupt nicht benutzen**. Seit Paket 042, PR 3 lehnt `POST /v1/text-workshop/sessions` jede Zielplattform ohne eingerichteten Kanal mit `422 platform_not_available` ab, und `targetPlatforms` verlangt mindestens einen Eintrag. Ohne Instagram- oder Facebook-Kanal ist jede zulässige Auswahl leer und jede leere Auswahl unzulässig — eine Sackgasse.

Die Betreiberentscheidung dazu (2026-08-14): Auf welchen Plattformen ein Verein veröffentlicht, gibt der Betreiber **nicht** vor. Ein eigener Blog ist deshalb kein Sonderfall im Generierungscode, sondern **ein Kanal wie jeder andere**:

- Der **Vereins-Admin legt ihn an** (`social_account.manage`), so wie er heute Instagram verbindet.
- Er **stellt ihn Abteilungen zur Verfügung** — über die vorhandenen `channel_scopes`, unverändert.
- Er **legt die maximale Beitragslänge fest**, denn anders als bei Instagram gibt es hier keine fremde Plattform, die sie diktiert. Dieser Wert muss **immer unterhalb der harten Obergrenze** des Systems liegen (`MaxCharactersSchema`, 100–10000).

Der Gewinn dieses Zuschnitts: die Textwerkstatt braucht **keine einzige Sonderbehandlung**. `resolveAvailableChannels` beantwortet „darf dieser Scope hier veröffentlichen“ für einen Blog-Kanal genauso wie für einen Instagram-Kanal. Ein Verein ohne Blog sieht ihn nicht, einer mit Blog schon. Die Sackgasse verschwindet als Nebenwirkung, nicht als eingebauter Sonderweg.

## Current state

| Wo | Was |
|---|---|
| `social_connections` | `platform text not null check (platform in ('instagram','facebook'))`, `external_account_id text not null`, `unique (organization_id, platform, external_account_id)`. **Kein Token hier** — `token_ciphertext`/`token_key_version` wurden bereits in Paket 012 (`2026080701_channel_scoping_and_secrets.sql:74-75`) auf eine eigene Tabelle verschoben |
| `social_connection_secrets` | `social_connection_id uuid primary key references social_connections(...)`, `token_ciphertext bytea not null`, `token_key_version text not null`. Reine 1:1-Zusatztabelle, keine Policy für `authenticated`; eine Zeile ohne Geheimnis ist einfach eine Zeile ohne Eintrag hier — kein Nullable-Umbau nötig |
| Anlage einer Zeile | **ausschließlich** in `apps/api/src/routes/channelOAuth.ts:198` (`social_connections`) plus `:218-223` (`social_connection_secrets`), beide im OAuth-Callback. Es gibt **keine** `POST /v1/channels`-Route — `channels.ts` kennt nur GET/PATCH/DELETE/verify und die Scope-Routen |
| `channel_scopes` | Verein/Abteilung/Team mit `can_schedule`; trägt die Zuteilung, die dieses Paket unverändert nutzt |
| Plattform-CHECK in SQL | sieben Stellen: `social_connections`, `publications`, `post_variants` (alle `202608030001`), `oauth_states`, `oauth_pending_connections` (beide `2026080701`), `text_generation_platform_defaults` (`2026081308`), `composition_sessions.target_platforms` (`2026081309`) |
| Längengrenze | global je Plattform in `text_generation_platform_defaults`, gepflegt vom **Plattform-Admin** (Betreiber). Kein Wert je Kanal |
| `resolveTextGenerationPlatformAvailability` | `apps/api/src/routes/shared.ts` — je Plattform „verfügbar/nicht“, Grund `no_channel` oder `restricted_by_policy`, plus Zeichengrenze aus der globalen Vorgabe |
| `apps/web/app/pages/kanaele.vue` | 55 Zeilen, zwei Knöpfe „Instagram verbinden“ / „Facebook verbinden“, beide starten den OAuth-Fluss |
| `SocialPlatformSchema` | `z.enum(['instagram','facebook'])` in `packages/contracts/src/primitives.ts`, geteilt von Kanälen, OAuth, Veröffentlichung und Textwerkstatt |

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Voller Gate | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | exit 0 |
| DB-Tests | `pnpm db:start && pnpm db:reset && pnpm db:test` | exit 0, alle pgTAP-Dateien grün |
| Web-Teilgate | `cd apps/web && pnpm typecheck && pnpm test` | exit 0 |

## Entwurfsentscheidungen

Diese vier sind vor der Umsetzung bewusst getroffen worden und sollten nicht stillschweigend anders gelöst werden.

**1. `website` kommt in `SocialPlatformSchema`, nicht in ein zweites Vokabular.**
Naheliegend wäre ein getrenntes `TextGenerationTargetSchema`, weil eine Website kein OAuth-Konto ist. Dagegen spricht der Kommentar an `SocialPlatformSchema` selbst: „Bewusst EINE Menge für Kanäle und Textwerkstatt — auf welchen Plattformen ein Beitrag entstehen darf, ist genau die Menge, auf die überhaupt veröffentlicht werden kann.“ Genau diese Gleichung soll gelten: der Blog **ist** ein Veröffentlichungsziel. Zwei Vokabulare würden bei jedem weiteren Kanal auseinanderlaufen. Was eine Website von Instagram unterscheidet, ist nicht die Zugehörigkeit zur Menge, sondern das Fehlen eines Tokens — und das gehört an die Spalten, nicht an den Enum.

**2. Kein Token — einfach keine Zeile in `social_connection_secrets`. Nur `external_account_id` wird nullable.**
`token_ciphertext`/`token_key_version` sitzen seit Paket 012 nicht mehr auf `social_connections`, sondern auf der eigenen Tabelle `social_connection_secrets` (`social_connection_id uuid primary key`, 1:1 per FK, keine Policy für `authenticated`). Ein Blog-Kanal braucht dort schlicht **keinen Eintrag** — nichts an diesem Schema muss dafür angefasst werden, und die heutige Zusicherung für Instagram/Facebook (dort **immer** eine Zeile mit Token) bleibt strukturell erhalten, nicht nur per CHECK. Anfassen muss nur `external_account_id` auf `social_connections`: es wird `null`-fähig, mit `check (platform = 'website' or external_account_id is not null)`. Der `unique (organization_id, platform, external_account_id)` braucht für Website-Kanäle ohnehin einen anderen Träger — die Website-URL (siehe Entscheidung 4).

**3. Die Längengrenze je Kanal ist eine Spalte auf `social_connections`, nicht eine zweite Tabelle.**
`max_characters integer null check (max_characters between 100 and 10000)`. `null` bedeutet „globale Vorgabe der Plattform gilt“ — so bleibt Instagram unverändert vom Betreiber gesteuert, während der Verein für seinen Blog selbst entscheidet. Die harte Obergrenze steht damit im CHECK **und** in `MaxCharactersSchema`, an beiden Enden derselbe Bereich.

**4. Beliebig viele Website-Kanäle, auf Vereins- wie auf Abteilungsebene.**
Betreiberentscheidung vom 2026-08-14. Ein Verein hat plausibel eine Hauptseite und daneben Abteilungsblogs; eine Begrenzung auf einen Kanal je Verein wäre eine Vorgabe, die der Betreiber ausdrücklich nicht machen will. Dafür ist **nichts Neues nötig**: `social_connections.owner_scope`/`owner_department_id` tragen die Besitzebene bereits (`channelOwnerScope` in `routes/shared.ts` wertet sie aus), und `channel_scopes` regelt unabhängig davon, wer senden darf. Der Unique-Index greift deshalb auf der **Adresse**, nicht auf der Organisation: `unique (organization_id, website_url) where platform = 'website'` — derselbe Blog nicht zweimal, beliebig viele verschiedene schon.

## Abweichung bei der Umsetzung

`SocialPlatformSchema` ist eine gemeinsame Quelle für Kanäle, Textwerkstatt **und** mehrere Frontend-`Record<SocialPlatform, …>`-Literale (`PLATFORM_LABELS` in `erstellen.vue` und `plattform-admin/llm.vue`, die Prop von `PlatformIcon.vue`). Die Erweiterung des Enums um `'website'` in PR 1 (Step 1) lässt `pnpm typecheck` deshalb schon vor PR 2 fehlschlagen — TypeScript verlangt einen `website`-Eintrag in jedem dieser Records, sonst bricht `apps/web` die Kompilierung. Da PR 1 eigenständig auf `main` gemergt wird (PR 2 baut erst danach auf), musste die reine Typvervollständigung (Label „Eigene Website“ ergänzen, `PlatformIcon`-Prop auf `SocialPlatform` erweitern) bereits in PR 1 mit hinein — nicht die eigentliche Oberfläche aus PR 2 Step 5/6, nur das, was der Compiler zwingend braucht. **Verifiziert**: `pnpm typecheck` ist nach PR 1 grün, ohne dass eine Anlage-Oberfläche für Website-Kanäle existiert. PR 2 Step 6 entfällt dadurch die Label-Zeile; die Mitglieds-Obergrenze bleibt offen.

## Korrekturen aus dem Review von PR #78

Sechs Punkte, die die Umsetzung gegenüber dem Entwurf oben verändern — jeweils mit dem Grund, weil es Entwurfsentscheidungen sind und keine Schönheitsreparaturen:

1. **Die globale Plattform-Vorgabe ist Deckel, nicht nur Ersatzwert.** Entwurfsentscheidung 3 sagt „`null` = globale Vorgabe gilt“, ließ aber offen, was ein *gesetzter* Kanalwert oberhalb der Vorgabe bedeutet. In der ersten Fassung gewann er: ein Vereins-Admin konnte seinen **Instagram**-Kanal auf 10000 Zeichen stellen, die Textwerkstatt versprach 10000, und Instagram weist bei 2200 ab. Die Vorgabe beschreibt bei fremden Plattformen deren tatsächliche Grenze — nach unten bleibt der Kanalwert frei, nach oben deckelt jetzt `min(Kanalwert, Vorgabe)` in `resolveTextGenerationPlatformAvailability`.
2. **Der `maxCharacters`-Wunsch des Mitglieds ist ein Kandidat der Minimumbildung, keine Überschreibung.** So steht es bereits unten im Abschnitt „Zusätzlich aus dem Review von PR #76“; umgesetzt war `input.maxCharacters ?? …`, was beide `min()`-Stufen übersprang. Seit die Token-Leine an `max_characters` hängt (Step 4), war das zugleich ein **Kostenhebel**: ein Mitglied mit `post.create` konnte den Provideraufruf allein über dieses Feld aufblähen. Jetzt `min(Wunsch, aufgelöste Plattformgrenze)`.
3. **Die Token-Leine braucht drei Größen statt „Zeichen / 3 + Pauschale“.** Der Divisor 3 war die optimistische Kante für deutschen Text (BPE-Tokenizer liegen bei ~2,0–2,5 Zeichen/Token) — ein 5000-Zeichen-Blogbeitrag wäre bei etwa der Hälfte abgeschnitten zurückgekommen, also genau der Fehler, den Step 4 beseitigen sollte. Zusätzlich ist der Zuschlag **nicht** pauschal: `assertGroundedPost` verlangt jeden Beleg in der Antwort, und `GeneratedPostSchema` lässt ihn zweimal auftauchen (`verifiedFacts` **und** `generatedClaims`), sodass ein belegreicher Spielbericht mehr Tokens kostet als die Bildunterschrift. Jetzt: `Zeichen / 2 + fester JSON-Rahmen + Belegzahl × Zuschlag`, mit dem bisherigen festen Budget als **Untergrenze** (sonst hätte eine 2200-Zeichen-Sitzung ab Step 4 mit 1134 statt 1200 Token **weniger** bekommen als vorher). Die Obergrenze entfällt: `MaxCharactersSchema` und `SourceMaterialSchema` begrenzen den Aufruf bereits, und ein Deckel darunter wäre wieder das stille Abschneiden.
4. **Zugangsdaten in der Adresse werden abgewiesen.** `https://benutzer:geheim@verein.de/blog` übersteht `new URL().toString()` unverändert und landete in `social_connections.website_url` — einer Spalte, die **jedes** Vereinsmitglied lesen darf — sowie im Klartext in `audit_events.metadata`. Zurückweisen statt still entfernen, sonst speichert das System eine Adresse, die der Verein nie eingegeben hat. Der Fragmentbezeichner (`#oben`) wird dagegen entfernt: er geht nie an den Server und darf keinen zweiten Kanal ergeben.
5. **Der Unique-Index gilt nur für nicht archivierte Kanäle.** `DELETE /v1/channels/:id` archiviert bloß (`status='disconnected'`, `archived_at=now()`), die Zeile bleibt stehen, und kein Endpunkt reaktiviert eine Verbindung. Ohne `and archived_at is null` im Prädikat blockierte ein einmal archivierter Blog seine eigene Adresse dauerhaft mit `409`, ohne Weg zurück.
6. **Die Kanalanlage nimmt sich bei einem Fehler selbst zurück.** Schlägt der `channel_scopes`-Insert fehl, wurde die bereits committete `social_connections`-Zeile stehen gelassen: `resolveAvailableChannels` sieht eine Verbindung ohne Freigabe nie, der Verein hätte also einen unbenutzbaren Kanal — und der Unique-Index auf der Adresse ließ jeden Wiederholungsversuch dauerhaft an `409` scheitern. Jetzt dasselbe Rollback-Muster wie im OAuth-Pfad (`channelOAuth.ts`).

## PR 1: Datenmodell, Kanalanlage, Längenauflösung und Token-Leine

### Step 1 — Migration: `website` als Plattform

Neue Migration (Nummer nach dem dann höchsten Stand, zum Planungszeitpunkt `2026081310`):

- Plattform-CHECK auf `('instagram','facebook','website')` erweitern — aber **nur an den fünf Stellen, die auch für die Textwerkstatt und die Veröffentlichung gelten**: `social_connections`, `publications`, `post_variants`, `text_generation_platform_defaults`, `composition_sessions.target_platforms`. `oauth_states` und `oauth_pending_connections` bleiben auf `('instagram','facebook')` — diese beiden Tabellen tragen ausschließlich den OAuth-Fluss, und ein Website-Kanal entsteht nie über OAuth (Step 2). Ein übersehener CHECK an den fünf relevanten Stellen schlägt erst beim ersten echten Blog-Beitrag zu, nicht beim Anlegen des Kanals.
- `social_connections.external_account_id` auf `null` erlauben, `social_connections.website_url text null` mit URL-Form-CHECK. Die beiden Felder schließen sich gegenseitig aus, nicht nur einseitig: `check ((platform = 'website' and external_account_id is null and website_url is not null) or (platform <> 'website' and external_account_id is not null and website_url is null))`. Ein Website-Kanal mit `external_account_id` oder ein Instagram-/Facebook-Kanal mit `website_url` ist damit ebenso unzulässig wie die bisher schon abgelehnten Fälle. **`social_connection_secrets` bleibt unverändert** — ein Website-Kanal bekommt dort schlicht keine Zeile, kein Nullable-Umbau nötig (siehe Entwurfsentscheidung 2).
- `social_connections.max_characters integer null check (max_characters between 100 and 10000)`.
- `website_url` vor dem Schreiben kanonisieren (Schema angleichen, Groß-/Kleinschreibung im Host normalisieren, abschließenden `/` auf der reinen Domain entfernen), damit `https://example.org` und `https://example.org/` denselben gespeicherten Wert ergeben — sonst umgeht der zweite Schreibvorgang den Unique-Index unten unbemerkt. Kanonisierung gehört in den Schreibpfad (Step 2), nicht in einen Datenbank-Trigger.
- Partieller Unique-Index für Website-Kanäle auf dem kanonisierten Wert: `unique (organization_id, website_url) where platform = 'website'`.
- `text_generation_platform_defaults`: Zeile für `website` mit **5000** (Betreiberentscheidung vom 2026-08-14), vom Plattform-Admin änderbar. Dieser Wert ist mit der heutigen Token-Leine **nicht erreichbar** — siehe Step 4, der gehört zwingend in denselben PR.

**Verifizieren**: `pnpm db:reset && pnpm db:test` grün. Neuer pgTAP-Fall: ein `insert` eines Website-Kanals ohne `external_account_id` und ohne begleitende `social_connection_secrets`-Zeile gelingt, derselbe `insert` mit `platform = 'instagram'` und `external_account_id = null` scheitert. Zweiter Fall: `max_characters = 99` und `= 10001` werden beide abgewiesen. Dritter Fall: ein Website-Kanal **mit** gesetzter `external_account_id` scheitert am CHECK, ebenso ein Instagram-Kanal mit gesetzter `website_url`. Vierter Fall: `oauth_states`/`oauth_pending_connections` weisen `platform = 'website'` weiterhin ab.

### Step 2 — `POST /v1/channels` für Website-Kanäle

Die erste Anlage-Route überhaupt. `requirePermission('social_account.manage', channelOwnerScope(...))`, Service-Client für den Insert wie im OAuth-Pfad.

- Nimmt `platform: 'website'`, `displayName`, `websiteUrl`, `ownerScope`/`ownerDepartmentId`, optional `maxCharacters`.
- Lehnt jede andere Plattform mit `422` ab: Instagram/Facebook entstehen weiterhin **nur** über OAuth, sonst ließe sich ein Kanal ohne gültiges Token anlegen und die Veröffentlichung liefe später ins Leere.
- `websiteUrl` durch dieselbe Prüfung wie andere vom Verein hinterlegte Adressen — die Adresse wird später serverseitig abgerufen, deshalb gilt die SSRF-Regel des Projekts (`outboundFetch`, siehe Paket 034). Auch wenn dieses Paket noch nichts abruft: eine Adresse, die hier ungeprüft hineinkommt, ist die Lücke, die das Folgepaket erbt.
- `websiteUrl` vor dem Insert kanonisieren (siehe Step 1) — hier und nicht erst im Unique-Index, damit die Fehlermeldung bei einer Kollision aussagekräftig bleibt statt auf einen rohen Constraint-Verstoß zurückzufallen.
- Audit-Eintrag wie bei der OAuth-Anlage.

**Verifizieren**: Vitest — Anlage gelingt mit Berechtigung, `403` ohne, `422` für `platform: 'instagram'`, `422` für eine Adresse im internen Netz. `https://example.org` anlegen, `https://example.org/` für dieselbe Organisation scheitert als Duplikat. Danach ist der Kanal über `GET /v1/organizations/:id/channels` sichtbar.

### Step 3 — Längengrenze je Kanal

- `PATCH /v1/channels/:id` nimmt `maxCharacters` (nullable) entgegen, `MaxCharactersSchema` validiert die harte Obergrenze.
- `resolveTextGenerationPlatformAvailability` liefert je Plattform die **kleinste** `max_characters` der tatsächlich verfügbaren Kanäle dieser Plattform. Ein Kanal ohne eigenen Wert geht mit der **globalen Vorgabe der Plattform** als seinem Kandidaten in dieselbe Minimumbildung ein — er fällt nicht aus der `min()` heraus, nur weil er selbst `null` trägt. Sonst würde bei globaler Grenze 5000 und Kanälen mit 6000 und `null` fälschlich 6000 herauskommen, obwohl der Kanal ohne eigenen Wert eigentlich bei 5000 liegt. Kleinste, nicht erste: stehen einem Scope zwei Blogs mit 3000 und 1500 zur Verfügung, muss ein Text auf beiden erscheinen können.
- **Wichtig**: der `null`-Rückgabewert aus dem Review von PR #76 bleibt für den Fall erhalten, dass **gar keine** Vorgabezeile existiert (siehe `apps/api/src/routes/content.ts`, Kommentar an `limits`) — das ist ein anderer Fall als „Kanal ohne eigenen Wert bei vorhandener globaler Vorgabe“ und wird davon nicht berührt.

**Verifizieren**: Vitest — zwei Website-Kanäle mit 3000 und 1500 im Scope ergeben `maxCharacters: 1500`; ein Kanal ohne eigenen Wert ergibt die globale Vorgabe; globale Vorgabe 5000 mit Kanälen 6000 und `null` ergibt `maxCharacters: 5000`, nicht 6000; die bestehenden Instagram-Fälle bleiben unverändert grün.

### Step 4 — Token-Leine an die Zeichengrenze koppeln

**Ohne diesen Schritt ist die 5000-Zeichen-Vorgabe aus Step 1 ein leeres Versprechen.** `TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS` ist heute eine feste 1200 und geht so in jeden Provideraufruf (`apps/worker/src/textGeneration.ts`). 1200 Ausgabe-Tokens tragen grob 4000 Zeichen deutschen Text, und davon geht die JSON-Struktur der Antwort ab (Headline, Hashtags, Alt-Text, Claims). Ein Beitrag, für den 5000 Zeichen erlaubt sind, käme abgeschnitten zurück — der Prompt nennt die Grenze, der Aufruf gibt sie nicht her.

Die Leine muss deshalb aus `session.max_characters` folgen statt konstant zu sein:

- Aus der eingefrorenen Zeichengrenze der Sitzung einen Token-Bedarf herleiten. **Im Review von PR #78 korrigiert** (siehe Korrektur 3 oben): Zeichen / **2** für deutschen Text — nicht 3 — plus ein fester Zuschlag für den JSON-Rahmen **plus einen Anteil je Beleg**, weil jeder Beleg in `verifiedFacts` *und* `generatedClaims` auftaucht und damit mit dem Quellmaterial wächst, nicht mit der Zeichengrenze. Untergrenze ist das bisherige feste Budget; eine harte Obergrenze gibt es nicht mehr, `MaxCharactersSchema` und `SourceMaterialSchema` begrenzen den Aufruf bereits.
- **Das ist die kostenschonendere Variante, nicht die teurere**: heute zahlt eine Instagram-Sitzung mit 2200 Zeichen dieselbe Leine wie ein 5000-Zeichen-Blogbeitrag. Danach bekommt jede Sitzung genau so viel Budget, wie ihre Grenze rechtfertigt — der teure Fall ist auf den Fall beschränkt, der ihn braucht. Die harte Obergrenze bleibt und wächst nicht mit der Nutzung.
- **Achtung `provider_parameter_hash`**: `maxOutputTokens` steckt im Hash (`parameterHash`, siehe Review von PR #76). Wird der Wert abgeleitet statt konstant, ändern sich Hashes — das ist korrekt, weil sich der tatsächlich gesendete Parameter ändert, aber es ist eine bewusste Provenienz-Änderung und gehört so in die Commit-Message.

**Verifizieren**: Vitest im Worker — eine Sitzung mit `max_characters: 2200` und eine mit `5000` erzeugen unterschiedliche `maxOutputTokens`; zwei Sitzungen mit **derselben** Zeichengrenze, aber unterschiedlich vielen Belegen erzeugen unterschiedliche `maxOutputTokens` **und** unterschiedliche `provider_parameter_hash` (der Vergleich zweier `max_characters`-Werte belegt das nicht — `max_characters` steht schon für sich im Hash, der Test wäre auch ohne die Ableitung grün gewesen). Vitest in den Contracts — das Budget fällt nie unter die alte feste Konstante. Danach einmal am echten Provider gegenprüfen, dass ein 5000-Zeichen-Blogbeitrag **vollständig** zurückkommt und nicht mitten im Satz endet.

## PR 2: Oberflächen

### Step 5 — Kanalverwaltung

`apps/web/app/pages/kanaele.vue` bekommt neben den beiden Verbinden-Knöpfen ein kleines Formular „Eigene Website / Blog hinzufügen“ (Anzeigename, Adresse, optional maximale Länge). Die Zuteilung an Abteilungen läuft über die vorhandene Scope-Oberfläche — dort ist nichts zu ändern, das ist der Sinn des Zuschnitts. Die Einleitung der Seite nennt heute nur „Instagram- und Facebook-Konten“; sie muss mit.

**Verifizieren**: Playwright-Smoke — Blog-Kanal anlegen, einer Abteilung zuteilen, Länge auf 1500 setzen, Seite neu laden, Wert steht.

### Step 6 — Textwerkstatt

`apps/web/app/pages/erstellen.vue`: `PLATFORM_LABELS` um `website: 'Eigene Website'` ergänzen. Sonst nichts — die Verfügbarkeitsliste kommt schon heute generisch aus `SocialPlatformSchema.options`, und die Begründungstexte (`no_channel`/`restricted_by_policy`) passen wörtlich.

Zusätzlich aus dem Review von PR #76, hier fällig statt dort: **eine optionale Obergrenze durch das Mitglied**. Betreiberwunsch vom 2026-08-14 — „manchmal will man einen kurzen, manchmal einen größeren Beitrag“. `maxCharacters` gibt es im Vertrag bereits als optionales Feld; es braucht nur ein Eingabefeld und die Aufnahme in den Entwurfsspeicher. In der Auflösung ist es ein **weiterer Kandidat der Minimumbildung**, keine Überschreibung: wer Instagram angehakt hat, darf die 2200 nicht per Formular aushebeln, denn ein Text, der dort nicht erscheinen kann, nützt niemandem.

**Verifizieren**: Vitest für die Auflösung (Mitgliedswunsch 5000 + Instagram 2200 ergibt 2200; Mitgliedswunsch 800 + Instagram 2200 ergibt 800). Playwright-Smoke: mit angelegtem Blog-Kanal ist „Eigene Website“ anhakbar, die Sitzung trägt die erwartete `max_characters`.

## Nicht enthalten

- **Die automatische Auslieferung an die Website.** Der Beitrag durchläuft Erzeugung und Freigabe wie jeder andere und liegt danach als freigegebene Version vor — abholbar, kopierbar. Wie er auf die Seite kommt (öffentlicher Feed, Webhook, CMS-Plugin, Einbettcode), ist weiterhin offen und braucht die Ausgangslage-Recherche, die `plans/README.md` für dieses Paket vorgesehen hat. Das gehört in ein Folgepaket **nach** einer Betreiberentscheidung über den Mechanismus.
- **`publications`/`publish_attempts` für Website-Ziele.** Ein Adapter entsteht hier nicht, und bis zum Folgepaket erzeugt ein Blog-Kanal keine Veröffentlichungszeile. **Korrigiert im Review von PR #78**: die CHECKs von `publications`/`post_variants` werden dafür gerade **nicht** mit erweitert. Die ursprüngliche Absicht („das Datenmodell nicht zweimal anfassen“) hätte die Zusage aufgehoben, statt sie durchzusetzen — `schedule_publication()` kopiert `connection.platform` ungefiltert in `publications`, ist `security definer` und per `grant execute … to authenticated` direkt über PostgREST aufrufbar. Ein Blog-Kanal wäre damit ein wählbares Veröffentlichungsziel gewesen, hätte eine `publications`-Zeile erzeugt, die `POST /v1/publications/:id/execute` mangels `social_connection_secrets`-Eintrag nie ausführen kann, und wäre zusätzlich am unveränderten `PublicationSchema` (`packages/contracts/src/policy.ts`) beim Serialisieren der eigenen Antwort mit `400` zerbrochen — nachdem die RPC bereits committet hatte. Der enge CHECK ist die verbindliche Sperre; `GET /v1/post-versions/:id/available-channels` blendet Website-Kanäle zusätzlich aus, damit die Oberfläche nichts Unmögliches anbietet.
- **Mehrere getrennte Texte je Plattform aus einer Sitzung.** Gibt es bewusst nicht (Betreiberentscheidung vom 2026-08-14, siehe Paket 042, Step 4 — dort verworfen). Hakt ein Verein Instagram (2200) und den Blog (5000) gemeinsam an, greift die `min()`-Regel und erzeugt **einen** Text mit 2200 Zeichen, der auf beiden erscheint. Das ist die Absicht: gemeinsame Auswahl heißt gemeinsamer Beitrag. Wer einen langen Blogtext **und** einen kurzen Instagram-Beitrag will, erzeugt zwei Sitzungen mit je einer Plattform — die Bequemlichkeit dafür (Einstellungen eines früheren Beitrags erneut laden) ist Paket 043.

## Offene Punkte

1. **Der Umrechnungsfaktor Zeichen → Tokens in Step 4 ist geschätzt, nicht gemessen.** „Zeichen / 3 plus Zuschlag“ ist eine Faustregel für deutschen Text; die tatsächliche Rate hängt am Tokenizer des jeweiligen Providers. Vor dem Merge einmal mit einem echten 5000-Zeichen-Blogbeitrag gegenprüfen und den Faktor bei Bedarf nachziehen. Zu knapp bemessen heißt abgeschnittener Text, zu großzügig heißt bezahltes Budget, das niemand nutzt.
2. **Blog und RSS-Feed sind im Datenmodell dasselbe (`platform = 'website'`).** Für dieses Paket reicht das: es entscheidet nur, dass der Kanal existiert, wem er gehört und wie lang seine Beiträge sein dürfen. Ob die Auslieferung später verschiedene Arten unterscheiden muss (eigener Blog per Webhook vs. abonnierbarer Feed), entscheidet das Folgepaket zum Auslieferungsmechanismus — und darf dann eine Unterart-Spalte nachrüsten, ohne diese Ausplanung zu widerlegen.
