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

Migration `2026080412_fixtures_and_events.sql`:

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
  add column source_revision_at timestamptz,
  add column source_facts_snapshot jsonb
    check (source_facts_snapshot is null or jsonb_typeof(source_facts_snapshot) = 'object');
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

Damit „weggeklickt“ hält, braucht der Vorschlag eine stabile Identität und einen Ort. Der Job rechnet ihn jeden Tag neu aus Ereignissen, Beiträgen und Kontingenten aus — ohne gespeicherte Ablehnung erscheint derselbe Vorschlag am nächsten Morgen wieder, und die Liste wird zu Lärm:

```sql
create table public.content_suggestion_dismissals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid not null,
  rule_key text not null check (rule_key in
    ('match_announcement_missing','match_result_missing','event_invitation_missing','quota_unused')),
  fixture_id uuid, club_event_id uuid,
  -- Stand der Quelle beim Wegklicken. Aendert sich das Ereignis danach, ist es
  -- ein anderer Anlass und der Vorschlag darf wiederkommen.
  source_revision_at timestamptz,
  dismissed_by uuid not null references public.profiles(id),
  dismissed_at timestamptz not null default now(),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, fixture_id)
    references public.fixtures(organization_id, id) on delete cascade,
  foreign key (organization_id, club_event_id)
    references public.club_events(organization_id, id) on delete cascade,
  check ((fixture_id is not null) <> (club_event_id is not null) or rule_key = 'quota_unused')
);
create unique index content_suggestion_dismissals_unique
  on public.content_suggestion_dismissals (
    organization_id, department_id, rule_key,
    coalesce(fixture_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(club_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
```

Wann ein weggeklickter Vorschlag **doch** wiederkommt, ist eine bewusste Regel und keine Nebenwirkung: wenn `source_updated_at` des Ereignisses neuer ist als `source_revision_at` — ein verlegtes Spiel ist eine neue Ankündigung. Reines Zeitablaufen bringt ihn nicht zurück. Der allgemeine Kontingent-Anstoß (`quota_unused`) hängt an keinem Ereignis und wird für die laufende Periode weggeklickt.

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
| `pages/kalender.vue:1` | fest „August 2026“, fünf Fantasietermine, fünf hartkodierte Vorlauftage | echte Beiträge, Spiele und Veranstaltungen, navigierbarer Monat |
| `pages/index.vue:17-25` | erfundene Woche mit drei Terminen | echte Woche aus derselben Abfrage |
| `pages/index.vue:77-86` | statische Wochenidee, toter `?type=`-Parameter | datengetriebene Anlassvorschläge |
| `pages/erstellen.vue:35` | leere Felder `title`, `date`, `location` | vorbelegt aus Spiel oder Veranstaltung, mit Herkunftsangabe |
| Termine im Beitragsentwurf | ✓ 008: `useDemoData.ts` mit Datumsangaben als Strings (`'Heute'`, `'Sa., 8. Aug.'`) gelöscht | Termine sind `timestamptz` und kommen aus `fixtures`/`club_events` |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Adaptertests: Spiel neu, verlegt, abgesagt, Ergebnis nachgetragen; uneindeutige Mannschaft erzeugt Konflikt; unbekannte Abteilung erzeugt Konflikt; Feld außerhalb des Schemas wird verworfen.
- iCal-Tests: `DTSTART` mit `TZID`, mit `Z` und ohne Angabe ergeben die richtige UTC-Zeit; ohne Angabe wird `kickoff_time_confirmed = false`; `RRULE` wird bis zur Obergrenze aufgelöst; Titel mit Ergebnis setzt Torzahlen; Titel ohne Gegner wird Veranstaltung; ganztägiger Eintrag setzt `all_day`.
- `factsFromFixture`-Tests: Ankündigung vor Anpfiff, Ergebnis danach, Heim- und Auswärtsspiel korrekt zugeordnet, Datum in Vereinszeitzone formatiert, `provenance` vollständig, alle Pflichtfakten des jeweiligen Presets belegt; **fehlender Gegner, fehlender Ort und unbekanntes `is_home` erzeugen kein Preset, sondern eine benannte Fehlliste**; ein Spiel mit `status = 'played'` ohne Torzahlen ebenso.
- pgTAP: `status = 'played'` ohne Torzahlen verstößt gegen CHECK; `ends_at` vor `starts_at` verstößt gegen CHECK; Spiel eines fremden Vereins ist unsichtbar; Mannschaft aus fremder Abteilung ist nicht referenzierbar; zweimaliges Einlesen derselben Veranstaltung erzeugt eine Zeile, zwei Instanzen derselben Serie erzeugen zwei; `source_material` mit einem fünften Schlüssel verstößt weiterhin gegen den bestehenden CHECK.
- Vorschlagstests: jede Regel einzeln; ein Spiel mit bestehendem Beitrag erzeugt keinen Vorschlag; ein weggeklickter Vorschlag kehrt beim nächsten Lauf **nicht** zurück, wohl aber, nachdem sich das Ereignis in der Quelle geändert hat.
- manuell: iCal-Feed eines Mannschaftskalenders anbinden, Trockenlauf zeigt erkannte Spiele mit Zuordnungsvorschlägen, eine Zuordnung korrigieren, übernehmen; Kalender zeigt die Spiele; Vorschlag „Ankündigung fehlt“ erscheint; Beitrag daraus erstellen, Fakten sind vorbelegt und als Quellenangabe markiert; Anstoßzeit in der Quelle ändern, Hinweis erscheint am Beitrag.

## Risiken und offene Entscheidungen

- **Verbandsdaten sind fremde Daten.** Ein Spielplan aus einem Verbandsportal enthält auch die Daten des Gegners. Veröffentlicht ein Verein „SV Nordstadt – TSV Süd 3:1“, ist das unproblematisch; ein Import von Spielerlisten des Gegners wäre es nicht. Die Schemata lassen das nicht zu, und diese Grenze muss ausdrücklich bleiben.
- **Kein Scraping.** fussball.de und nuLiga bieten teils iCal-Feeds, teils nur HTML. Angeboten wird ausschließlich, was ein Anbieter als Export oder Feed bereitstellt. Diese Grenze steht schon in Paket 014 und wird hier oft auf die Probe gestellt, weil der Nutzen so offensichtlich ist.
- **Titelmuster in iCal** sind eine Heuristik. Sie funktioniert bei Verbandsfeeds gut und bei handgepflegten Kalendern unzuverlässig. Deshalb ist die Erkennung immer im Trockenlauf sichtbar und korrigierbar. Ein Modell zur Klassifikation einzusetzen wäre möglich, wäre aber eine unnötige Abhängigkeit für ein Problem, das eine bestätigte Zuordnung dauerhaft löst.
- **Verlegte Spiele** sind der häufigste Änderungsfall im Amateursport. Der Hinweis am betroffenen Beitrag plus Invalidierung offener Freigaben ist die Mindestreaktion. Ob ein bereits **veröffentlichter** Ankündigungsbeitrag automatisch als „überholt“ markiert wird, ist eine offene Produktentscheidung — technisch möglich, aber ein Verein möchte vielleicht selbst entscheiden, ob er korrigiert.
- **Wiederkehrende Termine** ohne Enddatum brauchen eine Obergrenze. Vorschlag: 12 Monate im Voraus, danach beim nächsten Lauf nachrücken.
- **Reihenfolge**: dieses Paket setzt Paket 014 voraus. Ohne dessen Rahmen entstünde hier ein zweiter Synchronisationsmechanismus — genau das, was der Rahmen verhindern soll.
