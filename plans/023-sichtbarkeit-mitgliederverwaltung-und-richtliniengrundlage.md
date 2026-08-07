# 023 – Sichtbarkeit, Mitgliederverwaltung und Richtliniengrundlage

## Ergebnis

Drei Dinge, die beim Review von Paket 010 als Anforderung entstanden sind und die zusammengehören, weil sie dieselbe Mechanik brauchen:

- **Veröffentlichte Beiträge werden vereinsweit sichtbar.** Ein Teammitglied sieht, was seine Abteilung veröffentlicht hat, plus die Entwürfe des eigenen Teams — nicht die Entwürfe der Abteilung.
- **Mitgliedschaften werden aus der Oberfläche verwaltbar.** Rolle je Ebene, Befristung, Einladungsrecht — in einer aufklappbaren Detailebene je Mitglied, deren erlaubte Aktionen die API mitliefert, statt sie im Frontend ein zweites Mal herzuleiten.
- **Richtlinien mit Vererbung entstehen als Grundlage.** `policy_settings` mit `null` = erben und der Regel „untere Ebenen dürfen nur verschärfen“, zunächst mit genau zwei Feldern.

## Warum getrennt von Paket 011

Paket 011 (Freigaberouten, Vertrauen je Mitglied, Kontingente) braucht dieselbe Vererbungsmechanik, ist aber deutlich größer: mehrstufige Freigaberouten, Prüferzuordnung, Vertrauensregeln je Mitglied, Kontingente je Kanal, dazu der Umbau des Prüferzugangs. Diese Mechanik hier mit **zwei booleschen Feldern** zu bauen und zu beweisen, bevor die komplexe Freigabelogik darauf aufsetzt, ist der kleinere und besser prüfbare Schritt.

Dazu kommt: die Sichtbarkeitsänderung und die Mitgliederverwaltung sind unmittelbar nutzbar und schließen offene Punkte aus Paket 010 — sie sollten nicht warten, bis das gesamte Regelwerk steht.

**Reihenfolge:** dieses Paket kommt direkt nach 010 und **vor** 011, trotz der höheren Nummer. Die Nummer folgt nur dem nächsten freien Platz; eine Umnummerierung von 011–022 wäre teurer als diese Notiz (dieselbe Situation wie bei 021/022, siehe `plans/README.md`).

## Ausgangslage und Evidenz

Alles Folgende stammt aus dem Review von PR #7 (Paket 010) am 2026-08-05 und ist dort in „Nachtrag zweites Code-Review“ belegt.

- `authz.is_department_member` (`202608020001:284`) prüft die **Mitgliedschaft**, nicht die Rolle. Jede Inhaltspolicy setzt darauf auf: `posts_select` (`:417`), `submissions_select` (`:410`), `media_assets_select` (`202608030001:114`).
- `post_versions_select` (`202608020001:418`) prüft dagegen schon heute `authz.is_organization_member`. Der Fassungstext ist damit vereinsweit lesbar, der Beitrag selbst nicht auflistbar — ein bestehender Widerspruch.
- `public.accept_invitation()` (`2026080601`) legt bei einer Team-Einladung zusätzlich eine `viewer`-Mitgliedschaft in der Elternabteilung an, damit das Teammitglied überhaupt Inhalte sieht. Wegen des ersten Punktes macht das aus ihm ein vollwertiges Abteilungsmitglied.
- `member.invite` steckt fest in den Rollen `department_admin` und `team_manager` (`authz.has_department_permission`/`has_team_permission`, SQL-Funktionen in `supabase/migrations/2026080601_structure_and_invitations.sql:115,141`; die Rollen-Permission-Tabelle der API-Schicht in `packages/authorization/src/index.ts:63` trägt dieselbe Bindung ein zweites Mal). Der Verein bestimmt nur indirekt über die Rollenvergabe, wer einladen darf.
- `PATCH /v1/memberships/:id` (Rollenwechsel, atomar über `change_membership_role`), `POST /v1/memberships` und `expires_at` auf allen drei Mitgliedschaftstabellen existieren und sind getestet — es fehlt ausschließlich die Oberfläche.

## Fachliches Modell

### Vererbung: eine Richtung

> Der Verein setzt den Rahmen. Abteilung und Team dürfen ausschließlich verschärfen. Eine untere Ebene hebt keine Pflicht auf und erweitert keine Erlaubnis.

Das ist die Regel, die Paket 011 für Freigabe und Kontingente ausbuchstabiert. Hier gilt sie für zwei boolesche Felder, und genau daran wird die Auflösungsfunktion gebaut und geprüft:

