# 022 – Plattform-Administration (SaaS-Betreiber)

## Ergebnis

Ein SaaS-Betreiber-Admin, orthogonal zu allen vereinsbezogenen Rollen: ein per Umgebungsvariable bootstrap-fähiger Default-Admin, weitere Admins live hinzufügbar, nur der Default-Admin darf andere Admins wieder entfernen. Der Admin konfiguriert plattformweite Limits (löst die in Paket 009 hartkodierte Eigentümer-Grenze ab) und LLM-Provider (mehrere Modelle/Accounts/API-Keys, System-Prompts, Auswahllogik nach Zweck). Ein eigenes Admin-Dashboard zeigt Mandantenliste und App-/DB-Nutzungsmetriken (Post-Erzeugung, Fehlerraten) — ausdrücklich **keine** Server-/Container-Metriken, da kein Monitoring-Stack existiert.

**Hinweis zur Nummerierung:** Dieses Paket hieß ursprünglich „021“. Parallel zu seiner Entstehung wurde PR #5 gemergt, das die Nummer 021 bereits für [Abomodelle, Speicherkontingent und Nutzungsgrenzen](021-abomodelle-und-speicherkontingent.md) vergeben hatte — inklusive einer eigenen `subscription_plans`-Tabelle mit deutlich reichhaltigerem Schema (Tarif-Schlüssel, Speicher-/Beitrags-/Team-/Abteilungs-Limits, `organization_subscriptions` mit begründungspflichtiger operativer Übersteuerung). Dieses Paket wurde deshalb auf 022 umbenannt, und **jeder Bezug zu Abo-Plänen/Preisen/Vereins-Limit-Overrides wurde entfernt** — das gehört vollständig zu 021.

## Ausgangslage und Evidenz

