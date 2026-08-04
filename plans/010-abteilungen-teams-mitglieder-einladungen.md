# 010 – Abteilungen, Teams, Mitglieder und Einladungen

## Ergebnis

Ein Verein baut seine Struktur selbst: Abteilungen anlegen und umbenennen, darin Teams führen, Menschen per E-Mail einladen und ihnen auf genau einer Ebene eine Rolle geben. Ein Abteilungsadmin verwaltet ausschließlich seine eigene Abteilung, ein Teamadmin ausschließlich sein Team. Rollen und Mitgliedschaften kommen aus der Datenbank, nicht aus einer Liste im Template.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- `apps/web/app/pages/mitglieder.vue:1` enthält vier hartkodierte Namen als Array von Arrays. Der „Einladen“-Button hat keinen Handler. Die Seite ist zwei Zeilen lang.
- `supabase/migrations/202608020001_initial_tenant_foundation.sql:104-118`: `invitations` existiert mit `token_hash`, `expires_at`, `accepted_at`. Es gibt **nur eine SELECT-Policy** (`:402-403`) und in `202608020003_api_grants.sql` nur `select` für `authenticated`. Einladungen sind also ausschließlich über die Service Role schreibbar — richtig so, aber der Serverpfad fehlt.
- `invitations.role` ist ein freies `text`-Feld ohne CHECK (`:110`). Eine Einladung kann heute jede beliebige Zeichenkette als Rolle tragen.
- `invitations`' zusammengesetzter Fremdschlüssel auf `departments` (`:116-118`) hat **kein `on delete`**, anders als alle anderen Tenant-FKs. Wird eine Abteilung gelöscht, blockiert eine offene Einladung das Löschen.
- Es gibt **keine Team-Einladung**: `invitations` kennt `department_id`, aber keine `team_id`.
- Für `departments`, `teams`, `organization_memberships`, `department_memberships`, `team_memberships` existieren **ausschließlich SELECT-Policies** (`:392-400`). Jede Struktur- und Rollenänderung muss über die API laufen.
- `packages/authorization/src/index.ts:60` gibt `team_manager` nur `post.create`, `post.edit`, `post.submit`, `analytics.view` — **keine Verwaltungsrechte**. Die Anforderung „auf jeder Ebene Admins“ ist im Rollenmodell nicht abgedeckt.
- Es gibt keine `authz`-Funktion für Team-Ebene; `team_memberships_select` (`:399-400`) weicht auf `has_department_permission` aus. Paket 008 legt `authz.has_team_permission` an.
- `department_memberships` und `team_memberships` haben `unique (department_id, user_id, role)` bzw. `unique (team_id, user_id, role)` — eine Person kann also **mehrere Rollen gleichzeitig** in derselben Abteilung haben. Das ist gewollt (Rollen sind additiv, `hasPermission` prüft `some`), muss in der Oberfläche aber verständlich dargestellt werden.

## Scope

- Migration: Team-Rollen für Verwaltung, `invitations` um `team_id` und Rollen-CHECK erweitern, Löschverhalten korrigieren
- `packages/authorization` um Verwaltungsrechte je Ebene erweitern
- API: Abteilungen, Teams, Mitgliedschaften, Einladungen — vollständiger CRUD mit Scope-Prüfung
- Einladungsflow inklusive E-Mail, Annahme, Ablauf, Widerruf, erneutes Senden
- Nuxt: Strukturseite und echte Mitgliederseite
- Rückbau der Mitglieder-Dummies

Nicht enthalten: Richtlinien und Freigaberouten je Ebene (011), Mitgliederverzeichnis für Spieler aus Drittsystemen (014 — das ist ein anderes Konzept: hier geht es um **Nutzer der Software**, dort um **Personen auf Fotos**).

## Rollenmodell

Die heutige Matrix bleibt bestehen und wird an zwei Stellen ergänzt:

```ts
// packages/authorization
'team.manage'          // neu: Teams innerhalb einer Abteilung verwalten
'member.remove'        // neu: getrennt von member.invite
```

Zuordnung:

| Rolle | Ebene | neu erhält |
|---|---|---|
| `organization_owner` | Verein | alles (unverändert, `allPermissions`) |
| `organization_admin` | Verein | `team.manage`, `member.remove` |
| `department_admin` | Abteilung | `team.manage`, `member.remove` |
| `team_manager` | Team | `member.invite`, `member.remove` **nur im eigenen Team** |