| Feld | Verschärfung bedeutet |
|---|---|
| `invite_allowed` | `true → false`, nie zurück |
| `posts_visible_org_wide` | `true → false`, nie zurück |

`null` heißt „von oben erben“, nicht „false“. Der Unterschied ist die häufigste Fehlerquelle dieser Bauform und braucht eigene Tests: eine Abteilung ohne eigene Zeile verhält sich wie der Verein, eine Abteilung mit `false` verschärft.

### Sichtbarkeit richtet sich nach dem Lebenszyklus

Nicht nach einer Angabe des Erstellers. Der Ersteller ist der falsche Ort für einen Sichtbarkeitsschalter: ob ein Beitrag in einem vertraulichen Kanal landet, entscheidet die Kanalwahl — und die trifft der Freigebende bzw. Veröffentlichende später, nicht der Einreichende. Vertraulichkeit ist eine Eigenschaft des Kanals, nicht des Beitrags (`social_connections.confidential`, Paket 012).

| Was | Sichtbarkeit |
|---|---|
| Beiträge im Status veröffentlicht/geplant | vereinsweit: `posts_select` auf `authz.is_any_member_of_organization` für diese Zustände — **Korrektur beim Umsetzen**: `authz.is_organization_member` prüft ausschließlich `organization_memberships` und wäre für die meisten Mitglieder (reine Abteilungs- oder Teamrolle, ohne Organisationsrolle) immer falsch geblieben — die vereinsweite Sichtbarkeit hätte damit nur organization_admin/owner & Co. erreicht, nicht den ganzen Verein. Eine neue, eng gefasste Funktion `authz.is_any_member_of_organization` (Organisationsrolle oder eine beliebige Abteilungs-/Teammitgliedschaft) übernimmt das stattdessen, ohne `authz.is_organization_member` selbst zu verändern (das sichert u. a. `organizations_select_member`, `brand_profiles_select`, `consent_records_select`, `media_derivatives`/`social_connections`/`publications_select` — deren Sichtbarkeitsradius bleibt unverändert). |
| Entwürfe, Einreichungen, Freigabeverkehr | unverändert Abteilung plus Freigabekette |
| Entwürfe des **eigenen Teams** | zusätzlich für Teammitglieder: `or authz.has_team_membership(team_id)` in `posts_select`/`submissions_select` |
| `media_assets`, `face_regions`, `consent_records` | unverändert abteilungsweit — Medienrecht und Minderjährigenschutz, nicht Geheimhaltung |
| Ausnahme „diese Abteilung nicht vereinsweit“ | `policy_settings.posts_visible_org_wide` |

Begründung des Nutzers für den Default: was auf Social Media steht, ist ohnehin öffentlich, und die Leute im Verein erfahren so mehr über die anderen Abteilungen und Teams.

Falls doch ein Ersteller-Schalter gewünscht wird: als Opt-out **beim Veröffentlichen**, wenn der Kanal bekannt ist — nicht beim Einreichen.

## Datenmodell

Migration `<datum>_visibility_and_policy_foundation.sql`:

```sql
create type public.policy_scope as enum ('organization','department','team');

create table public.policy_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid, team_id uuid,

  invite_allowed boolean,            -- null = erben
  posts_visible_org_wide boolean,    -- null = erben

  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check ((scope = 'organization' and department_id is null and team_id is null)
      or (scope = 'department'   and department_id is not null and team_id is null)
      or (scope = 'team'         and department_id is not null and team_id is not null)),
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade
);

create unique index policy_settings_org_unique  on public.policy_settings (organization_id) where scope = 'organization';
create unique index policy_settings_dep_unique  on public.policy_settings (organization_id, department_id) where scope = 'department';
create unique index policy_settings_team_unique on public.policy_settings (organization_id, team_id) where scope = 'team';
```

`public.policy_scope` und `public.policy_settings` entstehen hier; Paket 011 **erweitert** dieselbe Tabelle um die Freigabe- und Kontingentfelder, legt sie nicht neu an. Paket 012 nutzt `policy_scope` bereits für `social_connections.owner_scope` — dieses Paket muss deshalb vor 012 liegen oder 012 den Typ selbst anlegen.

Auflösungsfunktion, an den zwei Feldern gebaut und von 011 wiederverwendet:

```sql
-- Innerste vorhandene Festlegung gewinnt, aber nur verschaerfend: sobald eine Ebene false
-- setzt, bleibt es false, egal was darunter steht.
create or replace function authz.resolve_policy_flag(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid, flag text
) returns boolean
```

