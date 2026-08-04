# 016 – Auswertung: interne Kennzahlen und Metrikmodell

## Ergebnis

Die Auswertung zeigt echte Zahlen aus dem eigenen System: wie viele Beiträge in einem Zeitraum entstanden, freigegeben, geplant und veröffentlicht wurden, aufgeschlüsselt nach Abteilung, Team, Kanal und Anlass; wie lange ein Beitrag von der Idee bis zur Veröffentlichung braucht; wie oft Freigaben abgelehnt werden und warum; wie stark Kontingente ausgelastet sind. Kein Wert ist geschätzt, kein Balken erfunden. Plattformzahlen wie Reichweite und Interaktionen fehlen an dieser Stelle ehrlich sichtbar und kommen mit Paket 017.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- `apps/web/app/pages/auswertung.vue:2` ist eine Zeile: vier erfundene Kennzahlen („Reichweite 24.812 +18 %“, „Interaktionen 1.946 +11 %“, „Profilaufrufe 683 +24 %“, „Link-Klicks 214 +8 %“) und ein Array `bars=[38,52,44,68,61,78,74,88,65,92,81,96]` als „Reichweitenentwicklung nach Woche“. Alle vier Kennzahlen sind Plattformwerte, die es ohne Meta-Anbindung nicht geben kann.
- Der Balkenchart hat keine Achsenbeschriftung außer „W1“–„W12“, keine Skala, keinen Bezugszeitraum und keine Datenquelle. Er ist Dekoration.
- `apps/web/app/pages/index.vue:113-118` wiederholt dieselbe Erfindung im Dashboard, inklusive „Veröffentlicht 18 diesen Monat +12 %“.
- Es gibt **keine Analytics-Tabelle**, kein Aggregat, keine Query und keinen Endpunkt.
- `packages/contracts/src/index.ts:135` enthält `'collect-analytics'` bereits in `WorkflowNameSchema` — der Workflow ist vorgesehen und nicht implementiert.
- Auswertbare Rohdaten sind reichlich vorhanden: `posts` mit `status`, `created_at`, `scheduled_for` (`202608020001:151-170`); `submissions` mit `preset_slug`, `communication_goal`, `requested_formats` (`202608030001:4-7`); `post_versions` mit `version_number` (`202608020001:172-192`); `approval_requests` und `approval_decisions` mit `decision` und `reason` (`:200-232`); `publications` mit `status` und `scheduled_for` (`202608030001:92-98`); `workflow_runs` mit `technical_status`, `attempt`, `error_class` (`:81-85`).
- Indizes für Zeitreihenabfragen sind teilweise vorhanden: `posts_scope_status_idx (organization_id, department_id, status, created_at desc)` (`202608020001:447`), `submissions_scope_idx` (`:446`). Für Statusübergänge fehlt jede Grundlage.
- **Der entscheidende Mangel**: es gibt keine Statushistorie. `posts.status` ist ein aktueller Wert. Wie lange ein Beitrag in `awaiting_approval` lag, ist heute nicht rekonstruierbar. Ohne Historie sind Durchlaufzeiten nicht messbar.

## Scope

- Migration: Statushistorie, Tagesaggregate, Indizes
- `packages/domain`: Metrikdefinitionen und Berechnung als reine Funktionen
- Hatchet-Workflow zum nächtlichen Aggregieren plus Nachberechnung
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
| Freigabequote | freigegebene Anfragen ÷ entschiedene Anfragen; unentschiedene zählen nicht |
| Änderungsquote | Anfragen mit `changes_requested` ÷ entschiedene Anfragen |
| Durchlaufzeit | Median der Dauer vom ersten `draft` bis zum ersten `published`, je Beitrag |
| Freigabedauer | Median von `approval_requests.created_at` bis zur letzten benötigten Entscheidung |
| Überarbeitungen | Mittelwert der höchsten `version_number` je veröffentlichtem Beitrag |
| Kontingentauslastung | Publikationen ÷ Limit je Kanal und Periode (Paket 011) |
| Aktive Einheiten | Abteilungen bzw. Teams mit mindestens einer Publikation im Zeitraum |
| Fehlerrate | `workflow_runs` mit `technical_status = 'failed'` ÷ alle Läufe |

**Median statt Mittelwert** bei Zeiten: ein einziger Beitrag, der drei Wochen liegen bleibt, verzerrt jeden Mittelwert. Vereine wollen wissen, wie lange es normalerweise dauert.

