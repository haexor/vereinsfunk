# 014 – Integrationsrahmen und Mitgliederverzeichnis

## Ergebnis

Ein Verein pflegt nichts doppelt. Was in seinem Vereinsverwaltungssystem, seinem Verbandsportal oder seinem Mannschaftskalender schon steht, wird eingelesen: Personen, Mannschaften, Spielpläne, Ergebnisse, Veranstaltungen. Dafür entsteht **ein** Synchronisationsrahmen, der für alle diese Bereiche gleich funktioniert — Quelle einrichten, Felder zuordnen, Trockenlauf ansehen, übernehmen, Konflikte entscheiden — und der neue Quellen aufnehmen kann, ohne dass die Logik jedes Mal neu geschrieben wird.

Als erster und heikelster Bereich entsteht das Mitgliederverzeichnis: die Personen, die auf Fotos auftauchen können, mit der Information, wer minderjährig ist, wer den Verein verlassen hat und wie Erziehungsberechtigte erreichbar sind. Mannschaften, Spielpläne und Veranstaltungen folgen in Paket 019 auf demselben Rahmen.

## Warum der Rahmen zuerst kommt

Die Anforderung lautet, viele Quellen anbinden zu können. Der Reflex ist, pro Quelle einen Import zu schreiben. Das skaliert nicht: fünf Quellen × vier Bereiche sind zwanzig Importe mit zwanzig Mal derselben Frage nach Abgleich, Konflikt, Trockenlauf und Löschschutz.

Der Rahmen trennt daher drei Dinge, die üblicherweise verschmelzen:

1. **Transport** — woher kommen die Daten: Datei, HTTP-API, iCal-Feed, Webhook
2. **Bereich** — was für Daten sind es: Personen, Mannschaften, Spiele, Veranstaltungen
3. **Abgleich** — was passiert mit ihnen: neu, geändert, verschwunden, widersprüchlich

Nur (1) und (2) sind pro Quelle verschieden. (3) wird einmal geschrieben und immer wieder benutzt. Ein neuer Anbieter kostet dann einen Adapter, nicht ein Teilsystem.

## Warum das Mitgliederverzeichnis ein Bruch ist

Bis hierhin ist das System bewusst personenarm: `consent_records.pseudonymous_subject_ref` (`202608030001:34`) ist eine freie Kennung, `face_regions` speichert Bounding Boxes und `subject_kind` als `adult`/`minor`/`unknown` (`:41`), und `plans/README.md` schließt „Gesichtserkennung, Personenabgleich oder biometrische Datenhaltung“ ausdrücklich aus.

Ein Verzeichnis mit Klarnamen, Geburtsjahren und Elternkontakten ist etwas anderes. Es ist die richtige Entscheidung, weil ohne es niemand nachvollziehbar sagen kann, ob für das Kind auf Bild drei eine gültige Einwilligung existiert — aber es erweitert den Datenschutzumfang bewusst und braucht ein ADR.

**Was sich nicht ändert:** keine Gesichtserkennung, kein automatischer Abgleich von Gesicht zu Person, keine biometrischen Merkmale, keine Vektoren, keine Ähnlichkeitssuche. Die Verknüpfung zwischen einer Gesichtsregion und einer Person entsteht ausschließlich, wenn ein Mensch sie herstellt.

**Was neu abgesichert werden muss:** Datenminimierung beim Import, Zweckbindung, Löschkonzept, Auftragsverarbeitung, und ein engmaschiges Rechtekonzept — Elternkontakte sind nicht für jedes Vereinsmitglied bestimmt.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- `supabase/migrations/202608030001:33-38` `consent_records`: `pseudonymous_subject_ref text` (8–160 Zeichen), `scope text`, `guardian_confirmed boolean`, `valid_from`, `valid_until`, `revoked_at`, `evidence_bucket`, `evidence_path`. Brauchbar, kennt aber **keine Person** — nur eine Kennung, die außerhalb des Systems aufgelöst werden muss.
- Es gibt **nur `consent_records_select`** (`:117`) und `grant select` (`:131`). Kein Schreibpfad für `authenticated`, kein Endpunkt.
- `face_regions.subject_kind` (`:41`) unterscheidet `adult`/`minor`/`unknown` **als manuelle Angabe pro Bildregion**. Wer dieselbe Person auf zwanzig Fotos markiert, entscheidet zwanzig Mal neu, ob sie minderjährig ist. Das ist die Fehlerquelle, die ein Verzeichnis beseitigt.
- `packages/domain/src/index.ts:423-432` (verschoben seit Planung, Datei ist durch Paket 013 gewachsen) `evaluateMediaGate` prüft `consentValid` als von außen gelieferten Wert. Wer ihn bestimmt, ist bisher offen.
- `public.teams` (`202608020001:52-62`) trägt keine Herkunftsinformation. Eine Mannschaft ist heute ausschließlich manuell anlegbar.
- Es gibt **keine Tabelle für Personen**, keinen Import, keine Quellenverwaltung, keinen Provider und keine Synchronisation im Code.
- `packages/contracts/src/index.ts:82` `WorkflowNameSchema` kennt keinen Sync-Workflow.

## Entscheidungen vor der Umsetzung (2026-08-07)

- **HTTP-API-Adapter verschoben.** Kein Zielsystem mit dokumentiertem Testzugang bekannt. Dieses Paket baut nur Datei-Import (CSV/XLSX) und iCal; der HTTP-Transport bleibt im Rahmen vorgesehen (Interface, Enum-Wert), aber ohne Implementierung — analog zum Meta-App-Review-Gate aus Paket 012. Ein HTTP-Adapter für ein konkretes System (easyVerein, SpielerPlus, ClubDesk, …) ist ein eigener, späterer Spike mit `docs/evidence/integration-spike.md`.
- **Jahr des 18. Geburtstags**: das ganze Kalenderjahr, in dem die Person volljährig wird, gilt als minderjährig. `is_minor` wird aus `birth_year` so abgeleitet, dass eine Person erst ab dem 1. Januar des Jahres nach ihrem 18. Geburtstag als volljährig gilt — im Zweifel die strengere Freigaberoute.

## Scope

- ADR: personenbezogenes Verzeichnis neben pseudonymer Medienverarbeitung
- ADR: Integrationsrahmen, Abgleichsemantik und Grenzen der Anbindung
- Migration: Quellenverwaltung, Sync-Läufe, Konflikte, Herkunftsspalten, `directory_people`, engmaschige RLS
- `packages/integrations`: Transport- und Bereichs-Interfaces, Abgleichlogik, Sicherungen
- erste Transporte: Datei-Import (CSV/XLSX) und iCal; ein HTTP-API-Adapter nach dokumentiertem Spike
- `packages/member-directory` als erster Bereich auf diesem Rahmen
- API-Endpunkte und Nuxt-Oberfläche für Quellen, Trockenlauf, Konflikte und Verzeichnis
- automatische Ableitung der Minderjährigkeit und Behandlung des Übergangs zur Volljährigkeit

Nicht enthalten: Mannschaften, Spielpläne, Ergebnisse und Veranstaltungen (019 — nutzt diesen Rahmen), Einwilligungsverwaltung (015), Beitragsverwaltung, Buchhaltung, Trainingsplanung.