Damit ist `team_manager` die Teamadmin-Rolle. Eine zusätzliche Rolle `team_admin` wird bewusst **nicht** eingeführt: `team_manager` ist bereits im DB-Enum `public.team_role` (`202608020001:15`), und eine zweite Verwaltungsrolle auf der kleinsten Ebene erzeugt Erklärungsbedarf ohne Nutzen.

Verbindliche Scope-Regel, die `hasPermission` allein nicht ausdrückt:

> Eine Permission gilt nur innerhalb des Scopes, in dem die Rolle vergeben wurde, und für Ziele **auf oder unterhalb** dieser Ebene. Ein `department_admin` in „Fußball“ kann niemanden in „Handball“ verändern, auch wenn beide Abteilungen zum selben Verein gehören. Ein `team_manager` kann keine Abteilungsmitgliedschaft anlegen.

Diese Regel wird an einer Stelle implementiert — `assertScopedPermission(actorScopes, permission, targetScope)` in `packages/authorization` — und von API und RLS gleichermaßen benutzt. Sie darf nicht in jedem Endpunkt neu erfunden werden.

Eskalationsschutz:

> Niemand darf eine Rolle vergeben, die mächtiger ist als die eigene, und niemand darf sich selbst eine höhere Rolle geben. `organization_owner` ist ausschließlich durch einen bestehenden `organization_owner` vergebbar.

## Datenmodell

Migration `2026080403_structure_and_invitations.sql`:

```sql
-- Einladungen können auf Team-Ebene gelten und tragen eine geprüfte Rolle.
alter table public.invitations add column team_id uuid;
alter table public.invitations add column revoked_at timestamptz;
alter table public.invitations add column last_sent_at timestamptz not null default now();
alter table public.invitations add column send_count integer not null default 1 check (send_count between 1 and 10);

alter table public.invitations drop constraint invitations_organization_id_department_id_fkey;
alter table public.invitations add constraint invitations_department_fk
  foreign key (organization_id, department_id)
  references public.departments(organization_id, id) on delete cascade;
alter table public.invitations add constraint invitations_team_fk
  foreign key (organization_id, department_id, team_id)
  references public.teams(organization_id, department_id, id) on delete cascade;

-- Genau eine Ebene pro Einladung.
alter table public.invitations add constraint invitations_scope_check check (
  (department_id is null and team_id is null) or
  (department_id is not null and team_id is null) or
  (department_id is not null and team_id is not null)
);
alter table public.invitations add constraint invitations_role_check check (
  role = any (array[
    'organization_admin','social_manager','billing_admin','organization_viewer',
    'department_admin','editor','approver','contributor','viewer','team_manager'
  ])
);
-- organization_owner ist nicht einladbar, nur übertragbar.

create unique index invitations_open_unique
  on public.invitations (organization_id, email, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where accepted_at is null and revoked_at is null;
```

Der partielle Unique-Index verhindert, dass dieselbe Adresse für denselben Scope mehrfach offen eingeladen wird. Wichtiger Nebeneffekt: „erneut senden“ ist dadurch ein Update, kein Insert.

Löschschutz als Trigger, nicht als Constraint:

```sql
-- Die letzte Abteilung eines Vereins darf nicht verschwinden (Invariante aus 009).
create or replace function public.prevent_last_department_delete() returns trigger ...
-- Der letzte Vereinsinhaber darf nicht verschwinden.
create or replace function public.prevent_last_owner_removal() returns trigger ...
```

Beide Trigger sind `before delete` und werfen eine sprechende Exception. Sie sind die einzige Stelle, an der diese Invarianten garantiert sind — API-Prüfungen allein reichen nicht, weil auch Worker und Migrationen schreiben.

## Umsetzung

### 1. Struktur-Endpunkte

- `POST /v1/organizations/:orgId/departments` — `department.manage` auf Vereinsebene oder `organization.manage`
- `PATCH`/`DELETE /v1/departments/:id` — `department.manage` **in dieser Abteilung**; Löschen nur wenn keine Beiträge existieren, sonst 409 mit Verweis auf Archivieren
- `POST /v1/departments/:id/teams`, `PATCH`/`DELETE /v1/teams/:id` — `team.manage`
- Umbenennen ändert nie den `slug`. `departments.slug` ist Teil des Unique-Keys (`202608020001:49`) und in Medienpfaden nicht enthalten, aber ein stabiler Slug erspart spätere Verwirrung.

