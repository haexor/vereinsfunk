# 011 – Regelwerk: Freigaberouten, Vertrauen je Mitglied und Kontingente

## Ergebnis

Jeder Knoten — Verein, Abteilung, Mannschaft — bestimmt für alles unter sich: wer Beiträge einreichen darf, ob sie vorher geprüft werden müssen und von wem. Und das nicht nur pauschal, sondern bis auf die einzelne Person.

Damit sind die Fälle möglich, um die es wirklich geht: Der Verein verlangt, dass jeder Beitrag durch das Marketing geht. Die Abteilung Fußball hat eine Medienverantwortliche, die zusätzlich prüft. Im E-Jugend-Team dürfen Eltern und Spieler Spielberichte schreiben — aber erst nachdem der Trainer sie abgenickt hat. Die Medienverantwortliche selbst darf ohne Prüfung veröffentlichen. Ein Beitrag mit einem Kind auf dem Bild braucht die strengere Route, egal wie sehr jemandem vertraut wird.

Diese Regeln stehen in der Datenbank, werden serverseitig zu einer Route aufgelöst, in die Beitragsversion eingefroren und beim Einreichen, Freigeben und Veröffentlichen tatsächlich durchgesetzt.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- `packages/domain/src/index.ts:47-87` enthält `EffectiveConfig` und `mergeEffectiveConfig` mit korrekter Verschärfungssemantik: `approvalRequired` per `||`, `minimumApprovals` per `Math.max`, `forbiddenTopics` per Vereinigung. **Diese Funktion wird von keinem Produktionspfad aufgerufen** — nur von `packages/domain/src/domain.test.ts`.
- Es existiert **keine Tabelle für Richtlinien.** Der einzige konfigurierbare Ort ist `organization_brand_profiles.settings` als freies `jsonb` (`202608020001:127`) ohne Schema und ohne Abteilungsebene.
- `approval_requests` (`:200-216`) kennt `required_approvals integer` und `requires_minor_approval boolean`. **Eine Zahl kann keine Kette ausdrücken.** „Eine Freigabe vom Trainer und eine vom Marketing“ ist nicht dasselbe wie „zwei Freigaben“ — bei zwei kann derselbe Personenkreis zweimal zustimmen.
- `approval_decisions` hat `unique (approval_request_id, decided_by)` (`:227`) — eine Person entscheidet pro Anfrage einmal. Für eine mehrstufige Route muss das zu „einmal pro Stufe“ werden, mit einer zusätzlichen Regel gegen dieselbe Person auf mehreren Stufen.
- `authz.can_approve_post_version` (`:351-365`) prüft `post.approve` **in der Abteilung des Beitrags**. Das ist die zentrale Blockade für das Marketing-Szenario: eine Person aus der Abteilung Marketing hat keine Mitgliedschaft in der Abteilung Fußball und kann deren Beiträge damit weder freigeben noch überhaupt sehen. Alle Inhaltspolicies bauen darauf auf — `posts_select` (`:417`) verlangt `is_department_member`. **Korrektur nach Paket 023**: `posts_select` verlangt das nur noch für Entwürfe und laufende Freigaben. Für `published`/`scheduled` gilt zusätzlich `authz.is_any_member_of_organization` (vereinsweite Sichtbarkeit), für Teamitglieder zusätzlich die eigene Teammitgliedschaft (`2026080603_post_visibility.sql`, `2026080604_policy_settings_and_invite_rights.sql:277-304`). Das Marketing-Szenario bleibt für den Prüferzugang unverändert bestehen — ein noch nicht veröffentlichter Beitrag ist über keinen der neuen Zweige sichtbar —, aber die pauschale Aussage „`posts_select` verlangt `is_department_member`“ gilt nicht mehr uneingeschränkt.
- Die Funktion prüft außerdem **nicht**, ob der Freigebende der Autor ist. Selbstfreigabe ist heute möglich.
- `post_versions.effective_config_snapshot` (`:178`) ist `not null` mit Objekt-CHECK — das Einfrieren ist vorgesehen und wird von nichts gefüllt.
- `packages/authorization/src/index.ts:40,55,60` verteilt `post.approve` an `social_manager`, `department_admin` und `approver`. Eine benannte Einzelperson als Prüferin ist im Modell nicht vorgesehen.
- `apps/web/app/pages/einstellungen.vue:1` zeigt fünf hartkodierte Zeilen, darunter „Jeder Beitrag benötigt eine menschliche Freigabe“ und „Minderjährigenschutz · Sonderfreigabe ist aktiv“. Jeder „Bearbeiten“-Button ist ohne Handler. **Vier der fünf Aussagen sind im System nirgends abgebildet.**
- Es gibt **keine Kontingente**: keine Tabelle, kein Zähler, keine Prüfung.
- `apps/api/src/app.ts:343-373` nimmt eine Submission an, ohne irgendeine Richtlinie zu konsultieren.

## Abhängigkeit: Paket 023 ist erledigt

Beim Review von Paket 010 sind drei Anforderungen entstanden, die dieselbe Vererbungsmechanik brauchen wie dieses Paket, aber deutlich kleiner sind: vereinsweite Sichtbarkeit veröffentlichter Beiträge, die Mitglieder-Detailebene und das delegierbare Einladungsrecht. Sie sind nach `plans/023-sichtbarkeit-mitgliederverwaltung-und-richtliniengrundlage.md` ausgelagert und am 2026-08-06 **vor** diesem Paket umgesetzt worden (siehe dort, Abschnitt „Umsetzung: Ergebnis und Abweichungen vom Plan“).

Was 023 mitbringt und dieses Paket voraussetzt:

- `public.policy_scope` und `public.policy_settings` **existieren bereits** (Migration `2026080604_policy_settings_and_invite_rights.sql`) — dieses Paket erweitert die Tabelle um die Freigabe- und Kontingentfelder, legt sie nicht neu an. Der Ausschnitt unter „Datenmodell“ zeigt sie deshalb vollständig, umzusetzen ist die Differenz.
- `authz.resolve_policy_flag(...)` und die Vererbungsregel („`null` = erben, untere Ebenen dürfen nur verschärfen“) sind an zwei booleschen Feldern gebaut und getestet (AND-Reduktion über Verein/Abteilung/Team).
- Die Mitglieder-Detailebene auf `/mitglieder` existiert mit Rolle und Befristung. Dieses Paket **füllt sie** mit Freigabe-Zuständigkeit (`policy_reviewers`) und Vertrauen (`member_review_trust`), statt eine zweite zu bauen. **Abweichung vom ursprünglichen Plan**: `invite_allowed` sitzt NICHT in dieser Detailebene, sondern als Scope-Feld auf `/struktur` (Komponente `PolicyFlagToggles.vue`, je Verein/Abteilung/Team) — es ist eine Eigenschaft der Ebene, nicht der einzelnen Mitgliedschaft. Freigabe-Zuständigkeit und Vertrauen gehören dagegen wirklich zur Person und damit in die Mitglieder-Detailebene.
- Die drei Vererbungszustände der Oberfläche (**geerbt**, **verschärft**, **gesperrt**) sind dort entstanden (`PolicyFlagToggles.vue`) und werden hier nicht neu erfunden. **Einschränkung**: die Komponente ist mit einem hartkodierten `fields`-Array und einem binären `stateFor()`-Ternary eng an genau die zwei bestehenden Flags gekoppelt, nicht generisch über beliebige Flags. Dieses Paket muss die Komponente selbst erweitern (weitere Flags, ggf. Freigabestufen als eigener Block), nicht nur ein neues Setting-Objekt durchreichen.
- **Verbindlich übernommen**: die erlaubten Aktionen kommen aus der API-Antwort (`canChangeRole`/`canRemove`/`canSetExpiry` auf `MemberRoleEntrySchema`), das Frontend leitet Berechtigungen nicht selbst her (Begründung in 023).
- **Neu, nicht im ursprünglichen 023-Plan vorgesehen**: `authz.is_any_member_of_organization` (statt des bestehenden `authz.is_organization_member`) für „vereinsweit“ — die bestehende Funktion prüft nur Organisationsrollen, nicht Abteilungs-/Teammitgliedschaft. Falls 011 an anderer Stelle „jedes Vereinsmitglied“ meint (nicht nur Organisationsrollen), diese Funktion wiederverwenden, nicht `is_organization_member`.