Sichtbarkeit, drei Änderungen, umgesetzt in zwei Migrationen (`2026080603_post_visibility.sql`, unbedingt vor allem anderen und mit eigener pgTAP-Abdeckung; `2026080604_policy_settings_and_invite_rights.sql` legt danach die Policy-Grundlage an und schichtet die `posts_visible_org_wide`-Ausnahme auf `posts_select`/`post_versions_select` drauf, siehe Risiken):

1. `posts_select` für veröffentlichte/geplante Beiträge auf `authz.is_any_member_of_organization`, sonst weiter `is_department_member`
2. `or authz.has_team_membership(team_id)` in `posts_select` und `submissions_select`
3. Wegfall der `viewer`-Zeile in `accept_invitation()`

Einzeln angewendet entsteht jeweils eine Lücke: ohne (1) und (2) verliert ein reines Teammitglied jeden Inhaltszugriff, ohne (3) bleibt der zu breite Zugriff bestehen. `authz.is_department_member` selbst wird **nicht** angefasst — darauf setzt jede bestehende Inhaltspolicy auf, die zusätzliche `or`-Bedingung an genau zwei Policies ist der kleinere Eingriff. `post_versions_select` wird gemeinsam mit `posts_select` angefasst (per `exists`-Join auf `posts`, da `post_versions` kein `department_id`/`team_id` trägt), damit die Ebene nicht wieder auseinanderläuft.

## Umsetzung

### 1. Einladungsrecht als Richtlinie

`invite_allowed` wirkt dort, wo eine **neue** Mitgliedschaft oder Einladung entsteht: die drei `*_memberships_insert`-Policies, `invitations_insert` und `public.create_invitation()` (dort zusätzlich zum bestehenden `has_*_permission`-Check, da die Funktion RLS umgeht) sowie die Ebenenauswahl in `pages/mitglieder.vue`. Eine Abteilung, für die der Verein `invite_allowed = false` setzt, kann niemanden mehr einladen — unabhängig davon, wer dort `department_admin` ist.

**Korrektur beim Umsetzen**: *nicht* in `authz.has_department_permission`/`has_team_permission` selbst, wie ursprünglich hier notiert. Diese beiden Funktionen werten `member.invite` auch innerhalb von `change_membership_role()` (Paket 010) aus, um einen **Rollenwechsel** eines bereits bestehenden Mitglieds zu autorisieren — eine Änderung dort hätte `invite_allowed = false` also auch das Verwalten bestehender Mitglieder entzogen, was mit „kann niemanden mehr einladen“ nicht gemeint ist. Der Check sitzt deshalb einzeln an den oben genannten Neuanlage-Stellen.

### 2. Mitglieder-Detailebene: ein Vertrag für Oberfläche und API

Eine aufklappbare Detailebene je Mitglied auf `/mitglieder`, **nicht** ein separater Rollen-Editor — sonst konkurrieren zwei Mitglieder-Detail-Oberflächen, und Paket 011 füllt dieselbe Ebene mit Prüfpflicht und Freigabe-Zuständigkeit.

Sie trägt: Rolle je Ebene (Verein/Abteilung/Team), Befristung (`expires_at`), Einladungsrecht. Paket 011 ergänzt Freigabe-Zuständigkeit (`policy_reviewers`, `review_mode = 'named'`) und Vertrauen (`member_review_trust`).

Begründung des Nutzers: Zuständigkeiten im Verein ändern sich laufend — „Leute kommen und gehen und übernehmen mal mehr mal weniger Aufgaben. Wer z. B. verantwortlich für die Freigabe von Posts ist, kann sich häufiger mal ändern.“

**Verbindlich: die Berechtigung kommt aus einer Quelle, nicht aus zwei.** Die Antwort der API trägt je Mitglied und je Aktion mit, ob der Handelnde sie ausführen darf (`canChangeRole`, `canRemove`, `canSetExpiry`, …), server-seitig berechnet aus denselben Funktionen, die die Route selbst durchsetzt. Die Oberfläche zeigt und schickt nur, was dort steht, statt die Regeln mit `useCan`/`canAssignRole` ein zweites Mal herzuleiten; Fehlschläge werden mit der Fehlerkennung der API benannt, nicht generisch verschluckt.

Grund ist Erfahrung, nicht Vorsicht: **beide funktionalen Fehler, die das Nachfolge-Review von Paket 010 fand, waren genau diese Doppelherleitung.** Das Einladungsformular hing an vereinsweitem `member.invite` und war für Abteilungs- und Teamverantwortliche unsichtbar, obwohl API und RLS ihre Einladungen erlauben; und die Team-Einladung schickte eine Scope-Kette, die das Contract-Schema serverseitig verlangt, aber clientseitig niemand kannte. Beides kann nicht auftreten, wenn die Oberfläche die Berechtigungen nicht selbst herleitet.

