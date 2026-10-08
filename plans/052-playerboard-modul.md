# 052 – PlayerBoard-Modul: Trainings, Punkte, Rangliste und Trainingsfotos

## Ergebnis

Trainerinnen und Trainer erfassen nach dem Training auf dem Handy Punkte je Spieler und je konfigurierbarer Kategorie (z. B. Trainingsleistung, Fairness, Anwesenheit). Spielerinnen und Spieler sehen die Trainings und die Rangliste ihrer Mannschaft. Ein Verein oder eine Abteilung kann Kategorien und die Saison vorgeben, die alle Mannschaften darunter übernehmen müssen, sofern die obere Ebene das Übersteuern nicht ausdrücklich freigibt. Eine Mannschaft kann ihre Punkte und Veo-Werte öffentlich zeigen, mit Spielern nur als Rückennummer und Initialen, auf Wunsch auch die Trainingsfotos, wenn Verein und Abteilung das erlauben.

Das ist der fachliche Umfang der bisher eigenständigen Anwendung `haexhub/playerboard` (Features 001, 002 teilweise, 006, 015) als Modul `playerboard` innerhalb von Vereinsfunk. Die Veo-Anbindung folgt in Paket 053.

**Betreiberentscheidung 2026-10-05:** playerboard wird nicht migriert, sondern hier neu aufgebaut. Die bestehende playerboard-Datenbank enthält keine relevanten Nutzerdaten; es gibt keinen Datenumzug.

## Ausgangslage und Evidenz

Geplant auf `e3fb52d` am 2026-10-05, gegen playerboard `66f3879` (Release 0.5.0).

- **Voraussetzungen**: Paket 051 (Modulrahmen) — `public.app_module` mit Wert `playerboard`, `authz.module_enabled`, `permissionModule`, modulfähige Navigation. Paket 054 (Verzeichnis ohne Elternkontakt, eigene E-Mail je Person).
- playerboard ist eine Nuxt-App mit direktem Supabase-Zugriff aus dem Browser und Nitro-Serverrouten, Schema über Drizzle. Mandant ist dort ausschließlich das Team (`teams` + `memberships(role: trainer|player)`, RLS über `public.is_member(team_id)`/`public.is_trainer(team_id)`).
- Vereinsfunk besitzt für fast jede playerboard-Tabelle bereits einen Rahmen-Gegenpart:

| playerboard | Vereinsfunk | Entscheidung |
|---|---|---|
| `teams` | `teams` (unter `departments`) | wiederverwendet |
| `memberships` (trainer/player) | `team_memberships` | `team_manager` = Trainer, neue Team-Rolle `player` |
| `invitations` (+ `player_id`) | `invitations` | um `directory_person_id` erweitert |
| `user_profiles` (Name, Avatar) | `profiles` (`display_name`, `avatar_path`) | wiederverwendet |
| `players` (+ E-Mail aus Feature 006) | `directory_people` (+ `email` aus Paket 054) + neuer Kader-Eintrag | siehe „Spieler sind Verzeichnispersonen“ |
| `players.photo_consent` | `consent_records` (Zweck `internal`, Kontext `training`) | wiederverwendet |
| `teams.timezone` | `organizations.timezone` | wiederverwendet (Zeitzone je Verein reicht) |
| `team_settings.season_start` | — | neu, vererbbar |
| `point_categories`, `trainings`, `point_entries`, `training_photos` | — | neu, mandantenfähig |
| `get_public_ranking(slug)`, öffentlicher Veo-Tab (005) | Muster: öffentliches Impressum `GET /v1/organizations/:id/imprint` | neu über die API, erweitert um Initialen und Fotos |
| `pending_account_deletions`, Letzter-Trainer-Schutz, Profilmoderation | Kontolöschung/`prevent_last_owner_removal` des Rahmens | **nicht übernommen**, siehe unten |

- Beide Oberflächen nutzen Nuxt 4, Tailwind 4 und `reka-ui`; playerboards Komponenten (insbesondere die mobile Punkteeingabe `trainings/[id].vue`) lassen sich übernehmen, ihr Datenzugriff muss aber auf `useApiClient` umgestellt werden.
- Betroffenenanfragen (Paket 020) adressieren eine Person über `data_subject_requests.directory_person_id`.

## Fachliches Modell

### Spieler sind Verzeichnispersonen

Ein Kader-Eintrag (`playerboard_players`) verweist **zwingend** auf eine `directory_people`-Zeile und trägt nur die PlayerBoard-eigenen Angaben (Rückennummer, Position, aktiv). Name, Geburtsjahr, Minderjährigkeit, E-Mail und Kontoverknüpfung (`profile_id`) bleiben im Verzeichnis.

Begründung, warum nicht ein freier Namenseintrag wie in playerboard:

- Eine Auskunfts- oder Löschanfrage über `directory_person_id` muss Punkte und Fotos eines Kindes finden. Ein zweites Personenregister im Modul wäre für Betroffenenanfragen unsichtbar.
- Aufbewahrung (Paket 020) und Austritt (`directory_people.left_at`, `consentExpiresOnLeave`) wirken dann ohne Zusatzlogik.
- Ein Verein pflegt seine Mitglieder einmal; der Import aus dem Integrationsrahmen (014) füllt auch den PlayerBoard-Kader.

### Trainer legen Spieler selbst an

**Betreiberentscheidung 2026-10-05/06:** Trainer bauen ihren Kader selbst auf. Im Kader legen sie eine Person direkt an: Vorname, Nachname, optional Geburtsjahr, Rückennummer, Position und E-Mail. Die Verzeichnisperson entsteht dabei im Hintergrund in ihrer Mannschaft. Alternativ übernehmen sie eine Person, die schon im Verzeichnis ihrer Mannschaft steht.

Dafür braucht es kein neues Recht: `POST /v1/organizations/:id/directory-people` verlangt heute `directory.read` im Ziel-Scope, und das hat `team_manager` für die eigene Mannschaft. Bisher scheiterte es nur bei aktiven Minderjährigen an der Pflicht zur Eltern-E-Mail. Die entfällt mit Paket 054.

Die E-Mail ist optional und kann jederzeit ergänzt werden. Eingeladen wird ein Spieler, wann der Trainer will: beim Anlegen, später aus dem Kader heraus oder nie. Ohne Konto taucht ein Spieler trotzdem in Punkten, Rangliste und Veo-Werten auf.

