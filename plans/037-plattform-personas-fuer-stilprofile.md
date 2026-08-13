# 037 – Plattform-kuratierte Personas für die Textwerkstatt

## Ergebnis

Der Plattform-Betreiber kann im bestehenden SaaS-Admin-Panel (`/plattform-admin`) benannte
Personas anlegen, bearbeiten, deaktivieren und löschen (z. B. „im Stil von Zlatan Ibrahimović“) –
strukturierte Stilprofile, keine freien System-Prompts. Diese Personas stehen anschließend
**jedem Verein** bei der Beitragserstellung zusätzlich zu den fünf fest kodierten Basismodi und
den eigenen, selbst angelegten Vereinsprofilen zur Auswahl, ohne Deployment pro neuer Persona.
Das setzt genau die in `plans/032-mobile-textwerkstatt-mit-stilprofilen.md:27` und
`docs/adr/ADR-010-text-workshop-style-profiles-and-generation-provenance.md:18-20` bereits
vorgesehene, aber bewusst ausgeklammerte Erweiterung um „ein kuratiertes Set benannter Persona“
um.

## Ausgangslage und Evidenz

- `apps/api/src/routes/content.ts:26-32` (`systemStyleProfiles`): die fünf Basismodi
  (`klar_erklaerend` etc.) sind eine **hartkodierte** Konstante, kein DB-Zustand. Sie werden in
  `GET /v1/content-style-profiles` (Zeile 266-276) mit den `content_style_profiles`-Zeilen der
  Organisation zu einer Liste zusammengeführt und in `POST /v1/text-workshop/sessions`
  (Zeile 289-311) per `systemStyleProfileSlug` aufgelöst.
- `supabase/migrations/2026081003_text_workshop_foundation.sql:5,23-49`: `content_style_profiles`
  hat zwar den Enum-Wert `kind = 'system'` vorgesehen, die Tabellen-CHECK erzwingt aber aktuell
  `kind = 'custom'` (Zeile 30) – es gibt **keine** DB-Zeile mit `kind = 'system'`. `organization_id`
  ist `not null` und Teil jedes zusammengesetzten Fremdschlüssels (Zeile 39-42); jede bestehende
  Abfrage auf diese Tabelle filtert zusätzlich hart nach `organization_id` (`content.ts:271,301`).
  `organization_id` nullable zu machen, um globale Personas in derselben Tabelle zu halten, würde
  diese Mandanten-Invariante durchbrechen: der zusammengesetzte Fremdschlüssel
  `(organization_id, style_profile_id) → content_style_profiles(organization_id, id)` in
  `composition_sessions` (Zeile 117-118) könnte eine Zeile mit `organization_id = null` nie
  auflösen, weil die anfragende `organizationId` niemals `null` ist – genau das Muster, vor dem
  `plans/README.md` unter „FK-Referenz braucht Scope-Prüfung“ warnt. Deshalb: neue, eigene,
  global-scoped Tabelle statt Erweiterung von `content_style_profiles` (siehe Datenmodell).
- `packages/contracts/src/content.ts:74-76`: `SystemStyleProfileSlugSchema` ist ein **geschlossener**
  `z.enum` der fünf Basismodi-Slugs. Ein admin-verwaltbarer, zur Laufzeit wachsender Persona-Katalog
  kann nicht über einen zur Compile-Zeit fixierten Enum laufen. Statt diesen Enum anzufassen: ein
  neues, additives, optionales Feld `personaSlug` (validiert nur auf Form wie
  `ContentPresetSlugSchema`, die tatsächliche Existenz/`isActive`-Prüfung passiert wie bei
  `styleProfileId` heute schon zur Laufzeit in der Route) – der bestehende Enum und sein
  Reservierungs-Code (`content.ts:109-111`) bleiben unangetastet.
- `apps/api/src/routes/platformAdmin.ts`, `apps/api/src/routes/llmProviders.routes.ts`: das
  Plattform-Admin-Panel existiert bereits vollständig (`requirePlatformAdmin`-Guard in
  `apps/api/src/auth.ts`, eigene Rolle orthogonal zu allen Vereinsrollen, `plans/022-plattform-administration.md`).
  `llmProviders.routes.ts` ist das nächstliegende Vorbild für admin-verwaltete, plattformweite
  Konfigurationsdaten mit vollem CRUD (`GET/POST/PATCH/DELETE /v1/llm-providers`), inklusive des
  bewusst dokumentierten Verzichts auf einen Audit-Trail (Zeile 19-24: „die gesamte
  Plattform-Administration hat bislang keinen eigenen Audit-Trail – ein auf eine Route beschränkter
  Sonderweg wäre selbst unvollständig“).
