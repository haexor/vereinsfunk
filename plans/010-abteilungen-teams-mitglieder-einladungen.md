# 010 – Abteilungen, Teams, Mitglieder und Einladungen

## Ergebnis

Ein Verein baut seine Struktur selbst: Abteilungen anlegen und umbenennen, darin Teams führen, Menschen per E-Mail einladen und ihnen auf genau einer Ebene eine Rolle geben. Ein Abteilungsadmin verwaltet ausschließlich seine eigene Abteilung, ein Teamadmin ausschließlich sein Team. Rollen und Mitgliedschaften kommen aus der Datenbank, nicht aus einer Liste im Template.

**Umgesetzt am 2026-08-06.** Migration `2026080601_structure_and_invitations.sql` (nicht `2026080403` wie ursprünglich geplant — Dateiname folgt dem tatsächlich nächsten freien Datum nach den zwischenzeitlich gebauten Paketen 009/022). E-Mail-Versand: generisches SMTP (nicht Supabase Auth Invite, nicht Resend/Postmark) mit einem `fake`-Provider für lokale Entwicklung, siehe „Risiken“ und „Adversariale Prüfung“. Die adversariale Prüfung dieses Pakets fand einen kritischen Rechte-Fund (Rang-Check fehlte beim Entfernen/Degradieren, nicht nur beim Vergeben) sowie zwei weitere Mandantentrennungs-Funde, die alle vor Fertigstellung behoben wurden — siehe unten.

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

**Umsetzungshinweis**: kein neues `assertScopedPermission` gebaut — diese Regel war bereits vollständig durch den bestehenden Mechanismus abgedeckt. `apps/api/src/auth.ts`s `requirePermission`/`SupabaseRoleProvider.rolesForScope` fragt Rollen **immer nur für den konkreten Zielscope** ab (z. B. `department_memberships` gefiltert auf `department_id = <Zielabteilung>`); ein `department_admin` aus „Fußball“ hat dort schlicht keine Zeile für „Handball“ und `hasPermission` liefert `false`. Das ist dieselbe Prüfung, die schon für alle post.*-Berechtigungen aus früheren Paketen gilt — sie musste nur auf die neuen Permissions `team.manage`/`member.invite`/`member.remove` angewendet werden, nicht neu erfunden.

Eskalationsschutz:

> Niemand darf eine Rolle vergeben, die mächtiger ist als die eigene, und niemand darf sich selbst eine höhere Rolle geben. `organization_owner` ist ausschließlich durch einen bestehenden `organization_owner` vergebbar.

**Umsetzung**: `canAssignRole(actorRoles, role)` in `packages/authorization` (TS) und `authz.can_assign_role(...)` (SQL, RLS-seitig dieselbe Logik) — ein Rang je Rolle (`organization_owner`=100 … `viewer`=5), `organization_owner` ist nie vergebbar. **Beim adversarialen Review dieses Pakets als unvollständig erkannt**: die ursprüngliche Regel spricht nur vom *Vergeben*, aber ohne einen spiegelbildlichen Check beim *Entfernen/Degradieren* könnte ein `organization_admin` (Rang 90) einen `organization_owner` (Rang 100) entfernen oder herabstufen — die Löschung eines Rang-100-Akteurs durch einen Rang-90-Akteur ist strukturell dieselbe Eskalation wie ein verbotenes Vergeben, nur rückwärts. Ergänzt um `canRemoveRole(actorRoles, targetRole)`/`authz.can_remove_role(...)`: identischer Rang-Vergleich, aber **ohne** die `organization_owner`-Ausnahme (ein `organization_owner` darf einen anderen `organization_owner` entfernen, Rang 100 ≤ 100). Siehe „Adversariale Prüfung“ unten.

## Datenmodell

Migration `2026080601_structure_and_invitations.sql` (tatsächlicher Dateiname, siehe „Ergebnis“ oben). Zusätzlich zum unten skizzierten SQL, das im Kern wie geplant umgesetzt wurde:

- `departments.archived_at`/`teams.archived_at` (siehe „Archivieren statt Löschen“ unten) plus Trigger `prevent_department_delete_with_content()`/`prevent_team_delete_with_content()`, die ein Löschen mit vorhandenen `submissions`/`posts` verhindern (sonst würde `on delete cascade` Inhalte unwiederbringlich mitreißen).
- `authz.role_rank(role)`, `authz.actor_max_role_rank(org, dept, team)`, `authz.can_assign_role(...)`, `authz.can_remove_role(...)` — siehe „Rollenmodell“ oben und „Adversariale Prüfung“ unten für den nachträglich ergänzten `can_remove_role`.
- `public.create_department(org, name)` — security definer statt RLS-Insert-Policy, weil die Slug-Vergabe denselben Kollisions-Retry wie `create_organization()` braucht (race-safe).
- `public.email_has_membership(...)` — security definer, prüft ob eine E-Mail-Adresse im Zielscope bereits Mitglied ist (für den Einladungsflow). **Ursprünglich ohne eigene Berechtigungsprüfung gebaut, beim Mandantentrennung-Review als Cross-Tenant-Orakel erkannt und um denselben `member.invite`-Check ergänzt, den auch das eigentliche Anlegen der Einladung verlangt.**
- `public.accept_invitation(raw_token)` — security definer, Hash-Vergleich, E-Mail-Abgleich, legt Mitgliedschaft an, schreibt `audit_events`.
- `authz.shares_organization_with(target_user_id)` + Policy `profiles_select_co_member` auf `public.profiles` — **nicht ursprünglich geplant, aber notwendig**: die bestehende `profiles_select_self`-Policy (Paket 008) ließ jeden Nutzer ausschließlich seine eigene Zeile lesen. Die Mitgliederliste (`GET /v1/organizations/:id/members`) zeigt aber Namen aller Vereinsmitglieder — auf ausdrücklichen Nutzerwunsch **vereinsweit, nicht nur innerhalb derselben Abteilung/Team** —, wofür die bisherige Policy `display_name` für jeden außer sich selbst als „Unbekannt“ zurückgab (beim manuellen Smoke-Test gefunden).

