# 052 – PlayerBoard-Modul: Trainings, Punkte, Rangliste und Trainingsfotos

## Ergebnis

Trainerinnen und Trainer erfassen nach dem Training auf dem Handy Punkte je Spieler und je konfigurierbarer Kategorie (z. B. Trainingsleistung, Fairness, Anwesenheit). Spielerinnen und Spieler sehen die Trainings und die Rangliste ihrer Mannschaft. Ein Verein oder eine Abteilung kann Kategorien und die Saison vorgeben, die alle Mannschaften darunter übernehmen müssen, sofern die obere Ebene das Übersteuern nicht ausdrücklich freigibt. Eine Mannschaft kann ihre Rangliste ohne Namen öffentlich zeigen, wenn Verein und Abteilung das erlauben.

Das ist der fachliche Umfang der bisher eigenständigen Anwendung `haexhub/playerboard` (Features 001, 002 teilweise, 006, 015) als Modul `playerboard` innerhalb von Vereinsfunk. Die Veo-Anbindung folgt in Paket 053.

**Betreiberentscheidung 2026-10-05:** playerboard wird nicht migriert, sondern hier neu aufgebaut. Die bestehende playerboard-Datenbank enthält keine relevanten Nutzerdaten; es gibt keinen Datenumzug.

## Ausgangslage und Evidenz

Geplant auf `e3fb52d` am 2026-10-05, gegen playerboard `66f3879` (Release 0.5.0).

- **Voraussetzung**: Paket 051 (Modulrahmen) — `public.app_module` mit Wert `playerboard`, `authz.module_enabled`, `permissionModule`, modulfähige Navigation.
- playerboard ist eine Nuxt-App mit direktem Supabase-Zugriff aus dem Browser und Nitro-Serverrouten, Schema über Drizzle. Mandant ist dort ausschließlich das Team (`teams` + `memberships(role: trainer|player)`, RLS über `public.is_member(team_id)`/`public.is_trainer(team_id)`).
- Vereinsfunk besitzt für fast jede playerboard-Tabelle bereits einen Rahmen-Gegenpart:

| playerboard | Vereinsfunk | Entscheidung |
|---|---|---|
| `teams` | `teams` (unter `departments`) | wiederverwendet |
| `memberships` (trainer/player) | `team_memberships` | `team_manager` = Trainer, neue Team-Rolle `player` |
| `invitations` (+ `player_id`) | `invitations` | um `directory_person_id` erweitert |
| `user_profiles` (Name, Avatar) | `profiles` (`display_name`, `avatar_path`) | wiederverwendet |
| `players` | `directory_people` + neuer Kader-Eintrag | siehe „Spieler sind Verzeichnispersonen“ |
| `players.photo_consent` | `consent_records` (Zweck `internal`, Kontext `training`) | wiederverwendet |
| `teams.timezone` | `organizations.timezone` | wiederverwendet (Zeitzone je Verein reicht) |
| `team_settings.season_start` | — | neu, vererbbar |
| `point_categories`, `trainings`, `point_entries`, `training_photos` | — | neu, mandantenfähig |
| `get_public_ranking(slug)` | Muster: öffentliches Impressum `GET /v1/organizations/:id/imprint` | neu über die API |
| `pending_account_deletions`, Letzter-Trainer-Schutz, Profilmoderation | Kontolöschung/`prevent_last_owner_removal` des Rahmens | **nicht übernommen**, siehe unten |

- Beide Oberflächen nutzen Nuxt 4, Tailwind 4 und `reka-ui`; playerboards Komponenten (insbesondere die mobile Punkteeingabe `trainings/[id].vue`) lassen sich übernehmen, ihr Datenzugriff muss aber auf `useApiClient` umgestellt werden.
- Betroffenenanfragen (Paket 020) adressieren eine Person über `data_subject_requests.directory_person_id`.

## Fachliches Modell

### Spieler sind Verzeichnispersonen

Ein Kader-Eintrag (`playerboard_players`) verweist **zwingend** auf eine `directory_people`-Zeile und trägt nur die PlayerBoard-eigenen Angaben (Rückennummer, Position, aktiv). Name, Geburtsjahr, Minderjährigkeit, Erziehungsberechtigte und Kontoverknüpfung (`profile_id`) bleiben im Verzeichnis.

