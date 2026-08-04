# 017 – Plattform-Insights: Reichweite, Interaktionen und Wirkung

## Ergebnis

Für jeden veröffentlichten Beitrag stehen die Zahlen der Plattform bereit: wie oft er ausgeliefert und gesehen wurde, wie viele Menschen erreicht wurden, wie oft gelikt, kommentiert, geteilt, gespeichert und geklickt wurde. Die Werte werden wiederholt abgerufen, weil sie sich nach der Veröffentlichung noch entwickeln, und als Zeitreihe gehalten. Damit lässt sich sagen, welche Anlässe, Formate und Kanäle bei den eigenen Leuten wirklich ankommen.

## Abhängigkeit und Gate

Dieses Paket setzt Paket 006 (direkte Meta-Veröffentlichung) und Paket 016 (Metrikmodell) voraus. Ohne veröffentlichte Publikationen mit `provider_publication_id` gibt es nichts abzurufen.

Zusätzlich hängt es an einem **externen Gate**: die Meta-App braucht `pages_read_engagement` und `instagram_manage_insights` aus dem App Review. Das ist keine Implementierungsfrage, sondern ein Antrag mit Vorlauf. Der Plan ist umsetzbar und gegen Testkonten prüfbar, produktiv nutzbar erst danach.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- `packages/contracts/src/index.ts:82`: `'collect-analytics'` steht in `WorkflowNameSchema` und ist nicht implementiert.
- `supabase/migrations/202608030001:92-98` `publications` hält `provider_publication_id` — der Schlüssel für jeden Insights-Abruf ist vorhanden.
- `packages/publishing/src/index.ts:8` `SocialPublisher` kennt `validate`, `publish`, `reconcile` und optional `delete`. **Keine Methode für Metriken.** Die Provider-Grenze muss erweitert werden, und zwar getrennt, nicht durch Anhängen an `SocialPublisher`.
- `MetaPublisher.reconcile` (`:42-53`) ruft bereits `graph.facebook.com` mit `fields=id,permalink,status_code` ab. Das Muster für Graph-Abfragen inklusive Fehlerbehandlung existiert und ist übernehmbar.
- `packages/publishing/src/index.ts:2`: `PublicationStatus` enthält `'unknown'`, und die Regel aus `plans/README.md` verlangt Reconciliation statt blindem Retry. Für Insights gilt dasselbe: ein fehlender Wert ist nicht 0.
- `publication_attempts` (`:99-102`) protokolliert Versuche mit `error_class` und `response_summary`. Insights-Abrufe brauchen ein eigenes, ähnliches Protokoll, damit Ratenlimits und Fehler nachvollziehbar bleiben.
- Es gibt **keine Metriktabelle** für Plattformwerte.

## Scope

- Migration: Zeitreihe je Publikation, Kennzahlendefinitionen, Abrufprotokoll
- `packages/publishing`: eigenes `InsightsProvider`-Interface, Meta-Adapter, Fake-Adapter
- Hatchet-Workflow `collect-analytics` mit gestaffeltem Abrufplan und Ratenlimit
- Zusammenführung mit den internen Kennzahlen aus Paket 016
- Oberfläche: der in 016 bewusst leere Bereich wird gefüllt; Vergleich nach Anlass, Format, Kanal, Zeit
- Evidenzdokument zu API-Version, Berechtigungen und geprüften Fällen

Nicht enthalten: Kommentartexte und Sentiment (018), plattformübergreifende Normalisierung zu einer erfundenen Gesamtkennzahl, Werbeanzeigen und bezahlte Reichweite.

## Warum kein „Engagement-Score“

Instagram und Facebook messen unterschiedlich. „Reach“ auf einer Facebook-Seite und „Reach“ eines Instagram-Reels sind nicht dieselbe Größe, und Meta hat die Definitionen mehrfach geändert — `impressions` ist für Instagram-Medien inzwischen durch `views` ersetzt.

Deshalb gilt:

> Es werden Rohkennzahlen je Plattform gespeichert, benannt wie die Plattform sie benennt, mit der API-Version, aus der sie stammen. Kein zusammengerechneter Score, keine Umrechnung zwischen Plattformen, keine Kennzahl, die es bei der Quelle nicht gibt.

Ein Vergleich ist innerhalb einer Plattform gültig und über Plattformen hinweg nur als Nebeneinander. Das ist weniger befriedigend als eine große Zahl und deutlich weniger falsch.

## Datenmodell

Migration `2026080410_platform_insights.sql`:

```sql
create table public.publication_metrics (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  publication_id uuid not null,
  platform text not null check (platform in ('instagram','facebook')),
  collected_at timestamptz not null default now(),
  graph_api_version text not null,
  -- Rohwerte; null bedeutet "nicht geliefert", nicht 0
  reach integer, views integer, impressions integer,
  likes integer, comments integer, shares integer, saves integer,
  link_clicks integer, profile_visits integer, follows integer,
  video_watch_seconds integer, video_completions integer,
  raw jsonb not null default '{}'::jsonb check (jsonb_typeof(raw) = 'object'),
  foreign key (organization_id, publication_id)
    references public.publications(organization_id, id) on delete cascade
);
create unique index publication_metrics_snapshot_unique
  on public.publication_metrics (publication_id, collected_at);
create index publication_metrics_lookup_idx
  on public.publication_metrics (organization_id, publication_id, collected_at desc);

create table public.publication_metric_collections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, publication_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('succeeded','failed','rate_limited','not_available','permission_denied')),
  error_class text, retry_after_seconds integer,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (publication_id, attempt_number),
  foreign key (organization_id, publication_id)
    references public.publications(organization_id, id) on delete cascade
);
```

`null` statt `0` ist die wichtigste Entscheidung dieser Tabelle. Instagram liefert `saves` nicht für alle Medientypen, `shares` nicht für alle Formate. Eine Null würde in jeder Aggregation als „niemand hat gespeichert“ gelesen. Die Auswertung muss zwischen „null Mal“ und „nicht gemessen“ unterscheiden können, und das geht nur mit `null` plus einem Hinweis in der Anzeige.

`raw` hält die vollständige Antwort für Nachvollziehbarkeit und spätere Auswertung neuer Felder, ohne dass eine Migration nötig wird. Es darf keine personenbezogenen Daten enthalten — Insights-Antworten sind aggregiert, aber der Adapter filtert vor dem Speichern und protokolliert, was er verwirft.

Aggregat für die Auswertung, analog zu `metrics_daily` aus Paket 016:

```sql
-- department_id ist NOT NULL mit einer Sentinel-UUID statt NULL: PostgreSQL
-- erlaubt keinen ausdrucksbasierten (coalesce(...)) Primary Key, nur Spalten.
create table public.platform_metrics_daily (
  organization_id uuid not null,
  department_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  social_connection_id uuid not null,
  platform text not null, day date not null,
  publications integer not null default 0,
  reach_sum integer, views_sum integer,
  likes_sum integer, comments_sum integer, shares_sum integer, saves_sum integer,
  -- Abdeckung je Kennzahl, nicht global: Instagram liefert saves und shares
  -- nicht fuer jeden Medientyp, also hat jede Summe ihre eigene Grundgesamtheit.
  reach_available integer not null default 0, views_available integer not null default 0,
  likes_available integer not null default 0, comments_available integer not null default 0,
  shares_available integer not null default 0, saves_available integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (organization_id, day, social_connection_id, department_id)
);
```

Die `*_available`-Zähler neben den Summen: eine Summe über fünf von zwölf Publikationen ist keine Wochenreichweite. Ohne sie entstehen genau die Zahlen, die dieses Projekt zurückbauen will.

Ein **einziger** globaler Zähler würde dafür nicht reichen, und zwar aus demselben Grund, aus dem oben `null` statt `0` steht: Reichweite kann für zwölf Publikationen vorliegen und Likes nur für fünf. Ein gemeinsamer Wert müsste dann für beide gelten und wäre für mindestens eine der beiden Summen falsch. Je Kennzahl ein Zähler ist die einzige Form, in der `metricsAvailable` in `GET /v1/analytics/summary` eine wahre Aussage sein kann.

Für Aggregate wird je Publikation der **letzte** Schnappschuss verwendet, nicht die Summe der Schnappschüsse. Insights sind kumulativ.

## Umsetzung

### 1. Provider-Grenze

`packages/publishing/src/insights.ts` — ein **eigenes** Interface, nicht angehängt an `SocialPublisher`:

```ts
export interface PublicationInsight {
  publicationId: string
  collectedAt: string
  graphApiVersion: string
  metrics: Readonly<Record<string, number | null>>
  raw: Readonly<Record<string, unknown>>
}

export interface InsightsProvider {
  readonly platform: Platform
  readonly supportedMetrics: readonly string[]
  fetch(input: { externalId: string; format: OutputFormat }): Promise<PublicationInsight>
}
```

Begründung für die Trennung: Veröffentlichen und Messen haben unterschiedliche Berechtigungen, unterschiedliche Ratenlimits, unterschiedliche Fehlerklassen und einen völlig anderen Lebenszyklus. Ein gemeinsames Interface würde beide Seiten verkomplizieren.