### Kein Elternkontakt, keine Elternkonten

**Betreiberentscheidung 2026-10-05/06:** Es gibt weder eine Eltern-E-Mail noch Elternkonten. Wer einem Verein beitritt, hat die Erlaubnis der Eltern. Die Einwilligung zu Fotos geben die Eltern beim Eintritt ab oder eben nicht. Erfasst wird das als `consent_records` mit `origin = 'paper'` und `signer_role = 'guardian'` (Paket 015, braucht keine E-Mail). Die Elternfelder verschwinden komplett aus dem Verzeichnis (Paket 054). Ein Konto gehört der Person im Kader (`directory_people.profile_id`); eine Einladung geht an deren eigene E-Mail.

### Rollen und Rechte

Neue Permissions, alle dem Modul `playerboard` zugeordnet:

| Permission | Bedeutung |
|---|---|
| `training.view` | gespeicherte Trainings, Punkte und Rangliste der Mannschaft sehen |
| `training.manage` | Kader pflegen, Trainings anlegen, Punkte erfassen, Fotos hochladen |
| `playerboard.manage` | Kategorien und PlayerBoard-Einstellungen der eigenen Ebene verwalten, öffentliche Mannschaftsseite schalten |

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

Nicht betroffen sind Trainingsnotizen und Trainingsfotos. Sie bleiben im Verein mannschaftsintern, weil sie keine Kennzahlen sind. Die öffentliche Mannschaftsseite für Menschen ohne Konto ist davon getrennt (siehe unten).

### Vererbung: Vorgabe von oben, Übersteuern nur mit Freigabe

Zwei Regelarten, beide bereits im Projekt etabliert:

| Feld | Art | Regel |
|---|---|---|
| `season_start`, `stats_visibility` | **ersetzbar** (Muster `resolveBrand`) | Ein auf einer Ebene gesetzter Wert ist für alle Ebenen darunter verbindlich, **es sei denn**, die Ebene gibt das Feld über `overridable_fields` frei. Eine Freigabe reicht nur eine Ebene tief: Die Abteilung kann ein vom Verein freigegebenes Feld für ihre Mannschaften wieder sperren, aber kein vom Verein gesperrtes freigeben. |
| `team_categories_allowed` | **nur verschärfen** (Muster `resolve_policy_flag`) | `true → false`, nie zurück. `null` = erben, Standard `true`. |
| `public_sharing_allowed` | **nur verschärfen** | wie oben, Standard `true`. Schützt Daten Minderjähriger: Ein Verein, der keine öffentlichen Mannschaftsseiten will, wird von keiner Mannschaft unterlaufen. |

**Abweichung von `resolveBrand`, bewusst:** Dort ist ein Feld frei, bis die obere Ebene es sperrt (`lockedFields`). Hier ist ein gesetztes Feld gesperrt, bis die obere Ebene es freigibt (`overridable_fields`). Für Vorgaben wie „Saisonbeginn 1. Juli für den ganzen Verein“ ist verbindlich der erwartbare Normalfall; eine Freigabe ist die Ausnahme, die jemand bewusst trifft.

### Kategorien

Punktekategorien gibt es auf jeder Ebene. Die wirksamen Kategorien einer Mannschaft sind:

```text
aktive Kategorien des Vereins ∪ der Abteilung ∪ der Mannschaft (letztere nur, wenn team_categories_allowed)
```

Vorgegebene Kategorien kann eine Mannschaft **nicht** ausblenden — das ist der Sinn der Vorgabe (vergleichbare Ranglisten über die Jugendmannschaften einer Abteilung). Deaktiviert die Abteilung eine Kategorie, verschwindet sie für neue Trainings aller Mannschaften; vorhandene Punkte bleiben und werden in der Rangliste weiter gezählt, solange der Zeitraum sie enthält (Verhalten wie in playerboard).

### Trainingsfotos

Fotos sind mannschaftsintern und gehen **nicht** durch die Medien-Pipeline des Social-Media-Moduls (kein Gesichtsscan, keine Derivate). Eigener privater Bucket `playerboard-training-photos`, Pfad `{organization_id}/{team_id}/{training_id}/{uuid}`, Lesezugriff mit `training.view` auf gespeicherte Trainings.

Einwilligung: Für jede aktive Person im Kader ohne gültigen `consent_records`-Eintrag mit Zweck `internal` und Kontext `training` zeigt die Trainingsseite einen Hinweis. Der Upload wird nicht blockiert, weil ein Mannschaftsfoto keiner Person automatisch zugeordnet ist. Ein Trainingsfoto als Social-Media-Beitrag zu veröffentlichen ist ein modulübergreifender Ablauf und **nicht** Teil dieses Pakets. Öffentlich sichtbar werden Fotos nur über die öffentliche Mannschaftsseite (unten).

### Öffentliche Mannschaftsseite