Das Capability-Feld gehört ins Antwortschema in `packages/contracts`, damit Frontend und API denselben Vertrag teilen.

### 3. Richtlinienoberfläche, kleine Fassung

Zwei Schalter je Ebene mit sichtbarer Vererbung: **geerbt** (Wert grau, Herkunftsebene benannt), **verschärft** (eigener Wert plus Herkunft), **gesperrt** (obere Ebene lässt keine Lockerung zu, Bedienelement deaktiviert mit Begründung). Paket 011 erweitert dieselbe Darstellung um seine Felder — die drei Zustände entstehen hier und werden dort nicht neu erfunden.

### 4. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `accept_invitation()` | legt bei Team-Einladung eine Abteilungs-`viewer`-Zeile an | ✓ entfällt, ersetzt durch die Policy-Änderung (`2026080603_post_visibility.sql`) |
| `pages/mitglieder.vue` | Rollen-Chip entfernen, sonst keine Bearbeitung | ✓ Detailebene mit Rolle und Befristung je Mitgliedschaft; Einladungsrecht sitzt als Scope-Feld bewusst auf `/struktur`, nicht pro Mitgliedschaftszeile |
| `POST /v1/memberships` | legt für Team-Mitgliedschaften keine Abteilungszeile an (Paket 010, offener Punkt) | ✓ erledigt sich mit dem Wegfall der `viewer`-Zeile |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- pgTAP: ein reines Teammitglied sieht veröffentlichte Beiträge seiner Abteilung **und** Entwürfe des eigenen Teams, aber **keine** Entwürfe der Abteilung; ein Abteilungsmitglied sieht weiterhin alles seiner Abteilung; ein Vereinsfremder sieht nichts. `null` gegen `false` bei beiden Flags über alle drei Ebenen. `invite_allowed = false` auf Vereinsebene verhindert eine Einladung durch einen `department_admin`, `create_invitation()` inbegriffen.
- API-Tests: die Capability-Felder der Mitgliederantwort stimmen mit dem überein, was die jeweilige Route tatsächlich durchsetzt — für `organization_admin`, `department_admin`, `team_manager` und ein rollenloses Mitglied. Das ist der Test, der die Doppelherleitung aus Paket 010 verhindert.
- manuell: zwei Browserkontexte, eine Person nur im Team. Sie sieht den veröffentlichten Beitrag der Abteilung, nicht dessen Entwurf.

## Risiken und offene Entscheidungen

- **Die Sichtbarkeitsmigration fasst Policies an, auf denen alles aufsetzt.** Sie gehört in eine eigene Migration mit vollständiger pgTAP-Abdeckung vor allem anderen in diesem Paket, damit ein Fehler dort nicht mit Oberflächenarbeit vermischt ist. **Umgesetzt** als eigene, zuerst angewendete Migration `2026080603_post_visibility.sql`.
- **`posts.status`**: die Sichtbarkeitsregel unterscheidet veröffentlicht/geplant von allem davor. Beim Umsetzen prüfen, ob der vorhandene Status das ohne neue Spalte hergibt. **Geklärt**: der vorhandene Enum reicht; die Regel greift genau auf `status in ('published', 'scheduled')`. `publishing`/`partially_published`/`failed`/`cancelled` bleiben bewusst abteilungs-/teamgebunden (kein Publikationszustand, für den der Plan ausdrücklich vereinsweite Sichtbarkeit fordert) — falls das im Betrieb als Lücke auffällt, ist es eine bewusste Nachschärfung, keine vergessene Fallunterscheidung.
- **Vertrauliche Kanäle** (`social_connections.confidential`, Paket 012) können die vereinsweite Sichtbarkeit einschränken. Offen ist, ob das als eigene Bedingung in `posts_select` oder abgeleitet über `posts_visible_org_wide` gelöst wird — einen Weg wählen, nicht beide bauen. **Geklärt in Paket 012** (erledigt): eigene Bedingung, nicht abgeleitet — `authz.post_is_not_confidential_only(...)` als zusätzliches `AND` in `posts_select`/`post_versions_select`, restriktiv nur wenn Publikationen existieren **und** alle davon vertraulich sind (keine Publikation ist keine Aussage über Vertraulichkeit). Details in `plans/012-kanaele-und-social-accounts.md`, Abschnitt „Umsetzung: Ergebnis und Abweichungen vom Plan“.