## Scope

- Migration: Richtlinien je Scope, Prüferreferenzen, Vertrauen je Mitglied, mehrstufige Freigabeanfragen, Kontingente
- `packages/domain`: Routenauflösung, Vertrauensauswertung, Kontingentprüfung — als reine Funktionen
- `authz`: Prüferzugang über Scope-Grenzen hinweg, Ersatz von `can_approve_post_version`
- RLS: Leserecht für zugewiesene Prüfer auf genau das, was zur Prüfung nötig ist
- API: Richtlinien pflegen, Route auflösen, Durchsetzung an vier Stellen
- Benachrichtigung der Prüfer
- Nuxt: Richtlinienseite mit sichtbarer Vererbung, Vertrauen je Mitglied, mehrstufige Freigabeansicht
- Rückbau der Einstellungs-Dummies

Nicht enthalten: Kanalverbindungen (012 — hier wird festgelegt, **welche** Kanäle erlaubt sind), Einwilligungsregeln im Detail (015), Auswertung der Freigabedauer (016).

## Fachliches Modell

### Vererbung: eine Richtung

> Der Verein setzt den Rahmen. Abteilung und Team dürfen ausschließlich verschärfen. Eine untere Ebene hebt keine Pflicht auf und erweitert keine Erlaubnis.

| Feld | Verschärfung bedeutet |
|---|---|
| `allowedPresets`, `allowedFormats`, `allowedChannelIds` | Schnittmenge (`null` = keine Einschränkung auf dieser Ebene) |
| `forbiddenTopics`, `requiredHashtags` | Vereinigung |
| `quotas` | jeweils das kleinere Limit |
| `minorApprovalRequired`, `mediaRequiresConsentCheck` | `false → true`, nie zurück |
| `selfApprovalAllowed` | `true → false`, nie zurück |
| Freigabestufen | **additiv**: jede Ebene kann eine Stufe hinzufügen, keine entfernen |

`null` gegen leere Liste ist bei `allowedPresets` und `allowedChannelIds` die häufigste Fehlerquelle: `null` heißt „keine Einschränkung“, `[]` heißt „nichts erlaubt“. Eigene Tests.

### Freigaberoute als geordnete Stufen

Jeder Knoten kann **eine** Prüfstufe für alles unter sich verlangen. Die Route eines Beitrags ist die Liste dieser Stufen, geordnet von innen nach außen:

```text
Beitrag entsteht im Team "E-Jugend" (Abteilung Fußball, Verein SV Nordstadt)

Stufe 1  Team E-Jugend      → benannt: Trainer
Stufe 2  Abteilung Fußball  → benannt: Medienverantwortliche
Stufe 3  Verein             → benannt: Rolle 'approver' in Abteilung Marketing
```

Sequenziell, nicht parallel: Stufe 2 öffnet erst, wenn Stufe 1 erfüllt ist. Das entspricht der Wirklichkeit — das Marketing soll nicht prüfen, was der Trainer noch ablehnen wird — und macht Ablehnungen billig. Parallele Stufen sind bewusst **kein** Feature; sie sparen Zeit, die im Vereinsalltag nicht das knappe Gut ist, und verdoppeln den Erklärungsbedarf.

Eine Stufe hat einen Modus:

- `any_with_permission` — jede Person mit `post.approve` im Scope der Stufe
- `named` — nur die benannten Prüfer

Prüferreferenzen sind mehr als Einzelpersonen, weil „das Marketing muss freigeben“ keine Namensliste sein soll:

```ts
type ReviewerRef =
  | { kind: 'user'; userId: string }
  | { kind: 'organization_role'; role: OrganizationRole }
  | { kind: 'department_role'; departmentId: string; role: DepartmentRole }
  | { kind: 'team_role'; teamId: string; role: TeamRole }
```

`{ kind: 'department_role', departmentId: <Marketing>, role: 'approver' }` löst den Vereinsfall ohne Namen — wer Marketing verlässt, verliert die Prüfrolle automatisch.

### Vertrauen je Mitglied

Ein Knoten kann für eine einzelne Person abweichen:

| Einstellung | Wirkung |
|---|---|
| `submit_allowed = false` | darf im Scope Entwürfe schreiben, aber nicht einreichen |
| `review_requirement = 'always'` | braucht Prüfung, auch wenn der Scope sie sonst nicht verlangt |
| `review_requirement = 'waived'` | darf ohne Prüfung veröffentlichen |
| `review_requirement = 'inherit'` | Standard |

Die entscheidende Regel, ohne die das Vertrauen die Vererbung aushebeln würde:

> Eine Befreiung, die auf Ebene L gewährt wurde, entfällt Stufen der Ebene L **und darunter**. Niemals Stufen darüber.

Die Abteilung kann ihre Medienverantwortliche von der Abteilungs- und Teamstufe befreien. Die Vereinsstufe „Marketing“ bleibt. Nur der Verein selbst kann von der Vereinsstufe befreien. `always` wirkt umgekehrt: auf jeder Ebene gesetzt, überlebt es jede Befreiung darunter.

Zwei Sicherungen dazu:

- Der Verein kann Befreiungen ganz verbieten (`allow_review_exemptions`, nur auf Vereinsebene wirksam). Ein Verein, der auf durchgängiger Prüfung besteht, soll das nicht abteilungsweise unterlaufen sehen.
- **Eine Befreiung entfällt niemals die Minderjährigenstufe.** Genau das ist der Grund: wenn Spieler und Eltern selbst Beiträge schreiben dürfen, darf keine Vertrauenseinstellung dazu führen, dass ein Foto eines anderen Kindes ohne die strengere Route hinausgeht. Das Vertrauen gilt der Person, nicht dem Risiko für Dritte.

Befreiungen sind befristbar (`expires_at`) und tragen eine Begründung. Beides ist im Audit sichtbar.

### Selbstfreigabe

Ist `selfApprovalAllowed = false`, wird der Autor auf jeder Stufe aus dem Prüferkreis genommen. Zusätzlich gilt standardmäßig: **wer auf einer inneren Stufe entschieden hat, entscheidet auf keiner äußeren mehr** (`allowSameReviewerAcrossStages`, Default `false`). Sonst nickt der Trainer, der zugleich Vereinsvorstand ist, seinen eigenen Beitrag zweimal ab, und die Kette ist Dekoration.

## Datenmodell

Migration `2026080606_policies_and_review_routes.sql` (der ursprünglich geplante Zeitstempel `2026080404` liegt vor den vier 023-Migrationen `2026080501`–`2026080605` und damit vor `2026080604_policy_settings_and_invite_rights.sql`, die `policy_settings` erst anlegt — mit dem alten Zeitstempel würde diese Migration vor ihrer eigenen Voraussetzung laufen):