**Dies wird kein Vereinsverwaltungssystem.** Es liest, was es für Bildrechte, Redaktionsplanung und belegte Fakten braucht, und schreibt nie zurück.

## Der Integrationsrahmen

### Transport und Bereich als getrennte Interfaces

`packages/integrations/src/index.ts`:

```ts
export type IntegrationDomain = 'people' | 'teams' | 'fixtures' | 'events'
export type SourceTransportKind = 'file' | 'http' | 'ical' | 'webhook'

/** Transport: woher kommen rohe Datensätze? */
export interface SourceTransport {
  readonly kind: SourceTransportKind          // deckungsgleich mit integration_transport
  readonly key: string
  read(options: { since?: Date }): AsyncIterable<Readonly<Record<string, unknown>>>
}

/** Bereich: was ist ein Datensatz fachlich, und was darf davon behalten werden? */
export interface DomainAdapter<TExternal> {
  readonly domain: IntegrationDomain
  readonly schema: ZodType<TExternal>          // erzwingt Datenminimierung
  normalize(raw: Readonly<Record<string, unknown>>, mapping: FieldMapping): unknown
  identityOf(entity: TExternal): { externalId: string } | { fuzzy: string[] }
}

/** Abgleich: einmal geschrieben, für jeden Bereich gleich. */
export function planSync<TLocal, TExternal>(input: {
  existing: readonly TLocal[]
  incoming: readonly TExternal[]
  match: MatchStrategy<TLocal, TExternal>
  policy: SyncPolicy
}): SyncPlan<TLocal, TExternal>
```

Der entscheidende Punkt ist `schema`: **das Zod-Schema des Bereichs ist die Datenminimierung.** Ein Adapter kann nichts durchlassen, was das Schema nicht kennt. Das ist keine Disziplinfrage mehr, sondern eine Typ- und Laufzeitgrenze.

### Sicherungen, die für jeden Bereich gelten

Diese Regeln werden in `planSync` implementiert, nicht in den Adaptern:

- **Nichts wird gelöscht.** Ein Datensatz, der in der Quelle fehlt, wird als `left`, `cancelled` oder `archived` markiert — je Bereich, aber nie entfernt. Ein unvollständiger Export darf keine Datenbank leeren.
- **Verlustschwelle.** Fehlen mehr als 30 % der bekannten Datensätze, bricht der Lauf ab, statt Massenänderungen zu erzeugen. Konfigurierbar, übersteuerbar, aber nicht der Default.
- **Kein unscharfer Treffer ohne Rückfrage.** Fehlt eine externe ID, wird über normalisierte Merkmale verglichen — und ein Treffer, der nicht eindeutig ist, wird zum Konflikt statt zu einer Vermutung.
- **Keine Strukturänderung durch Import.** Ein unbekannter Abteilungs- oder Mannschaftsname erzeugt einen Konflikt zur Entscheidung, niemals eine neue Abteilung. Sonst legt ein Import die Vereinsstruktur um.
- **Lokale Korrektur gewinnt**, wenn sie neuer ist als `source_updated_at`. Vereine korrigieren Daten dort, wo sie sie brauchen.
- **Immer zweistufig.** `dry_run` schreibt nur Läufe und Konflikte. Geschrieben wird erst nach ausdrücklicher Bestätigung.

### Herkunft inline, nicht polymorph

Jede synchronisierbare Tabelle erhält `source_id`, `external_id`, `source_updated_at` als eigene Spalten mit zusammengesetztem Fremdschlüssel auf `integration_sources`.

Die naheliegende Alternative — eine zentrale `integration_links`-Tabelle mit `local_table text` und `local_id uuid` — wird verworfen: ein polymorpher Verweis kann keinen Fremdschlüssel auf sein Ziel haben und verletzt damit die Regel aus AGENTS.md, dass Tenant-Referenzen über zusammengesetzte Fremdschlüssel gegen Cross-Tenant-Zugriffe gesichert werden. Drei zusätzliche Spalten pro Tabelle sind der geringere Preis.

## Datenmodell

Migration `2026080703_integration_framework.sql` (Dateiname im ursprünglichen Plan trug das Planungsdatum 2026-08-04; inzwischen sind Migrationen bis `2026080702` gemergt, daher das aktuelle Datum):

```sql
create type public.integration_domain as enum ('people','teams','fixtures','events');
-- Deckungsgleich mit SourceTransport.kind. Handgepflegte Datensaetze sind keine
-- Quelle, sondern tragen source_id = null -- deshalb kein 'manual' im Enum.
create type public.integration_transport as enum ('file','http','ical','webhook');

create table public.integration_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transport public.integration_transport not null,
  provider_key text not null,                    -- 'csv','ical','easyverein', …
  display_name text not null,
  -- cardinality, nicht array_length: array_length('{}', 1) ist NULL, und ein
  -- CHECK mit NULL gilt als erfuellt -- der leere Wert umgeht die Grenze sonst.
  enabled_domains public.integration_domain[] not null
    check (cardinality(enabled_domains) between 1 and 4),
  department_id uuid,                            -- optional auf eine Abteilung begrenzt
  endpoint_url text,
  credentials_secret_id uuid,                    -- packages/secrets, nie Klartext
  field_mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(field_mapping) = 'object'),
  sync_cron text,                                -- null = nur manuell
  loss_threshold_percent integer not null default 30 check (loss_threshold_percent between 1 and 100),
  enabled boolean not null default true,
  last_sync_at timestamptz, last_sync_status text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade
);

create table public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, source_id uuid not null,
  domain public.integration_domain not null,
  mode text not null check (mode in ('dry_run','apply')),
  status text not null default 'running'
    check (status in ('running','succeeded','failed','cancelled','aborted_loss_threshold')),
  created_count integer not null default 0, updated_count integer not null default 0,
  retired_count integer not null default 0, skipped_count integer not null default 0,
  conflict_count integer not null default 0,
  error_class text, correlation_id uuid not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  triggered_by uuid references public.profiles(id),
  unique (organization_id, id),
  foreign key (organization_id, source_id)
    references public.integration_sources(organization_id, id) on delete cascade
);

create table public.integration_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, sync_run_id uuid not null,
  source_id uuid not null,
  domain public.integration_domain not null,
  external_id text, local_id uuid, label text not null,
  field text not null, current_value text, incoming_value text,
  kind text not null check (kind in ('ambiguous_match','unknown_structure','value_conflict','invalid_record')),
  -- Stabiler Wiedererkennungsschluessel ueber Laufgrenzen hinweg, damit
  -- ignore_permanently beim naechsten Lauf ueberhaupt greifen kann.
  fingerprint text not null,
  resolution text not null default 'pending'
    check (resolution in ('pending','keep_current','take_incoming','ignore_permanently')),
  resolved_by uuid references public.profiles(id), resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, sync_run_id)
    references public.integration_sync_runs(organization_id, id) on delete cascade,
  foreign key (organization_id, source_id)
    references public.integration_sources(organization_id, id) on delete cascade
);
-- Dauerhaft ignorierte Konflikte werden nicht neu angelegt, sondern gefunden.
create unique index integration_sync_conflicts_ignored_unique
  on public.integration_sync_conflicts (organization_id, source_id, fingerprint)
  where resolution = 'ignore_permanently';
```

