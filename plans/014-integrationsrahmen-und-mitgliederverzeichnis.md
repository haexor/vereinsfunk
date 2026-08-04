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
- `packages/domain/src/index.ts:99-117` `evaluateMediaGate` prüft `consentValid` als von außen gelieferten Wert. Wer ihn bestimmt, ist bisher offen.
- `public.teams` (`202608020001:52-62`) trägt keine Herkunftsinformation. Eine Mannschaft ist heute ausschließlich manuell anlegbar.
- Es gibt **keine Tabelle für Personen**, keinen Import, keine Quellenverwaltung, keinen Provider und keine Synchronisation im Code.
- `packages/contracts/src/index.ts:135` `WorkflowNameSchema` kennt keinen Sync-Workflow.

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

/** Transport: woher kommen rohe Datensätze? */
export interface SourceTransport {
  readonly kind: 'file' | 'http' | 'ical' | 'webhook'
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

Migration `2026080407_integration_framework.sql`:

```sql
create type public.integration_domain as enum ('people','teams','fixtures','events');
create type public.integration_transport as enum ('manual','file','http','ical','webhook');

create table public.integration_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transport public.integration_transport not null,
  provider_key text not null,                    -- 'csv','ical','easyverein', …
  display_name text not null,
  enabled_domains public.integration_domain[] not null
    check (array_length(enabled_domains, 1) between 1 and 4),
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
  domain public.integration_domain not null,
  external_id text, local_id uuid, label text not null,
  field text not null, current_value text, incoming_value text,
  kind text not null check (kind in ('ambiguous_match','unknown_structure','value_conflict','invalid_record')),
  resolution text not null default 'pending'
    check (resolution in ('pending','keep_current','take_incoming','ignore_permanently')),
  resolved_by uuid references public.profiles(id), resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, sync_run_id)
    references public.integration_sync_runs(organization_id, id) on delete cascade
);
```

`label` in der Konfliktzeile statt eines Verweises auf den Zieldatensatz: ein Konflikt muss auch dann verständlich bleiben, wenn der zugehörige Datensatz noch nicht existiert. `ignore_permanently` verhindert, dass derselbe Konflikt bei jedem Lauf erneut erscheint.

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
  foreign key (organization_id, department_id) references public.departments(organization_id, id) on delete set null,
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete set null,
  foreign key (organization_id, source_id) references public.integration_sources(organization_id, id) on delete set null,
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
- `integration_sources.credentials_secret_id` ist für `authenticated` nie lesbar; Zugangsdaten liegen verschlüsselt über `packages/secrets` (Paket 012).

## Umsetzung

### 1. Transporte

- **Datei (CSV/XLSX)** — funktioniert bei jedem Verein sofort, weil jedes System exportieren kann. Spaltenzuordnung in der Oberfläche, gespeichert in `field_mapping`, damit der nächste Import ohne erneutes Zuordnen läuft.
- **iCal** — der pragmatische Universaladapter für Termine. Viele Verbands- und Mannschaftssysteme bieten einen Kalender-Feed, auch wenn sie keine API haben. Wird primär von Paket 019 gebraucht, entsteht aber hier, weil er zum Rahmen gehört.
- **HTTP-API** — ein Adapter nach dokumentiertem Spike in `docs/evidence/integration-spike.md`. Je Kandidat zu beantworten: dokumentierte API, Authentifizierung, Ratenlimits, welche Bereiche geliefert werden, Auftragsverarbeitungsvertrag möglich, Kosten, Stabilitätszusage. Kandidaten im deutschen Markt sind unter anderem easyVerein, Vereinsflieger, SpielerPlus, ClubDesk, Campai, Kurabu, WISO MeinVerein und SAMS.
- **Webhook** ist als Transportart im Enum vorgesehen und wird in diesem Paket **nicht** implementiert. Er braucht Signaturprüfung und eine öffentliche Route und ist erst sinnvoll, wenn ein Anbieter ihn anbietet.

Ehrliche Erwartung, die im Plan stehen soll: die meisten dieser Systeme haben keine offene, dokumentierte API für Vereine. Datei-Import und iCal bleiben auf absehbare Zeit die Hauptwege, und das ist kein Notbehelf — ein zuverlässiger Import mit Trockenlauf ist besser als eine brüchige Integration.

**Wichtige Abgrenzung:** Das Auslesen von Verbandsportalen wie fussball.de oder nuLiga per Scraping kommt nicht in Betracht. Angeboten wird ausschließlich, was ein Anbieter als Export oder Feed bereitstellt.

### 2. Ausführung

Hatchet-Workflow `sync-integration-source` mit Fairness-Key `organizationId`, weil ein API-Sync langsam und ratenlimitiert sein kann. Der Name muss in `WorkflowNameSchema` (`packages/contracts/src/index.ts:135`) ergänzt werden. Die Nachricht enthält nur `sourceId`, `domain`, `mode` und `correlationId` — keine Fachdaten, entsprechend `ADR-002`.

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

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- `planSync`-Tests, bereichsunabhängig: neuer Datensatz; geändertes Feld; fehlender Datensatz wird stillgelegt; uneindeutiger Treffer erzeugt Konflikt statt Zuordnung; Abbruch über der Verlustschwelle; lokale Änderung gewinnt gegen ältere Quelle; unbekannte Struktur erzeugt Konflikt; `ignore_permanently` unterdrückt den Konflikt beim nächsten Lauf.
- Datenminimierungstest: CSV mit IBAN-, Adress- und Geschlechtsspalte → keines dieser Felder erscheint in der Datenbank, in einer API-Antwort oder in einem Log. Dieser Test ist die Zusage in ausführbarer Form.
- pgTAP: aktive minderjährige Person ohne Elternkontakt verstößt gegen CHECK; `contributor` liest keine Zeile aus `directory_people`; `editor` liest die Person, aber nicht `guardian_email`; Person mit Einwilligung ist per Sync nicht löschbar; Quelle und Verzeichnis eines fremden Vereins sind unsichtbar; `credentials_secret_id` ist für `authenticated` nicht lesbar.
- manuell: CSV mit 50 Personen importieren, Trockenlauf prüfen, übernehmen; zweiter Import mit drei Änderungen und einem Austritt zeigt genau diese vier Unterschiede; Import mit halbierter Datei wird abgewiesen.

## Risiken und offene Entscheidungen

- **Auftragsverarbeitung**: Der Verein bleibt Verantwortlicher, wir werden Auftragsverarbeiter. Ein AVV mit dem Verein ist Betriebsvoraussetzung, und der Verein braucht eine Rechtsgrundlage für die Übermittlung aus dem Quellsystem. Paket 020 verwaltet diese Dokumente; produktiv gehen kann dieses Paket erst danach. Für Entwicklung mit synthetischen Daten gilt das nicht.
- **Geburtsjahr statt Geburtsdatum** lässt offen, wie das Jahr des 18. Geburtstags behandelt wird. Empfehlung: das ganze Jahr als minderjährig behandeln und im Zweifel die strengere Freigaberoute nehmen. Diese Entscheidung sollte ausdrücklich getroffen werden.
- **Klarnamen neben Gesichtsregionen** bleiben ein Risikoprofil, das das System vorher nicht hatte. Das ADR muss benennen, was ausdrücklich nicht getan wird, und die Löschfristen müssen kurz sein.
- **Adapterpflege**: jede API-Integration ist dauerhafte Wartungslast an einem fremden System ohne Stabilitätszusage. Der Rahmen senkt die Kosten pro Adapter erheblich, macht sie aber nicht null. Vorschlag: höchstens zwei HTTP-Adapter gleichzeitig aktiv pflegen, alles Weitere über Datei und iCal — und diese Grenze als Produktentscheidung festhalten.
- **Automatische Übernahme** ist bewusst eingeschränkt. Ein Verein, der täglich synchronisiert und nie Konflikte anschaut, wird sich über stillgelegte Personen wundern. Die Benachrichtigung bei offenen Konflikten ist deshalb Teil des Pakets, nicht Zierde.