Begründung, warum nicht ein freier Namenseintrag wie in playerboard:

- Eine Auskunfts- oder Löschanfrage über `directory_person_id` muss Punkte und Fotos eines Kindes finden. Ein zweites Personenregister im Modul wäre für Betroffenenanfragen unsichtbar.
- Aufbewahrung (Paket 020) und Austritt (`directory_people.left_at`, `consentExpiresOnLeave`) wirken dann ohne Zusatzlogik.
- Ein Verein pflegt seine Mitglieder einmal; der Import aus dem Integrationsrahmen (014) füllt auch den PlayerBoard-Kader.

### Keine Pflicht zur Eltern-E-Mail

**Betreiberentscheidung 2026-10-05:** Wer einem Verein beitritt, hat die Erlaubnis der Eltern. Die Einwilligung zu Fotos geben die Eltern beim Eintritt ab oder eben nicht. Das reicht. Eine Eltern-E-Mail ist deshalb keine Voraussetzung mehr dafür, eine minderjährige Person aktiv im Verzeichnis zu führen.

Das ändert den Rahmen, nicht nur das Modul, und gehört deshalb in PR 1 dieses Pakets:

- Check `not is_minor or guardian_email is not null or status <> 'active'` auf `directory_people` entfernen (`2026080703_integration_framework.sql:188`).
- `recompute_directory_minor_status()` darf danach in beide Richtungen schreiben; die Begründung im Kommentar (`:203-211`) entfällt mit dem Check.
- Personen-Import (`apps/api/src/services/sync/people.ts:124`, `:186`): kein `invalid_record`-Konflikt mehr für fehlende `guardianEmail`.
- Filter `missingGuardian` in `GET …/directory` und die Anzeige „Keine E-Mail hinterlegt“ auf `/verzeichnis` entfernen.
- `guardian_name`/`guardian_email` bleiben als freiwillige Felder mit ihren Spaltenrechten bestehen.

Die Einwilligung bei Eintritt wird als `consent_records` mit `origin = 'paper'` und `signer_role = 'guardian'` erfasst. Diesen Weg gibt es schon (Paket 015), er braucht keine E-Mail-Adresse. Die Regel, dass bei Minderjährigen die Erziehungsberechtigten unterschreiben, bleibt unverändert.

### Keine Elternkonten

**Betreiberentscheidung 2026-10-05:** Es gibt keine Elternkonten. Ein Konto gehört der Person im Kader (`directory_people.profile_id`); eine Einladung geht an diese Person.

### Rollen und Rechte

Neue Permissions, alle dem Modul `playerboard` zugeordnet:

| Permission | Bedeutung |
|---|---|
| `training.view` | gespeicherte Trainings, Punkte und Rangliste der Mannschaft sehen |
| `training.manage` | Kader pflegen, Trainings anlegen, Punkte erfassen, Fotos hochladen |
| `playerboard.manage` | Kategorien und PlayerBoard-Einstellungen der eigenen Ebene verwalten, öffentliche Rangliste schalten |

| Rolle | erhält |
|---|---|
| neue Team-Rolle `player` (Rang 5) | `training.view` |
| `team_manager` | `training.view`, `training.manage`, `playerboard.manage` (nur Team-Ebene wirksam) |
| `department_admin` | alle drei |
| `organization_owner`/`organization_admin` | automatisch (bestehende Regel) |

Durch die bestehende Kaskade `has_team_permission → has_department_permission → has_organization_permission` sehen Abteilungs- und Vereinsadmins PlayerBoard-Daten aller Mannschaften darunter. Das ist im Vereinsbetrieb gewollt (Jugendleitung).

### Sichtbarkeit der Werte

**Betreiberentscheidung 2026-10-05:** Punkte und Veo-Werte sind nichts Geheimes. Innerhalb der Mannschaft sieht jeder mit `training.view` die **gespeicherten** Trainings (`status = 'saved'`) samt aller Punkte aller Spieler, dazu Rangliste und Veo-Werte (Paket 053). Entwürfe sieht nur, wer `training.manage` hat.