`label` in der Konfliktzeile statt eines Verweises auf den Zieldatensatz: ein Konflikt muss auch dann verständlich bleiben, wenn der zugehörige Datensatz noch nicht existiert.

`fingerprint` ist der Grund, warum `ignore_permanently` funktioniert. Die `id` ist pro Lauf neu, und die Zeile hängt per `on delete cascade` am Lauf — ohne stabilen Schlüssel wäre eine Ignorier-Entscheidung beim nächsten Lauf vergessen. Der Wert wird deterministisch aus Quelle, Bereich, Konfliktart, Feld und der Identität des Datensatzes (`external_id`, sonst `local_id`, sonst dem normalisierten `label`) gebildet. Bevor ein Konflikt angelegt wird, prüft der Lauf den Fingerabdruck gegen die dauerhaft ignorierten Einträge derselben Quelle.

### Mitgliederverzeichnis

Erlaubte Felder, vollständig:

| Feld | Zweck | Warum nicht mehr |
|---|---|---|
| Vorname, Nachname | Person auf einem Foto identifizieren | ohne Namen keine Zuordnung |
| Geburtsjahr | Minderjährigkeit ableiten | **kein vollständiges Geburtsdatum** |
| Abteilung, Mannschaft | Zuständigkeit und Sichtbarkeit begrenzen | sonst sieht jede Abteilung alle Kinder |
| Status, Austrittsdatum | erlöschende Einwilligung | – |
| Erziehungsberechtigte: Name, E-Mail | Einwilligung einholen und Widerruf ermöglichen | keine Telefonnummer, keine Adresse |

Ausdrücklich **nicht** importiert, auch wenn die Quelle sie liefert: Adresse, Bankverbindung, Beitragsklasse, Geschlecht, Nationalität, Gesundheitsdaten, Passnummer, vollständiges Geburtsdatum, Spielberechtigungen, Freitextnotizen.

```sql
create type public.directory_person_status as enum ('active','inactive','left','unknown');

create table public.directory_people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid, team_id uuid,
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name  text not null check (char_length(last_name)  between 1 and 80),
  birth_year integer check (birth_year between 1900 and 2100),
  is_minor boolean not null default false,
  status public.directory_person_status not null default 'active',
  left_at date,
  guardian_name text, guardian_email text check (guardian_email = lower(guardian_email)),
  source_id uuid, external_id text, source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  -- Spaltenliste bei SET NULL ist Pflicht: ohne sie setzt PostgreSQL *alle*
  -- Spalten des Fremdschluessels auf NULL, also auch organization_id -- die ist
  -- not null, und das Loeschen der Abteilung wuerde daran scheitern.
  foreign key (organization_id, department_id) references public.departments(organization_id, id) on delete set null (department_id),
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete set null (team_id),
  foreign key (organization_id, source_id) references public.integration_sources(organization_id, id) on delete set null (source_id),
  check (not is_minor or guardian_email is not null or status <> 'active')
);

create unique index directory_people_external_unique
  on public.directory_people (organization_id, source_id, external_id)
  where source_id is not null and external_id is not null;
```

Der letzte CHECK: eine **aktive minderjährige** Person braucht einen Elternkontakt. Ohne ihn kann keine Einwilligung eingeholt werden. Ausgetretene bleiben ohne Kontakt zulässig.

`is_minor` ist gespeichert und nicht berechnet, weil es auch ohne Geburtsjahr gesetzt werden kann — nicht jede Quelle liefert eines, und ein Verein weiß trotzdem, dass es die F-Jugend ist.

Verknüpfung zur Medienwelt, minimal:

```sql
alter table public.consent_records add column directory_person_id uuid;
alter table public.consent_records add constraint consent_records_person_fk
  foreign key (organization_id, directory_person_id)
  references public.directory_people(organization_id, id) on delete restrict;
```

`pseudonymous_subject_ref` bleibt pflichtig. Gastspieler, Zuschauer und fremde Trainer werden weiter pseudonym erfasst — das Verzeichnis ist eine Erleichterung, keine Voraussetzung. `on delete restrict` verhindert, dass ein Sync-Lauf eine Person mit Einwilligungshistorie löscht.

## Rechtekonzept

Elternkontakte und Geburtsjahre sind nicht für jedes Vereinsmitglied bestimmt. Die Policies sind enger als überall sonst:

- **Lesen** von `directory_people`: `department_admin` oder `team_manager` der zugeordneten Einheit, plus `organization_admin` und `organization_owner`. **Nicht** jeder `contributor`.
- `guardian_name` und `guardian_email` per Spaltenrechten nur mit `department.manage` oder höher. Ein `editor` muss wissen, dass ein Kind eine gültige Einwilligung hat — nicht, wie die Mutter heißt.
- **Schreiben** ausschließlich über die API mit Service Role und Audit-Eintrag. Keine INSERT/UPDATE-Policy für `authenticated`, analog zu `invitations` und `consent_records`.
- `authz.can_read_directory_person(person_id)` als einzige Stelle dieser Regel.
- Jeder Lesezugriff auf einen Elternkontakt erzeugt einen `audit_events`-Eintrag.
- `integration_sources.credentials_secret_id` ist für `authenticated` nie lesbar; Zugangsdaten liegen verschlüsselt über `packages/secrets` (existiert bereits aus Paket 022, dort für LLM-Provider-Schlüssel angelegt und in Paket 012 für Social-Connection-Tokens wiederverwendet).

## Umsetzung

### 1. Transporte

- **Datei (CSV/XLSX)** — funktioniert bei jedem Verein sofort, weil jedes System exportieren kann. Spaltenzuordnung in der Oberfläche, gespeichert in `field_mapping`, damit der nächste Import ohne erneutes Zuordnen läuft.
- **iCal** — der pragmatische Universaladapter für Termine. Viele Verbands- und Mannschaftssysteme bieten einen Kalender-Feed, auch wenn sie keine API haben. Wird primär von Paket 019 gebraucht, entsteht aber hier, weil er zum Rahmen gehört.
- **HTTP-API** — ein Adapter nach dokumentiertem Spike in `docs/evidence/integration-spike.md`. Je Kandidat zu beantworten: dokumentierte API, Authentifizierung, Ratenlimits, welche Bereiche geliefert werden, Auftragsverarbeitungsvertrag möglich, Kosten, Stabilitätszusage. Kandidaten im deutschen Markt sind unter anderem easyVerein, Vereinsflieger, SpielerPlus, ClubDesk, Campai, Kurabu, WISO MeinVerein und SAMS.
- **Webhook** ist als Transportart im Enum vorgesehen und wird in diesem Paket **nicht** implementiert. Er braucht Signaturprüfung und eine öffentliche Route und ist erst sinnvoll, wenn ein Anbieter ihn anbietet.
- **Manuell** ist ausdrücklich **keine** Transportart. Ein handgepflegter Datensatz hat keine Quelle: `source_id`, `external_id` und `source_updated_at` bleiben `null`, der partielle Unique-Index greift nicht, und `planSync` sieht ihn nie. Deshalb steht `manual` weder im Enum noch im TypeScript-Vertrag.