Migration `2026080601_structure_and_invitations.sql` — der ursprünglich geplante SQL-Kern (Constraint-Name inzwischen `invitations_role_matches_scope` statt `invitations_role_check`, da er die Rolle direkt gegen die jeweilige Scope-Ebene prüft, nicht nur gegen eine flache Liste):

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
-- invitations_role_matches_scope statt einer flachen invitations_role_check: prueft die Rolle
-- direkt gegen die jeweilige Scope-Ebene, nicht nur gegen die Vereinigung aller Rollen (siehe
-- authz.can_assign_role/can_remove_role fuer den Rang-basierten Eskalationsschutz obendrauf).
alter table public.invitations add constraint invitations_role_matches_scope check (
  (team_id is not null and role = any(array['team_manager', 'contributor', 'viewer'])) or
  (team_id is null and department_id is not null and role = any(array['department_admin', 'editor', 'approver', 'contributor', 'viewer'])) or
  (department_id is null and role = any(array['organization_admin', 'social_manager', 'billing_admin', 'organization_viewer']))
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
- Jede Operation prüft `requirePermission` (siehe Rollenmodell oben) und schreibt `audit_events`. Der Eskalationsschutz läuft über `canAssignRole` (Vergeben, `POST`/`PATCH`) **und** `canRemoveRole` (Entfernen/Herabstufen, `DELETE`/`PATCH`) — letzteres wurde erst beim adversarialen Review ergänzt, siehe unten.
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

Der Workflow-Name `cleanup-expired-invitations` ist in `WorkflowNameSchema` reserviert, **der eigentliche Hatchet-Cron ist nicht gebaut** — dieselbe Situation wie `collect-analytics` (Paket 017) im bestehenden Rückbau-Inventar: ein reservierter, ungenutzter Name ist ein etabliertes, akzeptiertes Muster in diesem Repo, kein Rückbau-Verstoß. Paket 004 (Hatchet produktionsreif) müsste den eigentlichen Cron-Trigger bauen. **Bekannte Konsequenz**: abgelaufene, nie angenommene Einladungen bleiben unbegrenzt in der Tabelle stehen und blockieren (über `invitations_open_unique`) eine erneute Einladung derselben Adresse in demselben Scope, bis sie manuell widerrufen werden.

### 4. Oberfläche

`pages/mitglieder.vue` wurde ersetzt durch:

- Liste mit Anzeigename, allen Rollen als Chips mit Ebenenangabe (Vereinsname/Abteilungsname/Teamname), Ablaufdatum falls gesetzt
- Aktionen ausschließlich sichtbar, wenn `useCan` sie erlaubt: Rollen-Chip entfernen (Mitgliedschaft entfernen)
- eigener Bereich für offene Einladungen mit Status, Ablauf und den Aktionen erneut senden / widerrufen
- Einladungsdialog: E-Mail, Ebene, Rolle. Die Rollenauswahl zeigt nur Rollen, die der Handelnde vergeben darf (`canAssignRole`, clientseitig als Komfort — die echte Durchsetzung bleibt serverseitig)
- Empty State: „Noch seid ihr allein hier“ mit direkter Einladungsaktion

**Bewusst nicht umgesetzt** (Scope-Reduktion gegenüber diesem Plandokument, Aufwand/Nutzen-Abwägung beim Bau):
- Kein separater Scope-Filter (ganzer Verein / Abteilung / Team) und keine Namenssuche — bei den heute üblichen Vereinsgrößen ist eine einzige Liste überschaubar; kann bei Bedarf ergänzt werden, ohne das Datenmodell zu ändern.
- Kein Rollenwechsel-Button (nur Entfernen) — `PATCH /v1/memberships/:id` ist vollständig implementiert und getestet, die UI ruft ihn nur noch nicht auf.
- Keine Befristung (`expires_at` setzen) aus der Oberfläche — die Spalte existiert und wird von allen `authz`-Funktionen bereits geprüft (siehe Datenmodell), nur kein UI-Formular dafür.
- Die in Paket 011 vorgesehene aufklappbare Detailebene je Mitglied ist wie geplant nicht Teil dieses Pakets.

Neue Seite `pages/struktur.vue`: Baum aus Verein → Abteilungen → Teams, Anlegen, Umbenennen, Archivieren/Wiederherstellen, Löschen (mit 409 bei vorhandenem Inhalt). **Der Abteilungswähler in `layouts/default.vue` bekam entgegen der ursprünglichen Planung keine Teamebene** — das erfordert Änderungen an `useScope()`/`ActiveScope` (heute `{organizationId, departmentId}`, keine dritte Ebene) und an jeder Stelle, die `useCan()`/`useScope()` konsumiert; das wurde als eigener, nicht trivialer Umbau eingeschätzt und zurückgestellt, um den Umfang dieses ohnehin großen Pakets nicht weiter auszudehnen. Teams sind über `/struktur` und `/mitglieder` vollständig verwaltbar, nur die schnelle Sidebar-Umschaltung fehlt.

### 5. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `pages/mitglieder.vue:1` | vier hartkodierte Namen, funktionsloser Button | echte Mitglieder und Einladungen |
| `layouts/default.vue:82-91` | ✓ 008: echte Abteilungen aus `useSession()`, nur Abteilungsebene | zusätzlich Teamebene |
| `useDemoData.ts` | ✓ 008: Datei gelöscht | – |

## Adversariale Prüfung

Fünf parallele Perspektiven (Mandantentrennung, Rechte, Geheimnisse, Verträge, Rückbau) auf die fertige Implementierung. Alle nachfolgend echten Funde wurden vor Fertigstellung behoben und mit einem Regressionstest (pgTAP, Vitest oder beidem) abgesichert.

**Rechte — kritisch:** `DELETE`/`PATCH /v1/memberships/:id` prüften den Rang des Akteurs nur gegen die **neu zuzuweisende** Rolle (`canAssignRole`), nie gegen die **aktuelle** Rolle der Zielzeile. Ein `organization_admin` (Rang 90) konnte dadurch einen `organization_owner` (Rang 100) entfernen oder auf eine niedrigere Rolle herabstufen, solange mindestens ein weiterer Owner übrig blieb (`prevent_last_owner_removal` greift nur beim letzten). Behoben durch `canRemoveRole`/`authz.can_remove_role` (siehe „Rollenmodell“ oben), angewendet in beiden Routen **und** in den drei `*_memberships_delete`-RLS-Policies. Zusätzlich gefunden: `authz.has_team_permission` (aus Paket 008) fehlte ein `revoke ... from public` — praktisch geringe Auswirkung (Funktion ist strikt an `auth.uid()` gebunden), aber inkonsistent zum sonst durchgehaltenen Muster; direkt mitbehoben, ebenso für `has_team_membership`/`membership_scopes` (dieselbe Lücke, seit Paket 008 unbemerkt). `invitations_update`s RLS-Policy bekam zusätzlich denselben `can_assign_role`-Check wie `invitations_insert` (defensiv, da `resend`/`revoke` `role` nie ändern, aber ein direkter PostgREST-Zugriff das theoretisch könnte).

**Mandantentrennung — kritisch:** `public.email_has_membership()` war `security definer` **ohne jede eigene Berechtigungsprüfung** — jeder authentifizierte Nutzer konnte für eine beliebige fremde `organization_id`/E-Mail-Adresse abfragen, ob dort eine Mitgliedschaft existiert (Cross-Tenant-Informationsleck). Behoben um denselben `member.invite`-Check, den auch das Anlegen der Einladung selbst verlangt. Zweiter Fund: `POST /v1/invitations` baute den zu prüfenden Scope direkt aus den vom Client gesendeten `organizationId`/`departmentId`/`teamId` zusammen, ohne zu verifizieren, dass diese wirklich zusammengehören — ein Akteur konnte theoretisch eine fremde `organizationId` mit der eigenen `departmentId` kombinieren und würde von `requirePermission` fälschlich durchgelassen (nur der `on delete cascade`-Fremdschlüssel auf `invitations` rettete das zufällig, als 23503 abgefangen von der API). Behoben durch `resolveInvitationScope()`, das `departmentId`/`teamId` serverseitig gegen ihre echte `organization_id` prüft, bevor überhaupt eine Berechtigung geprüft wird.

**Geheimnisse:** `EMAIL_PROVIDER` war unabhängig von `NODE_ENV` und konnte in Produktion versehentlich bei seinem `fake`-Standard bleiben — der Fake-Provider protokolliert die komplette Einladungsmail inklusive Rohtoken, ein vergessenes `EMAIL_PROVIDER=smtp` wäre ein stiller Secret-Leak ins Log gewesen. Behoben durch eine neue Produktionsvoraussetzung in `packages/config` (`EMAIL_PROVIDER` darf in Produktion nicht `fake` sein), analog zu den bereits bestehenden Pflichtfeldern für `SUPABASE_*`. Kein Fund beim Rohtoken selbst: es verlässt den Server nie über eine API-Antwort, nur über die E-Mail (jetzt zusätzlich durch einen Test abgesichert, der die komplette Response-Payload nach dem Token durchsucht).

**Verträge:** `CreateMembershipRequestSchema`/`UpdateMembershipRequestSchema` prüften — anders als `CreateInvitationRequestSchema` — nicht, ob die Rolle zur Scope-Ebene passt. Eine falsche Kombination (z. B. eine Vereinsrolle für eine Abteilungsmitgliedschaft) wäre erst am Postgres-Enum-Cast als unbehandelter 500 sichtbar geworden, statt als sauberer 400. Behoben durch eine gemeinsame, exportierte Rollen-Zuordnung (`ORGANIZATION_SCOPED_ROLES`/`DEPARTMENT_SCOPED_ROLES`/`TEAM_SCOPED_ROLES`/`rolesForScopeLevel`), die jetzt sowohl `CreateMembershipRequestSchema`s `superRefine` als auch `CreateInvitationRequestSchema`s bisher separat gepflegte, identische Arrays speist (behebt nebenbei das Risiko einer unbemerkten Drift zwischen beiden) sowie von der `PATCH`-Route direkt genutzt wird (dort liegt `scope` in der Query, nicht im Body, kann also nicht per Zod-`superRefine` geprüft werden).

**Rückbau:** Die Einladungsmail nannte für **jede** Einladung den Vereinsnamen als „Ziel-Ebene“, auch für Abteilungs- oder Team-Einladungen (`scopeName: organizationName` hartkodiert) — eine Angabe, die nicht der echten Ziel-Ebene entsprach. Behoben: `resolveInvitationScope()`/`resolveScopeName()` liefern jetzt den echten Abteilungs- bzw. Teamnamen. Zweiter Fund: der Plan verlangt explizit `audit_events` für jede Schreiboperation, keine der neuen Routen (Abteilungen/Teams/Mitgliedschaften/Einladungen) schrieb einen — nachgezogen für alle zwölf Schreib-Endpunkte (Annehmen einer Einladung schrieb bereits einen, seit der ursprünglichen Implementierung). Dritter Fund (nicht behoben, siehe „Umsetzung“/„Risiken“): die Teamebene fehlt im Sidebar-Abteilungswähler entgegen der ursprünglichen Planung — als bewusste Scope-Reduktion dokumentiert, nicht stillschweigend fallengelassen.

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test` — alle grün.
- pgTAP: 38 Assertions in `supabase/tests/structure_and_invitations.test.sql`, zusammen mit den bestehenden Suiten 119 Assertions über 5 Dateien. Negativ abgesichert u. a.: Abteilungsadmin aus „Fußball“ kann keine Mitgliedschaft in „Handball“ anlegen; `team_manager` kann keine Abteilungsmitgliedschaft anlegen; `organization_admin` kann einen `organization_owner` weder entfernen noch (über `can_remove_role` direkt geprüft) degradieren; Löschen der letzten Abteilung/des letzten Inhabers schlägt fehl; Löschen einer Abteilung/eines Teams mit Inhalt schlägt fehl; Einladung mit `organization_owner` oder scope-inkonsistenter Rolle verstößt gegen die Constraints; zweite offene Einladung für gleiche Adresse/Scope verstößt gegen den Unique-Index; `email_has_membership` verweigert einem nicht-berechtigten Aufrufer den Zugriff; kompletter Einladungs-Annahme-Fluss inkl. Team-Einladung (automatische Abteilungs-`viewer`-Zeile), abgelaufener Einladung, E-Mail-Mismatch.
- `packages/authorization`: 15 Tests (`hasPermission`, `canAssignRole`, `canRemoveRole` inkl. der Regression, dass Rang-Prüfung beim Entfernen genauso gilt wie beim Vergeben).
- `packages/contracts`: Regressionstests für scope-inkonsistente Einladungen/Mitgliedschaften, `organization_owner` nie zuweisbar, PostgREST-Zeitstempel mit Offset auf allen neuen Schemas (`DepartmentSchema`, `TeamSchema`, `MemberRoleEntrySchema`, `InvitationSchema`).
- `packages/config`: neuer Test, dass `EMAIL_PROVIDER=fake` in Produktion abgelehnt wird.
- API-Tests (`apps/api/src/app.test.ts`): 403 für fehlende Berechtigung auf Struktur-/Mitgliedschafts-/Einladungsrouten, 400 für scope-inkonsistente Rollen vor jedem DB-Zugriff, 409 für Kontingent-/Inhalts-/verantwortliche-Person-Konflikte, 429 für Resend-Limits, 403/410 für Annahme-Fehler, und ein expliziter Test, dass das Rohtoken nie in einer API-Antwort auftaucht (nur in der — im Test abgefangenen — ausgehenden E-Mail).
- manuell (Playwright, zwei Browserkontexte gegen den echten lokalen Stack): Vereinsinhaber registriert sich, legt Verein „SV Struktur Test“ mit Abteilung „Fussball“ an, legt über `/struktur` eine zweite Abteilung „Handball“ und ein Team an, lädt über `/mitglieder` eine zweite Person als `editor` in „Fussball“ ein; die eingeladene Person registriert sich separat, bestätigt ihre E-Mail, ruft den (aus dem API-Log extrahierten, da `EMAIL_PROVIDER=fake` lokal) Einladungslink auf und sieht danach ausschließlich „SV Struktur Test“/„Fussball“ mit der Rolle „Redakteurin“; der Vereinsinhaber sieht die Person danach mit echtem Namen (nicht „Unbekannt“) in der Mitgliederliste, die offene Einladung ist verschwunden.

## Risiken und offene Entscheidungen

- **E-Mail-Versand**: Nutzer hat sich für generisches SMTP entschieden (nicht Supabase Auth Invite, nicht Resend/Postmark) — kein Vendor-Lock-in, funktioniert mit jedem SMTP-Relay. Lokal gibt es keinen vom Host erreichbaren SMTP-Port für den Supabase-Inbucket-Container, deshalb ein `EMAIL_PROVIDER=fake`-Modus (Standard), der die komplette Mail nur protokolliert — analog zu `PUBLISHING_PROVIDER=fake`. In Produktion ist `fake` jetzt per Config-Validierung ausgeschlossen (siehe „Adversariale Prüfung“).
- **Team-Mitgliedschaft ohne Abteilungsmitgliedschaft**: wie geplant gelöst durch eine automatische `viewer`-Zeile in der Abteilung beim Annehmen einer Team-Einladung (`accept_invitation()`), nicht durch eine Erweiterung von `is_department_member`.
- **Rollen als Teil des Unique-Keys** macht Rollenwechsel zu Löschen-und-Anlegen — im Audit-Log jetzt als zwei `audit_events`-Zeilen sichtbar (`membership.role_changed` schreibt einen kombinierten Eintrag mit `fromRole`/`toRole` in den Metadaten, nicht zwei getrennte). `correlation_id` ist die Request-ID, verbindet also ohnehin alle innerhalb desselben Requests geschriebenen Audit-Zeilen.
- **Sidebar-Teamwahl nicht umgesetzt** (siehe „Umsetzung“ oben): `layouts/default.vue`s Abteilungswähler bietet weiterhin nur Verein/Abteilung, keine Teamebene. `useScope()`/`ActiveScope` müssten um ein drittes Feld erweitert werden, was mehrere Konsumenten (`useCan`, alle Seiten, die `scope.value.departmentId` lesen) berührt. Bewusst zurückgestellt, um den Umfang dieses Pakets nicht weiter auszudehnen — Teams sind über `/struktur` und `/mitglieder` vollständig nutzbar.
- **Rate-Limit für erneutes Senden umgehbar**: `POST /v1/invitations/:id/revoke` gefolgt von einem neuen `POST /v1/invitations` für dieselbe Adresse setzt `send_count`/`last_sent_at` zurück, da beide Limits (429 bei `send_count ≥ 10`, DB-Trigger 1×/Stunde) nur an der jeweiligen **Einladungszeile** hängen, nicht an der Adresse über die Zeit. Ein Akteur mit `member.invite` könnte dadurch eine Zieladresse mit E-Mails fluten. Erfordert bereits eine berechtigte Innentäterschaft (kein externer Angriff, kein Vorteil beim Erraten des Rohtokens, da jedes Token unabhängig 256 Bit Zufall ist) — beim Geheimnisse-Review gefunden, als geringes Risiko eingestuft und nicht behoben. Ein echtes, adressbezogenes Rate-Limit (z. B. über eine separate, scope-unabhängige Zähltabelle) wäre der nächste Schritt, falls das in der Praxis missbraucht wird.
- **Mitglieder-Detailebene aus Paket 011** (Einreichrecht, Prüfpflicht, Freigaberoute je Person) ist wie ursprünglich geplant nicht Teil dieses Pakets.