Ob die Werte einer Mannschaft **darüber hinaus** sichtbar sind, legt die Hierarchie über `stats_visibility` fest:

| Wert | Wer sieht Punkte, Rangliste und Veo-Werte der Mannschaft |
|---|---|
| `team` (Standard) | nur die Mannschaft selbst, plus Admins über die Rechte-Kaskade |
| `department` | zusätzlich jedes Mitglied irgendeiner Ebene in derselben Abteilung |
| `organization` | zusätzlich jedes Vereinsmitglied (`authz.is_any_member_of_organization`, Paket 023) |

Der Wert vererbt sich nach der Regel unten. Setzt der Verein `organization`, ist das für alle Mannschaften verbindlich, es sei denn, er gibt das Feld frei. Dann kann eine Abteilung oder Mannschaft enger oder weiter wählen.

Nicht betroffen sind Trainingsnotizen und Trainingsfotos. Sie bleiben mannschaftsintern, weil sie keine Kennzahlen sind. Die öffentliche Rangliste für Menschen ohne Konto ist davon getrennt (siehe unten).

### Vererbung: Vorgabe von oben, Übersteuern nur mit Freigabe

Zwei Regelarten, beide bereits im Projekt etabliert:

| Feld | Art | Regel |
|---|---|---|
| `season_start`, `stats_visibility` | **ersetzbar** (Muster `resolveBrand`) | Ein auf einer Ebene gesetzter Wert ist für alle Ebenen darunter verbindlich, **es sei denn**, die Ebene gibt das Feld über `overridable_fields` frei. Eine Freigabe reicht nur eine Ebene tief: Die Abteilung kann ein vom Verein freigegebenes Feld für ihre Mannschaften wieder sperren, aber kein vom Verein gesperrtes freigeben. |
| `team_categories_allowed` | **nur verschärfen** (Muster `resolve_policy_flag`) | `true → false`, nie zurück. `null` = erben, Standard `true`. |
| `public_ranking_allowed` | **nur verschärfen** | wie oben, Standard `true`. Schützt Daten Minderjähriger: Ein Verein, der keine öffentlichen Ranglisten will, wird von keiner Mannschaft unterlaufen. |

**Abweichung von `resolveBrand`, bewusst:** Dort ist ein Feld frei, bis die obere Ebene es sperrt (`lockedFields`). Hier ist ein gesetztes Feld gesperrt, bis die obere Ebene es freigibt (`overridable_fields`). Für Vorgaben wie „Saisonbeginn 1. Juli für den ganzen Verein“ ist verbindlich der erwartbare Normalfall; eine Freigabe ist die Ausnahme, die jemand bewusst trifft.

### Kategorien

Punktekategorien gibt es auf jeder Ebene. Die wirksamen Kategorien einer Mannschaft sind:

```text
aktive Kategorien des Vereins ∪ der Abteilung ∪ der Mannschaft (letztere nur, wenn team_categories_allowed)
```

Vorgegebene Kategorien kann eine Mannschaft **nicht** ausblenden — das ist der Sinn der Vorgabe (vergleichbare Ranglisten über die Jugendmannschaften einer Abteilung). Deaktiviert die Abteilung eine Kategorie, verschwindet sie für neue Trainings aller Mannschaften; vorhandene Punkte bleiben und werden in der Rangliste weiter gezählt, solange der Zeitraum sie enthält (Verhalten wie in playerboard).

### Trainingsfotos

Fotos sind mannschaftsintern und gehen **nicht** durch die Medien-Pipeline des Social-Media-Moduls (kein Gesichtsscan, keine Derivate). Eigener privater Bucket `playerboard-training-photos`, Pfad `{organization_id}/{team_id}/{training_id}/{uuid}`, Lesezugriff mit `training.view` auf gespeicherte Trainings.

Einwilligung: Für jede aktive Person im Kader ohne gültigen `consent_records`-Eintrag mit Zweck `internal` und Kontext `training` zeigt die Trainingsseite einen Hinweis. Der Upload wird nicht blockiert, weil ein Mannschaftsfoto keiner Person automatisch zugeordnet ist. Ein Trainingsfoto als Beitrag zu veröffentlichen ist ein modulübergreifender Ablauf und **nicht** Teil dieses Pakets.