```sql
create type public.policy_scope as enum ('organization','department','team');
create type public.review_mode as enum ('any_with_permission','named');

create table public.policy_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid, team_id uuid,

  -- Einreichen
  submit_requires_permission boolean,          -- null = erben
  -- Prüfstufe dieses Knotens
  review_required boolean,
  review_mode public.review_mode,
  review_stage_label text check (char_length(review_stage_label) <= 80),
  review_minimum_approvals integer check (review_minimum_approvals between 1 and 5),
  review_deadline_hours integer check (review_deadline_hours between 1 and 720),
  -- Weitere Regeln
  minor_approval_required boolean,
  self_approval_allowed boolean,
  allow_same_reviewer_across_stages boolean,
  allow_review_exemptions boolean,             -- nur auf Vereinsebene wirksam
  media_requires_consent_check boolean,
  allowed_presets text[], allowed_formats text[], allowed_channel_ids uuid[],
  forbidden_topics text[] not null default '{}',
  required_hashtags text[] not null default '{}',
  tone text,

  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check ((scope = 'organization' and department_id is null and team_id is null)
      or (scope = 'department'   and department_id is not null and team_id is null)
      or (scope = 'team'         and department_id is not null and team_id is not null)),
  check (review_mode is distinct from 'named' or review_required is true),
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

Alle Regelfelder sind nullable: `null` heißt „von oben erben“. Nur die additiven Array-Felder haben `default '{}'`.

**Achtung, Reihenfolge:** `policy_settings` wird nicht hier angelegt, sondern in Paket 023 — zusammen mit `public.policy_scope`, der Auflösungsfunktion und den beiden Feldern `invite_allowed` und `posts_visible_org_wide`. Der Block oben zeigt die Tabelle vollständig; umzusetzen ist hier nur die Erweiterung um die Freigabe-, Medien- und Kontingentfelder. Die beiden Felder aus 023 bleiben unverändert bestehen.

Prüferreferenzen:

```sql
create table public.policy_reviewers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  policy_settings_id uuid not null,
  kind text not null check (kind in ('user','organization_role','department_role','team_role')),
  user_id uuid references public.profiles(id) on delete cascade,
  role text,
  target_department_id uuid, target_team_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (
    (kind = 'user'              and user_id is not null and role is null and target_department_id is null and target_team_id is null) or
    (kind = 'organization_role' and user_id is null and role is not null and target_department_id is null and target_team_id is null) or
    (kind = 'department_role'   and user_id is null and role is not null and target_department_id is not null and target_team_id is null) or
    (kind = 'team_role'         and user_id is null and role is not null and target_department_id is not null and target_team_id is not null)
  ),
  foreign key (organization_id, policy_settings_id)
    references public.policy_settings(organization_id, id) on delete cascade,
  foreign key (organization_id, target_department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, target_department_id, target_team_id)
    references public.teams(organization_id, target_department_id, id) on delete cascade
);
create unique index policy_reviewers_user_unique on public.policy_reviewers (policy_settings_id, user_id) where kind = 'user';
create unique index policy_reviewers_role_unique on public.policy_reviewers
  (policy_settings_id, kind, role,
   coalesce(target_department_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(target_team_id, '00000000-0000-0000-0000-000000000000'::uuid)) where kind <> 'user';
```

Vertrauen je Mitglied:

```sql
create table public.member_review_trust (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid, team_id uuid,
  user_id uuid not null references public.profiles(id) on delete cascade,
  submit_allowed boolean not null default true,
  review_requirement text not null default 'inherit'
    check (review_requirement in ('inherit','always','waived')),
  reason text check (char_length(reason) <= 500),
  expires_at timestamptz,
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'organization' and department_id is null and team_id is null)
      or (scope = 'department'   and department_id is not null and team_id is null)
      or (scope = 'team'         and department_id is not null and team_id is not null)),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade
);

-- Als Index, nicht als UNIQUE-Constraint: PostgreSQL erlaubt Ausdruecke wie
-- coalesce() nur in Indexdefinitionen. Und ohne die Normalisierung waeren zwei
-- Zeilen mit NULL-Scope voneinander verschieden -- NULL ist in einem Unique-Key
-- nicht gleich NULL.
create unique index member_review_trust_unique on public.member_review_trust (
  organization_id, scope,
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  user_id
);
```

Mehrstufige Freigabeanfragen:

```sql
create table public.approval_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  approval_request_id uuid not null,
  position integer not null check (position > 0),
  scope public.policy_scope not null,
  scope_department_id uuid, scope_team_id uuid,
  label text not null,
  mode public.review_mode not null,
  minimum_approvals integer not null check (minimum_approvals between 1 and 5),
  is_minor_stage boolean not null default false,
  reviewer_snapshot jsonb not null check (jsonb_typeof(reviewer_snapshot) = 'array'),
  status text not null default 'pending'
    check (status in ('pending','open','satisfied','rejected','skipped','stalled')),
  deadline_at timestamptz, opened_at timestamptz, closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (approval_request_id, position),
  foreign key (organization_id, approval_request_id)
    references public.approval_requests(organization_id, id) on delete cascade
);

-- approval_stages traegt approval_request_id, damit der Fremdschluessel unten
-- die Stufe an *dieselbe* Anfrage bindet.
alter table public.approval_stages
  add constraint approval_stages_request_scoped
  unique (organization_id, approval_request_id, id);

alter table public.approval_decisions add column approval_stage_id uuid;
-- Bestandsentscheidungen einer Stufe zuordnen, bevor die Spalte pflichtig wird:
-- je Anfrage entsteht eine einzige Stufe aus required_approvals, und jede
-- vorhandene Entscheidung wird ihr zugewiesen.
update public.approval_decisions set approval_stage_id = ... ;
alter table public.approval_decisions alter column approval_stage_id set not null;

-- Dreispaltig, nicht zweispaltig: sonst laesst sich eine Entscheidung an eine
-- Stufe einer *fremden* Anfrage haengen, und die Route wird umgehbar.
alter table public.approval_decisions add constraint approval_decisions_stage_fk
  foreign key (organization_id, approval_request_id, approval_stage_id)
  references public.approval_stages(organization_id, approval_request_id, id) on delete cascade;
alter table public.approval_decisions drop constraint approval_decisions_approval_request_id_decided_by_key;
alter table public.approval_decisions
  add constraint approval_decisions_stage_unique unique (approval_stage_id, decided_by);
```

`approval_stage_id` muss `not null` werden, und das ist keine Kosmetik: `unique (approval_stage_id, decided_by)` greift bei `NULL` nicht, weil NULL in einem Unique-Key von jedem anderen NULL verschieden ist. Eine Person könnte also beliebig viele Entscheidungen ohne Stufenbezug schreiben — und da der alte `unique (approval_request_id, decided_by)` in derselben Migration fällt, gäbe es dann gar keine Sicherung mehr gegen Mehrfachzustimmung.

`reviewer_snapshot` friert die zum Zeitpunkt der Routenauflösung aufgelösten Prüfer ein — als Namen und IDs, nicht als Referenzregel. Sonst ändert eine Rollenänderung mitten in einer laufenden Freigabe, wer zustimmen darf. Das ist dieselbe Immutabilitätslogik, die `ADR-003` für Inhalte fordert.

`required_approvals` und `requires_minor_approval` auf `approval_requests` bleiben erhalten und werden aus der Route abgeleitet gefüllt — als Summe bzw. als „mindestens eine Stufe ist Minderjährigenstufe“. Damit bleiben bestehende Abfragen gültig, und `plans/002` muss nicht angepasst werden.

Kontingente:

```sql
create table public.channel_quotas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid, team_id uuid,
  social_connection_id uuid,              -- null = alle Kanäle im Scope
  period text not null check (period in ('day','week','month')),
  max_publications integer not null check (max_publications between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'organization' and department_id is null and team_id is null)
      or (scope = 'department'   and department_id is not null and team_id is null)
      or (scope = 'team'         and department_id is not null and team_id is not null)),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade,
  foreign key (organization_id, social_connection_id)
    references public.social_connections(organization_id, id) on delete cascade
);