**Betreiberentscheidung 2026-10-06:** Punkte und Veo-Werte einer Mannschaft sollen auch ohne Anmeldung sichtbar sein können. Spieler erscheinen dort **nie mit Klarnamen**, sondern nur als Rückennummer und Initialen („#7 M. K.“). Trainingsfotos sind öffentlich, wenn der Trainer das eingestellt hat.

Der Trainer schaltet drei Teile einzeln (`playerboard.manage` auf der Mannschaft):

| Schalter | zeigt öffentlich |
|---|---|
| `public_points_enabled` | Rangliste und Summen je Kategorie im gewählten Zeitraum |
| `public_veo_stats_enabled` | Spiele mit Ergebnis, Mannschafts- und Spielerwerte aus Veo (Paket 053) |
| `public_photos_enabled` | Fotos gespeicherter Trainings, soweit nicht einzeln ausgenommen (siehe unten) |

Jeder Schalter wirkt nur, wenn `public_sharing_allowed` entlang des ganzen Pfads nicht `false` ist und das Modul aktiv ist.

Darstellung von Spielern:

- Initialen werden **in der Datenbank** gebildet (erster Buchstabe von Vor- und Nachname, „M. K.“). Klarnamen, Geburtsjahr, IDs, Positionen und E-Mail verlassen die `security definer`-Funktion nie.
- Ohne Rückennummer erscheint nur „M. K.“. Bei gleichen Initialen unterscheidet die Rückennummer. Zwei Spieler ohne Nummer mit gleichen Initialen werden bewusst nicht weiter aufgelöst.
- Trainingsnotizen sind nie öffentlich.

Fotos:

- Die Fotos werden über kurzlebige, signierte URLs ausgeliefert, die der anonyme API-Endpunkt mit Service-Rolle erzeugt (Muster Medien-Grant aus Paket 025). Der Bucket selbst bleibt privat.
- Einzelne Fotos kann der Trainer über `playerboard_training_photos.public = false` ausnehmen.
- Jedes Foto startet privat mit `consent_review_status = 'pending'`; der Upload selbst bleibt möglich. Vor einer öffentlichen Freigabe führt ein Trainer oder eine dazu berechtigte Einwilligungsprüfung einen verbindlichen Einzelbild-Review durch: Er listet jede erkennbare Person über `directory_person_id`, bestätigt ausdrücklich, dass keine weitere erkennbare Person übersehen wurde, und ordnet jeder gelisteten Person eine zum Prüfzeitpunkt gültige Einwilligung für Zweck `website` und Kontext `training` zu. Unbekannte, nicht gelistete oder nicht gültig eingewilligte erkennbare Personen blockieren die Freigabe. Erst eine transaktionale Prüfung aller Zuordnungen setzt `consent_review_status = 'approved'` und darf `public = true` setzen; der anonyme Endpunkt und die signierte URL-Ausgabe liefern ausschließlich Fotos mit diesem Status. Widerruf, Ablauf oder Ablösung einer Einwilligung setzt betroffene Fotos wieder auf `blocked` und macht sie privat. Die bloße Anzeige betroffener Spieler ohne diese Bestätigung reicht nicht aus.

URL `/mannschaft/{vereins-slug}/{public_slug}` mit Reitern Rangliste, Veo und Fotos (nur die eingeschalteten). Ausgeliefert über anonyme API-Endpunkte mit Service-Rolle und `security definer`-Funktionen, die nur `service_role` ausführen darf (Muster öffentliches Impressum, Paket 020).

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
  public_sharing_allowed boolean,                      -- null = erben
  -- nur scope = 'team':
  public_points_enabled boolean,
  public_veo_stats_enabled boolean,
  public_photos_enabled boolean,
  public_slug text check (public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Scope-Check, Unique-Indizes je Ebene und Fremdschlüssel wie policy_settings (Paket 023)
  check (scope = 'team' or (public_points_enabled is null and public_veo_stats_enabled is null
                            and public_photos_enabled is null and public_slug is null)),
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
  unique (training_id, player_id, category_id),
  foreign key (organization_id, player_id)
    references public.playerboard_players(organization_id, id) on delete cascade
  -- Trigger: Spieler gehört zur Mannschaft des Trainings, Kategorie ist für diese
  -- Mannschaft wirksam, value liegt in [value_min, value_max]
  -- (Gegenstück zu enforce_point_entry_team_consistency aus playerboard).
);

create table public.playerboard_training_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, training_id uuid not null,
  storage_path text not null unique,
  content_type text not null, size_bytes integer not null,
  public boolean not null default false,               -- wirkt nur bei public_photos_enabled und consent_review_status = 'approved'
  consent_review_status text not null default 'pending'
    check (consent_review_status in ('pending', 'approved', 'blocked')),
  all_recognizable_people_listed boolean not null default false,
  consent_reviewed_by uuid references public.profiles(id) on delete set null,
  consent_reviewed_at timestamptz,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.playerboard_training_photo_people (
  organization_id uuid not null, photo_id uuid not null, directory_person_id uuid not null,
  consent_record_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (photo_id, directory_person_id),
  foreign key (organization_id, photo_id)
    references public.playerboard_training_photos(organization_id, id) on delete cascade,
  foreign key (organization_id, directory_person_id)
    references public.directory_people(organization_id, id) on delete cascade,
  foreign key (organization_id, consent_record_id)
    references public.consent_records(organization_id, id) on delete restrict
);

alter table public.invitations add column directory_person_id uuid;
-- accept_invitation(): bei gesetzter directory_person_id und Rolle 'player'
-- directory_people.profile_id setzen (nur wenn null) und Team-Mitgliedschaft anlegen.
-- Vorbelegt wird die Einladungsadresse aus directory_people.email (Paket 054).
```

Funktionen:

- `authz.playerboard_setting(org, dept, team, field)`: löst beide Regelarten auf. Eine Funktion statt je Feld, mit `raise exception` bei unbekanntem Feld (Muster `resolve_policy_flag`).
- `authz.can_view_playerboard_stats(team_id)`: `training.view` auf die Mannschaft **oder** wirksame `stats_visibility` = `department` und Mitglied der Abteilung bzw. einer ihrer Mannschaften **oder** = `organization` und `is_any_member_of_organization`. Wird in den Lese-Policies von `playerboard_point_entries`, gespeicherten `playerboard_trainings` (nur Datum, Titel, Status; Notiz und Fotos weiter nur mit `training.view`), `playerboard_players` (Rückennummer und Name über das Verzeichnis) und den Veo-Tabellen aus 053 verwendet, jeweils zusammen mit `module_enabled`.
- `public.playerboard_effective_categories(team_id)`: wirksame Kategorien nach obiger Regel.
- `public.playerboard_team_ranking(team_id, from, to)`: `security invoker`, Rangliste für Berechtigte.
- `public.playerboard_public_label(directory_person_id, jersey_number)`: bildet „#7 M. K.“; einzige Stelle, an der öffentliche Spielerbezeichnungen entstehen.
- `public.playerboard_public_ranking(org_slug, public_slug, from, to)` und `public.playerboard_public_photos(org_slug, public_slug, from, to)`: `security definer`, prüfen den jeweiligen Schalter **und** `public_sharing_allowed` **und** `module_enabled`; Fotos zusätzlich nur mit `consent_review_status = 'approved'`, `public = true`, vollständiger Personenliste und aktuell gültigen Einwilligungen. Spieler werden nur über `playerboard_public_label` ausgegeben; nur `service_role` darf sie ausführen. Die öffentlichen Veo-Werte folgen in 053 demselben Muster.

Speicherverbrauch der Fotos zählt auf das Speicherkontingent des Vereins (Paket 021).

## Umsetzung

### PR 1 – Schema, RLS, pgTAP

Migration wie oben (setzt 054 voraus), Bucket mit Policies, Trigger. pgTAP mit positiven **und** negativen Isolationstests (AGENTS.md):

- fremder Verein, fremde Mannschaft derselben Abteilung, Modul aus (Verein, Abteilung, Mannschaft je einzeln)
- `player` sieht keine Entwürfe, kann nichts schreiben, sieht aber alle Punkte der eigenen Mannschaft
- `stats_visibility`: Spieler einer Nachbarmannschaft sieht bei `team` nichts, bei `department` Punkte, aber keine Trainingsnotizen oder Fotos; Mitglied einer anderen Abteilung sieht erst bei `organization` etwas; vom Verein verbindlich gesetztes `organization` ist von der Mannschaft nicht zu verengen, nach Freigabe schon
- Punkte mit Spieler einer anderen Mannschaft oder nicht wirksamer Kategorie werden abgelehnt
- Vererbung: Saisonbeginn verbindlich/freigegeben/von der Abteilung wieder gesperrt; `team_categories_allowed = false` auf Vereinsebene schlägt `true` darunter
- Öffentliche Funktionen liefern nichts, wenn Schalter, `public_sharing_allowed` oder Modul fehlen; die Ausgabe enthält nie Vor- oder Nachnamen, IDs, Geburtsjahre, E-Mails oder Notizen (Test sucht die Klarnamen der Testpersonen im JSON); Fotos mit `public = false`, ausstehender/gescheiterter Einwilligungsprüfung, unvollständiger Personenliste oder ungültiger Einwilligung erscheinen nicht

### PR 2 – Domain, Verträge, API

- `packages/domain/src/playerboard.ts`: `resolvePlayerboardSettings`, `effectiveCategories` (TS-Spiegel der SQL-Funktionen, für die Oberflächenzustände geerbt/eigener Wert/gesperrt), Rangberechnung mit geteilten Rängen (1, 2, 2, 4).
- `packages/authorization`: drei Permissions, Rolle `player`, `roleRank` und `authz.role_rank` gemeinsam anpassen (bestehende Regel).
- `apps/api/src/routes/playerboard/`: `players.ts`, `categories.ts`, `trainings.ts`, `pointEntries.ts` (Bulk-Upsert je Training, wie die mobile Eingabe speichert), `photos.ts` (signierte Upload- und Lese-URLs, Ausnehmen einzelner Fotos), `ranking.ts`, `settings.ts`, `public.ts` (anonym: Rangliste, Fotos; kurzlebige signierte Foto-URLs).
- `POST /v1/playerboard/players` legt Verzeichnisperson und Kader-Eintrag in einem Schritt an (eine Transaktion, Rechteprüfung `training.manage` auf der Mannschaft); alternativ mit `directoryPersonId` für eine vorhandene Person.
- Einladung mit `directoryPersonId` in `POST /v1/invitations`, Adresse aus `directory_people.email` vorbelegt (ersetzt playerboards vereinheitlichten Einladungsdialog aus Feature 015). Fehlt die E-Mail, fragt der Dialog sie ab und speichert sie an der Person.

### PR 3 – Oberfläche Trainer

Seiten unter `/playerboard/` im Modul-Registry aus 051, Mannschaft aus dem aktiven Scope (`useActiveScope`); auf Abteilungs- oder Vereinsebene zuerst eine Mannschaftsauswahl.

- `/playerboard/kader`: Spieler neu anlegen (Name, optional Geburtsjahr, Rückennummer, Position, E-Mail) oder aus dem Verzeichnis der Mannschaft übernehmen; E-Mail später ergänzen; „Einladen“ jederzeit, sobald eine E-Mail vorliegt
- `/playerboard/trainings`, `/playerboard/trainings/neu`, `/playerboard/trainings/[id]`: mobile Punkteeingabe aus playerboard übernehmen (Zielgruppe ist der Platzrand: ≥ 44 px Touchziele, 360 px Breite), Fotos, Einwilligungshinweis
- `/playerboard/kategorien`: eigene und geerbte Kategorien, geerbte schreibgeschützt mit Herkunftsebene
- `/playerboard/einstellungen`: Saisonbeginn, Sichtbarkeit der Werte (`stats_visibility`), Freigaben, öffentliche Mannschaftsseite (drei Schalter, Link zum Teilen, Liste der Spieler ohne Einwilligung für öffentliche Fotos) — Zustände **geerbt**, **eigener Wert**, **gesperrt** wie `PolicyFlagToggles.vue`

### PR 4 – Spieleransicht, Rangliste, Übersicht

- `/playerboard` und `/playerboard/rangliste` für `player` und Trainer, Zeitraumfilter (Saison, Monat, frei)
- öffentliche Seite `/mannschaft/[orgSlug]/[teamSlug]` im `auth`-Layout mit den Reitern Rangliste und Fotos (Veo folgt in 053), Vereinsmarke aus `resolveBrand`; die globale Auth-Middleware lässt ausschließlich das Muster `/mannschaft/[^/]+/[^/]+` ohne Anmeldung passieren, nicht leere Segmente, zusätzliche Segmente oder andere Routen
- bei jedem Trainingsfoto: Schalter „nicht öffentlich“
- PlayerBoard-Kachel auf der Übersicht (`index.vue`), eingehängt über das Modul-Registry

## Bewusst nicht übernommen

- **Eigene Anmeldung, Team-Anlage, Onboarding, Profilseite**: Das übernimmt der Rahmen.
- **Letzter-Trainer-Schutz** (`last_trainer_guard`): In Vereinsfunk verwaltet die Abteilung eine Mannschaft auch ohne `team_manager`; eine Mannschaft ohne Trainer ist kein gesperrter Zustand.
- **Profilmoderation durch Trainer** (playerboard 002, `profile/moderate`): Rahmenfunktion, falls gebraucht als eigenes Paket für alle Module.
- **Eigene Zeitzone je Mannschaft**: Die Zeitzone des Vereins reicht.

## Verifikation

- pgTAP wie unter PR 1, nach frischem `supabase db reset`.
- API-Tests je Route inklusive `403 module_disabled` und `403 forbidden` für `player` auf Schreibrouten.
- Playwright auf 360 px Breite: Training anlegen, Punkte für zehn Spieler erfassen, speichern, als `player` Rangliste prüfen, öffentliche Mannschaftsseite ohne Anmeldung aufrufen: nur „#Nr Initialen“, keine Klarnamen; Fotos nur bei eingeschaltetem Schalter, `approved`-Einwilligungsprüfung, vollständiger Personenliste und ohne ausgenommene Fotos.
- `pnpm lint`, `typecheck`, `test`, `build`, `db:test` grün.

## Risiken und offene Entscheidungen

- **Initialen sind kein vollständiger Schutz.** In einer kleinen Mannschaft lassen „#7 M. K.“ und ein öffentliches Foto auf eine Person schließen. Das ist mit der Betreiberentscheidung bewusst in Kauf genommen. Die Vereinsebene kann `public_sharing_allowed` jederzeit für alle abschalten.
- **Bewertungsdaten von Kindern in der Verarbeitungsdokumentation.** Punkte und Veo-Werte sind bewusst offen (siehe „Sichtbarkeit der Werte“). Sie gehören trotzdem als eigene Verarbeitung mit Zweck „Trainingsbewertung und Spielanalyse“ in die Verarbeitungsdokumentation (Paket 020), samt der gewählten `stats_visibility`.
- **`team_manager` als einzige Trainerrolle.** Wer nur Punkte erfassen, aber keine Beiträge schreiben soll (Co-Trainer), bekommt dieselbe Rolle. Bei Bedarf später eine Team-Rolle `coach` mit nur `training.*`.

Entschieden (Betreiber, 2026-10-05/06): kein Elternkontakt und keine Elternkonten; Trainer legen Spieler selbst an, E-Mail optional, Einladung jederzeit; Punkte und Veo-Werte innerhalb der Mannschaft für alle sichtbar, vereinsintern darüber hinaus je Ebene über `stats_visibility`; öffentliche Mannschaftsseite mit Rückennummer und Initialen, Fotos auf Wunsch des Trainers.

## Umsetzung PR 1: Ergebnis und Abweichungen vom Plan

Umgesetzt am 2026-10-07:
- Migrationen `2026100801_team_role_player.sql` (Enum-Wert vorab) und `2026100802_playerboard_core.sql`.
- `packages/authorization`: drei Permissions, Rolle `player`, Rang, Modulzuordnung.
- `packages/contracts`: `player` in `RoleSchema`, `AssignableRoleSchema` und `TEAM_SCOPED_ROLES`; dazu das Label in der Weboberfläche.

Verifiziert:
- `pnpm lint`, `typecheck` und `build` grün.
- `pnpm test` grün: 38 Tasks, einschließlich `websiteRenderer.logoScoring.test.ts`.
- `playerboard_core.test.sql` nach frischem `supabase db reset` grün: 69 Assertions; der vollständige Teststand umfasst damit 1261 Assertions in 49 Dateien.

Abgedeckt sind alle unter „PR 1“ verlangten Fälle:
- fremder Verein und Nachbarmannschaft
- Modul aus auf jeder Ebene einzeln
- `player` ohne Entwürfe und Schreibrechte
- `stats_visibility` `team`/`department`/`organization`, verbindlich und freigegeben
- Punkte mit fremdem Spieler, fremder Kategorie oder außerhalb des Wertebereichs
- Vererbung des Saisonbeginns, `team_categories_allowed`
- öffentliche Ausgabe ohne Klarnamen, Geburtsjahre oder IDs
- Fotos ohne Review, mit unvollständiger Personenliste, mit ungültiger oder widerrufener Einwilligung sowie ausgenommene Fotos

Abweichungen:

- **Rollen und Rechte schon in PR 1.** Rolle `player`, die drei Permissions, Rang und Modulzuordnung in `packages/authorization` sowie `player` in den Rollen-Verträgen stehen hier statt in PR 2. Die SQL-Rechtelisten ändern sich in dieser Migration, und TS und SQL bleiben nach der bestehenden Regel gemeinsam gepflegt.
- **Trainingsnotizen in eigener Tabelle `playerboard_training_notes`.** Wer die Werte nur über `stats_visibility` sieht, darf Datum, Titel und Status lesen, die Notiz aber nicht. RLS schützt Zeilen, keine Spalten. Spaltenweise Grants hätten jedes `select *` gebrochen.
- **Namen über Funktionen.**
  - Spieler haben kein `directory.read`. Kader und Rangliste mit Namen liefern deshalb `playerboard_team_roster(team)` und `playerboard_team_ranking(team, von, bis)` als `security definer` mit expliziter Prüfung `authz.can_view_playerboard_stats`.
  - Die Rangliste ist entgegen dem Plan nicht `security invoker`. Die Wirkung ist dieselbe, aber ohne verschachtelte RLS über Verzeichnis, Kader, Punkte und Trainings.
- **Interne und abgesicherte Funktionen getrennt.** `authz` ist per PostgREST erreichbar.
  - Die Auflösung der Einstellungen (`authz.resolve_playerboard_setting`) und der wirksamen Kategorien (`authz.playerboard_effective_categories`) laufen intern ohne Mitgliedschaftsprüfung und ohne Grant.
  - Nach außen gehen `authz.playerboard_setting` und `public.playerboard_effective_categories`. Ein Nichtmitglied bekommt dort `null` bzw. nichts (Muster `authz.module_enabled`).
  - Ohne diese Trennung scheiterte der Punkte-Trigger in Wartungs- und Service-Kontexten.
- **Vererbung, Regel präzisiert.**
  - Eine Ebene ist für ein ersetzbares Feld frei, solange oben noch nichts gesetzt ist, oder wenn die direkt übergeordnete Ebene selbst frei ist und das Feld in `overridable_fields` freigibt.
  - Daraus folgen beide Plan-Fälle: Eine Abteilung kann ein freigegebenes Feld wieder sperren, ein gesperrtes aber nicht freigeben.
  - Ohne Wert: `stats_visibility` ist `team`, `season_start` bleibt `null` (die Oberfläche entscheidet über einen Standard).
- **Fotos.**
  - `public`, `consent_review_status` und die Personenliste ändern ausschließlich die RPCs `playerboard_review_photo_consent()` und `playerboard_set_photo_public()`.
  - Einfügen ist nur spaltenweise erlaubt, ein Trigger setzt jedes neue Foto auf privat und `pending`. Ein CHECK verbietet `public` ohne `approved` und vollständige Personenliste.
  - Der Speicherpfad muss zur Mannschaft und zum Training passen.
  - Prüfen dürfen `training.manage` auf der Mannschaft oder `consent.manage` in der Abteilung.
- **Einwilligung in SQL.** `authz.playerboard_photo_consent_valid()` spiegelt `evaluateConsent()` für Zweck `website`, Medienart `photo`, Kontext `training` und die Abteilung der Mannschaft. Ausgetretene Personen zählen für die öffentliche Seite immer als ungültig, unabhängig von `consentExpiresOnLeave`.
  - Widerruf, Ablösung und Änderungen an Gültigkeit oder Umfang sperren betroffene Fotos sofort per Trigger.
  - Ein bloßer Ablauf fängt `playerboard_public_photos()` bei jedem Abruf ab.
- **Bucket ohne Policies für `authenticated`.** `playerboard-training-photos` ist privat; Hoch- und Herunterladen nur über signierte URLs der API (PR 2), nach deren eigener Rechteprüfung.
- **Kader.** Ein Trainer nimmt nur Personen auf, die er über die RLS von `directory_people` selbst lesen darf (`directory.read` in deren Scope). Mannschaft und Person einer Kaderzeile sind unveränderlich.
- **Einladung.**
  - `create_invitation()` hat einen optionalen siebten Parameter `target_directory_person_id`; die Person muss im Kader genau dieser Mannschaft stehen.
  - `accept_invitation()` verknüpft das Konto mit der Person, wenn diese noch keines hat.
  - Die Rolle `player` ist als Team-Rolle einladbar.
- **Speicherkontingent.** `storage_usage_bytes()` zählt Trainingsfotos mit (je Abteilung und Mannschaft über das Training). `storage_usage_breakdown()` folgt mit dem Upload in PR 2.
- **Öffentliche Funktionen.**
  - Zusätzlich `playerboard_public_team_info()` für Vereins- und Mannschaftsname und die eingeschalteten Reiter.
  - Die Rangliste liefert Kategorien mit Namen statt IDs.
  - Die Fotofunktion gibt den Speicherpfad nur an die API, die daraus kurzlebige signierte URLs macht.
  - In der Rangliste erscheinen aktive Spieler auch mit 0 Punkten, inaktive nur mit Punkten im Zeitraum.

## Umsetzung PR 2: Ergebnis und Abweichungen vom Plan

Umgesetzt am 2026-10-08:
- `packages/domain/src/playerboard.ts`: Vererbung mit Zustand „gesperrt“, wirksame Kategorien, geteilte Ränge, Saisonbeginn als Zeitraumanfang.
- `packages/contracts/src/playerboard.ts`.
- Routen unter `apps/api/src/routes/playerboard/` (`players`, `categories`, `trainings` mit Punkten und Rangliste, `settings`, `photos`, `public`).
- Ergänzungsmigration `2026100901_playerboard_api_support.sql`.
- `directoryPersonId` in `POST /v1/invitations`.
- Trainingsfotos in der Speicheraufschlüsselung (`/v1/storage/usage`, Seite „Tarif“).

Verifiziert:
- `pnpm lint`, `typecheck`, `test` (alle 38 Tasks) und `build` grün.
- `pnpm db:test` nach frischem `supabase db reset` grün: 50 Dateien, 1277 Assertions, davon 14 in `playerboard_api_support.test.sql`.
- API-Tests in `playerboard.routes.test.ts`: jede Schreibroute mit `403 forbidden` für `player` und `403 module_disabled`; Leserouten mit `403` ohne Sicht auf die Kennzahlen; Zuordnung der Trigger-Fehler, Einladung, öffentliche Seite.
- Zusätzlich einmal gegen den lokalen Stack per HTTP durchgespielt, als Demo-Vereinsinhaberin:
  - Spieler neu anlegen, Kategorie, Training (Zukunftsdatum → `422`), Punkte (außerhalb des Bereichs → `422`), speichern, Rangliste
  - Einstellungen mit Vererbung (Saisonbeginn des Vereins sperrt die Abteilung)
  - öffentliche Rangliste als „#7 M. K.“ / „J. A.“
  - Foto: Reservierung, `complete` vor dem Hochladen → `409 upload_missing`, Upload über die signierte URL, Abschluss mit tatsächlicher Größe, Review, öffentliches Foto
  - Einladung ohne E-Mail → `422 email_required`, mit E-Mail → Einladung mit Rolle `player`

Endpunkte:

| Zweck | Route |
|---|---|
| Kader | `GET /v1/playerboard/teams/:teamId/players`, `POST /v1/playerboard/players`, `PATCH`/`DELETE /v1/playerboard/players/:id`, `POST /v1/playerboard/players/:id/invite` |
| Kategorien | `GET /v1/playerboard/categories?scope=&scopeId=`, `POST /v1/playerboard/categories`, `PATCH`/`DELETE /v1/playerboard/categories/:id` |
| Trainings | `GET /v1/playerboard/teams/:teamId/trainings`, `POST /v1/playerboard/trainings`, `GET`/`PATCH`/`DELETE /v1/playerboard/trainings/:id`, `PUT /v1/playerboard/trainings/:id/points` |
| Rangliste | `GET /v1/playerboard/teams/:teamId/ranking?from=&to=` |
| Einstellungen | `GET /v1/organizations/:id/playerboard/settings`, `PUT /v1/playerboard/settings` |
| Fotos | `GET`/`POST /v1/playerboard/trainings/:id/photos`, `POST /v1/playerboard/photos/:id/complete`, `POST /v1/playerboard/photos/:id/review`, `PUT /v1/playerboard/photos/:id/public`, `DELETE /v1/playerboard/photos/:id` |
| Öffentlich | `GET /v1/public/playerboard/:orgSlug/:teamSlug`, `…/ranking`, `…/photos` |

Abweichungen:

- **Ergänzungsmigration.**
  - `playerboard_create_player()` legt Verzeichnisperson und Kader-Eintrag in einer Transaktion an.
  - `playerboard_set_training_points()` (`security invoker`) speichert alle Punkte eines Trainings, alles oder nichts.
  - `playerboard_reserve_photo_upload()` reserviert unter derselben Kontingentsperre wie `reserve_storage_upload()`, mit Mannschaftsgrenze.
  - Dazu `upload_completed_at` mit Prüfung im Review und im CHECK für `public`, `storage_usage_breakdown()` mit `training_photos` und `playerboard_can_view_stats()` für die API.
- **Sicht auf Kennzahlen als eigene Prüfung.** Leserouten verlangen nicht `training.view`, sondern `authz.can_view_playerboard_stats`: eine Nachbarmannschaft mit passender `stats_visibility` darf lesen, hat aber kein `training.view`. Erst das Modul (`403 module_disabled`), dann die Sicht (`403 forbidden`); die Daten selbst kommen über den Nutzer-Client, RLS bleibt die zweite Prüfung. Fotos verlangen weiterhin `training.view`.
- **Einladung aus dem Kader.**
  - Zusätzlich `POST /v1/playerboard/players/:id/invite`: Adresse aus dem Verzeichnis; eine mitgegebene Adresse wird an der Person gespeichert und gilt.
  - Ohne Adresse `422 email_required`, mit bestehendem Konto `409 player_has_account`.
  - Der Trainer pflegt die E-Mail der Personen seines Kaders auch ohne `directory.read` auf deren Scope (`PATCH …/players/:id` mit `email`).
  - `POST /v1/invitations` nimmt ebenfalls `directoryPersonId`, nur mit Mannschaft.
- **E-Mail-Adressen im Kader** sehen nur Trainer (`training.manage`); Spieler sehen Namen und Rückennummern.
- **Löschen nur ohne Punkte.**
  - Kader-Einträge mit Punkten: `409 player_has_points`, dafür gibt es „inaktiv“.
  - Kategorien mit Punkten: `409 category_in_use`, dafür gibt es „deaktivieren“.
  - Beim Löschen eines Trainings entfernt die API auch die Fotodateien im Bucket.
- **Fotos in drei Schritten.**
  - Reservieren (Zeile und signierte Upload-URL), hochladen, `complete`. Erst danach erscheint das Foto und lässt sich prüfen.
  - Die tatsächliche Dateigröße ersetzt die angekündigte.
  - Prüfen darf auch die Einwilligungsverwaltung (`consent.manage`), wie in der RPC.
  - Öffentliche Foto-URLs leben fünf Minuten, interne zehn.
- **Offen für PR 3:** Die Liste der Spieler ohne gültige Einwilligung für öffentliche Fotos braucht einen eigenen Endpunkt und entsteht mit der Einstellungsseite.

## Umsetzung PR 3: Ergebnis und Abweichungen vom Plan

Umgesetzt am 2026-10-08:
- Seiten unter `apps/web/app/pages/playerboard/`: `kader.vue`, `trainings/index.vue`, `trainings/neu.vue`, `trainings/[id].vue`, `kategorien.vue`, `einstellungen.vue`.
- Komponenten: `PlayerboardTeamPicker`, `PlayerboardTeamEmpty`, `PlayerboardLevelTabs`, `PlayerboardPointEntry`, `PlayerboardTrainingPhotos`.
- Composable `usePlayerboardTeam` (Mannschaft aus dem Arbeitsbereich, Ebenen für Kategorien und Einstellungen).
- Logik ohne Vue in `utils/playerboardTeams.ts`, `utils/playerboardPoints.ts` (Speicherwarteschlange der Punkteeingabe), `utils/playerboardSettings.ts` und `utils/playerboardErrors.ts`, jeweils mit Tests.
- Modul-Registry: „Trainings“ und „Kader“ unter PlayerBoard, „Kategorien“ und „Einstellungen“ unter „PlayerBoard verwalten“.
- Ergänzungsmigration `2026101001_playerboard_photo_consents.sql` mit `playerboard_team_photo_consents()` und Route `GET /v1/playerboard/teams/:teamId/photo-consents`.
- `publicPath` in den Einstellungen je Mannschaft.

Verifiziert:
- `pnpm lint`, `typecheck`, `test` (alle 38 Tasks) und `build` grün.
- `pnpm db:test` nach frischem `supabase db reset` grün: 51 Dateien, 1288 Assertions, davon 7 in `playerboard_photo_consents.test.sql`.
- API-Tests: Einwilligungsliste (`403` für `player`, `403 module_disabled`, Zuordnung für Trainer) und `publicPath`.
- Im Browser auf 360 px Breite gegen den lokalen Stack, als Demo-Vereinsinhaberin:
  - Mannschaft wählen, zehn Spieler anlegen.
  - Kategorie des Vereins (in der Mannschaft geerbt und gesperrt) und eine eigene der Mannschaft.
  - Training anlegen, Punkte für alle zehn Spieler per Plus und Zahlenfeld erfassen. Die Werte sind nach dem Neuladen da; ein Wert außerhalb des Bereichs wird markiert und nicht gesendet.
  - Training abschließen.
  - Foto hochladen und prüfen, öffentlich schalten. Die Prüfung mit einer Person ohne Einwilligung ist gesperrt.
  - Öffentliche Seite der Mannschaft einschalten, Link erscheint.
  - Liste der Spieler ohne Einwilligung.
  - Einladung aus dem Kader. Entfernen eines Spielers mit Punkten wird mit Hinweis auf „inaktiv“ abgelehnt.
  - Keine Seite scrollt horizontal.

Abweichungen:

- **Punkteeingabe als Karten statt Tabelle.** Die Tabelle aus playerboard mit Schiebereglern ist auf 360 px nur seitlich scrollbar. Jetzt gibt es je Spieler eine Karte mit „−“, Zahlenfeld und „+“ je Kategorie (44-px-Ziele) und der Summe des Trainings.
  - Änderungen sammeln sich 0,7 s und gehen dann gemeinsam an `PUT …/points`, statt je Zelle einzeln.
  - Scheitert das Speichern, bleiben die Werte offen; „Erneut senden“ schickt sie nach.
  - Beim Verlassen der Seite wird Offenes noch gesendet, sonst fragt die Seite nach.
  - Ein leeres Feld startet bei 0 (bzw. an der nächsten Grenze), damit der erste Tipp auf „+“ eine 1 ergibt.
- **Einwilligungsstand als eigene Datenbankfunktion.** `playerboard_team_photo_consents()` liefert je Kaderspieler die jüngste Einwilligung, die der Foto-Review akzeptieren würde, mit derselben Prüfung (`authz.playerboard_photo_consent_valid`). Die Regeln stehen damit nicht ein zweites Mal in TypeScript.
  - Rechte wie beim Review: `training.manage` oder `consent.manage`.
  - Genutzt für den Hinweis an der Punkteeingabe, die Liste auf der Einstellungsseite und die Prüfung eines Fotos.
- **Prüfung im Browser vorab.** Ist eine ausgewählte Person ohne gültige Einwilligung, lässt sich das Foto gar nicht erst zur Prüfung absenden; die Seite nennt die betroffenen Spieler. Erkennbare Personen außerhalb des Kaders lassen sich nicht auswählen; der Hinweis sagt, das Foto dann nicht freizugeben.
- **Schalter „öffentlich / nicht öffentlich“ je Foto schon in PR 3** (Plan: PR 4), weil er zur Prüfung gehört. PR 4 behält die Spieleransicht.
- **Mannschaft aus dem Arbeitsbereich.** Die Sidebar kennt keine Mannschaft als Arbeitsbereich. `usePlayerboardTeam` bietet die Mannschaften der aktiven Abteilung bzw. auf Vereinsebene alle sichtbaren an und merkt sich die Wahl (Cookie). Bei genau einer Mannschaft entfällt die Auswahl.
  - Ein Training bestimmt seine Mannschaft selbst, ein Link darauf funktioniert unabhängig von der Auswahl.
- **Kategorien und Einstellungen je Ebene über Reiter** (Verein, Abteilung, gewählte Mannschaft) statt eines Baums aller Ebenen.
  - Die Einstellungen speichern über die Seiten-Schaltfläche nur geänderte Felder und laden danach alle Ebenen neu, weil eine Änderung nach unten wirkt.
  - Auf Vereinsebene heißt der Ausgangswert „Standard“, darunter „geerbt“.
- **Link zum Teilen** kommt als `publicPath` aus der API (der Vereins-Slug ist im Browser nicht bekannt). Die Seite dahinter entsteht mit PR 4.
- **Der Schalter für öffentliche Veo-Werte fehlt** auf der Einstellungsseite. Er folgt mit 053, solange gibt es keine Werte.
- **Registry-Test:** Eine Navigationsroute darf auch ein Ordner mit `index.vue` sein (`/playerboard/trainings`).

## Umsetzung PR 4: Ergebnis und Abweichungen vom Plan

Umgesetzt am 2026-10-08:
- Seiten `apps/web/app/pages/playerboard/index.vue` (Übersicht) und `rangliste.vue` für Spieler und Trainer.
- Öffentliche Seite `pages/mannschaft/[orgSlug]/[teamSlug].vue` im `auth`-Layout mit den Reitern Rangliste und Fotos.
- Komponenten `PlayerboardRankingList` (intern und öffentlich) und `PlayerboardSeasonSummary` (Übersicht und Kachel).
- Composable `usePlayerboardRanking`; `utils/playerboardRanking.ts` und `utils/publicTeamPage.ts`, jeweils mit Tests.
- PlayerBoard-Kachel auf der Startseite (`index.vue`).
- Navigation: „Übersicht“ und „Rangliste“ vor „Trainings“ und „Kader“.
- API:
  - `isSelf` im Kader.
  - `seasonFrom` und `brand` (wirksame Vereinsfarben über `resolveBrand`) in `GET /v1/public/playerboard/:orgSlug/:teamSlug`.
- Migration `2026101101_playerboard_public_ranking_order.sql`.

Verifiziert:
- `pnpm lint`, `typecheck`, `test` (alle 38 Tasks) und `build` grün.
- `pnpm db:test` nach frischem `supabase db reset` grün: 51 Dateien, 1288 Assertions.
- API-Tests: `isSelf` für die verknüpfte Person ohne E-Mail für Spieler; öffentliche Mannschaftsinfo mit Saisonanfang und Vereinsfarben.
- Im Browser auf 360 px gegen den lokalen Stack:
  - **Trainer:** Kachel auf der Startseite. Übersicht und Rangliste mit Saison (Saisonbeginn des Vereins 1. August), Monat und Aufklappen der Kategorien.
  - **Spielerin** (Konto mit ihrem Kader-Eintrag verknüpft):
    - eigener Platz auf der Übersicht, „Du“ in der Rangliste;
    - im Kader keine E-Mail-Adressen und kein Anlegeformular;
    - im Training keine Eingabeknöpfe.
  - **Ohne Anmeldung:**
    - `/mannschaft/sv-nordstadt/u13` zeigt die Rangliste nur mit „#Nr Initialen“; weder im HTML noch in der API-Antwort steht einer der zwölf Vor- oder Nachnamen.
    - Das geprüfte Foto erscheint unter „Fotos“; `robots` steht auf `noindex, nofollow`.
    - `/mannschaft/sv-nordstadt`, `/mannschaft/sv-nordstadt/u13/fotos` und `/playerboard/rangliste` führen zur Anmeldung.
    - Eine unbekannte Mannschaft zeigt „Seite nicht gefunden“.
  - Keine Seite scrollt horizontal.

Abweichungen:

- **`noindex` auf der öffentlichen Seite.** Anders als das öffentliche Impressum: In Jugendmannschaften sind die Spieler Kinder, die Seite ist zum Teilen gedacht, nicht für Suchmaschinen.
- **Öffentliche Rangliste ab Saisonbeginn.** Die API liefert den Anfang der laufenden Saison (`seasonFrom`) mit; ohne Saisonbeginn gilt die gesamte Zeit. Einen Zeitraumfilter hat die öffentliche Seite nicht.
- **Vereinsfarben, kein Logo.** Die öffentliche Seite übernimmt Primär- und Akzentfarbe; Textfarben werden wie in der Seitenleiste nach Kontrast gewählt. Das Logo bräuchte eine weitere öffentliche, signierte Datei-URL und fehlt bewusst.
- **Rangliste als aufklappbare Liste** statt Tabelle mit Spalte je Kategorie, damit sie auf 360 px ohne seitliches Scrollen auskommt.
- **Kachel ohne Registry-Hook.** Wie in `index.vue` vorgesehen (keine modulübergreifende Kachel-API), direkt eingehängt; sie erscheint nur, wenn PlayerBoard wirkt und es im Arbeitsbereich eine Mannschaft gibt.
- **Öffentliche Rangliste bei geteilten Plätzen nach Rückennummer**, wie intern (Migration `2026101101`). Bisher entschied der Text des Kürzels („#10“ vor „#3“).
- **Schalter „nicht öffentlich“ je Foto** ist schon mit PR 3 gekommen.
- **Nebenbefund außerhalb des Pakets:** Die Startseite fragt für reine Mannschaftsmitglieder `GET /v1/onboarding` an und bekommt `404` (Konsolenfehler, keine sichtbare Folge). Das gehört zum Social-Media-Teil der Startseite und ist hier nicht geändert.