- `MetaInsightsProvider` nutzt `/{media-id}/insights` für Instagram und `/{post-id}/insights` für Facebook. Die abgefragten Kennzahlen unterscheiden sich je Medientyp — ein Reel liefert andere als ein Feed-Bild. Die Zuordnung Format → Kennzahlenliste ist Teil des Adapters und wird als Tabelle im Evidenzdokument festgehalten.
- `FakeInsightsProvider` liefert deterministische Werte aus dem `externalId`-Hash, damit lokale Entwicklung und Tests ohne Meta funktionieren — dasselbe Muster wie `FakePublisher` (`packages/publishing/src/index.ts:10-15`). Er wird über `PUBLISHING_PROVIDER` gewählt und ist im Produktivbetrieb nicht erreichbar.
- **Kein `raw`-Feld ungefiltert durchreichen.** Der Adapter kennt eine Whitelist erlaubter Schlüssel; alles andere wird verworfen und die Anzahl protokolliert. Ändert Meta die Antwort, ist das sichtbar statt still gespeichert.

### 2. Abrufplan

Insights entwickeln sich nach der Veröffentlichung. Ein einmaliger Abruf misst nichts. Ein Abruf jede Stunde für immer verbrennt Ratenlimits.

Gestaffelt, je Publikation ab Veröffentlichungszeitpunkt:

| Zeitpunkt | Zweck |
|---|---|
| +1 Stunde | frühe Reaktion |
| +6 Stunden | Verlauf des ersten Tages |
| +24 Stunden | der Wert, mit dem üblicherweise verglichen wird |
| +72 Stunden | Nachlauf |
| +7 Tage | weitgehend stabil |
| +30 Tage | Abschluss, danach keine Abrufe mehr |

Sechs Schnappschüsse je Publikation. Bei zwanzig Beiträgen pro Monat und zwei Kanälen sind das 240 Abrufe im Monat — unkritisch für jedes Ratenlimit.

Umsetzung als Hatchet-Workflow `collect-analytics`:

- geplant beim Übergang einer Publikation auf `published`, mit `scheduledFor` je Stufe. Der `Orchestrator` unterstützt `scheduledFor` bereits (`packages/orchestration/src/index.ts:6`).
- Idempotenzschlüssel `createIdempotencyKey('insights', publicationId, stage)` — die Kind-Werte in `createIdempotencyKey` (`packages/domain/src/index.ts:90`) müssen dafür um `'insights'` erweitert werden. `'publish'` zweckzuentfremden wäre falsch: die Schlüssel kollidierten dann mit denen des Veröffentlichungspfads für dieselbe Publikation.
- Fairness-Key `organizationId:socialConnectionId`, weil Meta-Ratenlimits pro App und pro Konto greifen.
- Concurrency-Gruppe: `concurrency` in `apps/worker/src/workflows.ts:6-9` um `insights: { global: 8, organization: 2, department: 1 }` erweitern.
- Fehlerbehandlung: `rate_limited` mit `retry_after` wird respektiert und neu geplant, **nicht** sofort wiederholt. `permission_denied` ist nicht wiederholbar und setzt den Kanal auf `action_required` (Paket 012), weil in der Regel eine Berechtigung fehlt. `not_available` bei zu jungen oder gelöschten Beiträgen wird protokolliert und beendet den Plan für diese Publikation.
- Ein fehlgeschlagener Abruf schreibt **keine** Metrikzeile. Eine Zeile mit Nullen wäre eine Falschaussage.

### 3. Zusammenführung

`GET /v1/analytics/summary` aus Paket 016 wird um Plattformwerte erweitert. Jede Plattformkennzahl trägt in der Antwort mit:

- `value`, `metricsAvailable`, `publications`, `platform`, `graphApiVersion`, `lastCollectedAt`

Ohne diese Begleitangaben ist der Wert nicht interpretierbar. `coverage` aus Paket 016 wird um „Plattformwerte liegen für N von M Publikationen vor“ erweitert.

Neuer Endpunkt `GET /v1/analytics/posts?from&to&sort=reach|likes|comments` für die eigentliche Produktfrage: welche Beiträge kamen an. Mit Anlass, Format, Kanal und Veröffentlichungszeit, damit ein Muster erkennbar wird.

### 4. Oberfläche

