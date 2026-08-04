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
- `authz.can_approve_post_version` (`:351-365`) prüft `post.approve` **in der Abteilung des Beitrags**. Das ist die zentrale Blockade für das Marketing-Szenario: eine Person aus der Abteilung Marketing hat keine Mitgliedschaft in der Abteilung Fußball und kann deren Beiträge damit weder freigeben noch überhaupt sehen. Alle Inhaltspolicies bauen darauf auf — `posts_select` (`:417`) verlangt `is_department_member`.
- Die Funktion prüft außerdem **nicht**, ob der Freigebende der Autor ist. Selbstfreigabe ist heute möglich.
- `post_versions.effective_config_snapshot` (`:178`) ist `not null` mit Objekt-CHECK — das Einfrieren ist vorgesehen und wird von nichts gefüllt.
- `packages/authorization/src/index.ts:41,53,57` verteilt `post.approve` an `social_manager`, `department_admin` und `approver`. Eine benannte Einzelperson als Prüferin ist im Modell nicht vorgesehen.
- `apps/web/app/pages/einstellungen.vue:1` zeigt fünf hartkodierte Zeilen, darunter „Jeder Beitrag benötigt eine menschliche Freigabe“ und „Minderjährigenschutz · Sonderfreigabe ist aktiv“. Jeder „Bearbeiten“-Button ist ohne Handler. **Vier der fünf Aussagen sind im System nirgends abgebildet.**
- Es gibt **keine Kontingente**: keine Tabelle, kein Zähler, keine Prüfung.
- `apps/api/src/app.ts:74-103` nimmt eine Submission an, ohne irgendeine Richtlinie zu konsultieren.

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

Migration `2026080404_policies_and_review_routes.sql`:

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

Vertrauen je Mitglied liegt bei der Mitgliederliste aus Paket 010, nicht in den Einstellungen. Dort wird über eine Person entschieden, und dort sucht man sie:

- je Mitglied und Scope: Einreichen erlaubt, Prüfung erforderlich / befreit / geerbt, Befristung, Begründung
- direkt daneben, welche Route für diese Person gilt — inklusive der Stufen, die eine Befreiung **nicht** entfällt
- die Befreiungsoption ist deaktiviert mit Begründung, wenn der Verein `allow_review_exemptions = false` gesetzt hat

`pages/freigaben.vue` zeigt die Route als Fortschritt: erfüllte Stufen, die offene Stufe mit Prüfern und Frist, die wartenden. Wer nicht auf der offenen Stufe steht, sieht den Stand, aber keine Aktion.

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
- API-Tests: Einreichen bei `submit_allowed = false` → 403; Submission mit nicht erlaubtem Preset → 422; Freigabeanfrage mit unerfüllbarer Stufe → 422 mit Nennung der Ebene; Entscheidung auf einer noch nicht offenen Stufe → 409; Selbstfreigabe → 403; Einplanen über dem Tageskontingent → 409 mit Nennung des Limits
- manuell, der Zielfall: Verein setzt Vereinsstufe „Rolle `approver` in Abteilung Marketing“. Abteilung Fußball setzt Abteilungsstufe „Medienverantwortliche“. Team E-Jugend setzt Teamstufe „Trainer“ und erlaubt einem Elternkonto das Einreichen. Das Elternkonto reicht einen Spielbericht ein → nur der Trainer sieht die Aktion. Nach seiner Zustimmung sieht die Medienverantwortliche sie, danach das Marketing. Die Medienverantwortliche wird auf Abteilungsebene befreit → ihre eigenen Beiträge gehen direkt ans Marketing, nicht ohne Prüfung hinaus. Ein Bild mit einem Kind erzeugt zusätzlich die Minderjährigenstufe, auch bei ihr.

## Risiken und offene Entscheidungen

- **Drei Stufen sind langsam.** Ein Spielbericht, der am Sonntag entsteht und Montagabend das Marketing erreicht, ist keine Nachricht mehr. Deshalb: Fristen mit Erinnerung, Bündelung der Benachrichtigungen, und die Prosa-Vorschau, die einem Verein vor dem Speichern zeigt, was er sich einrichtet. Die Software soll die Kette möglich machen und ihren Preis sichtbar — nicht die Entscheidung treffen.
- **Freigabe ganz abschalten**: `review_required = false` überall plus keine Befreiungspflicht bedeutet, dass der Autor selbst veröffentlicht. `plans/README.md` schließt „vollautomatisches Publizieren ohne menschliche Freigabe“ aus; die Auslegung hier ist, dass eine Person entscheidet — nur keine zweite. Vollautomatik ohne jeden Menschen bleibt ausgeschlossen. Diese Auslegung berührt eine dokumentierte Produktgrenze und sollte bestätigt werden.
- **Prüferzugang über Scope-Grenzen** ist die sicherheitsrelevanteste Änderung des Pakets. Sie erweitert Policies, auf denen alles aufsetzt. Die negativen pgTAP-Fälle sind hier nicht Beiwerk: dass ein Marketing-Prüfer **nicht** an Rohmedien und Personendaten kommt, ist so wichtig wie dass er an die Version kommt.
- **Prüfer verlässt den Verein**: der `reviewer_snapshot` einer laufenden Stufe zeigt dann auf eine Person ohne Zugang. Paket 010 verhindert das Entfernen einer benannten Person nicht in allen Fällen — hier braucht es einen täglichen Abgleich, der solche Stufen als `stalled` markiert, plus die Möglichkeit, eine Route bewusst neu aufzulösen. Letzteres ist ein Eingriff in eine laufende Freigabe und muss auditiert und begründet werden.
- **Rückwirkung**: der Snapshot friert Regeln ein. Verschärft ein Verein nach einem Vorfall, laufen offene Freigaben unter den alten Regeln weiter. Das ist beabsichtigt und muss in der Oberfläche stehen. Ein bewusstes „Alle offenen Freigaben neu bewerten“ ist ein sinnvoller Notfallknopf — nicht in diesem Paket.
- **Vertrauen und Minderjährige**: die Regel, dass keine Befreiung die Minderjährigenstufe entfällt, ist der Grund, warum Spieler und Eltern überhaupt einreichen dürfen können. Wird sie später gelockert, fällt die Begründung für den ganzen Ansatz. Sie gehört als Kommentar in den Code und als Test in die Suite, nicht nur in dieses Dokument.
- **`publications` ohne `department_id`**: dieselbe Einschränkung wie in Paket 016. Wenn kanalbezogene Kontingente je Abteilung zu langsam werden, ist Denormalisierung fällig — dann in einem Schritt für beide Pakete.