-- Dieselbe Normalisierung wie bei member_review_trust, aus demselben Grund: ein
-- vereinsweites Kontingent hat NULL in drei Spalten, und ohne coalesce() liesse
-- die Datenbank zwei davon gleichzeitig zu. Die effektive Grenze waere dann
-- nicht eindeutig bestimmbar.
create unique index channel_quotas_unique on public.channel_quotas (
  organization_id, scope,
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(social_connection_id, '00000000-0000-0000-0000-000000000000'::uuid),
  period
);
```

Gezählt wird als Aggregat über `publications`, nicht in einer Zählerspalte:

```sql
create or replace function public.count_publications_in_period(
  target_organization uuid, target_department uuid, target_team uuid,
  target_connection uuid, quota_period text, reference timestamptz
) returns integer language sql stable security definer set search_path = public, pg_temp as $$ ... $$;
```

Eine Zählerspalte weicht von der Wahrheit ab, sobald ein Beitrag storniert, verschoben oder ein Workflow wiederholt wird. Gezählt werden `queued`, `uploading`, `processing`, `published` — alles, was den Platz belegt oder belegt hat. `failed` und `cancelled` nicht.

Perioden liegen in der **Vereinszeitzone** (`organizations.timezone`), nicht in UTC. „Drei Beiträge pro Tag“ muss dem Kalendertag des Vereins entsprechen.

`publications` trägt heute keine `department_id`; für abteilungsbezogene Kontingente wird über `post_versions → posts` gejoint. Index ergänzen, weil bisher nur `(status, scheduled_for)` existiert (`202608030001:137`):

```sql
create index publications_quota_idx on public.publications (organization_id, social_connection_id, created_at desc);
```

## Prüferzugang: die unangenehme Konsequenz

Ein Prüfer aus dem Marketing ist kein Mitglied der Abteilung Fußball. Alle bestehenden Inhaltspolicies verlangen aber Abteilungsmitgliedschaft — `posts_select` (`202608020001:417`), `submissions_select` (`:410`), `media_assets_select` (`202608030001:114`). Ohne Änderung kann er den Beitrag, den er freigeben soll, nicht einmal laden.

Neue `authz`-Funktion:

```sql
create or replace function authz.is_assigned_reviewer(target_post_version_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  -- true, wenn auth.uid() im reviewer_snapshot einer Stufe dieser Version steht
  -- und die Stufe nicht 'skipped' ist
$$;
```

Erweitert werden **nur** die Policies, die zur Prüfung nötig sind:

| Tabelle | Prüfer sieht |
|---|---|
| `posts`, `post_versions`, `post_variants` | Text, Fakten, Hashtags, Alt-Text der zu prüfenden Version |
| `post_media`, `media_derivatives` | die freigegebenen Derivate — das, was veröffentlicht würde |
| `approval_media_snapshots` | die eingefrorenen Prüfsummen |
| `approval_requests`, `approval_stages`, `approval_decisions` | die Route und ihren Stand |

Ausdrücklich **nicht** erweitert:

| Tabelle | Warum nicht |
|---|---|
| `media_assets` | Originalmedien bleiben privat (`plans/README.md`, `ADR-004`). Der Prüfer beurteilt, was veröffentlicht wird, nicht das Rohmaterial. |
| `face_regions` | Bildregionen und Personenzuordnungen gehören der Abteilung |
| `directory_people` (Paket 014) | Elternkontakte sind nicht Teil einer Freigabeentscheidung |
| `submissions` | der Prüfer sieht die Version, nicht den Erfassungsvorgang |

Der Prüfer erhält den **Einwilligungs-Status** als abgeleiteten Wert über den Freigabeendpunkt („alle Personen geprüft, zwei Kinder mit gültiger Einwilligung“), nicht als Tabellenzugriff. So kann er verantwortlich entscheiden, ohne Zugriff auf personenbezogene Details zu bekommen.

`authz.can_approve_post_version` (`202608020001:351-365`) wird durch `authz.can_decide_stage(stage_id)` ersetzt. Diese prüft: Stufe ist `open`, Person steht im `reviewer_snapshot`, Person hat nicht schon auf dieser Stufe entschieden, Person ist nicht der Autor bei `self_approval_allowed = false`, Person hat nicht auf einer inneren Stufe entschieden bei `allow_same_reviewer_across_stages = false`.

Die alte Funktion bleibt als Wrapper erhalten, bis alle Aufrufer umgestellt sind, und wird dann entfernt.

## Umsetzung

### 1. Domain: fünf reine Funktionen

`packages/domain`:

```ts
resolveEffectiveConfig(org, department?, team?): EffectiveConfig
resolveReviewRoute(input: {
  config: EffectiveConfig
  stages: readonly StageDefinition[]        // innen nach außen
  trust: readonly TrustRecord[]
  author: { userId: string }
  media: { containsMinors: boolean }
}): { stages: ReviewStage[]; blockers: RouteBlocker[] }
evaluateSubmitPermission(config, trust, scope): { allowed: boolean; reason?: string }
evaluateQuota({ limits, counts }): { allowed: boolean; blockingLimit?: QuotaLimit }
resolveReviewers(refs, memberships): { userIds: string[]; unresolved: ReviewerRef[] }
```

`resolveReviewRoute` ist das Herz und muss folgendes leisten:

- Stufen von innen nach außen sammeln, `position` fortlaufend
- Befreiungen anwenden, aber nur nach unten wirkend
- `always` nach oben durchsetzen
- Minderjährigenstufe ergänzen, wenn `containsMinors` — **unbefreibar**, und als äußerste der inneren Stufen einsortiert, sodass sie nie übersprungen wird
- Autor und Doppelprüfer ausschließen
- **`blockers` zurückgeben, wenn eine Stufe unerfüllbar ist**: leerer Prüferkreis, nur der Autor als Prüfer, oder ein `ReviewerRef`, der auf niemanden auflöst. Eine Route mit einer unerfüllbaren Stufe wird nicht erzeugt — sie würde einen Beitrag lautlos für immer liegen lassen.

`mergeEffectiveConfig` wird um Schnittmengen-, Minimum- und `true → false`-Semantik erweitert. Reihenfolge bleibt: Basis ist die Vereinsebene, Overrides von außen nach innen.

### 2. Durchsetzung an vier Stellen

| Stelle | Prüfung |
|---|---|
| Einreichen (`POST /v1/submissions`) | `evaluateSubmitPermission`: Permission im Scope **und** `submit_allowed`. `presetSlug` in `allowedPresets`, `requestedFormats` in `allowedFormats`. `forbiddenTopics` werden zu `doNotMention` ergänzt. Verstoß → 422 mit maschinenlesbarem Grund. |
| Freigabe anfordern | `resolveReviewRoute`; bei leerer Route geht der Beitrag direkt auf `approved`; bei `blockers` → 422 mit Nennung der unerfüllbaren Stufe und der zuständigen Ebene. `approval_stages` werden angelegt, Stufe 1 auf `open`. |
| Entscheiden | `authz.can_decide_stage`. Ist eine Stufe erfüllt, öffnet die nächste; bei `changes_requested` oder `rejected` geht der Beitrag zurück und alle Folgestufen werden `skipped`. |
| Einplanen und Veröffentlichen | Kanal in `allowedChannelIds`, `evaluateQuota`, verantwortliche Ansprechperson gesetzt. Verstoß → 409 mit dem konkret blockierenden Limit. |

Die Kontingentprüfung gehört **an das Einplanen, nicht an den Entwurf** — ein Entwurf verbraucht kein Kontingent, sonst blockieren Ideen die Umsetzung. Beim tatsächlichen Veröffentlichen wird erneut geprüft, weil zwischen Planung und Ausführung Zeit liegt.

Zwei Prüfungen sind aber keine atomare Prüfung. `count_publications_in_period` ist eine Aggregatabfrage: prüfen zwei Anfragen gleichzeitig, sehen beide denselben Stand, beide sind unter dem Limit, und beide legen an. Bei einem Tageskontingent von drei entstehen vier Publikationen, und die zweite Prüfung vor dem Veröffentlichen findet dasselbe Ergebnis erneut vor. Prüfung und Einplanung laufen deshalb in **einer** Transaktion, die den Kontingent-Scope vorher sperrt:

```sql
-- Serialisiert alle gleichzeitigen Einplanungen desselben Scopes, ohne eine
-- Zeile zu sperren, die es noch nicht gibt. Der Schluessel wird deterministisch
-- aus organization_id und dem Scope gebildet.
select pg_advisory_xact_lock(hashtextextended(quota_scope_key, 0));
-- danach zaehlen, entscheiden, einplanen -- alles in derselben Transaktion
```

Ein Advisory Lock je Scope statt einer Zählerspalte: der Zähler weicht von der Wahrheit ab, sobald ein Beitrag storniert oder verschoben wird (siehe oben), das Lock nicht. Der Test dafür ist zwei parallele Einplanungen an der Kontingentgrenze — genau eine gewinnt.

`authz.can_decide_stage` liest den eingefrorenen `reviewer_snapshot`, nicht die aktuelle Richtlinie. Eine Richtlinienänderung wirkt auf neue Routen, nicht auf laufende Freigaben.

### 3. Snapshot und Benachrichtigung

`post_versions.effective_config_snapshot` wird beim Anlegen jeder Version mit `resolveEffectiveConfig` plus der aufgelösten Route, einem `resolvedAt` und den IDs der beitragenden `policy_settings` gefüllt. Ab da gilt für diese Version dieser Stand.

Prüfer müssen erfahren, dass sie gefragt sind — ein Trainer schaut nicht täglich in eine Weboberfläche. Beim Öffnen einer Stufe geht eine E-Mail an alle Prüfer dieser Stufe, über denselben Versandweg wie die Einladungen aus Paket 010. Bündelung: höchstens eine E-Mail pro Person und Stunde, mit Sammelliste. Zusätzlich ein Badge in der Navigation und eine Realtime-Aktualisierung über Supabase.

`review_deadline_hours` setzt `deadline_at`. Ein täglicher Job setzt überschrittene Stufen auf `stalled`, benachrichtigt erneut und macht sie in der Abteilungs- und Vereinsübersicht sichtbar. **Keine automatische Freigabe nach Fristablauf** — eine Frist, die zur Zustimmung führt, ist keine Prüfung.

### 4. Oberfläche

`pages/einstellungen.vue` wird zur scopeabhängigen Richtlinienseite:

- Scope-Umschalter Verein / Abteilung / Team aus `useSession()`
- jede Regel mit drei sichtbaren Zuständen: **geerbt** (Wert grau, Herkunftsebene benannt), **verschärft** (eigener Wert plus Herkunft), **gesperrt** (obere Ebene lässt keine Lockerung zu, Bedienelement deaktiviert mit Begründung)
- Freigabeblock: „Beiträge unter diesem Knoten müssen geprüft werden von …“ mit Modus, Prüferauswahl (Personen **oder** Rolle in einer Abteilung/Mannschaft), Bezeichnung der Stufe und Frist
- eine Vorschau der **vollständigen Route** für diesen Scope: „Team-Trainer → Medienverantwortliche Fußball → Marketing“. Ohne diese Darstellung ist eine dreistufige Kette nicht bedienbar.
- Warnung beim Speichern, wenn eine Stufe weniger als zwei auflösbare Prüfer hat. Eine Person im Urlaub blockiert sonst die ganze Abteilung.
- Kontingente als Liste mit aktueller Auslastung
- eine Prosa-Zusammenfassung „Was bedeutet das konkret?“ — für Ehrenamtliche der wichtigste Teil der Seite

Vertrauen je Mitglied liegt bei der Mitgliederliste aus Paket 010, nicht in den Einstellungen. Dort wird über eine Person entschieden, und dort sucht man sie. **Hinweis aus der Umsetzung von 010**: `pages/mitglieder.vue` hat keine aufklappbare Detailebene je Mitglied — dieses Paket muss sie selbst ergänzen, nicht nur befüllen.

- je Mitglied und Scope: Einreichen erlaubt, Prüfung erforderlich / befreit / geerbt, Befristung, Begründung
- direkt daneben, welche Route für diese Person gilt — inklusive der Stufen, die eine Befreiung **nicht** entfällt
- die Befreiungsoption ist deaktiviert mit Begründung, wenn der Verein `allow_review_exemptions = false` gesetzt hat

`pages/freigaben.vue` zeigt die Route als Fortschritt: erfüllte Stufen, die offene Stufe mit Prüfern und Frist, die wartenden. Wer nicht auf der offenen Stufe steht, sieht den Stand, aber keine Aktion.

### Der Autor muss die Ablehnung lesen können

Der Prüferzugang oben regelt, wer **hinein** sieht. Die Gegenrichtung fehlt sonst: eine Ablehnung ohne sichtbare Begründung ist für den Autor nur ein Beitrag, der zurückkommt.

- `approval_decisions.reason` ist für den **Autor der Version** lesbar, zusätzlich zu den Prüfern. Ohne diese Policy-Erweiterung steht die Begründung in der Datenbank und nirgends sonst.
- Lesbar ist die Begründung und wer entschieden hat — nicht die Zusammensetzung äußerer Stufen, die noch nicht geöffnet wurden. Ein Autor muss nicht wissen, wer im Marketing sitzt, um seinen Text zu verbessern.
- `pages/beitraege.vue` wird die Übersicht, die es heute nicht gibt: je Beitrag Status, aktuelle Stufe, und bei `changes_requested` oder `rejected` die Begründung im Klartext direkt in der Zeile. Filter „wartet auf mich“, „wartet auf andere“, „zurückgewiesen“, „freigegeben“.
- Dieselbe Seite dient dem Prüfer für seine eigene Historie: was habe ich entschieden und wie. Es ist dieselbe Abfrage mit anderem Filter, keine zweite Ansicht.
- Bei `changes_requested` führt eine Aktion direkt zurück in die Bearbeitung; das erneute Einreichen erzeugt eine neue Version und löst die Route neu auf. Es wird **keine** abgeschlossene Stufe wiederverwendet — sonst gilt eine alte Zustimmung für einen geänderten Text.

Diese Rückrichtung ist der Unterschied zwischen einem Freigabeprozess und einem Beitrag, der ohne Erklärung verschwindet. Sie ist der Grund, warum Ehrenamtliche das Werkzeug weiter benutzen, nachdem ihr erster Beitrag abgelehnt wurde.

### 5. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `pages/einstellungen.vue:1` | fünf erfundene Zeilen, funktionslose Buttons | echte Richtlinien mit sichtbarer Vererbung |
| „Jeder Beitrag benötigt eine menschliche Freigabe“ | Behauptung | `review_required` je Knoten mit echter Route und Durchsetzung |
| „Minderjährigenschutz · Sonderfreigabe ist aktiv“ | Behauptung | unbefreibare Minderjährigenstufe in der Route |
| „Instagram / Facebook verbunden“ | Behauptung | wandert nach Paket 012 |
| „Rohmedien · Löschung nach 90 Tagen“ | Behauptung ohne Job | wandert nach Paket 020 als echte Aufbewahrungsregel mit Cron |
| `packages/domain/mergeEffectiveConfig` | nur in Tests benutzt | einziger Auflösungspfad im Produktionscode |
| `approval_requests.required_approvals` als einzige Route | eine Zahl | abgeleitet aus `approval_stages` |
| `pages/beitraege.vue:1` | Empty State aus Paket 008, keine Statusansicht | eigene Beiträge mit Status, Stufe und Ablehnungsbegründung; für Prüfer dieselbe Ansicht mit Filter |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- `resolveReviewRoute`-Tests, das Kernstück dieses Pakets:
  - drei Stufen Team → Abteilung → Verein in dieser Reihenfolge
  - Befreiung auf Teamebene entfällt die Teamstufe, nicht die Abteilungs- und Vereinsstufe
  - Befreiung auf Vereinsebene entfällt alle Stufen
  - `always` auf Teamebene überlebt eine Befreiung auf Teamebene
  - `allow_review_exemptions = false` auf Vereinsebene macht jede Befreiung wirkungslos
  - **Minderjährigenstufe bleibt bei jeder Befreiungskombination bestehen**
  - Autor wird bei `self_approval_allowed = false` aus allen Stufen entfernt
  - Prüfer einer inneren Stufe fällt aus äußeren heraus
  - leerer Prüferkreis erzeugt einen `blocker`, keine Route
  - `ReviewerRef` auf eine Rolle, die niemand innehat, erzeugt einen `blocker`
- `mergeEffectiveConfig`: Lockerungsversuch auf jeder Ebene wird ignoriert; `null` gegen leere Liste; Stufen sind additiv
- `evaluateQuota`: an der Grenze, exakt darüber, exakt darunter; Periodengrenzen über Zeitzonenwechsel und Sommerzeitumstellung
- Nebenläufigkeit: zwei gleichzeitige Einplanungen an der Kontingentgrenze erzeugen genau eine Publikation und einen 409 — ohne die Sperre gehen beide durch
- pgTAP:
  - Marketing-Prüfer **ohne** Mitgliedschaft in Fußball liest `post_versions` und `media_derivatives` des zu prüfenden Beitrags
  - derselbe Prüfer liest **nicht** `media_assets`, **nicht** `face_regions`, **nicht** `submissions`
  - nach `skipped` verliert er den Zugriff wieder
  - `approval_decisions` zweimal auf derselben Stufe verstößt gegen den Unique-Index
  - `approval_decisions` mit einer Stufe, die zu einer **anderen** `approval_request` gehört, verstößt gegen den Fremdschlüssel
  - `approval_decisions` ohne `approval_stage_id` verstößt gegen `not null`
  - zwei `channel_quotas` für denselben Scope und dieselbe Periode verstoßen gegen den Unique-Index, auch wenn beide vereinsweit sind (`NULL` in allen Scope-Spalten)
  - zwei `member_review_trust`-Zeilen für dieselbe Person auf Vereinsebene verstoßen gegen den Unique-Index
  - `review_mode = 'named'` ohne `review_required = true` verstößt gegen CHECK
  - `policy_reviewers` mit gemischter Feldkombination verstößt gegen CHECK
  - `count_publications_in_period` zählt `failed` und `cancelled` nicht
- API-Tests: der Autor einer abgelehnten Version liest `reason` und den Namen des Entscheidenden; ein unbeteiligtes Vereinsmitglied liest beides **nicht**; der Autor liest nicht den `reviewer_snapshot` einer noch nicht geöffneten äußeren Stufe; erneutes Einreichen nach `changes_requested` erzeugt eine neue Version und eine neu aufgelöste Route statt eine erfüllte Stufe wiederzuverwenden. Einreichen bei `submit_allowed = false` → 403; Submission mit nicht erlaubtem Preset → 422; Freigabeanfrage mit unerfüllbarer Stufe → 422 mit Nennung der Ebene; Entscheidung auf einer noch nicht offenen Stufe → 409; Selbstfreigabe → 403; Einplanen über dem Tageskontingent → 409 mit Nennung des Limits
- manuell, der Zielfall: Verein setzt Vereinsstufe „Rolle `approver` in Abteilung Marketing“. Abteilung Fußball setzt Abteilungsstufe „Medienverantwortliche“. Team E-Jugend setzt Teamstufe „Trainer“ und erlaubt einem Elternkonto das Einreichen. Das Elternkonto reicht einen Spielbericht ein → nur der Trainer sieht die Aktion. Nach seiner Zustimmung sieht die Medienverantwortliche sie, danach das Marketing. Die Medienverantwortliche wird auf Abteilungsebene befreit → ihre eigenen Beiträge gehen direkt ans Marketing, nicht ohne Prüfung hinaus. Ein Bild mit einem Kind erzeugt zusätzlich die Minderjährigenstufe, auch bei ihr.

## Risiken und offene Entscheidungen

- **Drei Stufen sind langsam.** Ein Spielbericht, der am Sonntag entsteht und Montagabend das Marketing erreicht, ist keine Nachricht mehr. Deshalb: Fristen mit Erinnerung, Bündelung der Benachrichtigungen, und die Prosa-Vorschau, die einem Verein vor dem Speichern zeigt, was er sich einrichtet. Die Software soll die Kette möglich machen und ihren Preis sichtbar — nicht die Entscheidung treffen.
- **Freigabe ganz abschalten**: `review_required = false` überall plus keine Befreiungspflicht bedeutet, dass der Autor selbst veröffentlicht. `plans/README.md` schließt „vollautomatisches Publizieren ohne menschliche Freigabe“ aus; die Auslegung hier ist, dass eine Person entscheidet — nur keine zweite. Vollautomatik ohne jeden Menschen bleibt ausgeschlossen. Diese Auslegung berührt eine dokumentierte Produktgrenze und sollte bestätigt werden.
- **Prüferzugang über Scope-Grenzen** ist die sicherheitsrelevanteste Änderung des Pakets. Sie erweitert Policies, auf denen alles aufsetzt. Die negativen pgTAP-Fälle sind hier nicht Beiwerk: dass ein Marketing-Prüfer **nicht** an Rohmedien und Personendaten kommt, ist so wichtig wie dass er an die Version kommt.
- **Prüfer verlässt den Verein**: der `reviewer_snapshot` einer laufenden Stufe zeigt dann auf eine Person ohne Zugang. Paket 010 verhindert das Entfernen einer benannten Person nicht in allen Fällen — hier braucht es einen täglichen Abgleich, der solche Stufen als `stalled` markiert, plus die Möglichkeit, eine Route bewusst neu aufzulösen. Letzteres ist ein Eingriff in eine laufende Freigabe und muss auditiert und begründet werden.
- **Rückwirkung**: der Snapshot friert Regeln ein. Verschärft ein Verein nach einem Vorfall, laufen offene Freigaben unter den alten Regeln weiter. Das ist beabsichtigt und muss in der Oberfläche stehen. Ein bewusstes „Alle offenen Freigaben neu bewerten“ ist ein sinnvoller Notfallknopf — nicht in diesem Paket.
- **Vertrauen und Minderjährige**: die Regel, dass keine Befreiung die Minderjährigenstufe entfällt, ist der Grund, warum Spieler und Eltern überhaupt einreichen dürfen können. Wird sie später gelockert, fällt die Begründung für den ganzen Ansatz. Sie gehört als Kommentar in den Code und als Test in die Suite, nicht nur in dieses Dokument.
- **`publications` ohne `department_id`**: dieselbe Einschränkung wie in Paket 016. Wenn kanalbezogene Kontingente je Abteilung zu langsam werden, ist Denormalisierung fällig — dann in einem Schritt für beide Pakete.

## Umsetzung: Ergebnis und Abweichungen vom Plan

Umgesetzt in einer Migration (`2026080606_policies_and_review_routes.sql`), den Domain-Funktionen `resolveReviewRoute`/`evaluateSubmitPermission`/`resolveReviewers`/`resolveEffectiveConfig` in `packages/domain` (vier statt der geplanten fünf, siehe unten zu `evaluateQuota`), den entsprechenden Contracts- und API-Erweiterungen, sowie der Oberfläche auf `/einstellungen` (Richtlinienseite), `/mitglieder` (Vertrauen je Mitglied) und `/freigaben` (echte Stufen statt erfundener Beiträge). 237 pgTAP-Tests, 67 API-Tests, 32 Domain-Tests, `pnpm lint`/`typecheck`/`test`/`build` grün, manuell im Browser gegengeprüft (Richtlinie ändern und speichern mit echtem PUT-Roundtrip nach Reload, Prüfer hinzufügen/entfernen, Vertrauen-Block auf `/mitglieder`, ehrlicher Leerzustand auf `/freigaben`).

### Bewusste Scope-Entscheidung, vor dem Bauen geklärt

Es gibt im gesamten Repository keinen Code-Pfad, der aus einer `submission` einen `post`/`post_version` macht — die Inhalts-Pipeline (LLM-Entwurf, Rendering) ist Teil der ersten Planserie (001–007) und laut `plans/README.md` weiterhin „in Arbeit“. Auf Rückfrage wurde entschieden: **011 baut diese Pipeline nicht vor.** `POST /v1/submissions` persistiert jetzt echt (vorher: keine Zeile) und wendet `evaluateSubmitPermission` an — das schließt den ihm zugewiesenen Rückbau-Punkt. Die drei anderen Durchsetzungsstellen (Freigabe anfordern, entscheiden, einplanen) sind als echte, funktionsfähige API-Endpunkte und RPCs gebaut, aber ohne einen Weg, wie ein `post_version`-Datensatz durch eine echte Nutzerin entsteht — genau wie `approval_decisions_insert` seit Paket 008 existiert, ohne dass je etwas `approval_requests` anlegt. Konsequenzen:

- `post_versions.effective_config_snapshot` bleibt **strukturell ungefüllt** — es gibt keine Stelle, die eine `post_versions`-Zeile überhaupt anlegt. Der Rückbau-Punkt aus `plans/README.md` bleibt bewusst offen, bis Paket 005/006 diesen Anlegepfad bauen. **✓ Geschlossen in Paket 025**: `POST /v1/submissions` legt bei vollständigem Quellmaterial jetzt echt `post`/`post_version` an, `effective_config_snapshot` wird befüllt (geflacht, siehe `plans/025-inhalts-pipeline-entwurf-und-veroeffentlichung.md`).
- `/beitraege` und `/freigaben` zeigen ehrliche Leerzustände statt der vorherigen erfundenen Beiträge — nicht, weil sie fertig sind, sondern weil es noch keine echten Daten gibt, die sie zeigen könnten. Beide Dateien tragen einen Kommentar, der das für die nächste Session festhält. **Teilweise weiterhin zutreffend nach 025**: `/freigaben` bleibt leer, bis ein UI-Trigger für `request_approval` existiert (in 025 bewusst nicht gebaut, siehe dortiger Plan) — `posts`/`post_versions` selbst sind seit 025 aber real befüllbar.

### Kritischer Fund beim adversarialen Review, in diesem Paket behoben

Die Prüfungen aus den Blickwinkeln Mandantentrennung und Rechte fanden unabhängig voneinander denselben schwersten Fund: `public.request_approval` ist per `grant execute … to authenticated` direkt per RPC erreichbar (dasselbe Modell wie jede andere privilegierte Funktion in diesem Projekt) und übernahm `stages` (inklusive `reviewerSnapshot`) sowie `self_approval_allowed`/`allow_same_reviewer_across_stages` ungeprüft vom Aufrufer. Jede Person mit `post.submit` in ihrer eigenen Abteilung hätte damit (a) eine Person aus einem **fremden Verein** als Prüfer eintragen, (b) mit einer leeren Stufenliste jede Prüfung — einschließlich der als unbefreibar geplanten Minderjährigenstufe — vollständig umgehen, und (c) sich selbst freigeben können, unabhängig von der tatsächlichen Richtlinie. Behoben: die Funktion berechnet die beiden sicherheitsrelevanten Booleans jetzt selbst aus `policy_settings` (dieselbe AND-Reduktion wie `mergeEffectiveConfig`), lehnt eine leere oder die Minderjährigenstufe auslassende Stufenliste ab, wenn die Richtlinie das nicht zulässt, und prüft jede `reviewer_snapshot`-userId gegen echte Vereinsmitgliedschaft (`authz.is_user_member_of_organization`, neu). Die beiden jetzt überflüssigen Parameter sind aus Signatur und Aufruf entfernt. Fünf neue pgTAP-Tests sichern das ab.

Weitere Funde aus derselben Prüfung, ebenfalls behoben:

- `count_publications_in_period` hatte keinen eigenen Mitgliedschaftsschutz und war an `authenticated` vergeben, obwohl der einzige legitime Aufrufer (`schedule_publication`) sie als `SECURITY DEFINER`-Funktion intern mit den Rechten des Funktionseigentümers erreicht — Grant auf `service_role` beschränkt (per direktem RPC-Test bestätigt, dass `schedule_publication` dadurch nicht bricht).
- `policy_reviewers.created_by` war per Volltabellen-Grant vereinsweit lesbar, anders als das etablierte Muster bei `policy_settings.updated_by`/`member_review_trust.granted_by` — jetzt spaltenweiser Grant ohne `created_by`.
- Der Autor einer Version sah die `reviewer_snapshot`-Zusammensetzung einer nie geöffneten, aber nach einer Ablehnung bereits `skipped` gesetzten äußeren Stufe — die Sichtbarkeitsprüfung in der API nutzt jetzt `opened_at is null` statt eines einzelnen Statuswerts.
- `evaluateSubmitPermission` prüfte bei vorhandener `teamId` ausschließlich die Team-Ebene des Vertrauens und ignorierte die Abteilungsebene komplett — eine Abteilungssperre ließ sich durch Mitschicken einer `teamId` umgehen. Jetzt: AND-Reduktion über alle zutreffenden Ebenen.

Nicht behoben, dokumentiert als bekannte Robustheitslücken (kein Sicherheitsproblem, siehe Verträge-Review): `authz.can_approve_post_version` hat nach dieser Migration keinen Aufrufer mehr im Repository (bleibt als Wrapper bestehen, wie geplant); `ReviewerRefSchema.role` validiert nicht, dass die Rolle zum jeweiligen `kind` passt (führt zu einem sicher fehlschlagenden `422 unfulfillable_stage`, keine Sicherheitslücke); `scheduledFor` erlaubt ein Datum in der Vergangenheit; `allowedChannelIds` prüft nur UUID-Syntax, nicht Existenz.

### Zweite Review-Runde (Code-Review des PRs plus eigenes Review)

Der schwerste Fund derselben Klasse wie oben: `request_approval` prüfte den *Inhalt* der Stufenliste, nicht ihre *Struktur*. `decide_approval_stage` sucht die Folgestufe über `position + 1` — mit den vom Aufrufer gelieferten Positionen 1 und 3 wäre Stufe 3 nie geöffnet worden und der Beitrag nach Stufe 1 direkt auf `approved` gegangen, womit sich auch die unbefreibare Minderjährigenstufe überspringen ließ. Die Funktion verlangt die Positionen jetzt lückenlos und eindeutig ab 1 und lehnt außerdem eine Stufe ohne Prüfer ab (von niemandem entscheidbar, ließe den Beitrag lautlos liegen).

Weiter behoben:

- **Cross-Tenant-Personenreferenzen**: `policy_reviewers.user_id` und `member_review_trust.user_id` zeigen nur auf `public.profiles` und können keinen zusammengesetzten Fremdschlüssel auf den Verein tragen. `policy_reviewers_insert` und `set_member_review_trust` prüfen die Vereinsmitgliedschaft der benannten Person jetzt selbst (`authz.is_user_member_of_organization`).
- **Backfill blockierte laufende Freigaben**: die Migrations-Stufe erhielt `reviewer_snapshot = '[]'`, womit `authz.can_decide_stage` niemanden mehr durchgelassen und `is_assigned_reviewer` den bisherigen Prüfern den Lesezugriff genommen hätte. Der Snapshot wird jetzt aus genau dem Kreis befüllt, den `can_approve_post_version` bis zu dieser Migration durchgesetzt hat.
- **Advisory Lock zu feingranular**: der Schlüssel enthielt Abteilung und Team, die Schleife liest aber auch vereinsweite Kontingentzeilen — zwei gleichzeitige Einplanungen aus verschiedenen Abteilungen konnten dasselbe vereinsweite Kontingent beide passieren. Jetzt auf Vereinsebene gesperrt.
- **Ablaufzeiten ignoriert**: `fetchMemberTrust`, `membersWithApprovePermission` und `fetchAllMemberships` lasen befristbare Zeilen ohne Filter auf `expires_at` — eine abgelaufene Befreiung entfernte weiter Freigabestufen, ein abgelaufenes Mitglied wäre als Prüfer eingefroren worden (und hätte die Route über `invalid_reviewer_snapshot` unbrauchbar gemacht). Gemeinsamer Helfer `notExpiredFilter()`.
- **`any_with_permission` war zu eng** (eigener Fund): der Prüferkreis wurde nur aus den Rollen der eigenen Ebene gebildet, `authz.has_team_permission`/`has_department_permission` reichen `post.approve` aber von außen nach innen durch. Eine Abteilung ohne eigene `approver`-Rolle bekam deshalb einen `empty_reviewer_pool`-Blocker, obwohl die Vereinsleitung freigeben darf — der Normalfall im kleinen Verein. Der Kreis umfasst jetzt die eigene und alle äußeren Ebenen.
- **`channel_quotas_select` verlangte eine Organisationsrolle** (eigener Fund): ein Abteilungsverwalter durfte über `channel_quotas_insert` ein Kontingent anlegen, hätte es aber nicht lesen können — schon das `insert … returning` der API wäre an der Select-Policy gescheitert. Jetzt `is_any_member_of_organization`, wie bei `policy_settings_select`.
- **N+1 auf `GET /v1/organizations/:id/policy-rules`**: die Auflösung je Ebene lud die Vereinszeile jedes Mal neu (bei 10 Abteilungen und 40 Teams 141 Abfragen auf `policy_settings` plus 51 auf `policy_reviewers`). Jetzt eine Abfrage je Tabelle, indiziert je Ebene — dasselbe Muster wie `fetchPolicyRows` aus 023.
- **`max_rows=1000` schnitt den Prüferkreis ab** (eigener Fund): `fetchAllMemberships` und `membersWithApprovePermission` lasen ohne Paginierung. Jetzt über `fetchAllRows`, wie `GET /v1/organizations/:id/members`.
- **Falsche Scope-IDs bei Rollen-Prüfern** (`/einstellungen`): die Auswahl „Art“ stand unabhängig von der gewählten Ebene offen und schickte etwa die Team-ID als `departmentId`. Sie ist jetzt auf die Kombinationen begrenzt, die die Ebene tatsächlich bestimmen kann, und leitet die Abteilung einer Team-Ebene aus der Elternabteilung ab.
- **Geleerte Felder waren nicht speicherbar** (eigener Fund, `/einstellungen`): ein geleertes Text-/Zahlenfeld liefert `''`. Bei `tone`, Mindestanzahl und Frist scheiterte das Speichern damit an 400, eine leere Stufenbezeichnung landete dagegen in der Datenbank und ließ danach jede Freigabeliste am `ApprovalStageSchema.label` scheitern. `''` heißt jetzt „geerbt“ (null), und `reviewStageLabel` verlangt im Contract `min(1)`.
- **`GET /v1/approval-stages/mine` war nicht auf den Verein begrenzt**: wer in mehreren Vereinen prüft, sah alle Freigaben in der Liste eines einzelnen. `organizationId` ist jetzt pflichtiger Query-Parameter.
- Kleinere Robustheit: `PATCH /v1/channel-quotas/:id` antwortete mit 500 statt 403, wenn RLS die Zeile aus dem `UPDATE` filterte (`.single()` auf null Zeilen); die drei Namensabfragen im PUT-Pfad der Richtlinien prüften ihr `.error` nicht und bildeten einen Datenbankfehler als `400 invalid_request` ab; `GET …/member-review-trust` und `GET …/channel-quotas` antworteten Nicht-Mitgliedern mit einer leeren Liste statt mit 403.
- **Isolationstests nachgezogen** (AGENTS.md: „Neue exponierte Tabellen brauchen RLS sowie positive und negative Isolationstests”): die Fixture hat jetzt einen zweiten Verein mit eigenem Mitglied, und alle vier neuen Tabellen haben je einen positiven und einen negativen Zugriff. Dazu ein Regressionstest für die Snapshot-Sichtbarkeit gegenüber dem Autor (`opened_at is null`) und einer für `422` mit Nennung der unerfüllbaren Ebene.

### Eine Frist darf weder zustimmen noch blockieren

`authz.can_decide_stage` verlangte `status = 'open'`. Damit wäre jede von `public.mark_stalled_approval_stages()` als überfällig markierte Stufe **dauerhaft unentscheidbar** geworden — ausgelöst nicht durch eine Codeänderung, sondern in dem Moment, in dem Paket 004 einen Scheduler an die Funktion hängt. Das widerspricht Abschnitt „Snapshot und Benachrichtigung” oben („Keine automatische Freigabe nach Fristablauf — eine Frist, die zur Zustimmung führt, ist keine Prüfung”): dieselbe Begründung verbietet auch die Gegenrichtung, eine Frist, die eine Prüfung *verhindert*. `stalled` ist ein Label plus Benachrichtigungsauslöser, kein Statuswechsel mit Rechtsfolge. Behoben in `can_decide_stage`, im Wrapper `can_approve_post_version`, in `GET /v1/approval-stages/mine` (Filter auf `open`/`stalled` — sonst verschwindet die Stufe aus genau der Liste, in der sie entschieden werden soll) und in `isOverdue` der Freigabeansicht.

**Bewusst nicht gebaut**: „Verwaltende dürfen eine überfällige Stufe selbst entscheiden.” `review_deadline_hours` setzt die Ebene selbst, und `department.manage` genügt dafür — ein Abteilungsadmin könnte die Frist seiner eigenen Ebene auf eine Stunde stellen, warten und dann seinen eigenen Beitrag freigeben; dagegen stünde nur `self_approval_allowed`, das per Default `true` ist. Die Frist wäre damit ein Selbstfreigabe-Pfad für jeden mit Verwaltungsrecht. Der Ausweg für eine tatsächlich blockierte Route ist stattdessen das bewusste **Neuauflösen** der Route (Abschnitt „Risiken und offene Entscheidungen”, „Prüfer verlässt den Verein”: auditiert und begründet) — als eigenes Arbeitspaket 024 geplant.

### Offen und sicherheitsrelevant: `request_approval` prüft nicht, ob die Prüfer die konfigurierten sind

Beim Review des Planentwurfs für Paket 024 aufgefallen und hier festgehalten, weil es ausgelieferten Code betrifft: `request_approval` nimmt `stages` samt `reviewerSnapshot` vom Aufrufer und ist per Grant an `authenticated` direkt per RPC erreichbar. Der Härtungsschritt oben hat die schwersten Fälle geschlossen (Selbstfreigabe, leere Stufenliste, fremder Verein, Positionslücken, leerer Prüfkreis, Minderjährigenstufe muss vorhanden sein) — **nicht** aber, dass die genannten Prüfer die in der Richtlinie konfigurierten sind. Eine Person mit `post.submit` kann ihre Freigabe damit per direktem RPC-Aufruf an einen selbst gewählten Vereinskollegen richten statt an die unter `review_mode = 'named'` eingetragenen Prüfer; bei der Minderjährigenstufe wird nur ihre *Existenz* geprüft, nicht ihre Besetzung. `plans/024-freigaberoute-neu-aufloesen.md`, Abschnitt 2, stellt die beiden Auswege gegenüber (Routenauflösung in SQL, oder Grant auf `service_role` zurücknehmen und in Fastify durchsetzen) — die Entscheidung gilt für beide Pfade gemeinsam und fällt vor 024.

### `evaluateQuota` entfernt statt unbenutzt gelassen

Die Funktion hatte nach Abschluss des Pakets keinen Aufrufer: die Kontingentgrenze wird in `public.schedule_publication` durchgesetzt, und das muss sie auch, weil nur dort Zählung und Einplanung im selben Advisory Lock liegen. Entscheidend gegen ein Aufbewahren war aber ein Signaturfehler: `QuotaLimit` und `QuotaCount` trugen nur `scope` und `period`, gepaart wurde über genau diese zwei Felder. `channel_quotas` ist dagegen eindeutig über `(scope, department, team, social_connection_id, period)` — ein Verein mit „10 pro Woche insgesamt” und „3 pro Woche für Instagram” erzeugt zwei Limits mit identischem `(scope, period)`, die die Funktion nicht unterscheiden kann. Sie hätte für kanalspezifische Kontingente still falsche Antworten geliefert, sobald jemand sie hervorholt. Die Auslastungsanzeige („2 von 3 diese Woche”) wird deshalb mit der Kanaldimension neu gebaut, wenn Paket 012 die Kanal-Oberfläche liefert, zusammen mit einem Endpunkt, der `count_publications_in_period` service-seitig aufruft (an `authenticated` bewusst nicht vergeben) — als Anzeige, nie als Gate. Der Plan-Abschnitt „1. Domain: fünf reine Funktionen” bleibt als Planungsstand stehen; umgesetzt sind vier.

### Weitere Abweichungen vom ursprünglichen Plan-DDL

- **`approval_stages.deadline_hours`** (zusätzlich zur geplanten `deadline_at`): eine Frist gilt relativ zum Öffnen der jeweiligen Stufe, nicht zur Erzeugung der ganzen Route. `deadline_at` wird beim Öffnen einer Stufe aus `deadline_hours` neu berechnet (`request_approval` für Stufe 1, `decide_approval_stage` für jede folgende).
- **`submit_requires_permission`** existiert als Spalte (Plan-DDL folgt), bleibt aber ohne Verhalten: die „Vererbung: eine Richtung“-Tabelle des Plans erklärt dieses Feld nicht, und eine erfundene Semantik wäre riskanter als eine ungenutzte Spalte. Braucht eine Festlegung, bevor sie etwas durchsetzt.
- **Migrationsname**: `2026080404_policies_and_review_routes.sql` (Plan-Datum 2026-08-04) lag vor den vier 023-Migrationen und damit vor `policy_settings` selbst — umbenannt auf `2026080606_policies_and_review_routes.sql` (bereits in Phase 1 korrigiert, siehe „Ausgangslage und Evidenz“ oben).
- **Benachrichtigung der Prüfer** (E-Mail beim Öffnen einer Stufe, Bündelung auf höchstens eine E-Mail pro Stunde, Realtime-Badge in der Navigation) ist **nicht gebaut**. Paket 004 liefert inzwischen den technischen ID-only Outbox-/Worker-Unterbau, aber keine fachliche periodische Scheduler-Registrierung; eine Bündelung ohne diese separate Folgearbeit wäre nur simuliert. `public.mark_stalled_approval_stages()` existiert bereits (nur für `service_role` aufrufbar) und markiert überfällige offene Stufen; sie wird von nichts periodisch aufgerufen. Die API liefert „überfällig“ (`isOverdue`) stattdessen live aus `deadline_at`, ohne den Status physisch zu ändern.
- **Oberfläche vereinfacht gegenüber Plan-Abschnitt 4**: keine Prosa-Zusammenfassung „Was bedeutet das konkret?“, keine grafische Routenvorschau, keine Warnung bei weniger als zwei auflösbaren Prüfern. Die funktionalen Teile (Regeln setzen, Prüfer zuweisen, Vertrauen je Mitglied, Stufen entscheiden) sind vollständig; die UX-Politur ist es nicht.