Ehrliche Erwartung, die im Plan stehen soll: die meisten dieser Systeme haben keine offene, dokumentierte API für Vereine. Datei-Import und iCal bleiben auf absehbare Zeit die Hauptwege, und das ist kein Notbehelf — ein zuverlässiger Import mit Trockenlauf ist besser als eine brüchige Integration.

**Wichtige Abgrenzung:** Das Auslesen von Verbandsportalen wie fussball.de oder nuLiga per Scraping kommt nicht in Betracht. Angeboten wird ausschließlich, was ein Anbieter als Export oder Feed bereitstellt.

### 2. Ausführung

Hatchet-Workflow `sync-integration-source` mit Fairness-Key `organizationId`, weil ein API-Sync langsam und ratenlimitiert sein kann. Der Name muss in `WorkflowNameSchema` (`packages/contracts/src/index.ts:82`) ergänzt werden. Die Nachricht enthält nur `sourceId`, `domain`, `mode` und `correlationId` — keine Fachdaten, entsprechend `ADR-002`.

Ein Cron führt Quellen mit `sync_cron` automatisch aus, **immer als `dry_run`**, wenn Konflikte offen sind. Automatische Übernahme ist nur zulässig, wenn der letzte Lauf konfliktfrei war; sonst wartet der Lauf auf einen Menschen.

### 3. Minderjährigkeit und der Übergang

- `is_minor` wird aus `birth_year` abgeleitet. Ohne Geburtsjahr bleibt der manuell gesetzte Wert.
- Ein täglicher Cron hält es konsistent und schreibt bei einem Wechsel ein `audit_events`-Ereignis.
- **Der Übergang zur Volljährigkeit setzt bestehende Einwilligungen nicht außer Kraft**, aber er ändert, wer widerrufen darf. Die Person erscheint in einer Liste „Volljährig geworden — Einwilligung prüfen“; Paket 015 behandelt die Folgen.
- Umgekehrt: wird eine Person nachträglich als minderjährig erkannt, werden alle bereits veröffentlichten Beiträge mit ihr zur Prüfung markiert.

### 4. Oberfläche

Neue Seite `pages/integrationen.vue` — für alle Bereiche gleich, damit Paket 019 keine zweite Oberfläche braucht:

- Quellenliste mit Transport, Bereichen, letztem Lauf, Status, Zeitplan
- Quelle einrichten: Transport wählen, Zugang eintragen, Bereiche aktivieren, Felder zuordnen
- Trockenlauf mit Ergebnisvorschau: N neu, N geändert mit Feldliste, N stillgelegt, N Konflikte
- Konfliktliste mit Einzelentscheidung und der Möglichkeit, einen Konflikt dauerhaft zu ignorieren
- Verlauf der Läufe mit Zählwerten und Fehlerklassen

Neue Seite `pages/verzeichnis.vue`, nur für Berechtigte:

- Liste nach Abteilung und Mannschaft, Filter „minderjährig“, „ohne Elternkontakt“, „Einwilligung fehlt“ (Paket 015 füllt das), „ausgetreten“
- manuelles Anlegen und Bearbeiten — das Verzeichnis muss ohne jede Integration vollständig benutzbar sein
- ein sichtbarer Hinweis, welche Felder das System bewusst **nicht** speichert

### 5. Personenstammdaten: zwei Datensatzarten, nicht eine

**Anforderung des Nutzers am 2026-08-05**, aufgekommen beim Review von Paket 010. Der Wunsch lautete: „jedes Mitglied hat eine Profilseite, wo derjenige ein paar Daten und Foto von sich einstellen kann“ und gleichzeitig „wenn ein Vereinsadmin Mitglieder hinzufügt, dann sollte er einstellen können, seit wann das Mitglied dabei ist — genauso wie Geburtstag, Adresse, Eltern, Einwilligungen, Foto“, importierbar aus einem Drittsystem oder per CSV/JSON.

Das sind **zwei** Datensatzarten mit verschiedenen Eigentümern und verschiedenen Rechtsgrundlagen; sie dürfen nicht zu einer verschmelzen:

| | `public.profiles` | `public.directory_people` (dieses Paket) |
|---|---|---|
| Was | App-Konto einer angemeldeten Person | Person, die auf Fotos vorkommen kann — mit oder ohne Konto |
| Gepflegt von | der Person selbst | Vereins-/Abteilungsadmin, oder Import |
| Heute vorhanden | `display_name`, `avatar_path` (die Sidebar nutzt es), keine Profilseite | dieses Paket |

Zu bauen:

- **Profilseite** für `profiles` (Anzeigename, Foto über das vorhandene `avatar_path`) — Selbstbedienung, keine Vereinsdaten. Die Vereinszugehörigkeit erscheint dort nur lesend: sie entsteht ausschließlich über Einladung oder Admin (Paket 010) und ist bereits heute nicht selbst setzbar.
- **Verknüpfung** `directory_people.profile_id` (nullable): eine Verzeichnisperson kann ein Konto haben, muss aber nicht.
- **`joined_at date`** auf `directory_people` — heute existiert nur `left_at`. „Seit wann dabei“ ist eine der ausdrücklich genannten Import- und Pflegeangaben und fehlt bisher.
- **Adresse und vollständiges Geburtsdatum** sind heute bewusst **nicht** im Modell (Datenminimierung: nur `birth_year`, siehe „Warum das Mitgliederverzeichnis ein Bruch ist“). Beide aufzunehmen erweitert den Datenschutzumfang erneut und gehört in dasselbe ADR, das dieses Paket ohnehin verlangt — mit Zweckbindung und Löschkonzept, nicht als stille Spaltenergänzung.