### Öffentliche Rangliste

Wie playerboard-Vertrag `public-ranking.md`: Rang, Rückennummer und Summe je Kategorie, nie Namen, Positionen, IDs oder Fotos. URL `/rangliste/{vereins-slug}/{public_slug}`. Ausgeliefert über einen anonymen API-Endpunkt mit Service-Rolle und einer `security definer`-Funktion, die nur aggregierte Werte zurückgibt (Muster öffentliches Impressum, Paket 020).

## Datenmodell

Migration `<datum>_playerboard_core.sql`. Alle Tabellen tragen `organization_id`, zusammengesetzte Fremdschlüssel und RLS mit `authz.module_enabled(…, 'playerboard')` **und** der passenden Permission.

```sql
-- Eigene, vorgelagerte Migration: ein per ADD VALUE ergänzter Enum-Wert ist erst nach
-- dem Commit verwendbar, die Kernmigration darf ihn also nicht in derselben Transaktion nutzen.
alter type public.team_role add value 'player';

create table public.playerboard_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid, team_id uuid,
  season_start date,                                   -- null = erben
  stats_visibility text
    check (stats_visibility in ('team', 'department', 'organization')),  -- null = erben, ganz oben: 'team'
  overridable_fields text[] not null default '{}'
    check (overridable_fields <@ array['season_start', 'stats_visibility']),
  team_categories_allowed boolean,                     -- null = erben
  public_ranking_allowed boolean,                      -- null = erben
  public_ranking_enabled boolean,                      -- nur scope = 'team'
  public_slug text check (public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Scope-Check, Unique-Indizes je Ebene und Fremdschlüssel wie policy_settings (Paket 023)
  check (scope = 'team' or (public_ranking_enabled is null and public_slug is null)),
  unique (organization_id, public_slug)
);

create table public.playerboard_players (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, department_id uuid not null, team_id uuid not null,
  directory_person_id uuid not null,
  jersey_number integer check (jersey_number between 0 and 99),
  position text check (char_length(position) <= 40),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (team_id, directory_person_id),
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade,
  -- Löschung einer Verzeichnisperson (Betroffenenanfrage) nimmt Kader, Punkte und
  -- Zuordnungen mit.
  foreign key (organization_id, directory_person_id)
    references public.directory_people(organization_id, id) on delete cascade
);

create table public.playerboard_point_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  scope public.policy_scope not null,
  department_id uuid, team_id uuid,
  name text not null check (char_length(name) between 1 and 60),
  active boolean not null default true,
  sort_order integer not null,
  value_min integer not null, value_max integer not null,
  check (value_min < value_max),
  -- Scope-Check und Fremdschlüssel wie playerboard_settings
  unique (organization_id, id)
);

create table public.playerboard_trainings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, department_id uuid not null, team_id uuid not null,
  training_date date not null,                         -- Trigger: nicht in der Zukunft (organizations.timezone)
  title text check (char_length(title) <= 120),
  note text check (char_length(note) <= 2000),
  status text not null default 'draft' check (status in ('draft', 'saved')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
  -- Fremdschlüssel auf teams wie oben
);

create table public.playerboard_point_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  training_id uuid not null, player_id uuid not null, category_id uuid not null,
  value integer not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (training_id, player_id, category_id)
  -- Trigger: Spieler gehört zur Mannschaft des Trainings, Kategorie ist für diese
  -- Mannschaft wirksam, value liegt in [value_min, value_max]
  -- (Gegenstück zu enforce_point_entry_team_consistency aus playerboard).
);

create table public.playerboard_training_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, training_id uuid not null,
  storage_path text not null unique,
  content_type text not null, size_bytes integer not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

alter table public.invitations add column directory_person_id uuid;
-- accept_invitation(): bei gesetzter directory_person_id und Rolle 'player'
-- directory_people.profile_id setzen (nur wenn null) und Team-Mitgliedschaft anlegen.
```

Funktionen:

- `authz.playerboard_setting(org, dept, team, field)`: löst beide Regelarten auf. Eine Funktion statt je Feld, mit `raise exception` bei unbekanntem Feld (Muster `resolve_policy_flag`).
- `authz.can_view_playerboard_stats(team_id)`: `training.view` auf die Mannschaft **oder** wirksame `stats_visibility` = `department` und Mitglied der Abteilung bzw. einer ihrer Mannschaften **oder** = `organization` und `is_any_member_of_organization`. Wird in den Lese-Policies von `playerboard_point_entries`, gespeicherten `playerboard_trainings` (nur Datum, Titel, Status; Notiz und Fotos weiter nur mit `training.view`), `playerboard_players` (Rückennummer und Name über das Verzeichnis) und den Veo-Tabellen aus 053 verwendet, jeweils zusammen mit `module_enabled`.
- `public.playerboard_effective_categories(team_id)`: wirksame Kategorien nach obiger Regel.
- `public.playerboard_team_ranking(team_id, from, to)`: `security invoker`, Rangliste für Berechtigte.
- `public.playerboard_public_ranking(org_slug, public_slug, from, to)`: `security definer`, nur Aggregate, prüft `public_ranking_enabled` **und** `public_ranking_allowed` **und** `module_enabled`; nur `service_role` darf sie ausführen.

Speicherverbrauch der Fotos zählt auf das Speicherkontingent des Vereins (Paket 021).

## Umsetzung

### PR 1 – Schema, RLS, pgTAP

Vorab die Rahmenänderung „Keine Pflicht zur Eltern-E-Mail“ (eigene Migration, plus Import, Verzeichnis-API und `/verzeichnis`; pgTAP: aktive minderjährige Person ohne `guardian_email` ist gültig, `recompute_directory_minor_status` schreibt in beide Richtungen). Danach die Migration wie oben, Bucket mit Policies, Trigger. pgTAP mit positiven **und** negativen Isolationstests (AGENTS.md):

- fremder Verein, fremde Mannschaft derselben Abteilung, Modul aus (Verein, Abteilung, Mannschaft je einzeln)
- `player` sieht keine Entwürfe, kann nichts schreiben, sieht aber alle Punkte der eigenen Mannschaft
- `stats_visibility`: Spieler einer Nachbarmannschaft sieht bei `team` nichts, bei `department` Punkte, aber keine Trainingsnotizen oder Fotos; Mitglied einer anderen Abteilung sieht erst bei `organization` etwas; vom Verein verbindlich gesetztes `organization` ist von der Mannschaft nicht zu verengen, nach Freigabe schon
- Punkte mit Spieler einer anderen Mannschaft oder nicht wirksamer Kategorie werden abgelehnt
- Vererbung: Saisonbeginn verbindlich/freigegeben/von der Abteilung wieder gesperrt; `team_categories_allowed = false` auf Vereinsebene schlägt `true` darunter
- Öffentliche Rangliste liefert nichts, wenn eine der drei Bedingungen fehlt, und nie Namen oder IDs

### PR 2 – Domain, Verträge, API

- `packages/domain/src/playerboard.ts`: `resolvePlayerboardSettings`, `effectiveCategories` (TS-Spiegel der SQL-Funktionen, für die Oberflächenzustände geerbt/eigener Wert/gesperrt), Rangberechnung mit geteilten Rängen (1, 2, 2, 4).
- `packages/authorization`: drei Permissions, Rolle `player`, `roleRank` und `authz.role_rank` gemeinsam anpassen (bestehende Regel).
- `apps/api/src/routes/playerboard/`: `players.ts`, `categories.ts`, `trainings.ts`, `pointEntries.ts` (Bulk-Upsert je Training, wie die mobile Eingabe speichert), `photos.ts` (signierte Upload- und Lese-URLs), `ranking.ts`, `settings.ts`, `public.ts` (anonym).
- Einladung mit `directoryPersonId` in `POST /v1/invitations` (ersetzt playerboards vereinheitlichten Einladungsdialog aus Feature 015).

### PR 3 – Oberfläche Trainer

Seiten unter `/playerboard/` im Modul-Registry aus 051, Mannschaft aus dem aktiven Scope (`useActiveScope`); auf Abteilungs- oder Vereinsebene zuerst eine Mannschaftsauswahl.

