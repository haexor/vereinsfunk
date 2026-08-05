# 021 – Plattform-Administration (SaaS-Betreiber)

## Ergebnis

Ein SaaS-Betreiber-Admin, orthogonal zu allen vereinsbezogenen Rollen: ein per Umgebungsvariable bootstrap-fähiger Default-Admin, weitere Admins live hinzufügbar, nur der Default-Admin darf andere Admins wieder entfernen. Der Admin konfiguriert plattformweite Limits (löst die in Paket 009 hartkodierte Eigentümer-Grenze ab), Vereins-spezifische Ausnahmen davon, interne Abo-Pläne mit Preisen (keine echte Zahlungsabwicklung), und LLM-Provider (mehrere Modelle/Accounts/API-Keys, System-Prompts, Auswahllogik nach Zweck). Ein eigenes Admin-Dashboard zeigt Mandantenliste, Abo-Zuordnung und App-/DB-Nutzungsmetriken (Post-Erzeugung, Fehlerraten) — ausdrücklich **keine** Server-/Container-Metriken, da kein Monitoring-Stack existiert.

## Ausgangslage und Evidenz

- `packages/authorization/src/index.ts:16-27`: `Role` ist ausschließlich Verein-/Abteilung-/Team-scoped (`organization_owner`, `department_admin`, ...). Kein Konzept einer plattformweiten Rolle existiert.
- `apps/api/src/auth.ts`: `requireAuth`/`requirePermission` sind fest an `PermissionScope` (`organizationId`, optional `departmentId`/`teamId`) gekoppelt. Kein „globaler“, scope-loser Check existiert.
- `supabase/migrations/2026080501_organization_profile_and_onboarding.sql`, `create_organization()`: `max_organizations_per_owner constant integer := 3;` ist eine hartkodierte Konstante — bewusst so gewählt in Paket 009s Adversarial-Review, weil ein Aufrufparameter per `rpc()` aus dem Browser überschreibbar gewesen wäre. Der Nutzer möchte stattdessen Konfigurierbarkeit durch den richtigen (Betreiber-)Nutzer statt durch einen Parameter.
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
- Globale Konfiguration (`platform_settings`) + Vereins-spezifische Ausnahmen (`organization_setting_overrides`) — löst 009s hartkodierte Konstante ab
- Interne Abo-Pläne (`subscription_plans`) mit Preisen und Limits, Zuordnung zu Vereinen — **keine** Zahlungsabwicklung
- LLM-Provider-Konfiguration: mehrere Provider/Modelle/Accounts, verschlüsselte API-Keys, System-Prompts, Auswahllogik nach Zweck (`purpose`/`priority`) — inkl. Eignung für den hauseigenen `haex-claude-proxy` als ganz normaler Anthropic-kompatibler Endpunkt
- `packages/secrets` (generisches `SecretBox`-Modul, vorgezogen aus Plan 012s Spezifikation)
- Admin-Dashboard: Mandantenliste, Abo-Zuordnung, App-/DB-Nutzungsmetriken (Post-Erzeugung, Fehlerraten aus vorhandenen Tabellen)

Außerhalb des Scopes (bewusste Abgrenzung):
- Echte Zahlungsabwicklung/Rechnungsstellung (Stripe o.ä.) — eigenes, späteres geld-relevantes Paket
- Echte Server-/Container-Infrastrukturmetriken — kein Monitoring-Stack entschieden, keine erfundenen Werte
- Der tatsächliche LLM-Generierungsaufruf in `content-engine` — das ist Paket 005s „Phase 4“. 021 liefert die Konfigurationsschicht und eine reine Auswahlfunktion, keinen Aufrufer.
- Rotation des Default-Admins (nur Erstbootstrap; ein Wechsel der hinterlegten E-Mail ist eine direkte DB-Aktion, siehe Risiken)
- Org-seitige Anzeige des eigenen Abo-Plans (nicht angefragt)

## Datenmodell

Neue Migration `2026080502_platform_administration.sql`. Alle sechs neuen Tabellen: `enable row level security`, **keine** Policies für `authenticated`/`anon` (RLS ohne Policy = deny-all). Jeglicher Zugriff läuft ausschließlich über `apps/api`s Service-Role-Client, gated durch `requirePlatformAdmin`. Kein `is_platform_admin()`-SQL-Helper nötig, da keine RLS-Policy ihn referenziert — kleinerer Blast-Radius als eine zusätzliche `authz.*`-Helferfunktion. Einzige Ausnahme: `create_organization()` (security definer, owned by `postgres`) liest `platform_settings` direkt — Owner-Exemption von RLS, exakt wie bei bestehenden Lesezugriffen auf `organization_memberships`.