- `packages/authorization/src/index.ts:16-27`: `Role` ist ausschließlich Verein-/Abteilung-/Team-scoped (`organization_owner`, `department_admin`, ...). Kein Konzept einer plattformweiten Rolle existiert.
- `apps/api/src/auth.ts`: `requireAuth`/`requirePermission` sind fest an `PermissionScope` (`organizationId`, optional `departmentId`/`teamId`) gekoppelt. Kein „globaler“, scope-loser Check existiert.
- `supabase/migrations/2026080501_organization_profile_and_onboarding.sql`, `create_organization()`: `max_organizations_per_owner constant integer := 3;` ist eine hartkodierte Konstante — bewusst so gewählt in Paket 009s Adversarial-Review, weil ein Aufrufparameter per `rpc()` aus dem Browser überschreibbar gewesen wäre. Der Nutzer möchte stattdessen Konfigurierbarkeit durch den richtigen (Betreiber-)Nutzer statt durch einen Parameter.
- `plans/021-abomodelle-und-speicherkontingent.md:245,281` (gemergt nach PR #5): verlangt bereits ein neues Recht `platform.manage`, „die keine Vereinsrolle trägt; sie gehört dem Betreiber“ — spezifiziert aber nicht, **wie** dieses Recht durchgesetzt wird. Genau das liefert dieses Paket: eine Zeile in `platform_admins` besitzt `platform.manage`. Wenn 021 umgesetzt wird, sollte es `requirePlatformAdmin` (`apps/api/src/auth.ts`) direkt wiederverwenden statt einen zweiten Mechanismus zu bauen.
- `packages/config/src/index.ts:17`: `OPENAI_API_KEY` ist ein einzelner, ungenutzter Secret-Slot. Kein Code in `apps/api`/`packages/*` ruft ihn auf.
- `packages/content-engine/src/index.ts`: `createGroundedContentBrief`/`buildCaption` sind vollständig deterministisch/template-basiert. **Kein LLM-Aufruf existiert im Repository.**
- `docs/product/implementation-plan.md:1123,1424`: die echte LLM-Anbindung ist als eigene, noch nicht gebaute „Phase 4 – LLM-Content-Engine“ dokumentiert (Ziel-Adapter-Muster: „Provider hinter Adapter kapseln“, `docs/product/implementation-plan.md:769`), voraussichtlich Teil von Paket 005 (Status „in Arbeit“).
- `packages/observability/src/index.ts`: reiner `pino`-Logger-Wrapper. Keine Metrik-/Tracing-Infrastruktur.
- `plans/012-kanaele-und-social-accounts.md:156-169`: spezifiziert bereits ein `packages/secrets`-Modul (`SecretBox` mit `seal`/`open`, AES-GCM, AAD-Bindung, Schlüsselrotation über Env-Var `SOCIAL_TOKEN_KEYS`) für `social_connections`-Tokens. **Keine Implementierung existiert** (kein `createCipheriv`/`AES` irgendwo im Repo außerhalb von Tests) — Paket 012 selbst ist noch nicht umgesetzt (Status „bereit“).
- `supabase/migrations/202608030001_content_media_workflows_publishing.sql`: `posts`, `post_versions` (u.a. `created_by_type in ('user','system','llm')`), `workflow_runs` (`technical_status`, `error_class`), `publications`/`publication_attempts` (`status`, `error_class`) — alle Spalten, die für App-/DB-Nutzungsmetriken gebraucht werden, existieren bereits.
- `packages/domain/src/index.ts:47-87`: `mergeEffectiveConfig` ist korrekt implementiert, hat aber noch keinen Aufrufer außerhalb von Tests (wartet auf Paket 011) — etabliertes Muster im Repo für „Mechanismus fertig, Konsument folgt später“.
- Keine zusammengesetzten Fremdschlüssel mit `on delete set null` und kein `coalesce()`/Ausdruck in einem `unique`/`primary key`-Constraint sind für dieses Paket vorgesehen (siehe Datenmodell unten) — beide in diesem Repo bereits teuren Fallen wurden aktiv geprüft.

## Scope

In Scope:
- Plattform-Admin-Identität (Bootstrap per Env-Var, live hinzufügbare weitere Admins, nur Default-Admin darf löschen)
- Globale Konfiguration (`platform_settings`) — löst 009s hartkodierte Konstante ab (aktuell einziger Schlüssel: `max_organizations_per_owner`)
- LLM-Provider-Konfiguration: mehrere Provider/Modelle/Accounts, verschlüsselte API-Keys, System-Prompts, Auswahllogik nach Zweck (`purpose`/`priority`) — inkl. Eignung für den hauseigenen `haex-claude-proxy` als ganz normaler Anthropic-kompatibler Endpunkt
- `packages/secrets` (generisches `SecretBox`-Modul, vorgezogen aus Plan 012s Spezifikation)
- Admin-Dashboard: Mandantenliste, App-/DB-Nutzungsmetriken (Post-Erzeugung, Fehlerraten aus vorhandenen Tabellen)

Außerhalb des Scopes (bewusste Abgrenzung):
- **Abo-Pläne, Preise, Speicher-/Vereinslimits und deren Übersteuerung** — vollständig Paket 021 (Abomodelle, Speicherkontingent und Nutzungsgrenzen). Ursprünglich Teil dieses Pakets, entfernt wegen der Nummernkollision (siehe oben) und weil 021s Design (`subscription_plans` mit Tarif-Schlüssel, `organization_subscriptions` mit begründungspflichtiger Übersteuerung) dem hier ursprünglich skizzierten generischen Key-Value-Mechanismus klar überlegen ist.
- Echte Zahlungsabwicklung/Rechnungsstellung (Stripe o.ä.) — Teil von 021s eigenen offenen Entscheidungen, nicht dieses Pakets.
- Echte Server-/Container-Infrastrukturmetriken — kein Monitoring-Stack entschieden, keine erfundenen Werte.
- Der tatsächliche LLM-Generierungsaufruf in `content-engine` — das ist Paket 005s „Phase 4“. 022 liefert die Konfigurationsschicht und eine reine Auswahlfunktion, keinen Aufrufer.
- Rotation des Default-Admins (nur Erstbootstrap; ein Wechsel der hinterlegten E-Mail ist eine direkte DB-Aktion, siehe Risiken)

## Datenmodell

Neue Migration `2026080502_platform_administration.sql`. Alle vier neuen Tabellen: `enable row level security`, **keine** Policies für `authenticated`/`anon` (RLS ohne Policy = deny-all). Jeglicher Zugriff läuft ausschließlich über `apps/api`s Service-Role-Client, gated durch `requirePlatformAdmin`. Kein `is_platform_admin()`-SQL-Helper nötig, da keine RLS-Policy ihn referenziert — kleinerer Blast-Radius als eine zusätzliche `authz.*`-Helferfunktion. Einzige Ausnahme: `create_organization()` (security definer, owned by `postgres`) liest `platform_settings` direkt — Owner-Exemption von RLS, exakt wie bei bestehenden Lesezugriffen auf `organization_memberships`.

```sql
-- 1. Plattform-Admin-Identitaet. user_id referenziert public.profiles(id), nicht auth.users(id)
-- direkt -- Konvention im gesamten Repo (siehe z.B. posts.created_by, invitations.invited_by).
create table public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_default_admin boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index platform_admins_default_unique on public.platform_admins (is_default_admin) where is_default_admin;
-- Reiner Spaltenbezug + WHERE-Praedikat in einem CREATE INDEX, kein Ausdruck in einer
-- UNIQUE/PRIMARY-KEY-Tabellen-Constraint -- die zweite in diesem Repo teure Falle betrifft dies nicht.

create or replace function public.reject_default_admin_delete() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if old.is_default_admin then raise exception 'the default platform admin cannot be deleted'; end if;
  return old;
end; $$;
create trigger platform_admins_protect_default before delete on public.platform_admins
  for each row execute function public.reject_default_admin_delete();

-- Bootstrap: idempotent, von apps/api beim Serverstart aufgerufen, wenn PLATFORM_ADMIN_DEFAULT_EMAIL gesetzt ist.
create or replace function public.bootstrap_platform_admin(target_email text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare target_user_id uuid;
begin
  if exists (select 1 from public.platform_admins where is_default_admin) then return; end if;
  select id into target_user_id from auth.users where email = target_email;
  if target_user_id is null then raise exception 'bootstrap_platform_admin: no auth.users row for %', target_email; end if;
  insert into public.platform_admins (user_id, is_default_admin) values (target_user_id, true);
end; $$;
revoke all on function public.bootstrap_platform_admin(text) from public;
grant execute on function public.bootstrap_platform_admin(text) to service_role;

-- Live hinzufuegen (jeder bestehende Admin darf), ohne Default-Flag:
create or replace function public.add_platform_admin(target_email text, added_by uuid) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare target_user_id uuid;
begin
  select id into target_user_id from auth.users where email = target_email;
  if target_user_id is null then raise exception 'add_platform_admin: no auth.users row for %', target_email; end if;
  insert into public.platform_admins (user_id, created_by) values (target_user_id, added_by)
    on conflict (user_id) do nothing;
  return target_user_id;
end; $$;
revoke all on function public.add_platform_admin(text, uuid) from public;
grant execute on function public.add_platform_admin(text, uuid) to service_role;

-- 2. Globale Konfiguration (loest 009s hartkodierte Konstante ab)
create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.platform_settings (key, value) values ('max_organizations_per_owner', '3'::jsonb);

-- 3. LLM-Provider-Konfiguration (Metadaten) + getrennte Geheimnis-Tabelle
create table public.llm_provider_configurations (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  protocol text not null check (protocol in ('anthropic', 'openai')),
  base_url text not null,
  model text not null,
  purpose text not null default 'default',
  priority integer not null default 100,
  is_active boolean not null default true,
  system_prompt_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.llm_provider_secrets (
  llm_provider_configuration_id uuid primary key references public.llm_provider_configurations(id) on delete cascade,
  api_key_ciphertext bytea not null,
  key_version text not null,
  updated_at timestamptz not null default now()
);
alter table public.llm_provider_secrets force row level security;
grant all privileges on public.llm_provider_secrets to service_role;
```

`create_organization()` wird angepasst: die Konstante entfällt, stattdessen zu Beginn der Funktion:
```sql
select (value::text)::integer into max_organizations_per_owner
  from public.platform_settings where key = 'max_organizations_per_owner';
if max_organizations_per_owner is null then max_organizations_per_owner := 3; end if;
```
(Fallback `3`, falls die Zeile fehlt — hält die Funktion robust, sollte durch die Migration aber nie eintreten.) Die 009-Adversarial-Fallgrube bleibt geschlossen: **kein** Aufrufparameter für das Limit, ausschließlich Tabellenlesen innerhalb der `security definer`-Funktion.

Keiner der neuen Fremdschlüssel ist zusammengesetzt und keiner nutzt `on delete set null` — die erste teure Falle greift hier nicht. Die einzige bedingte Eindeutigkeit ist der partielle Index oben (`create unique index ... where`), kein `coalesce()` in einer Tabellen-Constraint — die zweite Falle ebenfalls geprüft und vermieden.

## `packages/secrets` (vorgezogen aus Plan 012)

```ts
export interface SecretBox {
  seal(plaintext: string, aad: string): { ciphertext: Buffer; keyVersion: string }
  open(ciphertext: Buffer, keyVersion: string, aad: string): string
}
```
AES-256-GCM, Nonce vorangestellt, Auth-Tag angehängt. Schlüssel aus Env-Var `SECRET_BOX_KEYS` (JSON-Map `{"v1": "<base64 32 bytes>"}`), aktuellste Version über `SECRET_BOX_CURRENT_KEY_VERSION`. AAD bindet ein Ciphertext an einen konkreten Kontext — für `llm_provider_secrets` die `llm_provider_configuration_id`, damit ein Ciphertext nicht auf eine andere Konfigurationszeile umgehängt werden kann (gleiches Prinzip wie Plan 012s AAD-Bindung an `organizationId`/`socialConnectionId`).

**Notiz für Paket 012** (nicht Teil dieses Pakets): wenn 012 umgesetzt wird, sollte es dieses `packages/secrets`/`SECRET_BOX_KEYS` wiederverwenden statt einer eigenen zweiten Implementierung unter `SOCIAL_TOKEN_KEYS`.

## LLM-Auswahllogik

Reine Funktion in `packages/domain`, analog zu `mergeEffectiveConfig`:
```ts
selectProviderConfiguration(purpose: string, configs: readonly LlmProviderConfiguration[]): LlmProviderConfiguration | null
```
Filtert auf `is_active`, bevorzugt exakten `purpose`-Match, fällt auf `purpose = 'default'` zurück, sortiert nach `priority` aufsteigend. Kein Retry-bei-Fehlschlag-Mechanismus — dafür gibt es noch keinen echten Aufrufer, den man testen könnte (siehe Scope-Abgrenzung); Paket 005 kann beim Bau des echten Adapters einen Retry um diese Funktion legen.

`haex-claude-proxy` (Anthropic-API-kompatibler Proxy, lässt Claude Pro/Max-Abos statt nutzungsbasierter API-Kosten verwenden) braucht **keine Sonderintegration**: ein `llm_provider_configurations`-Eintrag mit `protocol = 'anthropic'`, `base_url` = URL der eigenen Proxy-Instanz und ein Bearer-Token als Geheimnis genügt — er ist aus Sicht dieser Konfiguration ein gewöhnlicher Anthropic-kompatibler Endpunkt mit eigener `base_url`.

## Umsetzung

### 1. Migration und Datenbank-Tests

Migration wie oben, plus Anpassung von `create_organization()`. pgTAP-Tests: RLS deny-all auf allen vier Tabellen (inkl. `force row level security` auf `llm_provider_secrets`), partieller Unique-Index lässt nur einen Default-Admin zu, Trigger verhindert dessen Löschung, `bootstrap_platform_admin`/`add_platform_admin` idempotent und mit korrektem Fehlerverhalten bei unbekannter E-Mail, `create_organization()` respektiert einen geänderten `platform_settings`-Wert.

### 2. `packages/secrets`

`SecretBox`-Interface, AES-256-GCM-Implementierung, Tests: Rundtrip, falsche `keyVersion`/AAD/manipuliertes Ciphertext-Byte schlagen fehl.

### 3. `packages/domain`

`selectProviderConfiguration` mit Tests (Purpose-Match, Fallback, Priorität, `is_active`-Filter).

### 4. `packages/contracts`

Zod-Schemas für alle neuen Request-/Response-Formen (Platform-Admin-Verwaltung, Settings, LLM-Provider — `protocol` als geschlossenes Enum, Admin-E-Mails über die etablierte `.pipe(z.email())`-Konvention).

### 5. API-Endpunkte

Neuer Guard `requirePlatformAdmin(request, reply)` in `apps/api/src/auth.ts` (parallel zu `requireAuth`/`requirePermission`, ohne `PermissionScope` — fragt `platform_admins` per Service-Role-Client nach `request.auth.userId` ab). Serverstart: wenn `PLATFORM_ADMIN_DEFAULT_EMAIL` gesetzt ist, `bootstrap_platform_admin` per RPC aufrufen, Fehler loggen statt Absturz.

Neue Routen (alle `requireAuth` + `requirePlatformAdmin`, außer vermerkt):
- `GET /v1/me/platform-admin-status` — nur `requireAuth`, liefert `{ isPlatformAdmin, isDefaultAdmin }`
- `POST /v1/platform-admins`, `GET /v1/platform-admins`, `DELETE /v1/platform-admins/:userId` (zusätzlich 403, wenn Aufrufer nicht Default-Admin ist)
- `GET /v1/platform-settings`, `PUT /v1/platform-settings/:key`
- `GET /v1/platform-admin/organizations` — Mandantenliste via Service-Role-Aggregatabfrage
- `GET /v1/platform-admin/usage-metrics?from&to` — zeitlich gebuckete Zahlen aus `posts`, `post_versions` (`created_by_type = 'llm'`), `workflow_runs` (`technical_status`), `publications` (`status`)
- `GET/POST/PATCH/DELETE /v1/llm-providers` — Antworten enthalten nie den Klartext-Key, nur `hasSecret: boolean`

### 6. Oberfläche

`layouts/admin.vue` (minimal, wie `layouts/auth.vue`), vier Seiten unter `pages/plattform-admin/` (`index.vue` Dashboard, `admins.vue`, `einstellungen.vue`, `llm.vue`), Redirect in `middleware/auth.global.ts` für Nicht-Admins, `useSession.ts` um `isPlatformAdmin`/`isDefaultAdmin` erweitert, bedingter Nav-Link in `layouts/default.vue`.

### 7. Rückbau

Keiner. Rein additive Funktionalität — kein bestehendes Admin-Dashboard, keine Platzhalter dafür.

## Verifikation

- pgTAP: siehe Umsetzung Punkt 1. 24 Assertions in `supabase/tests/platform_administration.test.sql`, zusammen mit den bestehenden Suiten 81 Assertions über 4 Dateien, alle grün.
- `packages/secrets`, `packages/domain`: siehe Umsetzung Punkt 2/3.
- API-Tests: 403 für Nicht-Admin auf jeder neuen Route, 403 für Nicht-Default-Admin bei `DELETE /v1/platform-admins/:id`, 400 bei ungültigem Body/unbekanntem Settings-Key, API-Key nie im Response-Body. 16 Tests in `apps/api/src/app.test.ts` (9 aus 009 + 7 neu).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm db:start && pnpm db:reset && pnpm db:test` — alle grün.
- Manueller Smoke-Test (Playwright, echter lokaler Stack): Default-Admin per `PLATFORM_ADMIN_DEFAULT_EMAIL` bootstrappt echt beim Serverstart; `/plattform-admin` zeigt die beiden Seed-Vereine mit echten Mitglieder-/Abteilungszahlen; ein LLM-Provider wurde angelegt, der API-Key erschien nirgends im Response-Body oder DOM; ein zweiter, nicht-privilegierter Nutzer wurde von `/plattform-admin` weg auf `/onboarding` umgeleitet.
- Adversariale Prüfung (5 Perspektiven, siehe unten) durchgeführt: keine Funde in Mandantentrennung, Rechte, Geheimnisse, Rückbau. Ein Fund in Verträge (unten dokumentiert) behoben: Regressionstest für den Zeitstempel-Fix ergänzt (`packages/contracts/src/contracts.test.ts`).

## Adversariale Prüfung

Während des manuellen Smoke-Tests selbst gefunden und behoben, bevor die fünf Perspektiven liefen: `z.iso.datetime()` verlangt standardmäßig ein `Z`-Suffix, PostgREST liefert `timestamptz`-Werte aber mit numerischem Offset (`+00:00`). Betraf `PlatformAdminSchema.createdAt`, `PlatformSettingSchema.updatedAt`, `PlatformAdminOrganizationSummarySchema.createdAt` — alle drei ließen sich dadurch beim ersten echten Smoke-Test nicht parsen (400 auf `/v1/platform-admins`, `/v1/platform-settings`, `/v1/platform-admin/organizations`). Behoben mit `{ offset: true }`; ein Regressionstest dafür wurde in der Verträge-Perspektive als fehlend angemerkt und ergänzt.

**Pre-existing bug derselben Fehlerklasse außerhalb dieses Pakets, gefunden und auf expliziten Nutzerwunsch mitgezogen:** `OnboardingStateSchema.dismissedAt` (`packages/contracts/src/index.ts`, aus Paket 009) hatte kein `{ offset: true }` und wird ebenfalls aus einer echten `timestamptz`-Spalte befüllt (`organization_onboarding.dismissed_at`). Sobald ein Verein das Onboarding tatsächlich wegklickt (nicht-null `dismissed_at`), wäre `GET`/`POST /v1/onboarding/...` mit genau demselben Fehler fehlgeschlagen. Ursprünglich als out-of-scope für Paket 022 zurückgestellt, auf Nutzerwunsch beim finalen Aufräumen direkt mitgefixt (`{ offset: true }` ergänzt, Regressionstest in `packages/contracts/src/contracts.test.ts` ergänzt).

## Risiken und offene Entscheidungen

- **Reihenfolge gegenüber 021 (Abomodelle):** 021s `platform.manage`-Endpunkt (operative Speicher-/Kontingent-Übersteuerung) setzt diese Tabelle voraus (siehe Ausgangslage). Package-Nummer und Bau-Reihenfolge zeigen damit in unterschiedliche Richtungen — wer 021 umsetzt, sollte 022 vorher gebaut haben oder `requirePlatformAdmin` als Teil dieser Arbeit mitziehen.
- **Default-Admin-Rotation** ist nicht per API möglich (nur Erstbootstrap). Ein Wechsel der hinterlegten E-Mail erfordert direkten DB-Zugriff — bewusst, da selten und sicherheitskritisch.
- **Preise, Abo-Pläne, Speicher-/Vereinslimits** sind vollständig Paket 021s Verantwortung, nicht Teil dieses Pakets (siehe „Hinweis zur Nummerierung“ oben).
- **Server-/Container-Auslastung** wird im Dashboard als benannter leerer Bereich mit Begründung dargestellt, nicht als erfundene Zahl — sobald ein Monitoring-Stack entschieden ist, kann dieser Abschnitt gefüllt werden.
- **Betreiber vs. Vereinsnutzer — nachträglich entschieden, siehe `2026080602_platform_admin_separation.sql`:** „orthogonal zu allen vereinsbezogenen Rollen" war hier rein additiv umgesetzt — ein Plattform-Admin blieb ein ganz normales Nutzerkonto, konnte Vereine anlegen, Beiträge schreiben und Einladungen annehmen, und wurde ohne eigenen Verein sogar aktiv in den Onboarding-Wizard geschickt (`middleware/auth.global.ts`). Ein Rechteproblem war das nie (`platform_admins` vergibt keine einzige Vereinsberechtigung), aber für ein Mehrmandanten-SaaS ist die Vermischung von Betreiber- und Kundenrolle in einem Konto die falsche Grundlage. Seitdem gilt eine harte Trennung: Trigger auf allen drei Mitgliedschaftstabellen und auf `platform_admins` schließen beide Rollen gegenseitig aus, die API mappt das auf `409`, und die Oberfläche führt Plattform-Admins ausschließlich in den Admin-Bereich. Der Seed liefert dafür ein eigenes Betreiberkonto (`betreiber@example.local`) — die vorherige README-Empfehlung, ein Vorstandskonto zu bootstrappen, scheitert jetzt bewusst.
- **`OnboardingStateSchema.dismissedAt`** (Paket 009) hatte denselben Zeitstempel-Bug — gefunden während dieses Pakets, auf Nutzerwunsch direkt mitgefixt (siehe „Adversariale Prüfung“ oben), obwohl außerhalb des ursprünglichen Scopes.
