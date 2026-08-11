# 016 – Auswertung: interne Kennzahlen und Metrikmodell

## Ergebnis

Die Auswertung zeigt echte Zahlen aus dem eigenen System: wie viele Beiträge in einem Zeitraum entstanden, freigegeben, geplant und veröffentlicht wurden, aufgeschlüsselt nach Abteilung, Team, Kanal und Anlass; wie lange ein Beitrag von der Idee bis zur Veröffentlichung braucht; wie oft Freigaben abgelehnt werden und warum; wie stark Kontingente ausgelastet sind. Kein Wert ist geschätzt, kein Balken erfunden. Plattformzahlen wie Reichweite und Interaktionen fehlen an dieser Stelle ehrlich sichtbar und kommen mit Paket 017.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- `apps/web/app/pages/auswertung.vue:1` ist eine Zeile: vier erfundene Kennzahlen („Reichweite 24.812 +18 %“, „Interaktionen 1.946 +11 %“, „Profilaufrufe 683 +24 %“, „Link-Klicks 214 +8 %“) und ein Array `bars=[38,52,44,68,61,78,74,88,65,92,81,96]` als „Reichweitenentwicklung nach Woche“. Alle vier Kennzahlen sind Plattformwerte, die es ohne Meta-Anbindung nicht geben kann.
- Der Balkenchart hat keine Achsenbeschriftung außer „W1“–„W12“, keine Skala, keinen Bezugszeitraum und keine Datenquelle. Er ist Dekoration.
- `apps/web/app/pages/index.vue:10-15` wiederholt dieselbe Erfindung im Dashboard, inklusive „Veröffentlicht 18 diesen Monat +12 %“.
- Es gibt **keine Analytics-Tabelle**, kein Aggregat, keine Query und keinen Endpunkt.
- `packages/contracts/src/index.ts:82` enthält `'collect-analytics'` bereits in `WorkflowNameSchema` — der Workflow ist vorgesehen und nicht implementiert.
- Auswertbare Rohdaten sind **schemamäßig** vorhanden, aber nach Paket 011 überwiegend ohne echte Nutzungsdaten: `posts` mit `status`, `created_at`, `scheduled_for` (`202608020001:151-170`); `submissions` mit `preset_slug`, `communication_goal`, `requested_formats` (`202608030001:4-7`); `post_versions` mit `version_number` (`202608020001:172-192`); `approval_requests` und `approval_decisions` mit `decision` und `reason` (`:200-232`); `publications` mit `status` und `scheduled_for` (`202608030001:92-98`); `workflow_runs` mit `technical_status`, `attempt`, `error_class` (`:81-85`). **Korrektur nach Paket 011, überholt durch Paket 025**: Paket 011 hatte bewusst keine Inhalts-Pipeline vorgezogen — kein Code erzeugte einen `post`/eine `post_version` aus einer `submission`, solange Pakete 001–007 „in Arbeit“ waren (siehe `plans/011-regelwerk-richtlinien-und-kontingente.md`, Abschnitt „Umsetzung: Ergebnis und Abweichungen vom Plan“). **Seit Paket 025 gilt das nicht mehr**: `POST /v1/submissions` legt bei vollständigem Quellmaterial echt `post`/`post_version`/`post_variants` an; `approval_requests`/`approval_decisions` sind über `request_approval` erreichbar (aber ohne UI-Trigger dafür, siehe `plans/025-inhalts-pipeline-entwurf-und-veroeffentlichung.md`); `publications` entstehen über `schedule_publication` (011/012) und werden über `POST /v1/publications/:id/execute` (025) tatsächlich ausgeführt. Dieses Paket trifft also erstmals auf einen potenziell echten, aber noch dünnen Funnel — je nach Nutzung im Zeitpunkt der Umsetzung können die Tabellen trotzdem noch fast leer sein (kein UI-Trigger für Freigabeanfragen, keine Medien ohne Upload-Pipeline). Vor dem Bauen prüfen, wie viele echte Zeilen tatsächlich vorliegen, statt blind von leer oder blind von voll auszugehen.
- Indizes für Zeitreihenabfragen sind teilweise vorhanden: `posts_scope_status_idx (organization_id, department_id, status, created_at desc)` (`202608020001:447`), `submissions_scope_idx` (`:446`). Für Statusübergänge fehlt jede Grundlage.
- **Der entscheidende Mangel**: es gibt keine Statushistorie. `posts.status` ist ein aktueller Wert. Wie lange ein Beitrag in `awaiting_approval` lag, ist heute nicht rekonstruierbar. Ohne Historie sind Durchlaufzeiten nicht messbar.

