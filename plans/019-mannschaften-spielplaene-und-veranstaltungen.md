# 019 – Mannschaften, Spielpläne, Ergebnisse und Veranstaltungen

## Ergebnis

Der Spielplan steht nicht mehr in einer WhatsApp-Gruppe und in einem Aushang und im Verbandsportal und nochmal hier. Er wird aus der Quelle gelesen, in der er ohnehin gepflegt wird. Mannschaften, Spiele, Ergebnisse und Veranstaltungen liegen im System vor — und damit passiert das eigentlich Wertvolle: aus einem Termin wird ein Beitragsvorschlag mit **belegten** Fakten. Gegner, Anstoßzeit, Ort und Ergebnis muss niemand mehr abschreiben, und niemand muss sie erfinden.

Der Redaktionskalender zeigt nicht nur geplante Beiträge, sondern das Vereinsleben, um das es geht.

## Warum das mehr ist als ein Import

Der Produktgrundsatz des Projekts lautet: „Die KI formuliert und gestaltet; Menschen liefern und bestätigen die Fakten“ (`docs/product/implementation-plan.md`). Der teuerste Teil daran ist die Faktenbeschaffung — und genau die ist bei Spielen und Terminen bereits erledigt, nur an einer anderen Stelle.

Ein synchronisierter Spieltermin liefert exakt die Pflichtangaben, die `packages/content-engine/src/presets.ts:11` verlangt:

| Preset | verlangte Fakten | aus dem Spielplan |
|---|---|---|
| `match_announcement` | `opponent`, `date`, `location` | vollständig |
| `match_result` | `homeTeam`, `awayTeam`, `homeScore`, `awayScore` | vollständig |
| `event` | `title`, `date`, `location` | vollständig |

Damit wird der Beitragsentwurf für die häufigsten Anlässe vom Formular zur Bestätigung. Das ist der größte Hebel im ganzen Produkt: nicht bessere Texte, sondern weniger Tipparbeit vor dem Text.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- Paket 014 liefert den Integrationsrahmen: `integration_sources`, `integration_sync_runs`, `integration_sync_conflicts`, `planSync`, die Transporte Datei und iCal, und die Oberfläche unter `pages/integrationen.vue`. Dieses Paket ergänzt drei Bereichsadapter und schreibt **keine** eigene Synchronisationslogik.
- `public.teams` (`202608020001:52-62`) hat `organization_id`, `department_id`, `name` — **keine Herkunftsinformation, keine Altersklasse, keine Liga.**
- Es gibt **keine Tabelle für Spiele** und **keine für Veranstaltungen.** `posts.scheduled_for` (`:160`) ist der Veröffentlichungszeitpunkt eines Beitrags, nicht der Zeitpunkt eines Ereignisses. Die beiden werden heute vermischt.
- `apps/web/app/pages/kalender.vue:1` ist eine Zeile: fest „August 2026“, fünf hartkodierte Fantasietermine (`4: Neue Trainerin`, `6: Derbysieg`, `8: Heimspiel`, `10: Sommerfest`, `15: Probetraining`), fünf leere Vorlauftage. Kein Monatswechsel, keine Datenquelle.
- `apps/web/app/pages/index.vue:17-25` zeigt eine erfundene Woche mit drei Terminen.
- `apps/web/app/pages/index.vue:77-86` bewirbt eine statische „Idee für diese Woche“ und verlinkt auf `/erstellen?type=people` — einen Parameter, den `erstellen.vue` nicht auswertet. **Hier gehört ein echter, aus Daten abgeleiteter Vorschlag hin.**
- `apps/web/app/pages/erstellen.vue:35` hält `form` mit `title`, `date`, `location`, `audience` als leere Felder, die jeder Nutzer jedes Mal neu ausfüllt.
- `packages/contracts/src/index.ts:12` `sourceMaterial.facts` ist `Record<string, string|number|boolean>` mit maximal 30 Schlüsseln — für vorbelegte Spieldaten ausreichend.
- `submissions.source_material` erzwingt per CHECK die Schlüssel `facts`, `observations`, `quotes`, `doNotMention` (`202608030001:19`). Eine Vorbelegung muss diese Struktur einhalten.

## Entscheidungen vor der Umsetzung (2026-08-07)

