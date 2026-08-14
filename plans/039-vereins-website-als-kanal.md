# Plan 039: Vereinseigene Website/Blog als Kanal

> **Executor instructions**: Zwei PRs in dieser Reihenfolge. PR 1 legt Datenmodell und API, PR 2 die Oberflächen. PR 2 setzt auf dem gemergten Stand von PR 1 auf. Dieses Paket enthält **nicht** die automatische Auslieferung an die Website — siehe „Nicht enthalten".
>
> **Drift check (run first)**: `git log --oneline -3 -- supabase/migrations apps/api/src/routes/channels.ts apps/api/src/routes/channelOAuth.ts packages/contracts/src/channels.ts` — Stand bei Ausplanung ist der Merge von PR #76 (Paket 042 PR 3). Kommt an diesen Pfaden etwas Neueres, erst prüfen, ob `social_connections` inzwischen weitere Plattformen oder einen Anlageweg ohne OAuth kennt.

## Status

- **Priority**: P2
- **Effort**: M (PR 1 M, PR 2 S)
- **Risk**: MEDIUM — eine Migration lockert `not null` auf einer Tabelle, die heute ausschließlich über den OAuth-Callback befüllt wird; die Plattform-Prüfung steht an sieben Stellen in SQL
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

Der Gewinn dieses Zuschnitts: die Textwerkstatt braucht **keine einzige Sonderbehandlung**. `resolveAvailableChannels` beantwortet „darf dieser Scope hier veröffentlichen" für einen Blog-Kanal genauso wie für einen Instagram-Kanal. Ein Verein ohne Blog sieht ihn nicht, einer mit Blog schon. Die Sackgasse verschwindet als Nebenwirkung, nicht als eingebauter Sonderweg.

## Current state

| Wo | Was |
|---|---|
| `social_connections` | `platform text not null check (platform in ('instagram','facebook'))`, `external_account_id text not null`, `token_ciphertext bytea not null`, `token_key_version text not null`, `unique (organization_id, platform, external_account_id)` |
| Anlage einer Zeile | **ausschließlich** in `apps/api/src/routes/channelOAuth.ts:198` (OAuth-Callback). Es gibt **keine** `POST /v1/channels`-Route — `channels.ts` kennt nur GET/PATCH/DELETE/verify und die Scope-Routen |
| `channel_scopes` | Verein/Abteilung/Team mit `can_schedule`; trägt die Zuteilung, die dieses Paket unverändert nutzt |
| Plattform-CHECK in SQL | `social_connections`, `publications`, `post_targets`, `publish_attempts` (`202608030001`), zwei Tabellen in `2026080701`, `text_generation_platform_defaults` (`2026081308`), `composition_sessions.target_platforms` (`2026081309`) |
| Längengrenze | global je Plattform in `text_generation_platform_defaults`, gepflegt vom **Plattform-Admin** (Betreiber). Kein Wert je Kanal |
| `resolveTextGenerationPlatformAvailability` | `apps/api/src/routes/shared.ts` — je Plattform „verfügbar/nicht", Grund `no_channel` oder `restricted_by_policy`, plus Zeichengrenze aus der globalen Vorgabe |
| `apps/web/app/pages/kanaele.vue` | 55 Zeilen, zwei Knöpfe „Instagram verbinden" / „Facebook verbinden", beide starten den OAuth-Fluss |
| `SocialPlatformSchema` | `z.enum(['instagram','facebook'])` in `packages/contracts/src/primitives.ts`, geteilt von Kanälen, OAuth, Veröffentlichung und Textwerkstatt |

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Voller Gate | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | exit 0 |
| DB-Tests | `pnpm db:start && pnpm db:reset && pnpm db:test` | exit 0, alle pgTAP-Dateien grün |
| Web-Teilgate | `cd apps/web && pnpm typecheck && pnpm test` | exit 0 |

## Entwurfsentscheidungen

Diese drei sind vor der Umsetzung bewusst getroffen worden und sollten nicht stillschweigend anders gelöst werden.

**1. `website` kommt in `SocialPlatformSchema`, nicht in ein zweites Vokabular.**
Naheliegend wäre ein getrenntes `TextGenerationTargetSchema`, weil eine Website kein OAuth-Konto ist. Dagegen spricht der Kommentar an `SocialPlatformSchema` selbst: „Bewusst EINE Menge für Kanäle und Textwerkstatt — auf welchen Plattformen ein Beitrag entstehen darf, ist genau die Menge, auf die überhaupt veröffentlicht werden kann." Genau diese Gleichung soll gelten: der Blog **ist** ein Veröffentlichungsziel. Zwei Vokabulare würden bei jedem weiteren Kanal auseinanderlaufen. Was eine Website von Instagram unterscheidet, ist nicht die Zugehörigkeit zur Menge, sondern das Fehlen eines Tokens — und das gehört an die Spalten, nicht an den Enum.