- `apps/api/src/routes/platformAdmin.ts:...` / `supabase/migrations/2026080502_platform_administration.sql`:
  etabliertes Muster für plattformweite, nicht vereinsgebundene Tabellen – RLS aktiviert, aber ohne
  Policy für schreibende Zugriffe von `authenticated` (deny-all), jeglicher Schreibzugriff
  ausschließlich über den Service-Role-Client, gated durch `requirePlatformAdmin` in der API.
- `docs/adr/ADR-011-provider-task-routing-for-text-generation.md` (referenziert in
  `supabase/migrations/2026081103_text_generation_routing.sql:11-16`): ein freier, vom Betreiber
  gesetzter System-Prompt (`llm_provider_configurations.system_prompt_override`) wurde bewusst per
  CHECK stillgelegt – Kommentar: „A free operator supplied system prompt would be an unreviewed
  policy bypass.“ Personas müssen deshalb dasselbe strukturierte Format wie bestehende Stilprofile
  bekommen (`StyleProfileRulesSchema`: Satzlänge/Energie/Humor/Formalität/Perspektive/verbotene
  Formulierungen, `additionalInstructions` weiterhin auf 1000 Zeichen begrenzt und niedrig
  priorisiert), kein freies Prompt-Feld.
- `packages/content-engine/src/index.ts:93-114` (`buildStructuredTextPrompt`) und
  `apps/worker/src/textGeneration.ts:68-73` lesen `composition_sessions.style_profile_snapshot`
  vollständig generisch (`name`, `description`, `styleRules`, `avoidRules`) – unabhängig davon, ob
  der Snapshot aus einem Basismodus, einem Vereinsprofil oder künftig einer Persona stammt. **Kein
  Worker-/Prompt-Code muss geändert werden.**
- `docs/adr/ADR-010-...md:22-24` (offen): ob KI-generierter Text im veröffentlichten Beitrag als
  KI-unterstützt gekennzeichnet werden muss, ist rechtlich noch nicht geklärt; jede
  Veröffentlichungsroute für Textwerkstatt-Entwürfe bleibt bis dahin gesperrt
  (`docs/operations/text-generation-pilot.md:6-7`). Das gilt unverändert für Personas-generierten
  Text – kein neuer, aber auch kein durch dieses Paket gelöster Blocker.
- Kein Tarif-/Kontingentsystem existiert (`apps/web/app/pages/plattform-admin/einstellungen.vue:56`:
  „Abo-Pläne und Speicherkontingente werden in einem eigenen Paket verwaltet“; `[[project_token_budget_modell_angekuendigt]]`
  ist als separate Erweiterung von Paket 021 zurückgestellt). Eine tarifabhängige Freischaltung
  einzelner Personas hat daher keine Anknüpfungsstelle und ist nicht Teil dieses Pakets.
- `[[project_personenimitation_stilprofile_erlaubt]]`: Betreiberentscheidung vom 2026-08-11 –
  Stilprofile/Personas dürfen jede reale Person benennen und imitieren, keine technische Sperre;
  Absicherung ist organisatorisch (Rollenvergabe, bestehende Freigaberouten).

## Scope

In Scope:
- Neue Tabelle `platform_style_personas` (global, kein `organization_id`) mit RLS, wiederverwendeten
  Checks aus `content_style_profiles` (Slug-Form, Feldlängen, `avoid_rules`-Kardinalität) und
  beidseitigem Slug-Kollisionsschutz gegen die fünf Basismodi und gegen bestehende
  Vereins-Stilprofile.
- Admin-CRUD: `GET/POST/PATCH/DELETE /v1/platform-style-personas`, ausschließlich
  `requirePlatformAdmin`-gated, nach dem Muster von `llmProviders.routes.ts`.