- `/playerboard/kader`: aus dem Verzeichnis der Mannschaft hinzufügen, Rückennummer und Position, Einladung an den Spieler bzw. die Spielerin
- `/playerboard/trainings`, `/playerboard/trainings/neu`, `/playerboard/trainings/[id]`: mobile Punkteeingabe aus playerboard übernehmen (Zielgruppe ist der Platzrand: ≥ 44 px Touchziele, 360 px Breite), Fotos, Einwilligungshinweis
- `/playerboard/kategorien`: eigene und geerbte Kategorien, geerbte schreibgeschützt mit Herkunftsebene
- `/playerboard/einstellungen`: Saisonbeginn, Sichtbarkeit der Werte (`stats_visibility`), Freigaben, öffentliche Rangliste — Zustände **geerbt**, **eigener Wert**, **gesperrt** wie `PolicyFlagToggles.vue`

### PR 4 – Spieleransicht, Rangliste, Übersicht

- `/playerboard` und `/playerboard/rangliste` für `player` und Trainer, Zeitraumfilter (Saison, Monat, frei)
- öffentliche Seite `/rangliste/[orgSlug]/[teamSlug]` im `auth`-Layout, mit Vereinsmarke aus `resolveBrand`
- PlayerBoard-Kachel auf der Übersicht (`index.vue`), eingehängt über das Modul-Registry

## Bewusst nicht übernommen

- **Eigene Anmeldung, Team-Anlage, Onboarding, Profilseite**: Das übernimmt der Rahmen.
- **Letzter-Trainer-Schutz** (`last_trainer_guard`): In Vereinsfunk verwaltet die Abteilung eine Mannschaft auch ohne `team_manager`; eine Mannschaft ohne Trainer ist kein gesperrter Zustand.
- **Profilmoderation durch Trainer** (playerboard 002, `profile/moderate`): Rahmenfunktion, falls gebraucht als eigenes Paket für alle Module.
- **Eigene Zeitzone je Mannschaft**: Die Zeitzone des Vereins reicht.

## Verifikation

- pgTAP wie unter PR 1, nach frischem `supabase db reset`.
- API-Tests je Route inklusive `403 module_disabled` und `403 forbidden` für `player` auf Schreibrouten.
- Playwright auf 360 px Breite: Training anlegen, Punkte für zehn Spieler erfassen, speichern, als `player` Rangliste prüfen, öffentliche Rangliste ohne Anmeldung aufrufen und auf das Fehlen von Namen prüfen.
- `pnpm lint`, `typecheck`, `test`, `build`, `db:test` grün.

## Risiken und offene Entscheidungen

- **Wer legt Verzeichnispersonen an?** Heute hat `team_manager` nur `directory.read`. Ohne Schreibrecht kann ein Trainer seinen Kader nicht selbst aufbauen, bis die Abteilung oder ein Import die Personen anlegt. Empfehlung: neues Recht `directory.write` für `team_manager`, beschränkt auf Personen der eigenen Mannschaft. Seit dem Wegfall der Eltern-E-Mail-Pflicht reichen dafür Name, Geburtsjahr und Mannschaft.
- **Bewertungsdaten von Kindern in der Verarbeitungsdokumentation.** Punkte und Veo-Werte sind bewusst offen (siehe „Sichtbarkeit der Werte“). Sie gehören trotzdem als eigene Verarbeitung mit Zweck „Trainingsbewertung und Spielanalyse“ in die Verarbeitungsdokumentation (Paket 020), samt der gewählten `stats_visibility`.
- **`team_manager` als einzige Trainerrolle.** Wer nur Punkte erfassen, aber keine Beiträge schreiben soll (Co-Trainer), bekommt dieselbe Rolle. Bei Bedarf später eine Team-Rolle `coach` mit nur `training.*`.

Entschieden (Betreiber, 2026-10-05): keine Pflicht zur Eltern-E-Mail, keine Elternkonten, Punkte und Veo-Werte innerhalb der Mannschaft für alle sichtbar, Sichtbarkeit darüber hinaus je Ebene über `stats_visibility`.