- Der in Paket 016 bewusst leere Bereich „Reichweite und Interaktionen“ wird gefüllt, mit Angabe der Abdeckung direkt an der Zahl.
- Bestenliste „Das kam am besten an“ und ihr Gegenstück „Hier war die Resonanz gering“ — beides mit dem Hinweis, dass Reichweite von Uhrzeit und Kanalgröße abhängt und nicht nur von der Qualität. Ein Verein, der aus fünf Datenpunkten Schlüsse zieht, soll wenigstens gewarnt sein.
- Vergleich nach Anlass, Format und Wochentag als Nebeneinander je Plattform, nie zusammengerechnet.
- Je Beitrag eine Detailansicht mit dem Verlauf über die sechs Schnappschüsse. Das ist die Ansicht, die zeigt, ob ein Beitrag sofort oder langsam wirkt.
- Kennzahlen, die eine Plattform für ein Format nicht liefert, erscheinen als „nicht gemessen“ mit Erklärung — nicht als Strich und nicht als 0.

### 5. Evidenz

`docs/evidence/insights-spike.md` hält fest: Graph-API-Version, angeforderte Berechtigungen, Zuordnung Medientyp → verfügbare Kennzahlen, beobachtete Ratenlimits, Verhalten bei gelöschten Beiträgen, Datum der manuellen Prüfung. Meta ändert Insights-Felder regelmäßig; ohne dieses Dokument ist bei der nächsten Änderung nicht rekonstruierbar, was einmal funktioniert hat.

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Adaptertests gegen aufgezeichnete Antworten: Instagram-Feed-Bild, Instagram-Reel, Facebook-Seitenbeitrag; fehlende Kennzahl wird `null`, nicht `0`; unbekannte Schlüssel werden verworfen und gezählt; 429 mit `retry_after` wird korrekt gelesen; 400 mit Berechtigungsfehler wird als `permission_denied` klassifiziert.
- Aggregationstests: Aggregat nutzt den letzten Schnappschuss je Publikation, nicht die Summe; die `*_available`-Zähler stimmen je Kennzahl und weichen voneinander ab, wenn eine Publikation `saves` nicht liefert; Publikation ohne Werte senkt keine Summe.
- pgTAP: zwei Schnappschüsse mit gleichem `collected_at` verstoßen gegen den Unique-Index; Metriken eines fremden Vereins sind unsichtbar; Löschen einer Publikation entfernt ihre Metriken.
- Workflow-Tests: alle sechs Stufen werden geplant; doppelte Auslösung erzeugt keinen zweiten Abruf; `rate_limited` plant neu statt zu wiederholen; nach +30 Tagen wird nichts mehr geplant; **der Insights-Schlüssel einer Publikation ist verschieden vom Veröffentlichungsschlüssel derselben Publikation** — mit `'publish'` als Kind wären sie gleich, und der Insights-Abruf würde als bereits erledigt gelten und nie laufen.
- manuell mit Meta-Testkonto: einen Beitrag veröffentlichen, nach einer Stunde liegt ein Schnappschuss vor, die Zahlen entsprechen der Meta-Oberfläche. Diese Gegenprobe ist unverzichtbar — eine Zahl, die von der Plattformansicht abweicht, kostet mehr Vertrauen als eine fehlende.

## Risiken und offene Entscheidungen

- **App Review** ist das harte Gate. Ohne `pages_read_engagement` und `instagram_manage_insights` liefert jeder Abruf einen Berechtigungsfehler. Der Antrag braucht Datenschutzerklärung, Löschanfrage-Endpunkt und ein Demonstrationsvideo — Paket 020 und 012 liefern die Voraussetzungen.
- **Instabile Kennzahlendefinitionen**: Meta hat `impressions` für Instagram-Medien durch `views` ersetzt und Kennzahlen mit Ankündigungsfristen entfernt. Die Speicherung mit `graph_api_version` und `raw` ist die Vorsorge; ein Bruch bleibt trotzdem eine Änderung am Adapter. Die Auswertung muss mit Zeitreihen umgehen können, in denen ein Feld ab einem Datum fehlt.
- **Kleine Zahlen**: ein Vereinskanal hat oft dreistellige Reichweiten. Unterschiede zwischen zwei Beiträgen sind dann meist Rauschen. Die Oberfläche sollte bei kleinen Grundgesamtheiten keine Prozentvergleiche anbieten — das ist eine Produktentscheidung, die vor dem Bau der Bestenliste zu treffen ist.
- **Story-Insights** sind nur 24 Stunden abrufbar. Der Abrufplan muss für Stories anders aussehen: +1 h und +23 h, danach nichts mehr. Sonst fehlen Story-Werte dauerhaft.
- **Gelöschte Beiträge**: löscht ein Verein einen Beitrag auf der Plattform, liefert der Abruf 404. Das ist kein Fehler, sondern ein legitimer Endzustand und muss als solcher dargestellt werden — inklusive der Frage, ob die Metrikhistorie bleibt. Vorschlag: sie bleibt, mit Vermerk.