- Neue Seite `apps/web/app/pages/plattform-admin/personas.vue` (Tabelle + Formular, analog `llm.vue`).
- Additive Erweiterung von `GET /v1/content-style-profiles` (dritte Quelle neben Basismodi und
  Vereinsprofilen, Diskriminator `kind: 'persona'`) und von `POST /v1/text-workshop/sessions`
  (neues optionales Feld `personaSlug`, dritter gegenseitig ausschließender Zweig neben
  `styleProfileId`/`systemStyleProfileSlug`).
- Anpassung der Profil-Auswahl in `apps/web/app/pages/erstellen.vue`, damit eine gewählte Persona
  `personaSlug` statt `styleProfileId`/`systemStyleProfileSlug` sendet.
- pgTAP- und API-Tests, Contracts-Tests für das erweiterte `superRefine`.

Außerhalb des Scopes (bewusste Abgrenzung):
- **Kein Rechte-/Lizenzprüfungsworkflow** für real benannte Personen. `ADR-010` lehnt eine
  technische Durchsetzung explizit ab; welche Persona angelegt wird, bleibt eine redaktionelle
  Entscheidung des Betreibers außerhalb der Software.
- **Keine tarifabhängige Freischaltung** – alle Personas stehen allen Vereinen gleichermaßen zur
  Verfügung (entspricht der Nutzeranforderung „allen Nutzern zur Verfügung stehen“); ein
  Kontingent-/Tarifsystem existiert ohnehin nicht (siehe Ausgangslage).
- **Keine Änderung der fünf fest kodierten Basismodi** – `systemStyleProfiles` in `content.ts`
  bleibt unverändert Code; nur die neue Persona-Ebene wird DB-gestützt.
- **Kein Audit-Trail für Personas-CRUD** – spiegelt die bereits akzeptierte, dokumentierte Lücke
  bei `llm_provider_configurations` (siehe Ausgangslage); eine auf Personas beschränkte
  Einzellösung wäre selbst unvollständig.
- **Kein Soft-Delete/Versionierung** – `DELETE` löscht hart, wie bei `llm_provider_configurations`.
  Unkritisch, weil keine Fremdschlüssel von `composition_sessions`/`post_generation_provenance`
  auf `platform_style_personas` zeigen (Referenzierung ausschließlich per Slug in den bereits
  eingefrorenen Snapshot, exakt wie bei den fünf Basismodi heute); bereits akzeptierte Kandidaten
  bleiben nach Löschung/Deaktivierung einer Persona unverändert lesbar.
- **Keine Klärung der KI-Kennzeichnungsfrage** – bleibt ein von diesem Paket unabhängiger Blocker
  für jede echte Veröffentlichungsroute.

## Datenmodell

Neue Migration `2026081301_platform_style_personas.sql`:

```sql
create table public.platform_style_personas (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9]*([_-][a-z0-9]+)*$' and char_length(slug) <= 64),
  name text not null check (char_length(name) between 1 and 80),
  description text not null check (char_length(description) between 1 and 500),
  style_rules jsonb not null check (jsonb_typeof(style_rules) = 'object'),
  avoid_rules text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(avoid_rules) <= 30 and public.text_array_elements_within_length(avoid_rules, 160)),
  -- Dieselben fuenf reservierten Slugs wie content_style_profiles (2026081003, Zeile 48): eine
  -- Persona darf keinen Basismodus verdecken.
  check (slug not in ('klar_erklaerend', 'warm_gemeinschaftlich', 'lebendig_sportlich', 'leicht_humorvoll', 'feierlich_wertschaetzend'))
);

alter table public.platform_style_personas enable row level security;
alter table public.platform_style_personas force row level security;
-- Keine Sonderbehandlung von organization_id noetig -- es gibt keine. Sichtbarkeit ist bewusst
-- nicht auf is_active eingeschraenkt (das filtert wie bei content_style_profiles die Anwendung),
-- sondern rein "kann ueberhaupt lesen": jeder authentifizierte Nutzer, kein Vereinsbezug.
create policy platform_style_personas_select on public.platform_style_personas
  for select to authenticated using (true);
grant select on public.platform_style_personas to authenticated;
grant all privileges on public.platform_style_personas to service_role;

create trigger set_platform_style_personas_updated_at before update on public.platform_style_personas
  for each row execute function public.set_updated_at();

-- Beidseitiger Kollisionsschutz: ein Slug darf nicht gleichzeitig ein Vereinsprofil und eine
-- Persona benennen (verwirrende Dopplung im zusammengefuehrten Auswahl-Ergebnis). Eine CHECK-
-- Constraint kann keine Subquery enthalten (siehe Kommentar in 2026081003 zu
-- text_array_elements_within_length), deshalb zwei kleine Trigger statt eines CHECKs.
create or replace function public.reject_persona_slug_collision() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.content_style_profiles where slug = new.slug) then
    raise exception 'slug % is already used by a club style profile', new.slug;
  end if;
  return new;
end; $$;
create trigger platform_style_personas_reject_collision before insert or update of slug
  on public.platform_style_personas for each row execute function public.reject_persona_slug_collision();

create or replace function public.reject_tenant_slug_collision_with_persona() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.platform_style_personas where slug = new.slug) then
    raise exception 'slug % is reserved by a platform persona', new.slug;
  end if;
  return new;
end; $$;
create trigger content_style_profiles_reject_persona_collision before insert or update of slug
  on public.content_style_profiles for each row execute function public.reject_tenant_slug_collision_with_persona();
```