**Kein generischer Profileditor.** Der Wunsch dahinter ist DRY, und der ist berechtigt — der Weg dorthin sind gemeinsame Feld- und Formularkomponenten plus je Datensatz ein Zod-Schema aus `packages/contracts` (schema-getriebene Formulare). Ein generischer Editor über drei Datensatzarten mit unterschiedlichen Rechten und Rechtsgrundlagen wird dagegen zum Formular-Baukasten, in dem Pflichtfelder und Berechtigungen generisch werden — genau das, was hier nicht generisch sein darf.

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- `planSync`-Tests, bereichsunabhängig: neuer Datensatz; geändertes Feld; fehlender Datensatz wird stillgelegt; uneindeutiger Treffer erzeugt Konflikt statt Zuordnung; Abbruch über der Verlustschwelle; lokale Änderung gewinnt gegen ältere Quelle; unbekannte Struktur erzeugt Konflikt; `ignore_permanently` unterdrückt den Konflikt beim nächsten Lauf.
- Datenminimierungstest: CSV mit IBAN-, Adress- und Geschlechtsspalte → keines dieser Felder erscheint in der Datenbank, in einer API-Antwort oder in einem Log. Dieser Test ist die Zusage in ausführbarer Form.
- pgTAP: aktive minderjährige Person ohne Elternkontakt verstößt gegen CHECK; `contributor` liest keine Zeile aus `directory_people`; `editor` liest die Person, aber nicht `guardian_email`; Person mit Einwilligung ist per Sync nicht löschbar; Quelle und Verzeichnis eines fremden Vereins sind unsichtbar; `credentials_secret_id` ist für `authenticated` nicht lesbar; `enabled_domains = '{}'` verstößt gegen CHECK (das findet ein `array_length` an dieser Stelle nicht).
- pgTAP zum Löschverhalten — **die Tests, ohne die die `SET NULL`-Spaltenlisten unbemerkt fehlen können:** Löschen der Abteilung einer Person lässt die Person bestehen, setzt `department_id` und `team_id` auf `null` und lässt `organization_id` unverändert; dasselbe für das Löschen der Mannschaft (nur `team_id`) und der Quelle (nur `source_id`, `external_id` und `source_updated_at` bleiben als Historie). Ohne Spaltenliste schlägt jedes dieser Löschvorgänge mit einer `not null`-Verletzung fehl — und zwar erst zur Laufzeit, nicht beim Anlegen der Migration.
- Konfliktschlüssel: derselbe Konflikt erhält in zwei aufeinanderfolgenden Läufen denselben `fingerprint`; zwei Quellen mit gleicher `external_id` erzeugen verschiedene; ein dauerhaft ignorierter Konflikt wird beim nächsten Lauf nicht neu angelegt, auch nachdem der ursprüngliche Lauf gelöscht wurde.
- manuell: CSV mit 50 Personen importieren, Trockenlauf prüfen, übernehmen; zweiter Import mit drei Änderungen und einem Austritt zeigt genau diese vier Unterschiede; Import mit halbierter Datei wird abgewiesen.
- Ausgehende Abrufe (`apps/api/src/outboundFetch.ts`, ergänzt beim Review zu PR #21): Loopback, privates Netz, Link-Local und Cloud-Metadatendienst werden abgelehnt — als Literal, über einen Namen, der dorthin auflöst, und über eine Weiterleitung; dazu Zeit- und Größengrenze. Namensauflösung und `fetch` sind dafür injizierbar, damit diese Tests nicht am echten Netz hängen.

## Risiken und offene Entscheidungen

- **Auftragsverarbeitung**: Der Verein bleibt Verantwortlicher, wir werden Auftragsverarbeiter. Ein AVV mit dem Verein ist Betriebsvoraussetzung, und der Verein braucht eine Rechtsgrundlage für die Übermittlung aus dem Quellsystem. Paket 020 verwaltet diese Dokumente; produktiv gehen kann dieses Paket erst danach. Für Entwicklung mit synthetischen Daten gilt das nicht.
- ~~**Geburtsjahr statt Geburtsdatum** lässt offen, wie das Jahr des 18. Geburtstags behandelt wird.~~ **Entschieden 2026-08-07**: das ganze Jahr als minderjährig behandeln, siehe „Entscheidungen vor der Umsetzung“ oben.
- **Klarnamen neben Gesichtsregionen** bleiben ein Risikoprofil, das das System vorher nicht hatte. Das ADR muss benennen, was ausdrücklich nicht getan wird, und die Löschfristen müssen kurz sein.
- **Adapterpflege**: jede API-Integration ist dauerhafte Wartungslast an einem fremden System ohne Stabilitätszusage. Der Rahmen senkt die Kosten pro Adapter erheblich, macht sie aber nicht null. Vorschlag: höchstens zwei HTTP-Adapter gleichzeitig aktiv pflegen, alles Weitere über Datei und iCal — und diese Grenze als Produktentscheidung festhalten.
- **Automatische Übernahme** ist bewusst eingeschränkt. Ein Verein, der täglich synchronisiert und nie Konflikte anschaut, wird sich über stillgelegte Personen wundern. Die Benachrichtigung bei offenen Konflikten ist deshalb Teil des Pakets, nicht Zierde.

## Umsetzung: Ergebnis und Abweichungen vom Plan

### Neue Rechte statt neuer RLS-Sonderwege

Der Plan beschreibt das Rechtekonzept textlich, legt aber keinen Permission-Namen fest. Umgesetzt wurden zwei neue Einträge im etablierten Permission-Muster (TS `packages/authorization` und SQL `authz.has_department_permission`/`has_team_permission`, wie bei jeder vorherigen Erweiterung dieser Art dupliziert):

- `directory.read` — `department_admin` und `team_manager` in ihrer eigenen Einheit, `organization_admin`/`organization_owner` automatisch (bestehende Fallback-Logik).
- `integration.manage` — nur `department_admin` (und automatisch `organization_admin`/`organization_owner`), **nicht** `team_manager`: `integration_sources` kennt keine Team-Ebene.

### Elternkontakt: Lesen über die API mit Service Role, kein eigenes RPC

Der Plan nennt `authz.can_read_directory_person(person_id)` als Rechtekonzept-Baustein. Umgesetzt wurde stattdessen: die Basisspalten von `directory_people` sind per Spaltenrechten für `authenticated` lesbar (ohne `guardian_name`/`guardian_email`), und `GET /v1/directory-people/:id/guardian-contact` prüft `department.manage` in der API (dieselbe `rolesForScope`/`hasPermission`-Logik wie überall sonst) und liest die beiden Spalten danach über die Service Role — analog zum Auslesen von `social_connection_secrets` in Paket 012. Kein zusätzliches security-definer-RPC: das wäre eine weitere Fläche, auf der ein Aufrufer sicherheitsrelevante Parameter unterschieben könnte (wiederkehrender Fund aus 011/012), ohne dass die Prüfung selbst SQL-spezifische Logik bräuchte.

### `became_adult_at` als Ergänzung gegenüber dem Plan-Entwurf

Für die Liste „Volljährig geworden — Einwilligung prüfen“ (Abschnitt „Minderjährigkeit und der Übergang“) fehlte im Plan-Entwurf ein Datenfeld. Ergänzt: `directory_people.became_adult_at timestamptz`, gesetzt von `public.recompute_directory_minor_status()` beim Wechsel `is_minor: true → false`. Die Funktion schreibt **nur** in dieser Richtung — ein nachträglich eingetragenes Geburtsjahr, das eine bereits ohne Elternkontakt geführte Person minderjährig machen würde, liefe am CHECK-Constraint vorbei und bleibt eine Entscheidung für einen Menschen, kein automatischer Schreibvorgang. Es gibt noch keinen „erledigt“-Schalter für diese Liste; das ist eine bewusste Lücke, die Paket 015 mit dem echten Einwilligungs-Review-Schritt schließen sollte.

### Sync-Lauf synchron in der API, nicht über Hatchet

`sync-integration-source` ist wie geplant in `WorkflowNameSchema` reserviert, wird aber nicht tatsächlich als Hatchet-Workflow ausgeführt. Paket 004 stellt dafür inzwischen den technischen ID-only-Outbox-/Worker-Pfad bereit; die fachliche Umstellung dieses synchronen API-Laufs auf einen geplanten Workflow ist nicht Teil von Paket 004. `POST /v1/integration-sources/:id/sync` führt Lesen, Abgleich (`planSync`) und — bei `apply` — das Schreiben weiterhin synchron in einer API-Anfrage aus. Für Datei-Uploads bedeutet das: die Datei wird bei **jedem** Aufruf (`dry_run` **und** `apply`) erneut mitgeschickt, es gibt keine serverseitige Zwischenspeicherung zwischen den beiden Schritten — der Browser hat die Datei nach der Auswahl ohnehin im Speicher, ein erneutes Hochladen ist kein zusätzlicher Schritt für die Nutzerin. Der reservierte Workflow-Name bleibt für eine künftig separat umgesetzte geplante/automatische Ausführung über `sync_cron` vorgesehen.

### Konfliktauflösung: Entscheidung wird vermerkt, nicht automatisch angewendet

`PATCH /v1/integration-sync-conflicts/:id` setzt `resolution`/`resolved_by`/`resolved_at`. Für `ignore_permanently` ist das die vollständige, geplante Wirkung (Unterdrückung über den Fingerabdruck ab dem nächsten Lauf). Für `keep_current`/`take_incoming` fehlt im Plan die Angabe, wie eine einzelne Konfliktzeile (die nur `field`/`current_value`/`incoming_value` als Text trägt) in eine tatsächliche Schreiboperation auf `directory_people` übersetzt werden soll — insbesondere bei `ambiguous_match` (welcher von mehreren Kandidaten?) und `unknown_structure` (keine neue Abteilung anlegen, aber wohin dann?). Diese beiden Auflösungen bleiben deshalb reine Status-Vermerke; der tatsächliche Weg zu einer geänderten Person ist heute: Quelle/Zuordnung korrigieren und erneut synchronisieren, oder die Person manuell bearbeiten. Die Oberfläche sagt das ausdrücklich, um keine Wirkung zu behaupten, die es nicht gibt.

### `xlsx`/SheetJS ersetzt durch `exceljs`

Der zuerst gewählte XLSX-Parser (`xlsx`, npm-Version 0.18.5) hat zwei unbehobene High-Severity-CVEs (Prototype Pollution, ReDoS) — SheetJS verteilt gepatchte Versionen nur noch über die eigene CDN, nicht mehr über npm. Da dieser Parser direkt auf von einem Verein hochgeladene, also nicht vertrauenswürdige Dateien angewendet wird, wurde er vor dem Abschluss des Pakets durch `exceljs` (aktiv gepflegt, keine vergleichbaren offenen CVEs) ersetzt. `packages/integrations/src/fileTransport.ts` und der zugehörige Test wurden entsprechend angepasst.

### Nicht umgesetzt: automatische Prüfmarkierung veröffentlichter Beiträge bei nachträglich erkannter Minderjährigkeit

Plan-Abschnitt „Minderjährigkeit und der Übergang“ verlangt auch die umgekehrte Richtung: wird eine Person nachträglich als minderjährig erkannt, sollen bereits veröffentlichte Beiträge mit ihr zur Prüfung markiert werden. Das braucht eine Verknüpfung zwischen `directory_people` und veröffentlichten Beiträgen/Medien — die gibt es nicht, weil die Inhalts-Pipeline (Submission → Post → Post-Version, Pakete 001–007) weiterhin fehlte (derselbe, wiederholt dokumentierte Befund wie bei 011/012/016). **Teilweise geschlossen in Paket 025**: `post`/`post_version` entstehen jetzt real aus einer `submission`. Die Verknüpfung zu Medien/Personen bleibt aber weiterhin offen, weil `post_media`/`media_assets` ohne die Upload-Pipeline (002/003) leer bleiben — bleibt offen, bis diese und eine Personen-Medien-Verknüpfung existieren.

### Eigenes Profil: API-Endpunkt statt direktem Supabase-Aufruf aus der Oberfläche

`profiles_update_self` erlaubt Selbstbearbeitung bereits direkt per RLS, und `useSession.ts` liest `profiles` schon heute direkt über den Browser-Supabase-Client. Für das Schreiben (`PATCH /v1/me/profile`) wurde trotzdem ein dünner API-Endpunkt ergänzt, keine direkte Schreiboperation aus Nuxt: AGENTS.md verlangt Zod an jeder Systemgrenze, und ein eigener Endpunkt hält diese Grenze konsistent mit jedem anderen Schreibpfad dieser Anwendung, ohne echten Zusatzaufwand (kein Service-Role-Client nötig, RLS erzwingt `id = auth.uid()` weiterhin). Keine Audit-Protokollierung für diesen Endpunkt — eine Person, die ihren eigenen Anzeigenamen ändert, ist kein prüfrelevantes Ereignis.

### Keine Foto-Upload-Pipeline für Profile

Abschnitt 5 nennt „Foto über das vorhandene `avatar_path`“ als Teil der Profilseite. Der Plan legt dafür weder einen Bucket noch eine Verarbeitungspipeline fest (anders als bei Logos in Paket 013). Umgesetzt: die Profilseite zeigt das Avatar an, falls `avatar_path` gesetzt ist (Initialen-Kreis als Fallback), bietet aber keinen Upload an — das wäre eine unspezifizierte Neuerfindung einer Medien-Pipeline gewesen, kein chirurgischer Teil dieses Pakets. Bleibt offen für ein späteres, eigenes Vorhaben.

### `missingGuardian`-Filter über eine nachgelagerte Schnittmenge

`guardian_email` ist für `authenticated` nicht selektierbar (Spaltenrechte) — ein direktes `WHERE guardian_email IS NULL` scheitert deshalb an der Grenze, nicht erst an der Berechtigungslogik. `GET /v1/organizations/:id/directory-people?missingGuardian=true` löst das, indem die API die Liste der IDs ohne Elternkontakt über die Service Role ermittelt und die **Ergebnismenge** der weiterhin RLS-beschränkten Nutzerabfrage danach gegen diese Menge schneidet. Die Sichtbarkeitsgrenze bleibt dieselbe, nur die Filterbedingung selbst braucht einen privilegierten Zwischenschritt.

Zuerst umgesetzt war die naheliegendere Variante — die ID-Liste als `.in()`-Bedingung an die Nutzerabfrage anhängen. Das trägt zwei stille Grenzen in sich, die erst bei größeren Vereinen zuschlagen: PostgREST kappt die ID-Abfrage bei `max_rows` (1000), und einige hundert UUIDs im Query-String sprengen die URL-Länge. Beides fällt nicht als Fehler auf, sondern als unvollständige Liste. Die Schnittmenge im Speicher hat diese Grenzen nicht; die ID-Abfrage läuft über `fetchAllRows` (dasselbe Muster wie `GET /v1/organizations/:id/members`).

## Adversariale Prüfung: Funde und Korrekturen

Vier unabhängige Prüfungen (Mandantentrennung, Rechte, Geheimnisse/Datenminimierung, Verträge und Fehlerpfade) plus ein manueller Browser-Test deckten sechs reale, reproduzierbare Probleme auf. Alle wurden vor Abschluss des Pakets behoben.

- **Kritisch — Abteilungsgrenze eines Sync-Laufs umgehbar**: Für eine abteilungsgebundene Quelle wurden bei der Auflösung von `departmentName`/`teamName` **alle** Abteilungen/Mannschaften des Vereins geladen, nicht nur die eigene. Eine Datei-Spalte mit dem Namen einer fremden Abteilung hätte eine Person — samt Elternkontakt bei einer Minderjährigen — in eine Einheit schreiben können, die der verwaltende `department_admin` weder lesen noch verwalten darf. Behoben: die Abteilungs-/Mannschaftsabfrage in `POST /v1/integration-sources/:id/sync` filtert bei einer abteilungsgebundenen Quelle jetzt auf genau diese eine Abteilung; ein abweichender Name in der Datei wird ein `unknown_structure`-Konflikt, nie eine Zuordnung in eine fremde Einheit. Regressionstest in `apps/api/src/app.test.ts`.
- **Hoch — Rohwert einer falsch zugeordneten Spalte im Konflikt sichtbar**: Ein nicht auflösbarer `departmentName`/`teamName` (z. B. eine versehentlich dorthin gemappte IBAN-Spalte) landete unverändert in `integration_sync_conflicts.incoming_value` — lesbar für jeden mit `integration.manage` (nicht `department.manage`), ohne Audit-Eintrag. Behoben: `incoming_value` bleibt für `kind = 'unknown_structure'` leer; `field`/`label` reichen, um die eigene Feldzuordnung zu korrigieren, ohne den möglicherweise sensiblen Rohwert zu spiegeln.
- **Mittel — Mehrdeutige Kandidaten fälschlich als „ausgetreten“**: `planSync` markierte Kandidaten eines `ambiguous_match`-Konflikts nie als zugeordnet, wodurch sie zusätzlich in `retired` (und damit als „left“) landeten — eine Person wäre gleichzeitig offener Konflikt und als ausgetreten geführt worden. Behoben in `packages/integrations/src/sync.ts`.
- **Mittel — manuell gepflegte Personen durch fremden Import gefährdet** (beim manuellen Browser-Test gefunden, nicht Teil der vier automatisierten Prüfungen): Eine von Hand angelegte Person (`source_id = null`) galt für **jeden** Sync-Lauf als Abgleichskandidat — richtig für die Duplikatvermeidung — aber auch als Kandidat für die Verlustschwelle und für `retired`. Ein völlig unabhängiger Import, der diese Person nicht enthält, hätte sie als „left“ markiert bzw. den Lauf über die Verlustschwelle abgebrochen, nur weil sie zufällig in der falschen Quelle „ohne Zuordnung“ mitgezählt wurde. Behoben durch einen neuen, optionalen `MatchStrategy.isRetirable(local)`-Hook in `packages/integrations`: nur Personen mit echter Quellenbindung (`sourceId !== null`) sind Kandidaten für `retired` und für den Nenner der Verlustschwellenberechnung; alle bleiben weiterhin Abgleichskandidaten. Dieser Fund entstand ausschließlich durch das tatsächliche Ausführen im Browser — kein Unit- oder API-Test mit gemocktem Client hätte ihn gefunden, weil dafür eine echte, bereits gefüllte Datenbank nötig war.
- **Niedrig — kaputte Datei/kaputter iCal-Feed führte zu 500 statt 4xx**: `request.file()`/`csv-parse`/`exceljs` können bei defekten Uploads werfen; ein 200-Antwort-Feed kann trotzdem kein iCal sein (z. B. eine HTML-Login-Weiterleitung). Beide Fälle sind jetzt abgefangen (`400 invalid_file`, `502 source_fetch_failed` bei fehlendem `BEGIN:VCALENDAR`).
- **Niedrig — `enabledDomains` erlaubte Duplikate**: `cardinality()` zählt Duplikate mit; `CreateIntegrationSourceRequestSchema`/`UpdateIntegrationSourceRequestSchema` verlangen jetzt zusätzlich eindeutige Einträge.
- **Defensiv — Elternkontakt über einen Sync-Lauf ohne eigene Prüfung**: `integration.manage` und `department.manage` sind heute deckungsgleich (beide nur bei `department_admin`/Organisationsrollen), aber nur zufällig. `POST /v1/integration-sources/:id/sync` prüft jetzt zusätzlich explizit `department.manage`, bevor `guardianName`/`guardianEmail` aus einer Datei übernommen werden, und entfernt diese Felder sonst aus den eingehenden Datensätzen, statt sich auf die zufällige Deckungsgleichheit zu verlassen.

Ebenfalls beim Review gefunden und behoben, ohne eigenen Bug zu sein: eine der API-Konflikt-Update-Pfade (Aktualisierung einer Person, die durch die Änderung zu einer aktiven Minderjährigen ohne Elternkontakt würde) schlug am CHECK-Constraint fehl und wurde bisher still übersprungen, ohne dass `updated_count` das widerspiegelte oder ein Konflikt entstand. Jetzt entsteht dafür ein echter `invalid_record`-Konflikt, und `updated_count` zählt nur tatsächlich erfolgreiche Schreibvorgänge.

## Code-Review zu PR #21 (2026-08-07)

Eigenes Review plus CodeRabbit auf dem fertigen Stand. Deutliche Überschneidung, aber beide Seiten fanden je etwas, das die andere übersah — und die adversariale Prüfung oben hatte nichts davon gefunden.

**Sicherheit**

- **Kritisch — SSRF über `integration_sources.endpoint_url`**: Der iCal-Lauf rief die gespeicherte Adresse mit einem nackten `fetch()` ab, also aus dem Netz der API. `z.url()` lässt beliebige `http`/`https`-Ziele zu — Cloud-Metadatendienst (`169.254.169.254`), Loopback, internes Netz. Schon die Unterscheidung „502 oder nicht“ verrät, was intern antwortet. Neu `apps/api/src/outboundFetch.ts` als einzige Stelle für ausgehende Abrufe: `isAllowedOutboundUrl` prüft beim Anlegen/Ändern der Quelle die URL selbst — nur `https`, kein `localhost`-/`.local`-/`.internal`-Name, keine als Literal angegebene private/Loopback-/Link-Local-Adresse. `fetchPublicUrl` prüft zusätzlich bei jedem Lauf die tatsächlich aufgelöste Adresse (**auch über einen Namen, der erst zur Laufzeit dorthin auflöst**) und **jede Weiterleitung erneut** (Weiterleitungen werden selbst verfolgt und je Sprung geprüft), dazu Zeit- und Größengrenze — ein beim Speichern unauffälliger Name kann später auf eine andere Adresse zeigen. Von CodeRabbit gefunden. **Verbleibende Lücke, beim Nachtrag-Review erneut von CodeRabbit gefunden**: Die Prüfung löst den Namen selbst auf; der anschließende `fetch()`-Aufruf löst ihn für den eigentlichen Verbindungsaufbau erneut auf und ist nicht an die geprüfte Adresse gebunden. Ein Name mit sehr kurzer TTL könnte zwischen beiden Auflösungen wechseln (DNS-Rebinding) und so doch noch intern verbinden. Als bekannte Grenze in ADR-009 festgehalten statt die Zusage stillschweigend zu überziehen.
- **Hoch — `isMinor` aus der Anfrage konnte den Schutz senken**: `CreateDirectoryPersonRequestSchema`/`UpdateDirectoryPersonRequestSchema` führen `isMinor` als frei setzbares Feld. Eine Person mit Geburtsjahr 2015 liess sich damit als `isMinor: false` anlegen und umging sowohl den CHECK auf einen Elternkontakt als auch die strengere Freigaberoute. Der Server leitet den Wert jetzt aus dem Geburtsjahr selbst ab (`resolveIsMinor`); die Angabe des Aufrufers kann ihn nur noch **anheben**, nie senken. Ohne bekanntes Geburtsjahr gibt es nichts herzuleiten, dann zählt die Angabe. Dasselbe wiederkehrende Muster wie bei den security-definer-RPCs aus 011/012.

**Datenverlust und Abbrüche im Sync**

- **Ein Feld, zu dem die Quelle nichts sagt, überschrieb den lokalen Wert.** `MatchStrategy.fieldsOf` füllte fehlende externe Felder mit `null`/`'active'` auf, und der Schreibpfad setzte `birth_year: entity.birthYear ?? null`. Eine Importdatei ohne Geburtsjahrspalte leerte damit **jedes gepflegte Geburtsjahr** — und mit ihm die Grundlage der Minderjährigkeitsprüfung. `undefined` heisst jetzt durchgängig „die Quelle sagt dazu nichts“ und ist weder ein Unterschied noch ein Schreibvorgang; nur ausdrückliches `null` löscht. Abteilung/Mannschaft/Status waren im Schreibpfad bereits über `?? lokal` geschützt, erzeugten aber bei jedem Lauf einen Schein-Unterschied.
- **Doppelte externe ID in einer Datei** erzeugte zwei Anlagen derselben Identität; die zweite lief in den Unique-Index auf `(organization_id, source_id, external_id)` und liess den halb geschriebenen Lauf abbrechen. `planSync` meldet die Wiederholung jetzt als `invalid_record`-Konflikt.
- **Eine abteilungsgebundene Quelle fand ihre eigenen Datensätze nicht mehr**, sobald deren Abteilung gelöscht (`on delete set null`) oder die Person von Hand umgehängt wurde: die `existing`-Abfrage filterte pauschal auf `department_id = <Quelle>`. Folge wäre eine Neuanlage und damit derselbe Unique-Verstoss gewesen — und die Person wäre nie stillgelegt worden. Die Abteilungsgrenze gilt jetzt nur noch für **fremde** Datensätze (`source_id is null`, reine Abgleichskandidaten); eigene gehören immer dazu, egal wo sie inzwischen liegen. Gegen echtes PostgREST verifiziert, weil die API-Tests mit gemocktem Client die Filtersemantik nicht abdecken.
- **Der Lauf entstand erst nach allen Schreibvorgängen.** Es gibt keine Transaktion über Anlage, Änderung und Stilllegung — brach einer ab, blieben die vorherigen bestehen, aber ohne Lauf-Datensatz und ohne Audit-Eintrag: sichtbare Änderung, unsichtbare Herkunft. Der Lauf wird jetzt **vor** dem ersten Schreibvorgang angelegt (`status = 'running'`, der Vorgabewert der Tabelle) und im Fehlerfall auf `failed` mit `error_class` gesetzt. Die halb angewandte Änderung ist damit nachweisbar, aber nicht zurückgenommen — Aufräumen bleibt Handarbeit.
- Der Audit-Eintrag meldete `plan.updated.length` statt `appliedUpdatedCount`, also mehr Änderungen, als tatsächlich geschrieben wurden.
- Eine bereits dauerhaft ignorierte Konfliktkennung liess die zweite Auflösung in einen 500 laufen (der Teilindex greift nur für `ignore_permanently`, zwei Läufe können denselben Fingerabdruck je einmal als `pending` anlegen). Jetzt `409 fingerprint_already_ignored`.

**Weitere Funde**

- **XLSX-Kopfzeile an `rowNumber === 1` gebunden**: `eachRow({ includeEmpty: false })` überspringt leere Zeilen, der Callback wird bei einer Datei mit Leerzeile oder Titelzeile oben also nie mit `rowNumber === 1` aufgerufen. `headers` blieb leer und **jeder** Datensatz ein leeres Objekt — ohne Fehlermeldung. Die Kopfzeile ist jetzt die erste gelieferte Zeile.
- **`z.coerce.boolean()` ist `Boolean(value)`**, und damit ist jeder nicht-leere String wahr: `?isMinor=false` lieferte genau die Minderjährigen, die es ausschliessen sollte. Jetzt `z.stringbool()`. Die Oberfläche sendet den Parameter nur bei aktivem Filter, der Fehler war also latent, aber im Vertrag echt.
- **`/verzeichnis`** bot beim Bearbeiten „Keine Abteilung“ auch ohne vereinsweites Recht an — die API antwortet darauf mit 403. Die Option ist jetzt wie im Anlegen-Formular an `canReadOrgWide` gebunden.
- **`uuid` <11.1.1** (GHSA-w5hq-g745-h8pq) über `exceljs`. Die Stelle ist nicht erreichbar (`exceljs` ruft nur `v4()` ohne `buf` auf, und wir schreiben nie Arbeitsmappen), per Override in `pnpm-workspace.yaml` trotzdem angehoben, damit ein echter Fund künftig nicht im Rauschen untergeht. **Achtung**: seit pnpm 11 werden `pnpm.overrides` in `package.json` ignoriert — der Ort ist `pnpm-workspace.yaml`.
- **pgTAP**: `integration_sync_runs` und `integration_sync_conflicts` waren nur auf `relforcerowsecurity` geprüft, ohne einen einzigen Sichtbarkeitstest. Je ein positiver und ein negativer Fall ergänzt (353 statt 349 Tests).

**Bewusst nicht übernommen**

- CodeRabbits Vorschlag, in `localUpdatedAtOf` das Maximum aus `sourceUpdatedAt` und `updatedAt` zu bilden. Der generische `set_updated_at`-Trigger hebt `updated_at` bei jedem Sync-Schreibvorgang selbst an — jeder Datensatz gälte nach dem ersten Lauf dauerhaft als „lokal neuer“ und würde nie wieder aktualisiert. Der gemeinte Fall (manuelle Korrektur nach einem Sync) ist bereits dadurch abgedeckt, dass `PATCH /v1/directory-people/:id` bei jeder sync-relevanten Änderung `source_updated_at` neu setzt.
- **Idempotenz und Sperre gegen gleichzeitige `apply`-Läufe** (CodeRabbit, berechtigt). Zwei parallele Läufe auf derselben Quelle oder eine Wiederholung nach einem Timeout sind heute nicht ausgeschlossen. Das ist eine Design-Entscheidung, kein Review-Fix: `POST /v1/integration-sources/:id/sync` führt `apply` schon heute synchron in der API aus, `sync_cron` wird denselben Schreibpfad später zusätzlich aufrufen — eine Sperre nur für `sync_cron` würde die parallelen oder wiederholten API-Läufe von heute nicht schließen. Die Sperre gehört deshalb auf den gemeinsamen Schreibpfad, nicht auf einen der beiden Aufrufer; eine fachliche Folgearbeit, die den technischen Unterbau aus Paket 004 nutzen kann. Als bekannte Grenze in ADR-009 festgehalten statt still zu bleiben.
- **Automatische Reaktivierung einer stillgelegten Person.** Taucht jemand mit Status `left` in einer späteren Datei wieder auf, ohne dass die Quelle eine Statusspalte liefert, bleibt der Status stehen — die Quelle sagt dazu nichts. Vor und nach diesem Review gleich; jetzt ausdrücklich in ADR-009 benannt, weil es beim Lesen des Abgleichs wie ein Fehler aussieht und keiner ist.