**Archivieren statt Löschen**: eine Abteilung mit Beiträgen zu löschen würde über `on delete cascade` (`202608020001:61,86`) auch Teams, Mitgliedschaften, Submissions und Posts mitnehmen. Das ist bei einer Fehlbedienung nicht wiederherstellbar. Dieses Paket ergänzt daher `departments.archived_at` und `teams.archived_at`; archivierte Einheiten sind schreibgeschützt, bleiben in der Auswertung sichtbar und verschwinden aus Auswahllisten. Echtes Löschen bleibt nur für leere Einheiten möglich.

### 2. Mitgliedschaften

- `POST /v1/memberships` mit `{ scope: 'organization'|'department'|'team', scopeId, userId, role }`
- `DELETE /v1/memberships/:id`
- `PATCH /v1/memberships/:id` für Rollenwechsel; intern ein Löschen und Anlegen, weil die Unique-Keys Rollen als Teil der Identität behandeln
- Jede Operation prüft `assertScopedPermission`, den Eskalationsschutz und schreibt `audit_events`
- Beim Entfernen einer Person: ist sie `organization_profiles.responsible_person_profile_id` (Paket 009), wird der Vorgang mit 409 abgewiesen, bis eine andere Person zugewiesen ist. Eine verantwortliche Ansprechperson, die dem Verein nicht mehr angehört, ist ein rechtliches Problem, kein Datenproblem.
- `expires_at` existiert auf allen drei Membership-Tabellen und wird von allen `authz`-Funktionen bereits geprüft. Die Oberfläche macht es sichtbar und erlaubt befristete Zugänge — nützlich für Praktikanten und Saisonhelfer.

### 3. Einladungsflow

Erzeugen (`POST /v1/invitations`):

1. Berechtigung und Ziel-Scope prüfen, Rolle gegen Eskalationsschutz prüfen
2. E-Mail normalisieren (`lower`, trim) — die Tabelle erzwingt `email = lower(email)` (`:108`)
3. Ist die Adresse bereits Mitglied im Zielscope → 409, keine Einladung
4. Rohtoken mit `crypto.randomBytes(32)` erzeugen, **nur den SHA-256-Hash speichern** (`token_hash` ist unique, `:110`), Rohtoken ausschließlich in die E-Mail
5. `expires_at` auf 14 Tage
6. E-Mail versenden, `audit_events` schreiben. Die API-Antwort enthält das Rohtoken **nicht**

Annehmen (`POST /v1/invitations/accept` mit Rohtoken):

1. Hash bilden, Einladung suchen; nicht gefunden, abgelaufen, widerrufen oder angenommen → einheitlich 410 ohne Unterscheidung
2. Angemeldeter Nutzer muss existieren. Ist er nicht angemeldet, führt der Link erst zu `/registrieren?einladung=<token>`; nach Registrierung wird automatisch angenommen
3. **Die E-Mail des Kontos muss der eingeladenen Adresse entsprechen.** Sonst könnte ein weitergeleiteter Link von einer fremden Person eingelöst werden
4. Mitgliedschaft im Scope der Einladung anlegen; bei Team-Einladung zusätzlich eine `viewer`-Mitgliedschaft in der übergeordneten Abteilung, sonst greift keine RLS-Policy für die Inhalte des Teams
5. `accepted_at` setzen, `audit_events` schreiben

Weitere Aktionen: `POST /v1/invitations/:id/resend` (Rate-Limit: höchstens einmal pro Stunde, `send_count` ≤ 10, erzeugt ein **neues** Token und invalidiert das alte), `POST /v1/invitations/:id/revoke`.

Ein Hatchet-Cron räumt abgelaufene Einladungen nach 90 Tagen ab. Der Workflow-Name gehört in `WorkflowNameSchema` (`packages/contracts/src/index.ts:135`), sonst lässt er sich nicht triggern.

### 4. Oberfläche

`pages/mitglieder.vue` wird ersetzt durch:

- Filter nach Scope (ganzer Verein / Abteilung / Team) und Suche über Anzeigename
- Liste mit Anzeigename, allen Rollen als Chips mit Ebenenangabe, Ablaufdatum falls gesetzt, Beitrittsdatum
- Aktionen ausschließlich sichtbar, wenn `useCan` sie erlaubt: Rolle ändern, entfernen, Zugang befristen
- eigener Bereich für offene Einladungen mit Status, Ablauf und den Aktionen erneut senden / widerrufen
- Einladungsdialog: E-Mail, Ebene, Rolle. Die Rollenauswahl zeigt nur Rollen, die der Handelnde vergeben darf, und erklärt jede Rolle in einem Satz.
- Empty State: „Noch seid ihr allein hier“ mit direkter Einladungsaktion
- **Platz für das Vertrauen je Mitglied aus Paket 011.** Ob eine Person einreichen darf und ob ihre Beiträge geprüft werden müssen, wird über eine Person entschieden und gehört deshalb hierhin, nicht in die Einstellungen. Diese Seite ist so zu bauen, dass je Mitglied eine Detailebene aufklappt — 011 füllt sie mit Einreichrecht, Prüfpflicht, Befristung und der für diese Person geltenden Freigaberoute.

Neue Seite `pages/struktur.vue`: Baum aus Verein → Abteilungen → Teams mit Mitgliederzahl je Knoten, Anlegen, Umbenennen, Archivieren. Der Abteilungswähler in `layouts/default.vue:275-281` wird von der Demo-Stringliste auf echte Abteilungen aus `useSession()` umgestellt und um eine Teamebene ergänzt.

### 5. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `pages/mitglieder.vue:1` | vier hartkodierte Namen, funktionsloser Button | echte Mitglieder und Einladungen |
| `layouts/default.vue:275-281` | `departments` als String-Array aus `useDemoData` | echte Abteilungen und Teams mit IDs |
| `useDemoData.ts:23-24` | `department`, `departments` | mit diesem Paket vollständig überflüssig; die Datei wird gelöscht |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- pgTAP negativ: Abteilungsadmin aus „Fußball“ kann keine Mitgliedschaft in „Handball“ anlegen; `team_manager` kann keine Abteilungsmitgliedschaft anlegen; Löschen der letzten Abteilung schlägt fehl; Entfernen des letzten Inhabers schlägt fehl; Einladung mit `organization_owner` verstößt gegen den CHECK; zweite offene Einladung für gleiche Adresse und gleichen Scope verstößt gegen den Unique-Index.
- `packages/authorization`-Tests für `assertScopedPermission`: alle Kombinationen aus Handelnden-Ebene und Ziel-Ebene, inklusive der Eskalationsfälle.
- API-Tests: Annahme mit abgelaufenem Token → 410; Annahme mit fremdem Konto → 403; erneutes Senden über dem Rate-Limit → 429; Entfernen der verantwortlichen Ansprechperson → 409.
- manuell: zwei Browserprofile. Nutzer A lädt Nutzer B als `editor` in „Fußball“ ein; B registriert sich über den Link und sieht ausschließlich „Fußball“; B kann keine Mitglieder verwalten; A macht B zum `department_admin`; B kann es danach.

## Risiken und offene Entscheidungen

- **E-Mail-Versand** ist harte Voraussetzung. Optionen: Supabase Auth Invite (einfach, aber koppelt Einladung an Kontoerstellung und passt nicht zu bestehenden Nutzern) oder ein eigener Versand über Resend/Postmark aus der API (mehr Kontrolle, eigene Templates, eigener Vertrag). Empfehlung ist der eigene Versand, weil Einladungen auch an bereits registrierte Nutzer gehen. Das ist eine Beschaffungsentscheidung.
- **Team-Mitgliedschaft ohne Abteilungsmitgliedschaft** ist im Schema erlaubt, führt aber dazu, dass keine RLS-Policy greift, weil alle Inhaltspolicies auf `is_department_member` prüfen. Schritt 3.4 löst das durch eine automatische `viewer`-Zeile. Alternative wäre, `is_department_member` um Teammitgliedschaften zu erweitern — sauberer im Modell, aber ein Eingriff in eine Funktion, auf der jede bestehende Policy aufsetzt. Beim Umsetzen bewusst entscheiden und die Wahl im ADR festhalten.
- **Rollen als Teil des Unique-Keys** macht Rollenwechsel zu Löschen-und-Anlegen und damit im Audit-Log zu zwei Ereignissen. Akzeptabel, sollte aber im Audit als ein Vorgang mit gemeinsamer `correlation_id` erkennbar sein.