Verifiziert gegen den Stand von Branch `worktree-plan-014-integrationsrahmen-und-mitgliederverzeichnis` (PR #21, noch nicht in `main` gemergt — dieses Paket zweigt davon ab, siehe unten). Der Plan wurde auf `b5c2eda6` geschrieben; seither haben 008/009 einen Teil des unten beschriebenen Rückbaus bereits erledigt, und 014 hat den Rahmen etwas anders geformt als hier vorausgesetzt.

- **Rückbau ist kleiner als geplant.** `pages/kalender.vue`, `pages/index.vue:17-25` (Wochenübersicht) und `pages/index.vue:77-86` (statische Ideen-Sektion) sind bereits durch 008/009 auf echte `posts.scheduled_for`-Daten umgestellt bzw. ersatzlos entfernt — keine Fantasietermine, kein toter `?type=`-Parameter mehr. Was tatsächlich fehlt: `kalender.vue` kennt nur Beiträge, keine `fixtures`/`club_events`-Ebene; die Ideen-Sektion wurde entfernt, ohne dass ein datengetriebener Ersatz existiert. Dieses Paket **ergänzt** beides neu, statt Dummy-Daten zu ersetzen. Einzig `pages/erstellen.vue`s leere `form`-Felder (heute Zeile 12, nicht 35) und das Fehlen eines Anlass-Einstiegs sind wie im Plan beschrieben unverändert.
- **Migrationsdatei umbenannt.** `2026080412_fixtures_and_events.sql` würde numerisch vor die bereits gemergten Migrationen bis `2026080703` (Paket 014) sortieren. Tatsächlicher Dateiname: `2026080704_fixtures_and_events.sql`.
- **Begründung der CHECK-Constraint korrigiert.** `submissions.source_material` verlangt laut Constraint (`?&`-Operator) **mindestens** die vier Schlüssel `facts`/`observations`/`quotes`/`doNotMention`, nicht ausschließlich diese — ein zusätzlicher `provenance`-Schlüssel auf oberster Ebene würde den CHECK nicht verletzen. Die Entscheidung für eigene Spalten (`source_provenance` usw.) bleibt trotzdem richtig, aber aus einem anderen Grund: das Objekt ist im übrigen Code als abschließend behandelt (Zod-Schema in `packages/contracts` ohne weitere Schlüssel), und eine versteckte fünfte Bedeutung dort würde diese Abschließlichkeit unterlaufen.
- **`source_facts_snapshot` umbenannt.** `post_versions.source_facts_snapshot` existiert bereits (unveränderlicher Fakten-Endstand einer veröffentlichten Version). Die neue, andersartige Spalte auf `submissions` (Vergleichsbasis für „hat sich die Quelle seit der Vorbelegung geändert") heißt deshalb `submissions.source_prefill_snapshot`, um die beiden nicht zu verwechseln.
- **iCal-Transport muss TZID-Parameter erhalten.** `packages/integrations/src/icalTransport.ts` verwirft heute jedes `;PARAM=...` an einem Property-Namen (`rawKey.split(';')[0]`) — `DTSTART;TZID=Europe/Berlin` kommt beim Adapter nur noch als `dtstart` ohne Zeitzonenangabe an. Für die in diesem Plan verlangte `kickoff_time_confirmed=false`-Logik bei fehlender/uneindeutiger Zeitzone muss der Transport die Parameter zusätzlich mitgeben (additiv, z. B. eine parallele `<property>;params`-Rohzeile) — andere Domänen (`people`) ignorieren das unverändert, weil `normalize()` nur die ihr bekannten Schlüssel abbildet.
- **Sync-Dispatch ist bereits vorbereitet.** `apps/api/src/app.ts` hat am Sync-Endpunkt einen expliziten Zweig `if (domain !== 'people') return domain_not_implemented`, mit Kommentar, dass `teams`/`fixtures`/`events` in diesem Paket folgen. `integration_sources.enabled_domains` ist bereits ein Array (bis zu vier Werte) — eine Quelle kann mehrere Domänen aktivieren und wird pro Domäne einzeln synchronisiert, kein neues Feld nötig.
- **Neue Permissions `fixture.manage` und `event.manage`** (getrennt, nicht eine gemeinsame — ein Verbandsspielplan und eine Vereinsveranstaltung sind fachlich unterschiedliche Ressourcen), dupliziert in `packages/authorization` (TS) und `authz.has_department_permission` (SQL), gewährt an `department_admin` (automatisch an `organization_admin`/`organization_owner`, über deren eigene `has_organization_permission`-Fallback-Logik) — **nicht** an `team_manager`, analog zu `team.manage` und `integration.manage`: die Mannschaftsebene verwaltet nicht selbst, das tut die Abteilung.
- **Schreibpfad wie `directory_people`/`integration_sources`, nicht wie `teams`.** `directory_people` (Paket 014) hat bewusst **keine** `INSERT`/`UPDATE`/`DELETE`-Policy für `authenticated` — jeder Schreibzugriff läuft über die API mit Service Role, die Permission wird im Code geprüft (`requirePermission`/`toPermissionScope`, dieselbe Maschinerie wie überall sonst). `fixtures`/`club_events` folgen demselben Muster, nicht dem von `teams` (dort gibt es echte `WITH CHECK`-Policies für `authenticated`): sowohl Sync-Läufe als auch manuelle Korrekturen laufen über dieselbe, bereits vorhandene Prüfung — inklusive derselben Abteilungs-Scope-Einschränkung, die in 014 als kritischer Fund behoben wurde (Namensauflösung nur innerhalb der eigenen Quelle/Abteilung). Kein neues `security definer`-SQL-Helferfunktion nötig: `club_events.department_id` ist nullable, aber `toPermissionScope(organizationId, departmentId)` lässt den Schlüssel bei `null` einfach weg (`apps/api/src/app.ts:448`), wodurch `requirePermission` automatisch nur die Organisationsebene prüft — genau die gewünschte Kaskade, ohne eigenen Code.
- **Sichtbarkeit vereinsweit, nicht abteilungsbeschränkt.** `fixtures`/`club_events` sind unsensible, öffentlichkeitsnahe Fakten (Ergebnisse, Termine) — anders als `directory_people`. Analog zur in Paket 023 getroffenen Entscheidung für `posts`/`submissions` (`authz.is_any_member_of_organization`, nicht `is_department_member`) gilt: jedes Vereinsmitglied sieht alle Spiele und Veranstaltungen des Vereins, nicht nur die der eigenen Abteilung. Die „Filter nach Abteilung und Mannschaft" aus Abschnitt 5 ist eine Oberflächen-Filterung auf einer bereits vereinsweit sichtbaren Menge, keine RLS-Grenze.
- **Kein täglicher Job für Anlassvorschläge.** Paket 004 (Hatchet/Cron) ist weiterhin „in Arbeit" — wie bei `mark_stalled_approval_stages()`, `recompute_directory_minor_status()` und den beiden Funktionen aus 012 gibt es keine Ausführungsumgebung für einen echten täglichen Job. Die Vorschlagsliste ist zustandslos aus reinen Lesevergleichen berechenbar (Termine, vorhandene Beiträge, Kontingentstand, weggeklickte Zeitstempel) und wird deshalb bei jedem Aufruf des entsprechenden Endpunkts frisch berechnet — kein Job, kein gespeichertes Zwischenergebnis nötig. Sollte 004 später einen Cron bereitstellen, kann er denselben Endpunkt/dieselbe Funktion einfach regelmäßig aufrufen.
- **Worktree zweigt vom 014-Branch ab, nicht von `main`.** PR #21 (Paket 014) ist noch offen. Dieses Paket verwendet `packages/integrations`, `packages/member-directory`-Konventionen, `directory_people` und `integration_sources` direkt weiter — der Worktree für 019 basiert deshalb auf `worktree-plan-014-integrationsrahmen-und-mitgliederverzeichnis`, nicht auf `origin/main`. Nach dem Merge von PR #21 wird 019 auf `main` rebast.

## Scope

- Migration: Mannschaften um Herkunft und Merkmale erweitern, `fixtures`, `club_events`
- drei Bereichsadapter auf dem Rahmen aus Paket 014: `teams`, `fixtures`, `events`
- iCal-Adapter fachlich schärfen: aus einem Kalendereintrag ein Spiel oder eine Veranstaltung erkennen
- Faktenübernahme in die Beitragserstellung mit Herkunftsnachweis
- Anlassvorschläge: was ist bald, was ist gerade passiert, wo fehlt ein Beitrag
- Redaktionskalender mit Beiträgen **und** Ereignissen
- Rückbau der Kalender- und Ideen-Dummies

Nicht enthalten: Trainingsplanung, Aufstellungen, Spielerstatistiken, Tabellen und Ligastände, Zu- und Absagen, Zurückschreiben in Quellsysteme.

## Datenmodell

Migration `2026080704_fixtures_and_events.sql`:

```sql
-- Mannschaften: Herkunft und die Merkmale, die für Inhalte zählen.
alter table public.teams
  add column age_group text,                    -- 'F-Jugend', 'Herren', 'Ü40'
  add column competition text,                  -- Liga oder Staffel
  add column archived_at timestamptz,
  add column source_id uuid, add column external_id text,
  add column source_updated_at timestamptz;
-- Spaltenliste bei SET NULL ist Pflicht: ohne sie setzt PostgreSQL *alle*
-- Spalten des Fremdschluessels auf NULL, also auch organization_id -- die ist
-- not null, und das Loeschen der Quelle wuerde daran scheitern.
alter table public.teams add constraint teams_source_fk
  foreign key (organization_id, source_id)
  references public.integration_sources(organization_id, id) on delete set null (source_id);
create unique index teams_external_unique
  on public.teams (organization_id, source_id, external_id)
  where source_id is not null and external_id is not null;

create type public.fixture_status as enum ('scheduled','postponed','cancelled','played','unknown');

create table public.fixtures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid not null, team_id uuid,
  kind text not null default 'match' check (kind in ('match','friendly','tournament','cup')),
  competition text,
  is_home boolean,
  own_team_label text,                          -- wie die Quelle die eigene Mannschaft nennt
  opponent_name text,
  kickoff_at timestamptz,
  kickoff_time_confirmed boolean not null default true,
  venue_name text, venue_address text,
  status public.fixture_status not null default 'scheduled',
  home_score integer check (home_score >= 0),
  away_score integer check (away_score >= 0),
  result_recorded_at timestamptz,
  note text,
  source_id uuid, external_id text, source_updated_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete set null (team_id),
  foreign key (organization_id, source_id)
    references public.integration_sources(organization_id, id) on delete set null (source_id),
  check (status <> 'played' or (home_score is not null and away_score is not null))
);
create unique index fixtures_external_unique
  on public.fixtures (organization_id, source_id, external_id)
  where source_id is not null and external_id is not null;
create index fixtures_calendar_idx
  on public.fixtures (organization_id, department_id, kickoff_at);

create table public.club_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid, team_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 2000),
  category text not null default 'other' check (category in
    ('general_meeting','festival','tournament','training_camp','course','social','fundraiser','ceremony','other')),
  starts_at timestamptz not null, ends_at timestamptz,
  all_day boolean not null default false,
  location_name text, location_address text,
  registration_url text,
  status text not null default 'scheduled' check (status in ('scheduled','postponed','cancelled')),
  source_id uuid, external_id text, source_updated_at timestamptz,
  -- Bei Serien identifiziert UID nur die Serie. Die Instanz braucht RECURRENCE-ID
  -- bzw. die urspruengliche Startzeit, sonst kollabieren alle Einzeltermine einer
  -- Wiederholung auf denselben Schluessel.
  recurrence_key text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete set null (team_id),
  foreign key (organization_id, source_id)
    references public.integration_sources(organization_id, id) on delete set null (source_id),
  check (ends_at is null or ends_at >= starts_at)
);
-- Dasselbe Muster wie fixtures_external_unique und teams_external_unique. Ohne
-- diesen Index legt jeder neue Lauf dieselbe Veranstaltung erneut an -- der
-- Abgleich in planSync haette keinen Schluessel, an dem er sie wiedererkennt.
create unique index club_events_external_unique
  on public.club_events (organization_id, source_id, external_id,
                         coalesce(recurrence_key, ''))
  where source_id is not null and external_id is not null;
create index club_events_calendar_idx
  on public.club_events (organization_id, starts_at);
```

Drei Entscheidungen, die Erklärung brauchen:

**`fixtures` und `club_events` bleiben getrennt.** Ein Spiel hat Gegner, Heimrecht und Ergebnis; eine Veranstaltung hat Titel, Beschreibung und Anmeldung. In einer gemeinsamen Tabelle wären beide zur Hälfte leer, und jede Abfrage müsste einen Typ mitprüfen. Der gemeinsame Blick entsteht in einer Sicht, nicht in einer Tabelle.

**`recurrence_key` neben `external_id`.** Ein iCal-`UID` bezeichnet die Serie, nicht den Einzeltermin. „Jeden Dienstag Training“ ist ein `VEVENT` mit einer `RRULE` und einem `UID`; die aufgelösten Einzeltermine teilen ihn. Verschiebt der Verein einen einzelnen Termin, liefert die Quelle eine `RECURRENCE-ID`. Gespeichert wird deshalb `RECURRENCE-ID`, ersatzweise die ursprüngliche Startzeit in UTC-Normalform, und der Unique-Index umfasst sie. Verschiebung, Löschung einer Einzelinstanz und Änderung der ganzen Serie sind je ein Testfall — das sind die Fälle, in denen ein Kalenderimport sonst Duplikate erzeugt.

**`is_home` und `opponent_name` statt `home_team_name`/`away_team_name`.** Aus Vereinssicht ist die interessante Frage „gegen wen, wo“. Das eigene Team steht in `team_id`. `own_team_label` bewahrt zusätzlich den Namen aus der Quelle, weil Verbandsportale eigene Schreibweisen benutzen („SV Nordstadt 1921 II“) und die Zuordnung sonst bei jedem Lauf neu geraten werden müsste.

Verknüpfung zum Inhalt:

```sql
alter table public.submissions add column fixture_id uuid;
alter table public.submissions add column club_event_id uuid;
alter table public.submissions add constraint submissions_fixture_fk
  foreign key (organization_id, fixture_id) references public.fixtures(organization_id, id) on delete set null (fixture_id);
alter table public.submissions add constraint submissions_event_fk
  foreign key (organization_id, club_event_id) references public.club_events(organization_id, id) on delete set null (club_event_id);
```

Damit ist beantwortbar, ob zu einem Spiel schon ein Beitrag existiert — die Grundlage der Vorschläge.

## Umsetzung

### 1. Bereichsadapter

Drei `DomainAdapter`-Implementierungen in `packages/integrations`, jeweils mit einem Zod-Schema, das die erlaubten Felder abschließend festlegt:

```ts
const ExternalFixtureSchema = z.object({
  externalId: z.string().min(1).max(200),
  teamReference: z.string().max(200).optional(),
  competition: z.string().max(120).optional(),
  isHome: z.boolean().optional(),
  opponentName: z.string().max(160).optional(),
  kickoffAt: z.iso.datetime().optional(),
  venueName: z.string().max(200).optional(),
  venueAddress: z.string().max(300).optional(),
  status: z.enum(['scheduled','postponed','cancelled','played','unknown']),
  homeScore: z.int().min(0).max(999).optional(),
  awayScore: z.int().min(0).max(999).optional(),
  sourceUpdatedAt: z.iso.datetime().optional(),
})
```

Was nicht im Schema steht, kommt nicht ins System. Ein Verbandsexport mit Schiedsrichternamen, Zuschauerzahlen oder Spielberechtigungen verliert diese Felder beim Einlesen.

**Optional im Schema heißt nicht faktenfertig.** Fast jedes Feld ist `optional`, weil Quellen unvollständig liefern — ein Spiel ohne Gegner darf trotzdem im Kalender stehen. Die Presets sind strenger: `match_announcement` verlangt `opponent`, `date` und `location`, `match_result` zusätzlich `homeTeam`, `awayTeam`, `homeScore` und `awayScore` (`packages/content-engine/src/presets.ts:11`). Die Tabelle oben („vollständig“) gilt für einen vollständigen Feed, nicht für jede Zeile. `factsFromFixture` prüft deshalb Vollständigkeit und **erzeugt kein Preset**, wenn ein Pflichtfakt oder `is_home` fehlt — bei unbekanntem Heimrecht ist nicht entscheidbar, welche Mannschaft `homeTeam` ist, und ein geratenes Ergebnis wäre ein erfundener Vereinsfakt. Der Vorschlag lautet dann „Angaben fehlen: Gegner, Ort“ mit Verweis auf die Quelle, statt eines halb gefüllten Formulars.

**Mannschaftszuordnung** ist der schwierigste Teil. Ein Feed liefert „SV Nordstadt 1921 II“, im System heißt die Mannschaft „2. Herren“. Vorgehen:

1. Übereinstimmung über `external_id`, wenn die Quelle Mannschaften separat liefert
2. sonst über eine gespeicherte Zuordnung in `integration_sources.field_mapping` — einmal von einem Menschen bestätigt, danach stabil
3. sonst Konflikt vom Typ `ambiguous_match`. **Kein Raten**, weil eine falsch zugeordnete Mannschaft einen Beitrag mit falschem Gegner erzeugt.

Die erste Synchronisation ist damit Handarbeit für eine Viertelstunde und danach nie wieder. Das ist die richtige Verteilung des Aufwands.

### 2. iCal fachlich lesen

Ein Kalendereintrag ist zunächst nur Titel, Zeit und Ort. Die Einordnung erfolgt regelbasiert und **überprüfbar**, nicht per Modell:

- Titelmuster mit Trennzeichen wie „–“, „vs.“, „:“ deuten auf ein Spiel; der Teil, der nicht die eigene Mannschaft ist, wird als Gegner vorgeschlagen
- ein Ergebnis im Titel („3:1“) setzt `status = 'played'` und die Torzahlen
- alles ohne erkennbaren Gegner wird eine Veranstaltung
- `VEVENT.LAST-MODIFIED` füllt `source_updated_at`, `UID` füllt `external_id`, `RRULE` wird zu Einzelterminen aufgelöst — mit Obergrenze, damit ein „jeden Dienstag, unbegrenzt“ nicht tausende Zeilen erzeugt

Jede Regelanwendung ist im Trockenlauf sichtbar: „erkannt als Spiel gegen TSV Süd, Ergebnis 3:1“. Wer widerspricht, korrigiert einmal, und die Korrektur wird als Zuordnung gespeichert. Ein stiller Automatismus wäre hier falsch — aus einem falsch gelesenen Titel entsteht sonst ein falscher öffentlicher Beitrag.

Zeitzonen sind bei iCal die klassische Fehlerquelle: `DTSTART` mit `TZID`, mit `Z` und ohne Angabe bedeuten drei verschiedene Dinge. Ohne Angabe gilt die Vereinszeitzone, und `kickoff_time_confirmed` wird auf `false` gesetzt, damit die Oberfläche die Unsicherheit zeigt.

### 3. Fakten in die Beitragserstellung

Neuer Einstieg in `pages/erstellen.vue`: „Zu welchem Anlass?“ mit einer Liste bevorstehender und gerade vergangener Ereignisse. Wer eines wählt, erhält ein vorbefülltes Formular.

Vorbelegung als reine Funktion in `packages/content-engine`:

```ts
export function factsFromFixture(fixture: Fixture, team: Team, timezone: string): {
  presetSlug: ContentPresetSlug
  facts: Record<string, string | number | boolean>
  provenance: Record<string, FactProvenance>
}
```

- vor dem Anpfiff → `match_announcement` mit `opponent`, `date`, `location`
- nach dem Anpfiff mit Ergebnis → `match_result` mit `homeTeam`, `awayTeam`, `homeScore`, `awayScore`
- Veranstaltung → `event` mit `title`, `date`, `location`

`provenance` ist der Teil, der über eine bloße Vorbelegung hinausgeht: je Fakt wird festgehalten, aus welcher Quelle und von welchem Stand er kommt. Die Oberfläche zeigt „aus Spielplan · Stand heute 06:00“ neben dem Feld, statt es als Nutzereingabe auszugeben.

Dafür braucht die Herkunft einen Platz, den sie heute nicht hat: `submissions.source_material` erzwingt per CHECK genau die Schlüssel `facts`, `observations`, `quotes`, `doNotMention` (`202608030001:19`). Ein zusätzliches `provenance` auf oberster Ebene würde diesen CHECK verletzen; sie stillschweigend zu verwerfen nähme der Oberfläche den Quellenstand und dem System die Grundlage, eine spätere Änderung überhaupt zu erkennen. Sie gehört deshalb in eigene Spalten neben `fixture_id`/`club_event_id`, nicht in das bestehende Objekt:

```sql
alter table public.submissions
  add column source_provenance jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_provenance) = 'object'),
  -- Stand der Quelle und unveraenderlicher Faktenschnappschuss zum Zeitpunkt
  -- der Vorbelegung. Beides zusammen macht "hat sich das geaendert?" beantwortbar.
  -- Heisst bewusst nicht "source_facts_snapshot" -- diesen Namen traegt bereits
  -- post_versions (unveraenderlicher Endstand einer veroeffentlichten Fassung,
  -- andere Bedeutung).
  add column source_revision_at timestamptz,
  add column source_prefill_snapshot jsonb
    check (source_prefill_snapshot is null or jsonb_typeof(source_prefill_snapshot) = 'object');
```

Der Schnappschuss ist die Voraussetzung für die Invalidierung im nächsten Absatz. Ohne ihn ist nach einer Korrektur in der Quelle nur bekannt, dass sich *etwas* geändert hat, nicht welcher Fakt — und ein Hinweis, der das nicht sagen kann, wird ignoriert.

Dazu die notwendige Ehrlichkeit: **eine Quelle kann falsch sein.** Ein Spiel wird verlegt, ein Ergebnis nachträglich korrigiert. Vorbelegte Fakten sind daher weiterhin bestätigungspflichtig — der Mensch bestätigt schneller als er tippt, aber er bestätigt. Ändert sich ein Fakt in der Quelle, nachdem ein Beitrag erstellt wurde, erscheint ein Hinweis am Beitrag; bei einer bereits laufenden Freigabe wird sie invalidiert, wie es der Trigger `invalidate_approvals_for_media_change` (`202608030001:110-111`) für Medien schon tut.

Bei `match_result` gilt zusätzlich die Regel aus `plans/README.md`, keine Vereinsfakten zu erfinden: eine Niederlage bleibt eine Niederlage. Der Tonfall darf gewählt werden, das Ergebnis nicht.

### 4. Anlassvorschläge

Ein täglicher Job berechnet je Abteilung eine kurze Liste. Regeln, deterministisch und ohne Modell:

- Spiel in den nächsten drei Tagen, kein `submission` mit dieser `fixture_id` → „Spielankündigung fehlt“
- Spiel gespielt, Ergebnis vorhanden, seit weniger als 48 Stunden, kein Beitrag → „Ergebnis noch nicht erzählt“
- Veranstaltung in den nächsten 14 Tagen ohne Beitrag → „Einladung fehlt“
- Kontingent des Kanals weitgehend unausgeschöpft und keine Beiträge geplant → allgemeiner Anstoß

Jeder Vorschlag führt mit einem Klick in `pages/erstellen.vue` mit vorbelegten Fakten. Kein Vorschlag ohne konkrete Handlung, keine Aufforderung ohne Datengrundlage.

Das ersetzt den statischen Ideenblock in `pages/index.vue:77-86`. Der Unterschied: „Zeigt die Menschen hinter eurem Verein“ ist ein Ratschlag an alle; „Samstag 15:00 gegen TSV Süd — Ankündigung fehlt noch“ ist eine Aufgabe für diesen Verein.

Vorschläge sind **kein automatisches Erstellen**. Sie sind eine Liste, die ein Mensch abarbeitet oder wegklickt.

Damit „weggeklickt“ hält, braucht es einen Ort für den Zustand. Der Job rechnet die Liste jeden Tag neu aus Ereignissen, Beiträgen und Kontingenten — ohne gespeicherte Ablehnung erscheint derselbe Vorschlag am nächsten Morgen wieder, und die Liste wird zu Lärm.

Der Zustand gehört an das Ereignis, nicht in eine eigene Tabelle. Jede der drei ereignisgebundenen Regeln bekommt einen Zeitstempel:

```sql
alter table public.fixtures
  add column announcement_dismissed_at timestamptz,
  add column result_dismissed_at timestamptz;
alter table public.club_events
  add column invitation_dismissed_at timestamptz;
```

Zwei Spalten an `fixtures`, weil dasselbe Spiel zwei unabhängige Vorschläge erzeugt: vorher die Ankündigung, nachher das Ergebnis. Wer die Ankündigung wegklickt, will das Ergebnis trotzdem erzählen.

Die Wiederkehr wird damit ein Vergleich ohne Zusatzspalte: **erscheint wieder, sobald `source_updated_at` neuer ist als der Zeitstempel** — ein verlegtes Spiel ist eine neue Ankündigung. Reines Zeitablaufen bringt keinen Vorschlag zurück.

Der vierte, allgemeine Anstoß („Kontingent unausgeschöpft, nichts geplant“) hängt an keinem Ereignis und wird deshalb nicht weggeklickt, sondern gilt für die laufende Periode und verschwindet mit ihr von selbst. Damit braucht auch er keinen Speicher.

Eine eigene Tabelle wäre hier die falsche Wahl: sie kostet drei Fremdschlüssel und einen Unique-Index über normalisierte `NULL`-Spalten, um denselben Zustand zu halten — und der Vorschlag hat außerhalb seines Ereignisses ohnehin keine Identität.

### 5. Redaktionskalender

`pages/kalender.vue` wird neu gebaut:

- echter Monatswechsel, Wochen- und Monatsansicht, korrekte Vorlauftage aus dem Datum berechnet
- drei sichtbar unterschiedene Ebenen: geplante **Beiträge** (`posts.scheduled_for`), **Spiele** (`fixtures.kickoff_at`), **Veranstaltungen** (`club_events.starts_at`)
- Filter nach Abteilung und Mannschaft
- ein Spiel ohne zugehörigen Beitrag ist als Lücke erkennbar und direkt in die Erstellung verlinkt
- alle Zeiten in der Vereinszeitzone; `kickoff_time_confirmed = false` wird als Unsicherheit dargestellt
- Empty State mit Verweis auf die Quellenanbindung

Die Wochenvorschau im Dashboard nutzt dieselbe Abfrage.

### 6. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `pages/kalender.vue` | ✓ 008/009: navigierbarer Monat, echte `posts.scheduled_for`-Daten — zeigt aber ausschließlich Beiträge, keine Spiele/Veranstaltungen | ergänzt um `fixtures`/`club_events` als zweite/dritte Ebene, Filter nach Abteilung/Mannschaft |
| `pages/index.vue` (Wochenübersicht) | ✓ 008/009: echte Woche aus `posts` | unverändert, nutzt weiterhin dieselbe Abfrage |
| `pages/index.vue` (Ideen-Sektion) | ✓ 008/009: statische Wochenidee samt totem `?type=`-Parameter bereits ersatzlos entfernt — an ihrer Stelle heute nichts | neu: datengetriebene Anlassvorschläge (kein Rückbau eines Dummys, sondern eine neue, bisher fehlende Funktion) |
| `pages/erstellen.vue:35` | leere Felder `title`, `date`, `location` | vorbelegt aus Spiel oder Veranstaltung, mit Herkunftsangabe |
| Termine im Beitragsentwurf | ✓ 008: `useDemoData.ts` mit Datumsangaben als Strings (`'Heute'`, `'Sa., 8. Aug.'`) gelöscht | Termine sind `timestamptz` und kommen aus `fixtures`/`club_events` |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Adaptertests: Spiel neu, verlegt, abgesagt, Ergebnis nachgetragen; uneindeutige Mannschaft erzeugt Konflikt; unbekannte Abteilung erzeugt Konflikt; Feld außerhalb des Schemas wird verworfen.
- iCal-Tests: `DTSTART` mit `TZID`, mit `Z` und ohne Angabe ergeben die richtige UTC-Zeit; ohne Angabe wird `kickoff_time_confirmed = false`; `RRULE` wird bis zur Obergrenze aufgelöst; Titel mit Ergebnis setzt Torzahlen; Titel ohne Gegner wird Veranstaltung; ganztägiger Eintrag setzt `all_day`.
- `factsFromFixture`-Tests: Ankündigung vor Anpfiff, Ergebnis danach, Heim- und Auswärtsspiel korrekt zugeordnet, Datum in Vereinszeitzone formatiert, `provenance` vollständig, alle Pflichtfakten des jeweiligen Presets belegt; **fehlender Gegner, fehlender Ort und unbekanntes `is_home` erzeugen kein Preset, sondern eine benannte Fehlliste**; ein Spiel mit `status = 'played'` ohne Torzahlen ebenso.
- pgTAP: `status = 'played'` ohne Torzahlen verstößt gegen CHECK; `ends_at` vor `starts_at` verstößt gegen CHECK; Spiel eines fremden Vereins ist unsichtbar; Mannschaft aus fremder Abteilung ist nicht referenzierbar; zweimaliges Einlesen derselben Veranstaltung erzeugt eine Zeile, zwei Instanzen derselben Serie erzeugen zwei; `source_material` mit einem fünften Schlüssel verstößt weiterhin gegen den bestehenden CHECK.
- pgTAP zum Löschverhalten, je Tabelle mit `SET NULL`-Spaltenliste: Löschen einer Mannschaft lässt Spiele und Veranstaltungen bestehen und setzt nur `team_id` auf `null`; Löschen einer Quelle nur `source_id`; Löschen eines Spiels oder einer Veranstaltung lässt die `submissions`-Zeile bestehen und setzt nur `fixture_id` bzw. `club_event_id`; Löschen einer Quelle lässt die Mannschaft bestehen. `organization_id` und `department_id` bleiben in allen Fällen gesetzt — ohne Spaltenliste scheitert jeder dieser Löschvorgänge zur Laufzeit an `not null`.
- iCal-Serientests: eine verschobene Einzelinstanz aktualisiert genau eine Zeile statt eine zweite anzulegen; eine gelöschte Einzelinstanz einer weiterlaufenden Serie stillt nur diese; eine Änderung der ganzen Serie wirkt auf alle noch nicht abgelaufenen Instanzen; ein Feed ohne `RECURRENCE-ID` fällt auf die ursprüngliche Startzeit zurück und erzeugt trotzdem keine Duplikate.
- Vorschlagstests: jede Regel einzeln; ein Spiel mit bestehendem Beitrag erzeugt keinen Vorschlag; ein weggeklickter Vorschlag kehrt beim nächsten Lauf **nicht** zurück, wohl aber, nachdem sich das Ereignis in der Quelle geändert hat.
- manuell: iCal-Feed eines Mannschaftskalenders anbinden, Trockenlauf zeigt erkannte Spiele mit Zuordnungsvorschlägen, eine Zuordnung korrigieren, übernehmen; Kalender zeigt die Spiele; Vorschlag „Ankündigung fehlt“ erscheint; Beitrag daraus erstellen, Fakten sind vorbelegt und als Quellenangabe markiert; Anstoßzeit in der Quelle ändern, Hinweis erscheint am Beitrag.

## Risiken und offene Entscheidungen

- **Verbandsdaten sind fremde Daten.** Ein Spielplan aus einem Verbandsportal enthält auch die Daten des Gegners. Veröffentlicht ein Verein „SV Nordstadt – TSV Süd 3:1“, ist das unproblematisch; ein Import von Spielerlisten des Gegners wäre es nicht. Die Schemata lassen das nicht zu, und diese Grenze muss ausdrücklich bleiben.
- **Kein Scraping.** fussball.de und nuLiga bieten teils iCal-Feeds, teils nur HTML. Angeboten wird ausschließlich, was ein Anbieter als Export oder Feed bereitstellt. Diese Grenze steht schon in Paket 014 und wird hier oft auf die Probe gestellt, weil der Nutzen so offensichtlich ist.
- **Titelmuster in iCal** sind eine Heuristik. Sie funktioniert bei Verbandsfeeds gut und bei handgepflegten Kalendern unzuverlässig. Deshalb ist die Erkennung immer im Trockenlauf sichtbar und korrigierbar. Ein Modell zur Klassifikation einzusetzen wäre möglich, wäre aber eine unnötige Abhängigkeit für ein Problem, das eine bestätigte Zuordnung dauerhaft löst.
- **Verlegte Spiele**: ~~offene Produktentscheidung~~ **entschieden (2026-08-07): nur Hinweis, keine Automatik.** Ein bereits veröffentlichter Ankündigungsbeitrag wird nicht automatisch als „überholt“ markiert — Hinweis am Beitrag plus Invalidierung offener Freigaben bleibt die einzige Reaktion, der Verein entscheidet selbst, ob und wie er korrigiert.
- **Wiederkehrende Termine** ohne Enddatum brauchen eine Obergrenze. Vorschlag: 12 Monate im Voraus, danach beim nächsten Lauf nachrücken.
- **Reihenfolge**: dieses Paket setzt Paket 014 voraus. Ohne dessen Rahmen entstünde hier ein zweiter Synchronisationsmechanismus — genau das, was der Rahmen verhindern soll.

## Umsetzung: Ergebnis und Abweichungen vom Plan

Umgesetzt auf Branch `worktree-plan-019-mannschaften-spielplaene-und-veranstaltungen`, abgezweigt von `worktree-plan-014-integrationsrahmen-und-mitgliederverzeichnis` (PR #21 zum Zeitpunkt der Umsetzung noch offen, siehe „Entscheidungen vor der Umsetzung“ oben). Migration `2026080704_fixtures_and_events.sql`, neues Package `packages/club-schedule` (drei Bereichsadapter — der Plan nennt keinen Packagenamen, `member-directory` aus 014 ist das Vorbild für die Eins-Package-pro-Bereich-Konvention), `factsFromFixture`/`factsFromClubEvent` in `packages/content-engine/src/schedule.ts`, TZID-Erweiterung in `packages/integrations/src/icalTransport.ts`, API-Erweiterung in `apps/api/src/app.ts`, Oberfläche in `kalender.vue`/`erstellen.vue`/`index.vue`.

### Titelheuristik als eigene, getestete Funktion

`detectFixtureTitle()` (`packages/club-schedule/src/titleHeuristic.ts`) trennt zuerst einen Ergebnis-Suffix ab (Regex auf Ziffern, damit ein Trennzeichen im Ergebnis nicht mit dem Team-Trennzeichen verwechselt wird), splittet den Rest auf einem leerraum-umschlossenen Trennzeichen (`–`, `—`, `-`, `vs.`/`vs`, `:`) und liefert `homeName`/`awayName` unaufgelöst zurück — welche Seite die eigene Mannschaft ist, klärt erst der Resolver in `fixtureMatch.ts` (braucht einen Datenbankabgleich gegen bekannte Mannschaftsnamen, den `normalize()` nicht hat). Ein Mannschaftsname mit Bindestrich ohne umgebende Leerzeichen (z. B. „SV Bad-Homburg“) wird dadurch nicht fälschlich gesplittet. `normalize()` in `fixture.ts`/`event.ts` entscheidet anhand desselben Erkennungsergebnisses, ob eine iCal-Zeile zur `fixtures`- oder zur `events`-Domäne gehört — dafür wurde `DomainAdapter.normalize()` (`packages/integrations/src/types.ts`) um die Möglichkeit erweitert, `undefined` zurückzugeben („gehört nicht zu diesem Bereich, überspringen, kein Konflikt“); der `people`-Adapter aus 014 nutzt das nicht und ist unverändert.

### iCal-TZID: Transport erweitert, nicht umgangen

Wie in den Verifikationsagenten festgestellt, verwarf `icalTransport.ts` jedes Property-Parameter (`;TZID=…`, `;VALUE=…`) vollständig. Behoben additiv: jedes Parameter wird zusätzlich als Geschwister-Schlüssel `<property>_<param>` freigelegt (`dtstart_tzid`, `dtstart_value`, …), plus eine neue Funktion `resolveIcalDateTime(rawValue, tzid, fallbackTimezone)`, die über eine doppelte `Intl.DateTimeFormat`-Umrechnung (keine eigene Zeitzonendatenbank nötig, die ICU-Daten der Laufzeit reichen) eine Wanduhrzeit in einer beliebigen IANA-Zone korrekt in UTC auflöst — mit Sommerzeit-Test gegen `Europe/Berlin` und eine negative Zone (`America/New_York`) zur Absicherung der Vorzeichenrichtung. Ein ungültiger/unbekannter `TZID`-Wert fällt auf die Vereinszeitzone zurück statt den Sync-Lauf abzureißen. `ExternalFixtureSchema`/`ExternalClubEventSchema` tragen die Rohzeitzone als eigenes optionales Feld (`kickoffAtTzid`/`startsAtTzid`/`endsAtTzid`) bis zum tatsächlichen Schreibpfad in `apps/api/src/app.ts`, wo `organizations.timezone` als Fallback bekannt ist — das Adapter-Package selbst kennt keine Datenbank.

### Rechte: zwei neue Permissions, ein beim eigenen Review gefundener Durchsetzungsfehler

`fixture.manage`/`event.manage` (TS `packages/authorization`, SQL `authz.has_department_permission`), gewährt an `department_admin` (automatisch an Organisationsrollen), **nicht** an `team_manager` — wie `team.manage`/`integration.manage`. Schreibzugriff auf `fixtures`/`club_events` läuft ausschließlich über die API mit Service Role, keine `INSERT`/`UPDATE`/`DELETE`-Policy für `authenticated` — wie `directory_people` (014), nicht wie `teams`.

**Fund beim eigenen Review, vor Abschluss behoben**: Der Sync-Endpunkt prüfte für `teams`/`fixtures`/`events` ausschließlich `integration.manage` — `team.manage`/`fixture.manage`/`event.manage` existierten im Rollenmodell, wurden aber nirgends abgefragt. Heute zufällig folgenlos (`department_admin` hat alle vier gemeinsam), aber genau das Muster aus dem 014-Fund bei `integration.manage`/`department.manage`: eine künftige, engere Rolle mit ausschließlich `integration.manage` hätte Spielpläne/Veranstaltungen schreiben können, ohne dass das Rechtekonzept das vorsieht. Behoben durch eine explizite zusätzliche Prüfung der jeweils passenden Permission direkt vor dem Dispatch in `POST /v1/integration-sources/:id/sync`.

**Zweiter Fund, von einem Testschreib-Agenten beim Nachbau der Submission-Tests entdeckt**: `POST /v1/submissions`s neue Fixture-/Veranstaltungs-Verknüpfung selektierte `organization_id` nicht mit, obwohl `mapFixtureRow`/`mapClubEventRow` (und darüber `FixtureSchema`/`ClubEventSchema`) das Feld zwingend verlangen — jede gültige, fixture-/event-verknüpfte Einreichung wäre in einer echten Datenbank an einem `ZodError` gescheitert (500 statt 202). Die Vitest-Fakes des Bestandstests bilden Spaltenprojektion nicht nach und hätten das nie gezeigt; der Fund kam aus der Diskrepanz zwischen erwartetem und tatsächlichem `select()`. Behoben durch Ergänzen der Spalte in beiden `select()`-Aufrufen.

### Bewusst vereinfacht/aufgeschoben

- **Der vierte Anlassvorschlag („Kontingent unausgeschöpft, nichts geplant“) ist nicht gebaut.** Er bräuchte dieselbe periodengenaue Kontingentberechnung wie `public.schedule_publication`; deren Duplizierung in der Vorschlagsroute ohne eigene Tests hätte mehr Risiko als Nutzen gehabt. `ContentSuggestionKindSchema` reserviert `'quota_reminder'` als Wert, die Oberfläche behandelt ihn defensiv (kein Fixture-/Event-Link), aber kein Code erzeugt ihn. Ein späteres, eigenes Vorhaben — am ehesten zusammen mit einer echten Cron-Ausführung (Paket 004), da diese Regel laut Plan „für die laufende Periode gilt“, nicht ereignisgebunden ist.
- **Sync-geschriebene `kickoff_at`-Werte können den Änderungsvergleich in `planSync` spurious als „geändert“ zählen.** `fixtureMatch.ts`s `fieldsOf()` vergleicht auf der lokalen Seite eine bereits UTC-aufgelöste ISO-Zeichenkette gegen die auf der externen Seite weiterhin rohe iCal-Kompaktform (Zeitzonenauflösung passiert erst beim Schreiben in `apps/api/src/app.ts`, nicht im Adapter, der keine Datenbank kennt). Ein wiederholter Sync-Lauf ohne echte Änderung am Spiel zählt dadurch bei iCal-Quellen jedes Mal als „aktualisiert“ statt „unverändert“ — harmlos (derselbe Wert wird erneut geschrieben, keine Datenkorruption), aber die angezeigte Trockenlauf-/Anwenden-Zusammenfassung ist für diesen einen Fall ungenau. Eine echte Behebung bräuchte entweder eine zonenbewusste Auflösung schon im Adapter (Datenbankzugriff, den `packages/club-schedule` bewusst nicht hat) oder einen Vergleich auf Rohwert-Ebene vor der Auflösung — beides über den Rahmen dieses Pakets hinaus, hier dokumentiert statt stillschweigend in Kauf genommen.
- **Aus der Quelle verschwundene Spiele/Veranstaltungen werden `status = 'cancelled'`, nicht gelöscht.** Keine ausdrückliche Plan-Vorgabe für `retired` in diesen beiden Domänen (anders als `directory_people.status = 'left'` in 014); „abgesagt“ ist die naheliegende, mit dem bestehenden Enum abbildbare Deutung und löst nebenbei die Invalidierungstrigger aus, falls ein Beitrag bereits daran hängt. Ein bereits gespieltes (`status = 'played'`) Ergebnis wird davon ausdrücklich ausgenommen.
- **Kein manueller CRUD-Endpunkt für `fixtures`/`club_events`.** Der Plan beschreibt keine eigene Formularerstellung für Spiele/Veranstaltungen (anders als `directory_people` in 014, das explizit „Person manuell anlegen“ vorsah) — Korrektur läuft über die vorhandene Konfliktauflösung (`field_mapping`, `ignore_permanently`) und erneutes Synchronisieren.
- **Kein Team-Filter im Kalender**, nur Abteilung über den bereits bestehenden globalen Scope-Umschalter (`layouts/default.vue`) — `useScope()`/die Sitzung tragen keine `teamId`, ein lokaler Mannschaftsfilter hätte neue Plumbing gebraucht, die der Plan nicht ausdrücklich verlangt.
- Die optionale „oder wähle einen Anlass“-Dropdown-Erweiterung in `erstellen.vue` (Plan, Abschnitt 3) wurde nicht gebaut — die beiden tatsächlichen Einstiegspunkte (Kalender-Lücke, Anlassvorschläge-Widget) tragen `fixtureId`/`clubEventId` bereits vollständig über die Query-String-Route.

### Korrekturen an Plan-Behauptungen (bereits oben unter „Entscheidungen vor der Umsetzung“ dokumentiert)

Migration umbenannt (`2026080704` statt `2026080412`, sortierte vor den inzwischen gemergten Migrationen bis `2026080703`), `submissions.source_material`s CHECK verlangt „mindestens“ statt „genau“ die vier Schlüssel, `submissions.source_prefill_snapshot` statt `source_facts_snapshot` (Namenskollision mit `post_versions.source_facts_snapshot`, andere Bedeutung), `pages/kalender.vue`/`pages/index.vue`s Dummy-Daten waren durch 008/009 bereits vollständig ersetzt — nur `pages/erstellen.vue`s leere Formularfelder und das Fehlen eines Anlass-Einstiegs entsprachen noch dem Plantext.

### Rebase auf `main` nach dem Merge von PR #21/#22 — zwei weitere Funde

Zwischen dem Abzweigen dieses Pakets und seinem Abschluss wurden PR #21 (Paket 014) **und** eine eigene Review-Fix-Nachfolge-PR #22 gemergt (SSRF-Schutz `outboundFetch.ts`, `z.stringbool()` statt `z.coerce.boolean()`, Sync-Lauf wird vor dem ersten Schreibvorgang angelegt und im Fehlerfall auf `failed` gesetzt, u. a.). Vor der PR-Erstellung dieses Pakets deshalb `git rebase --onto origin/main <alter-Basis-Commit> HEAD` durchgeführt (Regel aus `plans/README.md`) — ein Konflikt (`plans/README.md`, beide Seiten hatten dieselbe Zeile geändert, von Hand vereint), `apps/api/src/app.ts`/`app.test.ts`/`packages/integrations/src/types.ts` automatisch gemergt. Beim anschließenden Abgleich gegen die Review-Fix-Commits zwei eigene, gleichartige Funde:

- **`z.coerce.boolean()` auch in `ExternalFixtureSchema`/`ExternalClubEventSchema`** (`isHome`, `kickoffTimeConfirmed`, `allDay`) — derselbe Fund wie bei `isMinor`/`missingGuardian` in 014: `Boolean(value)` macht jeden nicht-leeren String wahr, ein CSV-Wert `"false"` wäre `true` gewesen. Behoben durch `z.union([z.boolean(), z.stringbool()])` (ein `boolean` bleibt erlaubt, weil ein XLSX-Zellwert bereits als solcher ankommen kann, siehe `fileTransport.ts`). Test ergänzt (`"false"` → `false`). Nebenbefund beim Beheben: `z.stringbool()` erkennt nur englische Token (`true`/`false`/`1`/`0`/`yes`/`no`), keine deutschen (`ja`/`nein`) — ein Datei-Export mit deutschen Werten für diese drei Spalten scheitert deshalb bewusst als benannter `invalid_record`-Konflikt statt geraten zu werden, statt (wie zuvor `"ja"` unter der falschen Coerce-Logik nur zufällig) richtig zu funktionieren. Kein eigener Parser für deutsche Bool-Token ergänzt — das wäre Raten, welche Varianten ein Verein tatsächlich verwendet, und widerspräche demselben „Kein Raten"-Grundsatz wie bei der Mannschaftszuordnung.
- **Geprüft, ob dieselbe Abteilungs-Scope-Korrektur wie bei `directory_people`** (eigene Quellzeilen bleiben in `existing`, auch wenn ihre Abteilung inzwischen gelöscht oder sie umgehängt wurden) **auch für `teams`/`fixtures`/`club_events` gilt — Ergebnis: nein, bewusst nicht übertragen.** `directory_people.department_id` ist `on delete set null` und über `PATCH /v1/directory-people/:id` manuell umhängbar; `teams`/`fixtures`/`club_events.department_id` sind dagegen `on delete cascade` (die Zeile verschwindet mit ihrer Abteilung, es entsteht keine Waise) und kein Schreibpfad in diesem Paket ändert `department_id` nach dem Anlegen. Die Ausgangslage, die den 014-Fund auslöste, existiert für diese drei Tabellen schlicht nicht — eine unveränderte Kopie des Fixes wäre unnötiger Code für ein Szenario, das nicht eintreten kann.
- **Nicht übernommen: der „Sync-Lauf existiert schon vor dem ersten Schreibvorgang, wird bei einem Fehler auf `failed` gesetzt"-Härtung für `teams`/`fixtures`/`events`.** `handleTeamsSync`/`handleFixturesSync`/`handleEventsSync` legen die `integration_sync_runs`-Zeile weiterhin erst am Ende an (Erfolg) bzw. beim Abbruch durch die Verlustschwelle — ein unerwarteter Fehler mitten im Schreiben eines `apply`-Laufs hinterlässt für diese drei Domänen (anders als seit dem Review-Fix für `people`) keine Spur. Bewusst nicht in der verbleibenden Zeit dieses Pakets nachgezogen (eine Restrukturierung aller drei Handler plus ihrer beiden gemeinsamen Helferfunktionen `handleAbortedSync`/`finishSyncRun`); als bekannte, dokumentierte Inkonsistenz stehengelassen statt stillschweigend hingenommen. Nächster naheliegender Schritt für ein künftiges Paket oder einen Refactor: dieselbe Umstellung (Lauf vorab anlegen, `try`/`catch` um die Schreibphase, `.update()` statt `.insert()` am Ende) auf die drei neuen Helferfunktionen übertragen.

### Testabdeckung

- `packages/club-schedule`: 27 Tests (Titelheuristik inkl. Bindestrich-Randfall, alle drei Adapter/MatchStrategy-Paare, unaufgelöste Mannschaftszuordnung als Konflikt statt Ratens).
- `packages/content-engine`: 12 Tests für `factsFromFixture`/`factsFromClubEvent` (Ankündigung/Ergebnis, Heim-/Auswärts-Zuordnung, `ownTeamLabel`-Fallback ohne `Team`-Objekt, pauschale `isHome`-Pflicht, mehrere fehlende Fakten gesammelt, bestätigte/unbestätigte Anstoßzeit in der Datumsformatierung, ganztägige Veranstaltung).
- `packages/integrations`: TZID-Parametererhaltung und `resolveIcalDateTime` (UTC/TZID/Fallback/ungültiges TZID/Sommerzeit/negative Zone) — 31 Tests insgesamt in diesem Package, bestehende `sync.test.ts`/`fileTransport.test.ts` unverändert grün.
- `apps/api`: 28 neue Tests (137 gesamt in `app.test.ts` nach dem Rebase auf den PR-#22-Stand, 168 im ganzen Package inkl. `outboundFetch.test.ts`/`brandFont.test.ts`) für alle drei Sync-Domänen (inkl. `409 source_missing_department`, CHECK-Verstoß als Konflikt statt Absturz), Fixture-/Event-Listen mit Filtern, alle drei Dismiss-Endpunkte inkl. 403/404, Anlassvorschläge inkl. der „erscheint wieder nach Quelländerung“-Regel, und die Submission-Verknüpfung inkl. Abteilungs-Fehlpassung und vereinsweiter Veranstaltungs-Ausnahme.
- `supabase/tests/fixtures_and_events.test.sql`: 53 pgTAP-Assertions (CHECK-Constraints inkl. der neuen `club_events`-Prüfung gegen die MATCH-SIMPLE-Lücke, Eindeutigkeit inkl. `recurrence_key`-Koexistenz, FORCE-RLS, kein Schreibzugriff für `authenticated`, vereinsweite Sichtbarkeit versus `directory_people`s engerer Regel, `fixture.manage`/`event.manage` in `has_department_permission`, `teams`-Spaltenrechte-Härtung, Löschverhalten SET-NULL/CASCADE, beide Invalidierungstrigger).
- Gesamt reproduzierbar grün, nach dem Rebase auf `main`: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm db:reset && pnpm db:test` (406 pgTAP-Tests, 13 Dateien).
- Nicht automatisiert geprüft: Browser-Test der drei geänderten Oberflächenseiten (Kalender-Ebenen, Anlass-Vorbelegung, Anlassvorschläge-Widget) — siehe Definition-of-Done-Hinweis, gilt als offen für die nächste Sitzung.