## Umsetzung: Ergebnis und Abweichungen vom Plan

Umgesetzt in drei Migrationen (`2026080603_post_visibility.sql`, `2026080604_policy_settings_and_invite_rights.sql`, `2026080605_membership_expiry.sql`), den entsprechenden Contracts/API-Erweiterungen und der Oberfläche auf `/struktur` (Richtlinien je Ebene) und `/mitglieder` (Detailebene). 189 pgTAP-Tests, 51 API-Tests, `pnpm lint`/`typecheck`/`test`/`build` grün, manuell im Browser gegengeprüft (Login, Toggle-Klick mit echtem PUT-Roundtrip, Rollenwechsel- und Befristungsformular).

Abweichungen, die sich beim Bauen als nötig erwiesen und oben bereits an der jeweiligen Stelle korrigiert sind:

- **`authz.is_any_member_of_organization` statt `authz.is_organization_member`** für die vereinsweite Sichtbarkeit (siehe "Sichtbarkeit richtet sich nach dem Lebenszyklus" oben) — die bestehende Funktion hätte die vereinsweite Sichtbarkeit auf Organisationsrollen beschränkt, nicht auf jedes Vereinsmitglied.
- **`invite_allowed` sitzt an den Neuanlage-Stellen selbst** (die drei `*_memberships_insert`-Policies, `invitations_insert`, `create_invitation()`), **nicht** in `authz.has_department_permission`/`has_team_permission` — sonst hätte es auch `change_membership_role()` (Rollenwechsel bestehender Mitglieder) betroffen, was nicht gemeint ist (siehe "Umsetzung 1." oben).
- **Befristung braucht eine eigene RPC** (`public.set_membership_expiry`, Migration `2026080605`) und einen eigenen Endpunkt (`PATCH /v1/memberships/:id/expiry`): weder `POST /v1/memberships` noch `PATCH /v1/memberships/:id` konnten vor diesem Paket überhaupt `expires_at` setzen — die Phase-1-Evidenz ("existieren und sind getestet") bezog sich auf die Spalte, nicht auf einen Schreibpfad.
- **`policy_settings.updated_by` erhält einen spaltenweisen statt tabellenweiten Grant** (adversariale Prüfung, Geheimnisse): sonst hätte jedes Vereinsmitglied gesehen, wer zuletzt eine fremde Abteilung/Team-Richtlinie geändert hat.
- **`GET`/`PUT` der Policy-Settings lesen den Organisationsnamen über den Service-Client**, nicht den Nutzer-Client (adversariale Prüfung, Rechte): `organizations_select_member` verlangt eine Organisationsrolle, die ein reiner Abteilungs- oder Team-Admin nicht hat, aber laut diesem Paket Richtlinien für seine eigene Ebene sehen und setzen darf.
- **Kritischer Fund beim manuellen Browser-Test, außerhalb dieses Pakets, aber hier behoben, weil er die neue Oberfläche blockierte**: die CORS-Konfiguration in `apps/api/src/app.ts` (seit Paket 008/009) setzte nie `methods`, wodurch `@fastify/cors` auf seinen Default `GET,HEAD,POST` zurückfiel — jede PATCH/PUT/DELETE-Anfrage aus dem echten Browser scheiterte am Preflight, unabhängig vom Paket. Betraf nicht nur die neuen Routen, sondern auch bestehende Aktionen auf `/struktur` (Umbenennen, Archivieren, Löschen) und `/mitglieder` (Entfernen, Rollenwechsel). `vitest`/`app.inject()` umgeht CORS vollständig und deckte das nie auf. Jetzt behoben durch einen expliziten `methods`-Wert.
- **Bekannte, nicht behobene Randbeobachtung** (adversariale Prüfung, Mandantentrennung): `POST /v1/invitations` und `POST /v1/invitations/:id/resend` lesen den Organisationsnamen ebenfalls über den Nutzer-Client (`apps/api/src/app.ts`, vor diesem Paket entstanden) — hätte für einen Abteilungs-Admin ohne Organisationsrolle denselben Fehler wie oben beheben können, war aber nicht Teil dieses Pakets und wurde nicht angefasst.
- **Restbeobachtung, nicht behoben**: `UpdateMembershipExpiryRequestSchema` akzeptiert ein Datum in der Vergangenheit ohne Warnung — wirkt dann wie ein sofortiger, stiller Entzug der Mitgliedschaft (RLS behandelt eine abgelaufene Mitgliedschaft bereits heute so). Funktional korrekt, aber unbedacht dokumentiert; als bewusst offen gelassen markiert statt spekulativ verändert.