**2. Kein Token, kein `external_account_id` — beide werden nullable.**
Ein Blog-Kanal hat kein OAuth-Geheimnis. `token_ciphertext`/`token_key_version` werden `null`-fähig, mit einem CHECK, der sie für alle Plattformen **außer** `website` weiterhin erzwingt. Damit bleibt die heutige Zusicherung für Instagram/Facebook wortwörtlich erhalten, statt sie global aufzuweichen. Gleiches für `external_account_id`: der `unique (organization_id, platform, external_account_id)` braucht für Website-Kanäle einen anderen Träger — die Website-URL.

**3. Die Längengrenze je Kanal ist eine Spalte auf `social_connections`, nicht eine zweite Tabelle.**
`max_characters integer null check (max_characters between 100 and 10000)`. `null` bedeutet „globale Vorgabe der Plattform gilt" — so bleibt Instagram unverändert vom Betreiber gesteuert, während der Verein für seinen Blog selbst entscheidet. Die harte Obergrenze steht damit im CHECK **und** in `MaxCharactersSchema`, an beiden Enden derselbe Bereich.

## PR 1: Datenmodell, Kanalanlage und Längenauflösung

### Step 1 — Migration: `website` als Plattform

Neue Migration (Nummer nach dem dann höchsten Stand, zum Planungszeitpunkt `2026081310`):

- Alle Plattform-CHECKs auf `('instagram','facebook','website')` erweitern. **Alle sieben Stellen** aus „Current state" abarbeiten — ein übersehener CHECK schlägt erst beim ersten echten Blog-Beitrag zu, nicht beim Anlegen des Kanals.
- `social_connections`: `token_ciphertext`/`token_key_version`/`external_account_id` auf `null` erlauben, dazu
  `check (platform = 'website' or (token_ciphertext is not null and token_key_version is not null and external_account_id is not null))`.
- `social_connections.max_characters integer null check (max_characters between 100 and 10000)`.
- `social_connections.website_url text null` mit URL-Form-CHECK; `check (platform <> 'website' or website_url is not null)`.
- Partieller Unique-Index für Website-Kanäle: `unique (organization_id, website_url) where platform = 'website'`.
- `text_generation_platform_defaults`: Zeile für `website` mit einem Wert, den die Token-Leine auch liefern kann — **nicht 10000**. `TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS` steht bei 1200 und begrenzt den Aufruf auf grob 4000 Zeichen deutschen Text; ein höherer Vorgabewert verspricht eine Länge, die nie entsteht. Empfehlung: **3000**, vom Plattform-Admin änderbar.

**Verifizieren**: `pnpm db:reset && pnpm db:test` grün. Neuer pgTAP-Fall: ein `insert` eines Website-Kanals ohne Token gelingt, derselbe `insert` mit `platform = 'instagram'` scheitert. Zweiter Fall: `max_characters = 99` und `= 10001` werden beide abgewiesen.

### Step 2 — `POST /v1/channels` für Website-Kanäle

Die erste Anlage-Route überhaupt. `requirePermission('social_account.manage', channelOwnerScope(...))`, Service-Client für den Insert wie im OAuth-Pfad.

- Nimmt `platform: 'website'`, `displayName`, `websiteUrl`, `ownerScope`/`ownerDepartmentId`, optional `maxCharacters`.
- Lehnt jede andere Plattform mit `422` ab: Instagram/Facebook entstehen weiterhin **nur** über OAuth, sonst ließe sich ein Kanal ohne gültiges Token anlegen und die Veröffentlichung liefe später ins Leere.
- `websiteUrl` durch dieselbe Prüfung wie andere vom Verein hinterlegte Adressen — die Adresse wird später serverseitig abgerufen, deshalb gilt die SSRF-Regel des Projekts (`outboundFetch`, siehe Paket 034). Auch wenn dieses Paket noch nichts abruft: eine Adresse, die hier ungeprüft hineinkommt, ist die Lücke, die das Folgepaket erbt.
- Audit-Eintrag wie bei der OAuth-Anlage.

**Verifizieren**: Vitest — Anlage gelingt mit Berechtigung, `403` ohne, `422` für `platform: 'instagram'`, `422` für eine Adresse im internen Netz. Danach ist der Kanal über `GET /v1/organizations/:id/channels` sichtbar.

### Step 3 — Längengrenze je Kanal

- `PATCH /v1/channels/:id` nimmt `maxCharacters` (nullable) entgegen, `MaxCharactersSchema` validiert die harte Obergrenze.
- `resolveTextGenerationPlatformAvailability` liefert je Plattform die **kleinste** `max_characters` der tatsächlich verfügbaren Kanäle dieser Plattform, und fällt auf die globale Vorgabe zurück, wo kein Kanal einen eigenen Wert trägt. Kleinste, nicht erste: stehen einem Scope zwei Blogs mit 3000 und 1500 zur Verfügung, muss ein Text auf beiden erscheinen können.
- **Wichtig**: der `null`-Rückgabewert aus dem Review von PR #76 bleibt erhalten — eine fehlende Vorgabezeile zählt in der `min()`-Bildung weiterhin nicht mit (siehe `apps/api/src/routes/content.ts`, Kommentar an `limits`). Der neue Kanalwert kommt als **weiterer** Kandidat in dieselbe Minimumbildung, er ersetzt sie nicht.