Wiederverwendet: `text_array_elements_within_length` (bereits in `2026081003_text_workshop_foundation.sql`
definiert), `set_updated_at` (projektweite Standardfunktion). Keine neue Enum, kein neuer
zusammengesetzter Fremdschlüssel, kein `coalesce()` in einer Unique-/Primary-Key-Constraint – beide
in diesem Projekt bereits teuren Fallen betreffen dieses Datenmodell nicht.

### Contracts (`packages/contracts/src/content.ts`)

- Neu: `PlatformStylePersonaSchema` (`id, slug, name, description, styleRules, avoidRules,
  isActive, createdBy, createdAt, updatedAt` – gleiche Feldgrenzen wie `CustomStyleProfileSchema`,
  aber ohne Scope-Felder).
- Neu: `CreatePlatformStylePersonaRequestSchema` (`slug, name, description, styleRules,
  avoidRules`) und `UpdatePlatformStylePersonaRequestSchema` (alle Felder optional inklusive
  `isActive`, analog `UpdateLlmProviderConfigurationRequestSchema`s Partial-Update-Muster).
- `CreateCompositionSessionSchema` erhält ein additives `personaSlug: ContentPresetSlugSchema.optional()`;
  das bestehende `superRefine` (Zeile 131-133) wird auf drei sich gegenseitig ausschließende Felder
  erweitert (`styleProfileId`, `systemStyleProfileSlug`, `personaSlug` – höchstens eines gesetzt).

## Umsetzung

### 1. Migration und Datenbank-Tests

Migration wie oben. pgTAP (`supabase/tests/`, neue Datei oder Ergänzung der Textwerkstatt-Suite):
RLS erlaubt `select` für `authenticated` uneingeschränkt, verweigert `insert`/`update`/`delete` für
`authenticated` (nur `service_role`); Slug-Form-/Längen-Checks; `avoid_rules`-Kardinalität/-Länge
über die wiederverwendete Funktion; beide Kollisions-Trigger (Persona mit Slug eines bestehenden
Vereinsprofils abgelehnt, Vereinsprofil mit Slug einer bestehenden Persona abgelehnt); Basismodi-Slug
als Persona-Slug abgelehnt.

### 2. `packages/contracts`

Neue/erweiterte Schemas wie oben, Tests für das dreiwertige `superRefine` (jede Kombination aus
zwei gesetzten Feldern schlägt fehl, jede einzelne besteht, keines gesetzt besteht mit Fallback
auf den Default-Basismodus wie heute).

### 3. API

- Neue Datei `apps/api/src/routes/platformPersonas.routes.ts`, registriert wie
  `registerLlmProviderRoutes`: `GET/POST/PATCH/DELETE /v1/platform-style-personas`, alle
  `requireAuth` + `requirePlatformAdmin`, CRUD 1:1 nach dem Muster von `llmProviders.routes.ts`
  (Service-Role-Client, `.select(...).single()`/`.maybeSingle()`, 404 bei unbekannter `id`).