## Abweichungen vom Plan, vor der Umsetzung festgelegt (2026-08-08)

Bei der Verifikation gegen den aktuellen Code (Stand `cc5da332`, nach Paket 020/PR #27) ergaben sich acht Abweichungen vom ursprünglichen Entwurf oben. Sie werden hier vor dem Bauen dokumentiert, nicht still angewendet:

1. **Migrationsdateiname**: `2026080409_metrics.sql` (Zeile 56 unten) folgt keinem im Repo tatsächlich verwendeten Namensschema (weder dem alten 12-stelligen `YYYYMMDD`+4-stellige Sequenz noch dem seit Paket 013 verwendeten 10-stelligen `YYYYMM`+2-stellige laufende Nummer+2-stellige Sequenz) und würde lexikografisch vor bereits angewandte Migrationen ab dem 4. August einsortieren. Tatsächlicher Dateiname: `2026081001_metrics.sql` (letzte vorhandene Migration ist `2026080901_compliance_and_retention.sql`, Paket 020).
2. **`analytics.view` existiert bereits vollständig** — TS (`packages/authorization/src/index.ts:14`, Rollen-Zuordnung ab Zeile 39) und SQL (`authz.has_organization_permission`, `202608020001:303-322`; `authz.has_department_permission`, zuletzt neu gefasst in `2026080801_consent_management.sql:179-203`). Kein Rechte-Umbau nötig, nur Nutzung.
3. **Query-Form der Endpunkte**: Der Plan skizziert `?from&to&scope&scopeId`. Dafür gibt es im Code keine Präzedenz — jeder bestehende GET-Endpunkt mit Scope-Filter (`/v1/consent-requests`, `/v1/consents`, `/v1/organizations/:id/fixtures`) nutzt stattdessen `organizationId` (Pflicht) plus optionale `departmentId`/`teamId`. Die Analytics-Endpunkte übernehmen dieses etablierte Muster statt eines neuen Enum-Paars, um nicht zwei parallele Scope-Konventionen im selben Code zu haben.
4. **Kein `metrics_daily`/`metrics_by_preset_daily`, kein Aggregationsjob — alles wird live berechnet.** Ursprünglich war ein lazy Read-Through-Cache angedacht (Tag ohne Aggregatzeile wird live berechnet und zurückgeschrieben). Das wurde beim Entwerfen verworfen: Paket 004 liefert zwar inzwischen einen laufenden ID-only Worker, für `aggregate-metrics` ist jedoch kein fachlicher Cron/Executor registriert. Jeder Lesezugriff müsste den Cache daher weiterhin live berechnen — die Cache-Tabelle wäre reine, ungenutzte Infrastruktur gewesen, genau das, was „keine Abstraktion für Code, der nur einmal verwendet wird" verbietet. Stattdessen: **alle vier Leseendpunkte (`summary`, `timeseries`, `breakdown`, `funnel`) lesen bei jeder Anfrage direkt aus `post_status_events`, `approval_decisions`, `publications`, `workflow_runs`, `post_versions`, `posts` und `submissions`** — pro Anfrage je Rohtabelle eine Abfrage über den ganzen angefragten Zeitraum (nicht pro Tag), Bucketing/Summierung/Median laufen danach als reine Funktionen in `packages/domain/src/metrics.ts` über die bereits geladenen Zeilen. Das ist exakt die Begründung, die der ursprüngliche Plan schon für Perzentile gibt („für den erwarteten Datenumfang eines Vereins ist erneutes Lesen die einfachere und ausreichende Lösung"), hier auf alle Kennzahlen verallgemeinert. `'aggregate-metrics'` wird trotzdem als Name in `WorkflowNameSchema` reserviert (Kommentar wie bei `sync-integration-source`/`enforce-retention`) — falls eine spätere Messung bei einem sehr großen Verein tatsächlich Live-Berechnung zu langsam macht, ist eine Vorberechnungstabelle der nächste Schritt, aber „erst messen" (Plan, Abschnitt „Risiken"). **Damit sind die `metrics_daily`/`metrics_by_preset_daily`-Tabellen im Abschnitt „Datenmodell" unten, der Hatchet-Aggregationsjob im Abschnitt „Scope" sowie die „Aggregationstests" im Abschnitt „Verifikation" verworfener Entwurf, nicht Umsetzungsstand** — an den jeweiligen Stellen unten mit einem Verweis auf diesen Punkt markiert (CodeRabbit-Fund zu PR #28: diese Abschnitte widersprachen sich sonst mit dem tatsächlichen Ergebnis).
5. **Keine neue Chart-Bibliothek**: `apps/web/package.json` enthält keine Diagramm-Bibliothek, und keine bestehende Seite nutzt eine. Die Zeitreihe (Abschnitt „Oberfläche") wird als handgerolltes SVG mit echter Achse, Datumslabels, Skala und Nulllinie gebaut, keine neue Laufzeitabhängigkeit.
6. **`pages/index.vue` ist bereits weiter als die „Ausgangslage" unten annimmt**: Paket **009** hat dort schon drei echte Kennzahlenkacheln gebaut (Veröffentlicht, Offene Freigaben, Geplant nächste 7 Tage — `apps/web/app/pages/index.vue:77-85`, direkte Supabase-Query, kein erfundener Trend mehr; git-history-geprüft: Commit `93661b85` „Paket 009 umsetzen" führt diese drei Kacheln ein, Paket 019 lässt sie unangetastet — Berichtigung eines Zuordnungsfehlers, ursprünglich fälschlich 019 zugeschrieben, CodeRabbit-Fund zu PR #28; deckt sich jetzt mit `plans/README.md`, Rückbau-Inventar). Der Rückbau-Abschnitt unten (Zeile 204-205) bezieht sich auf einen Stand, der nicht mehr existiert; er gilt als bereits erledigt. Einziges verbleibendes Rückbau-Ziel dieses Pakets ist `pages/auswertung.vue`.
7. **`post_status_events` bekommt sofort eine Aufbewahrungsregel**, nicht erst in einem Folgepaket: `retention_settings` erhält `status_event_days` (Default 730 Tage / 24 Monate, wie vom Plan unter „Risiken" empfohlen), durchgesetzt im bestehenden `POST /v1/organizations/:id/retention/run`. Das ist kein optionaler Zusatz — die Migration aus Paket 020 (`2026080901_compliance_and_retention.sql:123-127`) hat die Spalte ausdrücklich mit dem Kommentar „Nachzuziehen, sobald 016/018 gebaut werden" ausgespart; diese Zusage wird hier eingelöst. **Ersetzt damit die Aussage im Abschnitt „Risiken" unten** („eine Aufbewahrungsfrist gehört in Paket 020"), die noch vom Stand vor dieser Entscheidung stammt (CodeRabbit-Fund zu PR #28).
8. **Metrikdefinitionen, die die Mehrstufigkeit aus Paket 011 (`approval_stages`) betreffen, werden präzisiert**: Der Plan (Abschnitt „Metrikdefinitionen") stammt von vor Paket 011 und kennt nur `approval_requests`/`approval_decisions`. Seit 011 hat eine Freigabe mehrere `approval_stages`, jede mit eigenen `approval_decisions`. Gezählt wird auf Ebene der einzelnen Entscheidung (`approval_decisions.decision`, gefiltert auf `created_at` im Zeitraum) — „Freigabequote"/„Änderungsquote" beziehen sich damit auf Entscheidungen, nicht auf ganze mehrstufige Anfragen; das deckt sich mit den Spaltennamen `approvals_granted`/`approvals_changes_requested`/`approvals_rejected` (Plural) im ursprünglichen `metrics_daily`-Entwurf. „Freigabedauer" wird nicht aus `approval_stages`-Fristlogik hergeleitet (das wäre an die noch offene Eskalations-/`stalled`-Frage aus Paket 011/024 gekoppelt), sondern aus der ohnehin vorhandenen Statushistorie: Dauer von `post_status_events(to_status='awaiting_approval')` bis zur nächsten Transition desselben Beitrags auf `approved` oder `changes_requested`.

## Scope

**Verworfener Entwurf, siehe Abweichung 4**: „Tagesaggregate" (Migration) und der Hatchet-Aggregationsjob (dritter Punkt unten) wurden nicht gebaut — alle vier Endpunkte lesen live. Statushistorie und Indizes wurden gebaut wie hier skizziert.

- Migration: Statushistorie, ~~Tagesaggregate~~, Indizes
- `packages/domain`: Metrikdefinitionen und Berechnung als reine Funktionen
- ~~Hatchet-Workflow zum nächtlichen Aggregieren plus Nachberechnung~~
- API: Kennzahlen-Endpunkte mit Zeitraum- und Scope-Filter
- Nuxt: Auswertungsseite und Dashboard-Kacheln auf echten Daten
- Adaptergrenze für Plattformwerte, ohne sie zu erfinden
- Rückbau aller Auswertungs-Dummies

Nicht enthalten: Plattform-Insights (017), Sentiment und Kommentarauswertung (018), Export als PDF, Benchmarking gegen andere Vereine.

## Metrikdefinitionen

Jede Kennzahl braucht eine Definition, sonst streiten Menschen später über Zahlen. Verbindlich:

| Kennzahl | Definition |
|---|---|
| Beiträge erstellt | `posts` mit `created_at` im Zeitraum |
| Beiträge veröffentlicht | `posts`, deren **erster** Übergang nach `published` im Zeitraum liegt |
| Publikationen | `publications` mit `status = 'published'` im Zeitraum — ein Beitrag auf zwei Kanälen zählt zwei Publikationen |
| Freigabequote | `approval_decisions` mit `decision = 'approved'` ÷ alle entschiedenen `approval_decisions` im Zeitraum; unentschiedene zählen nicht (aktualisiert gegenüber dem Erstentwurf: Ebene der einzelnen Entscheidung, nicht der mehrstufigen Anfrage — siehe Abweichung 8) |
| Änderungsquote | `approval_decisions` mit `decision = 'changes_requested'` ÷ alle entschiedenen `approval_decisions` im Zeitraum |
| Durchlaufzeit | Median der Dauer vom ersten `draft` bis zum ersten `published`, je Beitrag |
| Freigabedauer | Median der Dauer von `post_status_events(to_status='awaiting_approval')` bis zur nächsten Transition desselben Beitrags auf `approved` oder `changes_requested` (aktualisiert gegenüber dem Erstentwurf: aus der Statushistorie statt aus `approval_requests.created_at`, siehe Abweichung 8) |
| Überarbeitungen | Mittelwert der höchsten `version_number` je veröffentlichtem Beitrag |
| Kontingentauslastung | Publikationen ÷ Limit je Kanal und Periode (Paket 011) |
| Aktive Einheiten | Abteilungen bzw. Teams mit mindestens einer Publikation im Zeitraum |
| Fehlerrate | `workflow_runs` mit `technical_status = 'failed'` ÷ alle Läufe |

**Median statt Mittelwert** bei Zeiten: ein einziger Beitrag, der drei Wochen liegen bleibt, verzerrt jeden Mittelwert. Vereine wollen wissen, wie lange es normalerweise dauert.

Trendangaben („+18 %“) werden nur berechnet, wenn eine **vollständige** Vorperiode gleicher Länge vorliegt. Ein halber Vormonat erzeugt keinen Prozentwert, sondern keine Angabe. Der heutige Code behauptet Trends ohne jede Grundlage; das darf nicht durch eine korrekt gerechnete, aber unbelastbare Zahl ersetzt werden.

## Datenmodell

Migration `2026081001_metrics.sql`:

```sql
-- Ohne Historie keine Durchlaufzeit.
create table public.post_status_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  department_id uuid not null, team_id uuid,
  post_id uuid not null,
  from_status public.post_status, to_status public.post_status not null,
  actor_user_id uuid references public.profiles(id),
  actor_kind text not null check (actor_kind in ('user','system','worker')),
  reason text,
  correlation_id uuid,
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, post_id)
    references public.posts(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id)
);
create index post_status_events_post_idx on public.post_status_events (post_id, occurred_at);
create index post_status_events_scope_idx on public.post_status_events (organization_id, department_id, to_status, occurred_at desc);
```

Gefüllt per Trigger auf `posts`, nicht per Anwendungscode:

```sql
create or replace function public.record_post_status_event() returns trigger ...
-- TG_OP und OLD stehen im WHEN-Ausdruck nicht zur Verfuegung (OLD zusaetzlich
-- gar nicht bei INSERT) -- deshalb zwei Trigger statt einer kombinierten Bedingung.
create trigger posts_status_history_insert
  after insert on public.posts
  for each row execute function public.record_post_status_event();
create trigger posts_status_history_update
  after update of status on public.posts
  for each row when (old.status is distinct from new.status)
  execute function public.record_post_status_event();
```

Ein Trigger ist hier richtig, weil Status auch von Workern und künftigen Migrationen geändert wird. Eine Historie mit Lücken ist schlimmer als keine.

`bigint identity` statt UUID, weil diese Tabelle die am schnellsten wachsende wird und ausschließlich sequenziell gelesen wird. RLS wird aktiviert, SELECT nur mit `analytics.view` im Scope.

Tagesaggregate — **verworfener Entwurf, nicht gebaut, siehe Abweichung 4**: die beiden Tabellen unten (`metrics_daily`, `metrics_by_preset_daily`) und der Absatz „Vorberechnung statt Live-Aggregation" danach beschreiben den ursprünglichen Cache-Ansatz. Umgesetzt sind stattdessen vier live berechnende Endpunkte ohne diese Tabellen.

```sql
-- Dimensionsspalten sind NOT NULL mit einer Sentinel-UUID statt NULL: PostgreSQL
-- erlaubt keinen ausdrucksbasierten (coalesce(...)) Primary Key, nur Spalten.
create table public.metrics_daily (
  organization_id uuid not null,
  department_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  team_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  social_connection_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  day date not null,
  posts_created integer not null default 0,
  posts_published integer not null default 0,
  publications_published integer not null default 0,
  publications_failed integer not null default 0,
  approvals_granted integer not null default 0,
  approvals_changes_requested integer not null default 0,
  approvals_rejected integer not null default 0,
  lead_time_seconds_p50 integer, approval_seconds_p50 integer,
  revisions_sum integer not null default 0, revisions_count integer not null default 0,
  workflow_runs integer not null default 0, workflow_failures integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (organization_id, day, department_id, team_id, social_connection_id)
);

create table public.metrics_by_preset_daily (
  organization_id uuid not null,
  department_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  day date not null,
  preset_slug text not null, communication_goal text not null,
  posts_created integer not null default 0, posts_published integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (organization_id, day, department_id, preset_slug, communication_goal)
);
```

~~Vorberechnung statt Live-Aggregation, aus einem Grund: die Auswertungsseite soll auch mit drei Jahren Historie schnell sein, und ein Verein mit vielen Abteilungen erzeugt sonst bei jedem Seitenaufruf ein Aggregat über alle Beiträge. Der Preis ist ein Job und eine Nachberechnungsmöglichkeit.~~ Diese Abwägung wurde beim Bauen umgekehrt entschieden — siehe Abweichung 4: ohne einen echten Cron zum Vorausbefüllen wäre die Cache-Tabelle nur ungenutzte Infrastruktur gewesen.

~~**Der laufende Tag wird live gerechnet**, alle abgeschlossenen Tage aus dem Aggregat. Sonst wirkt die Seite morgens leer, und genau dann schauen Menschen hinein.~~ Tatsächlich: **jeder** Tag wird live gerechnet, nicht nur der laufende.

Tagesgrenzen liegen in der **Vereinszeitzone** (`organizations.timezone`). Ein Aggregat in UTC verschiebt bei einem Verein in Europe/Berlin jeden Abendbeitrag um bis zu zwei Stunden über die Tagesgrenze und macht Wochenvergleiche falsch.

## Umsetzung

### 1. Berechnung als reine Funktionen

`packages/domain/src/metrics.ts`:

```ts
export function computeDailyMetrics(input: {
  statusEvents: readonly PostStatusEvent[]
  approvals: readonly ApprovalSummary[]
  publications: readonly PublicationSummary[]
  workflowRuns: readonly WorkflowRunSummary[]
  day: string; timezone: string
}): DailyMetrics

export function aggregateRange(days: readonly DailyMetrics[]): RangeMetrics
export function computeTrend(current: RangeMetrics, previous: RangeMetrics | null): Trend | null
```

Perzentile dürfen **nicht** aus Tagesperzentilen gemittelt werden — das ist mathematisch falsch. Für Zeiträume werden die Rohwerte erneut gelesen oder ein t-digest-Sketch je Tag gespeichert. Für den erwarteten Datenumfang eines Vereins ist erneutes Lesen die einfachere und ausreichende Lösung: sowohl Perzentile als auch Zählwerte werden für den angefragten Zeitraum direkt aus den Rohtabellen berechnet — kein Wert kommt aus einem Aggregat, siehe Abweichung 4.

`computeTrend` gibt `null` zurück, wenn die Vorperiode unvollständig oder leer ist. Kein Fallback auf 0 %.

### 2. Aggregationsjob — **verworfener Entwurf, nicht gebaut, siehe Abweichung 4**

~~- Hatchet-Cron `aggregate-metrics`, täglich kurz nach Mitternacht je Vereinszeitzone, plus Nachberechnung eines Zeitraums auf Anfrage. Der Workflow-Name muss in `WorkflowNameSchema` ergänzt werden (`packages/contracts/src/index.ts:82`).
- Idempotent: dasselbe Datum zweimal zu rechnen erzeugt dasselbe Ergebnis (`insert ... on conflict do update`). `idempotency_keys` (`202608020001:234-244`) ist dafür vorhanden.
- Fairness-Key `organizationId`, damit ein großer Verein die anderen nicht blockiert — analog zu `fairnessKey` in `apps/worker/src/workflows.ts:16`.
- Nachricht enthält nur `organizationId`, `day`, `correlationId`. Keine Kennzahlen in der Nachricht, entsprechend `ADR-002`.~~

### 3. Endpunkte

- `GET /v1/analytics/summary?organizationId&departmentId&teamId&from&to` → Zählwerte, Perzentile, Trend, Kontingentauslastung
- `GET /v1/analytics/timeseries?organizationId&departmentId&teamId&from&to&metric&granularity=day|week|month`
- `GET /v1/analytics/breakdown?organizationId&departmentId&teamId&from&to&dimension=department|team|channel|preset|goal|format`
- `GET /v1/analytics/funnel?organizationId&departmentId&teamId&from&to` → Entwurf → Freigabe angefragt → freigegeben → geplant → veröffentlicht, mit Abbrüchen je Stufe

Alle Endpunkte verlangen `analytics.view` im angefragten Scope und liefern ausschließlich Daten dieses Scopes. Ein `department_admin` sieht seine Abteilung, nicht den Verein. Zeitraum auf maximal 24 Monate begrenzt. **Eine dokumentierte, bewusst nicht behobene Ausnahme** (siehe „Umsetzung: Ergebnis und Abweichungen vom Plan"): `workflow_runs` trägt kein `team_id` (Schema seit der ersten Content-Pipeline-Migration), ein `team_manager` ohne eigene Abteilungsrolle sieht in den Workflow-Zählwerten deshalb die gesamte Abteilung statt nur das eigene Team.

Jede Antwort trägt `coverage`: ab wann Daten überhaupt vorliegen (`measurementStartsAt`) sowie der angefragte Zeitraum. Keine Aggregat-/Live-Unterscheidung mehr, siehe Abweichung 4 — jeder Tag wird gleich (live) berechnet. Ein Verein, der letzte Woche gestartet ist, muss sehen, dass „letzte 30 Tage“ nur sieben Tage enthält — sonst liest er einen Einbruch, wo nur Datenmangel ist.

### 4. Oberfläche

`pages/auswertung.vue` wird neu gebaut:

- Zeitraumwähler mit Vorgaben (7 / 30 / 90 Tage, laufender Monat, Vormonat, frei) ~~und Scope-Wähler~~ — kein eigener Scope-Wähler gebaut: die aktive Verein-/Abteilungsauswahl kommt wie auf jeder anderen Seite aus der Sidebar (`layouts/default.vue`), kein zweites, redundantes Auswahlfeld (siehe „Umsetzung: Ergebnis und Abweichungen vom Plan")
- Kennzahlenzeile: Beiträge erstellt, veröffentlicht, Publikationen, Freigabequote, Durchlaufzeit-Median. Trend nur bei vollständiger Vorperiode.
- Zeitreihe mit **echter Achse**, Datumslabels, Skala und Nulllinie
- Aufschlüsselung nach Abteilung, Anlass und Ziel als sortierte Balkenliste — das beantwortet „was machen wir eigentlich am meisten“
- Funnel: wo bleiben Beiträge liegen
- Kontingentauslastung je Kanal mit Bezug zum Limit
- ein ausdrücklich leerer, benannter Bereich „Reichweite und Interaktionen“ mit dem Hinweis, dass diese Zahlen erst nach Anbindung der Plattformen vorliegen. **Kein Platzhalterwert, keine Null, kein grauer Balken.** Ein leerer Bereich mit Begründung ist ehrlich; eine Null ist eine Falschaussage.
- Empty State bei fehlenden Daten mit Angabe, ab wann gemessen wird

Für die Darstellung gilt: eine Kennzahl ohne Bezugsgröße ist keine Aussage. Jede Zahl trägt Zeitraum und Scope, jede Achse eine Beschriftung, jede Farbe eine Bedeutung. Die heutige Seite verletzt alle drei Punkte.

### 5. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `pages/auswertung.vue:1` | vier erfundene Plattformkennzahlen mit erfundenen Trends | echte interne Kennzahlen; Plattformwerte als benannt leerer Bereich |
| `pages/auswertung.vue:1` | `bars=[38,52,...]` ohne Skala und Quelle | echte Zeitreihe mit Achsen und `coverage` |
| `pages/auswertung.vue:1` | „Die letzten 30 Tage über alle Abteilungen“ als fester Text | tatsächlich gewählter Zeitraum und Scope |
| ~~`pages/index.vue:10-15`~~ | ~~Kennzahlen inkl. „Reichweite 24,8k +18 %“~~ | bereits erledigt in Paket 009, siehe Abweichung 6 — nicht Teil dieses Pakets |
| ~~`pages/index.vue:88-95`~~ | ~~„18 / 24 Beiträge“, „3 / 4 Abteilungen aktiv“~~ | bereits erledigt in Paket 009, siehe Abweichung 6 — nicht Teil dieses Pakets |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Domain-Tests: jede Metrikdefinition gegen ein handgerechnetes Szenario; Median bei gerader und ungerader Anzahl; `computeTrend` gibt `null` bei unvollständiger Vorperiode; Tagesgrenze in `Europe/Berlin` inklusive Sommerzeitumstellung; ein Beitrag auf zwei Kanälen zählt einmal als Beitrag und zweimal als Publikation.
- pgTAP: Statuswechsel erzeugt genau eine Historienzeile; Wechsel auf denselben Status erzeugt keine; Historie ist ohne `analytics.view` nicht lesbar; Aggregat eines fremden Vereins ist unsichtbar.
- ~~Aggregationstests: derselbe Tag zweimal gerechnet ergibt identische Werte; Nachberechnung nach nachträglicher Statusänderung korrigiert das Aggregat.~~ Entfällt: kein Aggregat, siehe Abweichung 4. Live-Berechnung ist bei jedem Aufruf deterministisch dieselbe Funktion über dieselben Rohzeilen, eine gesonderte Idempotenzprüfung ist ohne Nebenwirkungen kein zusätzlicher Test.
- API-Tests: Abteilungsadmin erhält keine vereinsweiten Zahlen; Zeitraum über 24 Monate → 400; `coverage` weist einen jungen Verein korrekt aus.
- manuell: Beitrag durch den vollen Lebenszyklus führen, Kennzahlen ändern sich nachvollziehbar; Beitrag ablehnen, Änderungsquote steigt. **Solange Paket 005/006 nicht existieren, ist dieser manuelle Test nur über direkte DB-/RPC-Eingriffe durchführbar, nicht über den echten Produktpfad** — siehe Korrektur zu Zeile 16.

## Risiken und offene Entscheidungen

- **Fehlende Historie für Bestandsdaten**: `post_status_events` beginnt am Tag der Migration. Für vorhandene Beiträge gibt es keine Durchlaufzeit. Ein Backfill kann aus `created_at`, `post_versions.created_at` und `approval_decisions.created_at` einen Näherungswert bilden — das sollte er entweder gar nicht oder deutlich als geschätzt markiert tun. Empfehlung: kein Backfill, Messbeginn ausweisen.
- **Wachstum von `post_status_events`**: unkritisch in Vereinsgrößenordnung. ~~eine Aufbewahrungsfrist gehört in Paket 020~~ Umgesetzt bereits hier in Paket 016 (siehe Abweichung 7): `retention_settings.status_event_days`, Default 730 Tage.
- **Perzentile über Zeiträume** werden hier durch erneutes Lesen gelöst. Sollte das bei großen Vereinen zu langsam werden, ist ein Sketch je Tag der nächste Schritt. Erst messen.
- **`publications` ohne `department_id`**: dieselbe Einschränkung wie in Paket 011. Kanalbezogene Aggregate je Abteilung brauchen einen Join über `post_versions → posts`. Wenn hier und dort dasselbe Problem auftritt, ist die Denormalisierung fällig — dann in einem Schritt für beide Pakete.
- **„Wie war die Response“** aus der Anforderung ist mit diesem Paket bewusst **nicht** beantwortet. Es liefert die Produktionsseite. Die Wirkungsseite braucht 017, und das hängt an einem externen Gate. Diese Aufteilung sollte im Dashboard sichtbar sein, damit niemand die interne Zahl für Reichweite hält.

## Umsetzung: Ergebnis und Abweichungen vom Plan

Umgesetzt wie im Abschnitt „Abweichungen vom Plan“ oben festgelegt: `post_status_events` (neue Tabelle, Trigger auf `posts`), vier live berechnende GET-Endpunkte (`summary`/`timeseries`/`breakdown`/`funnel`, kein Cache), `retention_settings.status_event_days`, neue Auswertungsseite. `pnpm lint`, `typecheck`, `test`, `build`, `db:reset`, `db:test` sind grün (246 API-Tests, 119 Domain-Tests, 58 Contracts-Tests, 13 pgTAP-Assertionen).

**Kritischster Fund der adversarialen Prüfung, projektweit relevant**: `apps/api/src/auth.ts`s `rolesForScope` prüft `organization_memberships`, `department_memberships` und `team_memberships` vollständig unabhängig voneinander — an keiner Stelle wird geprüft, dass die drei übergebenen IDs überhaupt zusammengehören. Ein Aufrufer mit einer echten Abteilungsrolle (`analytics.view`) im eigenen Verein A hätte `organizationId=<fremder Verein B>` mit der eigenen, echten `departmentId` aus A kombinieren können: `requirePermission` wäre über die reale Abteilungsrolle in A durchgegangen, obwohl die Anfrage inhaltlich Verein B betraf. Die meisten Loader dieses Pakets filtern zusammengesetzt nach `organization_id` UND `department_id` und liefern bei einem solchen inkonsistenten Paar zufällig leer — die Kontingentauslastung in `GET /v1/analytics/summary` filterte `channel_quotas` dagegen ausschließlich nach `organizationId` und hätte echte Konfigurations- und Nutzungsdaten eines fremden Vereins zurückgegeben. **Behoben**: `assertAnalyticsScopeConsistency` (`apps/api/src/app.ts`) prüft vor jeder Rechteprüfung über den Nutzer-Client (RLS), dass eine angegebene `departmentId` tatsächlich zu `organizationId` gehört und eine `teamId` zur `departmentId` — lehnt sonst mit 404 ab, bevor überhaupt ein Service-Role-Client entsteht. Der gemeinsam genutzte `RoleProvider` selbst wurde bewusst nicht geändert (größerer, eigenständiger Eingriff mit projektweiter Wirkung, verdient eine eigene Prüfung außerhalb dieses Pakets — andere Endpunkte, die `toPermissionScope(organizationId, departmentId)` aus rohen Query-Parametern bilden, könnten je nach nachgelagerter Abfrage demselben Muster unterliegen). Regressionstest: `apps/api/src/app.test.ts`, „rejects a departmentId that belongs to a different organization than the one requested“.

Zwei weitere, geringere Funde derselben Prüfung, beide bewusst nicht behoben und im Code dokumentiert: `workflow_runs` hat kein `team_id` (Schema seit der ersten Content-Pipeline-Migration) — ein `team_manager` ohne eigene Abteilungsrolle sieht in den Workflow-Zählwerten die gesamte Abteilung statt nur das eigene Team; reine technische Zählwerte ohne Personenbezug, eine Behebung bräuchte eine Schemaerweiterung außerhalb dieses Pakets. `computeFunnel` zählt die Stufe „Freigabe angefragt“ nach dem gleichen „erstes Auftreten“-Prinzip wie `postsPublished` — ein Beitrag, der vor dem angefragten Zeitraum zum ersten Mal in `awaiting_approval` eintrat und erst innerhalb des Zeitraums nach einem Änderungswunsch erneut eintrat, wird für dieses Fenster nicht zusätzlich gezählt; konsistent mit dem sonst durchgängigen Prinzip, aber je nach Erwartung überraschend.

**CodeRabbit hat den `workflow_runs`-Team-Scope-Punkt in einer zweiten Review-Runde zu PR #28 erneut als Major eingestuft** und eine echte Behebung statt nur Dokumentation verlangt. Bewusst erneut zurückgestellt: die Einschätzung oben steht unverändert — reine technische Zählwerte ohne Personenbezug, eine Behebung bräuchte eine Schemaerweiterung (`team_id` auf `workflow_runs`, dessen `entity_id` je nach `workflow_name` auf unterschiedliche Tabellen zeigt) außerhalb des Scopes eines Review-Fixes.

Bewusst kleiner als der ursprüngliche Entwurf: kein Team-Filter und keine Scope-Auswahl auf der Auswertungsseite selbst (die aktive Verein-/Abteilungsauswahl kommt wie auf jeder anderen Seite aus der Sidebar), Aufschlüsselung in der Oberfläche nur nach Abteilung/Anlass/Ziel (die API unterstützt zusätzlich Team/Kanal/Format, ungenutzt in der UI, da im Abschnitt „Oberfläche“ des Plans nicht gefordert).