**Verifizieren**: Vitest — zwei Website-Kanäle mit 3000 und 1500 im Scope ergeben `maxCharacters: 1500`; ein Kanal ohne eigenen Wert ergibt die globale Vorgabe; die bestehenden Instagram-Fälle bleiben unverändert grün.

## PR 2: Oberflächen

### Step 4 — Kanalverwaltung

`apps/web/app/pages/kanaele.vue` bekommt neben den beiden Verbinden-Knöpfen ein kleines Formular „Eigene Website / Blog hinzufügen" (Anzeigename, Adresse, optional maximale Länge). Die Zuteilung an Abteilungen läuft über die vorhandene Scope-Oberfläche — dort ist nichts zu ändern, das ist der Sinn des Zuschnitts. Die Einleitung der Seite nennt heute nur „Instagram- und Facebook-Konten"; sie muss mit.

**Verifizieren**: Playwright-Smoke — Blog-Kanal anlegen, einer Abteilung zuteilen, Länge auf 1500 setzen, Seite neu laden, Wert steht.

### Step 5 — Textwerkstatt

`apps/web/app/pages/erstellen.vue`: `PLATFORM_LABELS` um `website: 'Eigene Website'` ergänzen. Sonst nichts — die Verfügbarkeitsliste kommt schon heute generisch aus `SocialPlatformSchema.options`, und die Begründungstexte (`no_channel`/`restricted_by_policy`) passen wörtlich.

Zusätzlich aus dem Review von PR #76, hier fällig statt dort: **eine optionale Obergrenze durch das Mitglied**. Betreiberwunsch vom 2026-08-14 — „manchmal will man einen kurzen, manchmal einen größeren Beitrag". `maxCharacters` gibt es im Vertrag bereits als optionales Feld; es braucht nur ein Eingabefeld und die Aufnahme in den Entwurfsspeicher. In der Auflösung ist es ein **weiterer Kandidat der Minimumbildung**, keine Überschreibung: wer Instagram angehakt hat, darf die 2200 nicht per Formular aushebeln, denn ein Text, der dort nicht erscheinen kann, nützt niemandem.

**Verifizieren**: Vitest für die Auflösung (Mitgliedswunsch 5000 + Instagram 2200 ergibt 2200; Mitgliedswunsch 800 + Instagram 2200 ergibt 800). Playwright-Smoke: mit angelegtem Blog-Kanal ist „Eigene Website" anhakbar, die Sitzung trägt die erwartete `max_characters`.

## Nicht enthalten

- **Die automatische Auslieferung an die Website.** Der Beitrag durchläuft Erzeugung und Freigabe wie jeder andere und liegt danach als freigegebene Version vor — abholbar, kopierbar. Wie er auf die Seite kommt (öffentlicher Feed, Webhook, CMS-Plugin, Einbettcode), ist weiterhin offen und braucht die Ausgangslage-Recherche, die `plans/README.md` für dieses Paket vorgesehen hat. Das gehört in ein Folgepaket **nach** einer Betreiberentscheidung über den Mechanismus.
- **`publications`/`publish_attempts` für Website-Ziele.** Die CHECKs werden in Step 1 mit erweitert, damit das Datenmodell nicht zweimal angefasst werden muss — ein Adapter entsteht hier aber nicht. Bis zum Folgepaket erzeugt ein Blog-Kanal keine Veröffentlichungszeile.
- **Mehrere getrennte Texte je Plattform.** Bleibt Paket 042, Step 4 (`GeneratedPostSchema.variants`). Sobald ein Verein Instagram (2200) und einen Blog (3000) zusammen anhakt, greift weiterhin die `min()`-Regel und stutzt auf 2200. Das ist erträglich, solange die Grenzen ähnlich sind, und genau der Fall, für den die getrennten Varianten vorgesehen sind.

## Offene Punkte

1. **Darf ein Verein mehrere Website-Kanäle haben?** Der Entwurf lässt es zu (partieller Unique-Index auf der Adresse, nicht auf der Organisation) — ein Verein mit Hauptseite und separatem Abteilungsblog ist plausibel. Falls unerwünscht, ist der Index auf `(organization_id) where platform = 'website'` zu verengen.
2. **Vorgabewert 3000 für `website`.** Hergeleitet aus der Token-Leine (1200 Tokens ≈ 4000 Zeichen), nicht gemessen. Vor dem Merge einmal mit dem echten Provider gegenprüfen, ob ein 3000-Zeichen-Text zuverlässig vollständig zurückkommt oder abgeschnitten wird.