Trendangaben („+18 %“) werden nur berechnet, wenn eine **vollständige** Vorperiode gleicher Länge vorliegt. Ein halber Vormonat erzeugt keinen Prozentwert, sondern keine Angabe. Der heutige Code behauptet Trends ohne jede Grundlage; das darf nicht durch eine korrekt gerechnete, aber unbelastbare Zahl ersetzt werden.

## Datenmodell

Migration `2026080409_metrics.sql`:

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
create trigger posts_status_history
  after insert or update of status on public.posts
  for each row when (tg_op = 'INSERT' or old.status is distinct from new.status)
  execute function public.record_post_status_event();
```

Ein Trigger ist hier richtig, weil Status auch von Workern und künftigen Migrationen geändert wird. Eine Historie mit Lücken ist schlimmer als keine.

`bigint identity` statt UUID, weil diese Tabelle die am schnellsten wachsende wird und ausschließlich sequenziell gelesen wird. RLS wird aktiviert, SELECT nur mit `analytics.view` im Scope.

Tagesaggregate:

```sql
create table public.metrics_daily (
  organization_id uuid not null,
  department_id uuid, team_id uuid,
  social_connection_id uuid,
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
  primary key (organization_id, day,
    coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(social_connection_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

create table public.metrics_by_preset_daily (
  organization_id uuid not null, department_id uuid, day date not null,
  preset_slug text not null, communication_goal text not null,
  posts_created integer not null default 0, posts_published integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (organization_id, day, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid), preset_slug, communication_goal)
);
```

Vorberechnung statt Live-Aggregation, aus einem Grund: die Auswertungsseite soll auch mit drei Jahren Historie schnell sein, und ein Verein mit vielen Abteilungen erzeugt sonst bei jedem Seitenaufruf ein Aggregat über alle Beiträge. Der Preis ist ein Job und eine Nachberechnungsmöglichkeit.

**Der laufende Tag wird live gerechnet**, alle abgeschlossenen Tage aus dem Aggregat. Sonst wirkt die Seite morgens leer, und genau dann schauen Menschen hinein.

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

`aggregateRange` darf Perzentile **nicht** aus Tagesperzentilen mitteln — das ist mathematisch falsch. Für Zeiträume werden die Rohwerte erneut gelesen oder ein t-digest-Sketch je Tag gespeichert. Für den erwarteten Datenumfang eines Vereins ist erneutes Lesen die einfachere und ausreichende Lösung: die Perzentile werden für den angefragten Zeitraum direkt aus `post_status_events` berechnet, während Zählwerte aus dem Aggregat kommen.

`computeTrend` gibt `null` zurück, wenn die Vorperiode unvollständig oder leer ist. Kein Fallback auf 0 %.

### 2. Aggregationsjob

- Hatchet-Cron `aggregate-metrics`, täglich kurz nach Mitternacht je Vereinszeitzone, plus Nachberechnung eines Zeitraums auf Anfrage. Der Workflow-Name muss in `WorkflowNameSchema` ergänzt werden (`packages/contracts/src/index.ts:135`).
- Idempotent: dasselbe Datum zweimal zu rechnen erzeugt dasselbe Ergebnis (`insert ... on conflict do update`). `idempotency_keys` (`202608020001:234-244`) ist dafür vorhanden.
- Fairness-Key `organizationId`, damit ein großer Verein die anderen nicht blockiert — analog zu `fairnessKey` in `apps/worker/src/workflows.ts:361`.
- Nachricht enthält nur `organizationId`, `day`, `correlationId`. Keine Kennzahlen in der Nachricht, entsprechend `ADR-002`.

### 3. Endpunkte

- `GET /v1/analytics/summary?from&to&scope&scopeId` → Zählwerte, Perzentile, Trend, Kontingentauslastung
- `GET /v1/analytics/timeseries?from&to&metric&granularity=day|week|month`
- `GET /v1/analytics/breakdown?from&to&dimension=department|team|channel|preset|goal|format`
- `GET /v1/analytics/funnel?from&to` → Entwurf → Freigabe angefragt → freigegeben → geplant → veröffentlicht, mit Abbrüchen je Stufe

Alle Endpunkte verlangen `analytics.view` im angefragten Scope und liefern ausschließlich Daten dieses Scopes. Ein `department_admin` sieht seine Abteilung, nicht den Verein. Zeitraum auf maximal 24 Monate begrenzt.

Jede Antwort trägt `coverage`: welche Tage aus dem Aggregat kommen, welche live gerechnet wurden und ab wann Daten überhaupt vorliegen. Ein Verein, der letzte Woche gestartet ist, muss sehen, dass „letzte 30 Tage“ nur sieben Tage enthält — sonst liest er einen Einbruch, wo nur Datenmangel ist.

### 4. Oberfläche

`pages/auswertung.vue` wird neu gebaut:

- Zeitraumwähler mit Vorgaben (7 / 30 / 90 Tage, laufender Monat, Vormonat, frei) und Scope-Wähler
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
| `pages/auswertung.vue:2` | vier erfundene Plattformkennzahlen mit erfundenen Trends | echte interne Kennzahlen; Plattformwerte als benannt leerer Bereich |
| `pages/auswertung.vue:2` | `bars=[38,52,...]` ohne Skala und Quelle | echte Zeitreihe mit Achsen und `coverage` |
| `pages/auswertung.vue:3` | „Die letzten 30 Tage über alle Abteilungen“ als fester Text | tatsächlich gewählter Zeitraum und Scope |
| `pages/index.vue:113-118` | Kennzahlen inkl. „Reichweite 24,8k +18 %“ | drei echte Zählwerte aus `GET /v1/analytics/summary` |
| `pages/index.vue:206-209` | „18 / 24 Beiträge“, „3 / 4 Abteilungen aktiv“ | entfällt bzw. echte aktive Einheiten ohne erfundenes Ziel |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Domain-Tests: jede Metrikdefinition gegen ein handgerechnetes Szenario; Median bei gerader und ungerader Anzahl; `computeTrend` gibt `null` bei unvollständiger Vorperiode; Tagesgrenze in `Europe/Berlin` inklusive Sommerzeitumstellung; ein Beitrag auf zwei Kanälen zählt einmal als Beitrag und zweimal als Publikation.
- pgTAP: Statuswechsel erzeugt genau eine Historienzeile; Wechsel auf denselben Status erzeugt keine; Historie ist ohne `analytics.view` nicht lesbar; Aggregat eines fremden Vereins ist unsichtbar.
- Aggregationstests: derselbe Tag zweimal gerechnet ergibt identische Werte; Nachberechnung nach nachträglicher Statusänderung korrigiert das Aggregat.
- API-Tests: Abteilungsadmin erhält keine vereinsweiten Zahlen; Zeitraum über 24 Monate → 400; `coverage` weist einen jungen Verein korrekt aus.
- manuell: Beitrag durch den vollen Lebenszyklus führen, Kennzahlen ändern sich nachvollziehbar; Beitrag ablehnen, Änderungsquote steigt; Aggregation laufen lassen, Werte bleiben identisch.

## Risiken und offene Entscheidungen

- **Fehlende Historie für Bestandsdaten**: `post_status_events` beginnt am Tag der Migration. Für vorhandene Beiträge gibt es keine Durchlaufzeit. Ein Backfill kann aus `created_at`, `post_versions.created_at` und `approval_decisions.created_at` einen Näherungswert bilden — das sollte er entweder gar nicht oder deutlich als geschätzt markiert tun. Empfehlung: kein Backfill, Messbeginn ausweisen.
- **Wachstum von `post_status_events`**: unkritisch in Vereinsgrößenordnung, aber eine Aufbewahrungsfrist gehört in Paket 020. 24 Monate Rohereignisse und unbegrenzte Aggregate sind ein vernünftiger Ausgangspunkt.
- **Perzentile über Zeiträume** werden hier durch erneutes Lesen gelöst. Sollte das bei großen Vereinen zu langsam werden, ist ein Sketch je Tag der nächste Schritt. Erst messen.
- **`publications` ohne `department_id`**: dieselbe Einschränkung wie in Paket 011. Kanalbezogene Aggregate je Abteilung brauchen einen Join über `post_versions → posts`. Wenn hier und dort dasselbe Problem auftritt, ist die Denormalisierung fällig — dann in einem Schritt für beide Pakete.
- **„Wie war die Response“** aus der Anforderung ist mit diesem Paket bewusst **nicht** beantwortet. Es liefert die Produktionsseite. Die Wirkungsseite braucht 017, und das hängt an einem externen Gate. Diese Aufteilung sollte im Dashboard sichtbar sein, damit niemand die interne Zahl für Reichweite hält.