- `apps/api/src/routes/content.ts`:
  - `GET /v1/content-style-profiles`: zusätzliche Abfrage auf `platform_style_personas`
    (`is_active = true`), gemappt mit `kind: 'persona'`, in die zurückgegebene Liste eingefügt.
  - `POST /v1/text-workshop/sessions`: dritter Zweig neben `styleProfileId`/`systemStyleProfileSlug`
    für `input.personaSlug` – lädt die aktive Persona per Slug, 404 `persona_not_found`, sonst
    identischer `styleSnapshot`-Aufbau wie beim Basismodus-Zweig.

### 4. Frontend – Plattform-Admin

Neue Seite `apps/web/app/pages/plattform-admin/personas.vue` (Tabelle + Anlage-/Bearbeitungsformular,
Struktur analog `llm.vue`): Felder für Slug, Name, Beschreibung, die fünf `styleRules`-Attribute,
`bannedPhrases`, `additionalInstructions` (mit sichtbarem 1000-Zeichen-Limit), `avoidRules`,
Aktiv-Umschalter, Löschen mit Bestätigung. Nav-Link in `layouts/admin.vue`/`plattform-admin/index.vue`
neben dem bestehenden LLM-Provider-Link.

### 5. Frontend – Textwerkstatt

`apps/web/app/pages/erstellen.vue`: die Profil-Auswahl (aktuell Verzweigung nach `profile.id`
vorhanden/fehlt) erhält einen dritten Fall für `profile.kind === 'persona'` und sendet
`personaSlug` statt `styleProfileId`/`systemStyleProfileSlug`. Optional, falls ohne nennenswerten
Mehraufwand: sichtbare Gruppierung „Basis-Stile“ / „Personas“ / „Eigene Profile“ in der
Auswahl-Oberfläche, da drei `kind`-Werte sonst undifferenziert nebeneinanderstehen.

### 6. Dokumentation

`plans/README.md`: neue Zeile in der Tabelle „Fünfte Serie“ (Nr. 037), Ergänzung des Absatzes zur
Stilvorgabe um den Hinweis, dass die Admin-Verwaltung jetzt existiert.

## Verifikation

- pgTAP: siehe Umsetzung Punkt 1.
- Contracts-Tests: siehe Umsetzung Punkt 2.
- API-Tests (`apps/api/src/*.routes.test.ts`): 403 für Nicht-Plattform-Admin auf jeder neuen
  `/v1/platform-style-personas`-Route; 404 bei unbekannter/inaktiver Persona in
  `POST /v1/text-workshop/sessions`; `GET /v1/content-style-profiles` liefert Basismodi, Personas
  und Vereinsprofile gemeinsam mit korrektem `kind`; CRUD-Rundlauf (create → patch → delete);
  gelöschte/deaktivierte Persona lässt bereits akzeptierte `post_generation_provenance`-Zeilen
  unverändert lesbar.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm db:start && pnpm db:reset && pnpm db:test`.
- Manueller Smoke-Test (Playwright, echter lokaler Stack): Plattform-Admin legt eine Test-Persona
  mit einem generischen Platzhalternamen an (keine reale Person – die inhaltliche Kuration ist
  laut Scope eine eigene, spätere redaktionelle Aufgabe); sie erscheint im Vereins-Frontend unter
  „Personas“ und erzeugt einen echten Textgenerierungs-Kandidaten mit dem hinterlegten Stil; ein
  nicht-privilegierter Vereinsnutzer erhält 403 auf `/v1/platform-style-personas`.

## Risiken und offene Entscheidungen

- **Inhaltliche Kuration** (welche realen Personen tatsächlich angelegt werden, inkl. etwaiger
  Rechteprüfung) ist bewusst nicht Teil dieses Pakets – dieses Paket liefert nur den Mechanismus.
- **KI-Kennzeichnungspflicht** (ADR-010, weiterhin offen) blockiert unverändert jede echte
  Veröffentlichung KI-generierten Textes, unabhängig von der Anzahl verfügbarer Personas.
- **Tarifabhängige Freischaltung** ist absichtlich nicht vorgesehen; sollte sie später gewünscht
  werden, bräuchte sie zuerst ein Tarif-/Kontingentsystem (Erweiterung Paket 021), das aktuell
  nicht existiert.
- **Kein Audit-Trail** für Personas-CRUD, konsistent mit der bestehenden, dokumentierten Lücke bei
  `llm_provider_configurations` – eine projektweite Lösung wäre eigenständig zu entscheiden, nicht
  Teil dieses Pakets.