```sql
-- 1. Plattform-Admin-Identitaet
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_default_admin boolean not null default false,
  created_by uuid references auth.users(id),
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
  updated_by uuid references auth.users(id)
);
insert into public.platform_settings (key, value) values ('max_organizations_per_owner', '3'::jsonb);

-- 3. Vereins-spezifische Ausnahmen (generischer Mechanismus fuer 011/019 als kuenftige Konsumenten --
-- analog zu mergeEffectiveConfig, das ebenfalls vor seinem Aufrufer fertig war)
create table public.organization_setting_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (organization_id, key)
);

-- 4. Abo-Plaene (nur intern, kein Payment)
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'EUR',
  limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.subscription_plans (name, price_cents, limits) values ('Standard', 0, '{}'::jsonb);
alter table public.organizations add column subscription_plan_id uuid references public.subscription_plans(id);
update public.organizations set subscription_plan_id = (select id from public.subscription_plans where name = 'Standard');

-- 5. LLM-Provider-Konfiguration (Metadaten) + getrennte Geheimnis-Tabelle
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
select coalesce((value->>0)::integer, 3) into max_organizations_per_owner
  from public.platform_settings where key = 'max_organizations_per_owner';
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

Migration wie oben, plus Anpassung von `create_organization()`. pgTAP-Tests: RLS deny-all auf allen sechs Tabellen (inkl. `force row level security` auf `llm_provider_secrets`), partieller Unique-Index lässt nur einen Default-Admin zu, Trigger verhindert dessen Löschung, `bootstrap_platform_admin`/`add_platform_admin` idempotent und mit korrektem Fehlerverhalten bei unbekannter E-Mail, `create_organization()` respektiert einen geänderten `platform_settings`-Wert.

### 2. `packages/secrets`

`SecretBox`-Interface, AES-256-GCM-Implementierung, Tests: Rundtrip, falsche `keyVersion`/AAD/manipuliertes Ciphertext-Byte schlagen fehl.

### 3. `packages/domain`

`selectProviderConfiguration` mit Tests (Purpose-Match, Fallback, Priorität, `is_active`-Filter).

### 4. `packages/contracts`

Zod-Schemas für alle neuen Request-/Response-Formen (Platform-Admin-Verwaltung, Settings, Overrides, Abo-Pläne, LLM-Provider — inkl. `IanaTimezoneSchema`-artiger strikter Validierung wo zutreffend, z.B. `protocol` als geschlossenes Enum).

### 5. API-Endpunkte

Neuer Guard `requirePlatformAdmin(request, reply)` in `apps/api/src/auth.ts` (parallel zu `requireAuth`/`requirePermission`, ohne `PermissionScope` — fragt `platform_admins` per Service-Role-Client nach `request.auth.userId` ab). Serverstart: wenn `PLATFORM_ADMIN_DEFAULT_EMAIL` gesetzt ist, `bootstrap_platform_admin` per RPC aufrufen, Fehler loggen statt Absturz.

Neue Routen (alle `requireAuth` + `requirePlatformAdmin`, außer vermerkt):
- `GET /v1/me/platform-admin-status` — nur `requireAuth`, liefert `{ isPlatformAdmin, isDefaultAdmin }`
- `POST /v1/platform-admins`, `GET /v1/platform-admins`, `DELETE /v1/platform-admins/:userId` (zusätzlich 403, wenn Aufrufer nicht Default-Admin ist)
- `GET /v1/platform-settings`, `PUT /v1/platform-settings/:key`
- `GET /v1/organizations/:id/setting-overrides`, `PUT .../:key`, `DELETE .../:key`
- `GET /v1/subscription-plans`, `POST /v1/subscription-plans`, `PATCH /v1/subscription-plans/:id`, `PUT /v1/organizations/:id/subscription-plan`
- `GET /v1/platform-admin/organizations` — Mandantenliste via Service-Role-Aggregatabfrage
- `GET /v1/platform-admin/usage-metrics?from&to` — zeitlich gebuckete Zahlen aus `posts`, `post_versions` (`created_by_type = 'llm'`), `workflow_runs` (`technical_status`), `publications` (`status`)
- `GET/POST/PATCH/DELETE /v1/llm-providers` — Antworten enthalten nie den Klartext-Key, nur `hasSecret: boolean`

### 6. Oberfläche

`layouts/admin.vue` (minimal, wie `layouts/auth.vue`), vier Seiten unter `pages/plattform-admin/` (`index.vue` Dashboard, `admins.vue`, `einstellungen.vue`, `llm.vue`), Redirect in `middleware/auth.global.ts` für Nicht-Admins, `useSession.ts` um `isPlatformAdmin`/`isDefaultAdmin` erweitert, bedingter Nav-Link in `layouts/default.vue`.

### 7. Rückbau

Keiner. Rein additive Funktionalität — kein bestehendes Admin-Dashboard, keine Platzhalter dafür.

## Verifikation

- pgTAP: siehe Umsetzung Punkt 1.
- `packages/secrets`, `packages/domain`: siehe Umsetzung Punkt 2/3.
- API-Tests: 403 für Nicht-Admin auf jeder neuen Route, 403 für Nicht-Default-Admin bei `DELETE /v1/platform-admins/:id`, 400 bei ungültigem Body/unbekanntem Settings-Key, API-Key nie im Response-Body.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm db:start && pnpm db:reset && pnpm db:test` — alle grün.
- Manueller Smoke-Test: `PLATFORM_ADMIN_DEFAULT_EMAIL` setzen, Server starten, mit diesem Nutzer einloggen, `/plattform-admin` erreichbar; mit einem anderen Nutzer → Redirect.

## Risiken und offene Entscheidungen

- **Default-Admin-Rotation** ist nicht per API möglich (nur Erstbootstrap). Ein Wechsel der hinterlegten E-Mail erfordert direkten DB-Zugriff — bewusst, da selten und sicherheitskritisch.
- **`organization_setting_overrides` hat aktuell keinen Konsumenten** außer der Admin-UI selbst (das einzige heute existierende Limit, die Eigentümer-Grenze, ist pro-Eigentümer statt pro-Verein und deshalb nicht über diese Tabelle overridebar). Mechanismus ist fertig und getestet, wartet auf 011/019 als Konsumenten.
- **Preise sind reine Konfiguration**, keine Abrechnung/Rechnungsstellung — laut Nutzerentscheidung explizit so gewollt.
- **Server-/Container-Auslastung** wird im Dashboard als benannter leerer Bereich mit Begründung dargestellt, nicht als erfundene Zahl — sobald ein Monitoring-Stack entschieden ist, kann dieser Abschnitt gefüllt werden.
