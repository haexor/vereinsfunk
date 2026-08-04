# 008 – Echte Authentifizierung, Profile und Autorisierungsgrenze

## Ergebnis

Ein Mensch registriert sich, bestätigt seine E-Mail, meldet sich an und erhält eine echte Sitzung. Die Oberfläche kennt danach den angemeldeten Nutzer, seine Mitgliedschaften und seinen aktiven Scope aus der Datenbank statt aus einem Demo-Composable. Die Fastify-API verifiziert jedes Token kryptografisch. Scope-gebundene Endpunkte prüfen zusätzlich die passende Permission; `/health` bleibt öffentlich, `/v1/media/:assetId/complete` und `/v1/media/gate` verlangen ausschließlich eine verifizierte Authentifizierung (siehe Risiken). Es existiert kein Codepfad mehr, der fachliche Daten ohne verifizierte Identität liefert.

Dieses Paket ist die Voraussetzung für alle folgenden. Ohne es lässt sich kein Dummy-Datensatz ehrlich ersetzen, weil es keinen Nutzerkontext gibt, gegen den echte Daten geladen werden könnten.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04. Zeilenangaben am 2026-08-04 gegen den aktuellen Stand nachverifiziert — die fachlichen Aussagen halten alle, mehrere Zeilenangaben waren zu hoch gegriffen, weil die referenzierten Dateien deutlich kleiner sind als angenommen. Korrigierte Stellen sind unten direkt eingesetzt.

- `apps/api/src/app.ts:66-72` ist die gesamte Autorisierung: `requireAuth` prüft nur, **ob** ein `authorization`-Header existiert, und das ausschließlich bei `NODE_ENV === 'production'`. Der Header-Inhalt wird nie gelesen, keine Signatur geprüft, keine Permission ausgewertet. In Entwicklung und Test ist jeder Endpunkt vollständig offen.
- `apps/api/src/app.ts:74-121`: kein Endpunkt liest oder schreibt die Datenbank. `/v1/submissions` (`:74-103`) erzeugt eine UUID, ruft den Fake-Generator und antwortet 202, ohne etwas zu persistieren. `LocalUploadService` (`:27-30`) liefert eine `https://storage.invalid/...`-URL.
- `@supabase/supabase-js` steht in `apps/web/package.json` als Abhängigkeit, wird aber in keiner Datei importiert (verifiziert per Suche über `apps/*/src`, `apps/web/app`, `packages/*/src`). `apps/web/nuxt.config.ts:27-28` reicht `supabaseUrl` und `supabaseAnonKey` in die Runtime-Config, niemand liest sie.
- Es gibt keine Login-, Registrierungs- oder Passwort-Reset-Seite und keine Route-Middleware. Jede Seite unter `apps/web/app/pages/` ist ohne Anmeldung erreichbar.
- `apps/web/app/layouts/default.vue:5` bezieht Organisation und Abteilung aus `useDemoData()`; `:81` zeigt hartkodiert „Lena Müller / Social Managerin“.
- `apps/web/app/pages/erstellen.vue:14` liest `useState('content-scope')`, das **nirgends im Projekt gesetzt wird**. Der Scope ist daher immer `null`, jeder Entwurf landet zwangsläufig im lokalen Fallback (`localPreview()` an `:25-29`, aufgerufen in den `catch`-Zweigen von `createPreview()` an `:41` und `:47`).
- `supabase/migrations/202608020001_initial_tenant_foundation.sql:24-30`: `public.profiles` referenziert `auth.users`, aber es existiert **kein Trigger auf `auth.users`**, der beim Registrieren eine Profilzeile anlegt. `supabase/seed.sql:405-408` legt Profile manuell an. Ein echter Neuregistrierter hat kein Profil, und weil alle Memberships und `created_by`-Spalten auf `profiles(id)` verweisen, schlägt danach jede fachliche Operation fehl.
- Für `public.organizations` existiert **keine INSERT-Policy** (verifiziert über alle Migrationen). Ein Verein kann heute ausschließlich über die Service Role angelegt werden. Das ist als Sicherheitsentscheidung richtig, bedeutet aber, dass Onboarding zwingend einen privilegierten Serverpfad braucht (Paket 009).
- `supabase/migrations/202608020003_api_grants.sql` erteilt `authenticated` gezielte `select`/`insert`/`update`-Rechte. Die Rechtestruktur ist vorhanden und wird von diesem Paket genutzt, nicht verändert.

## Scope

- neue Nuxt-Seiten `anmelden`, `registrieren`, `passwort-vergessen`, `passwort-neu`, `auth/callback`
- Supabase-Client-Integration in Nuxt: Browser-Client mit Anon-Key, Server-Side-Session, Route-Middleware
- neues Paket `packages/supabase` oder Modul `apps/api/src/supabase.ts` für den Service-Role-Client
- echte Token-Verifikation und Auth-Kontext in Fastify inklusive Permission-Guard
- Migration: `profiles`-Autoanlage bei Registrierung, Selbst-Insert-Policy, `authz`-Funktion für Team-Ebene
- `apps/web/app/composables/useSession.ts` und `useScope.ts` als Ersatz für `useDemoData`
- Rückbau der Identitäts-Dummies

Nicht enthalten: Vereinserstellung und Onboarding-Wizard (009), Mitgliederverwaltung und Einladungen (010), Social-Login-Provider, Zwei-Faktor-Authentifizierung, SSO.

**Wichtig für den Rückbau**: `useDemoData()` hat drei Konsumenten, nicht nur `layouts/default.vue`: auch `pages/index.vue:4` (`drafts`, `department`) und `pages/beitraege.vue:3` (`drafts`) importieren sie. Löscht dieses Paket die Datei vollständig, brechen beide Seiten beim Build, wenn sie nicht mit angefasst werden. Beide Seiten gehören daher in den Scope dieses Pakets — nicht um ihre Listenansicht neu zu bauen (das bleibt 009/010), sondern um den jetzt herrenlosen Import zu ersetzen: `department` durch `useScope()`, `drafts` durch einen benannten Empty State („Es liegen noch keine Beiträge vor“ statt einer Null oder leeren Tabelle ohne Erklärung).

## Datenmodell

Eine additive Migration `2026080401_auth_bootstrap.sql`:

```sql
-- Profil entsteht beim Registrieren, nicht durch manuelles Seeding.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();
```

Zusätzlich:

- `profiles`-INSERT-Policy für `id = auth.uid()` als Rückfallebene, falls ein Nutzer vor dem Trigger existierte (Bestandsdaten aus dem Seed).
- `authz.has_team_permission(target_team_id uuid, permission text)` analog zu `has_department_permission`, mit Eskalation an Abteilung und Verein. Diese Funktion fehlt heute vollständig; `team_memberships`-Policies weichen deshalb auf Abteilungsrechte aus (`202608020001:399-400`). Paket 010 braucht sie.
- `authz.membership_scopes()` liefert für `auth.uid()` alle Scopes mit Rollen in einem Aufruf. Die Oberfläche darf nicht drei Tabellen einzeln abfragen müssen, um eine Sidebar zu füllen.

Keine bestehende Tabelle wird geändert.

## Umsetzung

### 1. Supabase-Client in Nuxt

- Manuelle Integration mit `@supabase/supabase-js` statt `@nuxtjs/supabase`, weil bereits `runtimeConfig.public.supabaseUrl` und `supabaseAnonKey` existieren und das Projekt keine weiteren Modulfeatures braucht. Wenn beim Umsetzen `@nuxtjs/supabase` weniger eigenen Code erzeugt, ist der Wechsel erlaubt, muss aber im Plan-Abschluss notiert werden.
- Plugin `apps/web/app/plugins/supabase.client.ts`: erzeugt genau einen Client, `persistSession: true`, `detectSessionInUrl: true`.
- **Abweichung, per Browsertest verifiziert**: `@supabase/supabase-js@2.55` (installierte `auth-js`-Version 2.111.0) verwendet standardmäßig `flowType: 'implicit'`, nicht PKCE. Bestätigungs- und Recovery-Links liefern die Sitzung daher als Hash-Fragment (`#access_token=...`) an die Ziel-URL, nicht als `?code=`-Query-Parameter. Ein `code` erreicht den Server nie — Fragmente werden vom Browser grundsätzlich nicht mitgeschickt. Die ursprünglich geplante Server-Route `apps/web/server/routes/auth/callback.get.ts` (Code-Tausch samt HttpOnly-Cookie) lief deshalb ins Leere und wurde ersetzt durch eine **Client-Seite** `apps/web/app/pages/auth/callback.vue`: Sie lädt regulär als Nuxt-Seite, `detectSessionInUrl` verarbeitet das Hash-Fragment automatisch, die Seite wartet auf das erste `onAuthStateChange`-Ereignis und leitet dann weiter. Diese Seite steht in der `publicPaths`-Liste der Middleware, da beim Aufruf noch keine Sitzung existiert. Ein PKCE-Server-Tausch bliebe ohnehin unvollständig, weil der `code_verifier` nur im Local Storage des Browsers liegt, der die Anfrage gestartet hat — ein Node-Server hat keinen Zugriff darauf, ohne ihn zusätzlich in ein Cookie zu spiegeln.
- **Der Anon-Key ist kein Geheimnis, der Service-Role-Key niemals im Browser.** Ein Lint- oder Testcheck stellt sicher, dass `SUPABASE_SERVICE_ROLE_KEY` in keinem Pfad unter `apps/web/app/` vorkommt.

### 2. Auth-Seiten und Middleware

- `pages/registrieren.vue`: E-Mail, Passwort, Anzeigename. Anzeigename geht als `raw_user_meta_data.display_name` mit und wird vom Trigger übernommen.
- `pages/anmelden.vue`, `pages/passwort-vergessen.vue`, `pages/passwort-neu.vue`.
- Diese Seiten nutzen ein eigenes Layout `auth.vue` ohne Sidebar. Das bestehende `default.vue` setzt eine Organisation voraus.
- `middleware/auth.global.ts`:
  - keine Sitzung und Route ist nicht öffentlich → `/anmelden` mit `redirect`-Parameter
  - Sitzung, aber keine Organisation → `/onboarding` (Seite entsteht in 009; bis dahin Platzhalter mit Hinweis)
  - Sitzung und Organisation → durchlassen
- Fehlermeldungen sind fachlich, nicht technisch, und unterscheiden nicht zwischen „E-Mail unbekannt“ und „Passwort falsch“.

### 3. Sitzung und Scope als Composables

`apps/web/app/composables/useSession.ts`:

```ts
interface SessionState {
  userId: string
  displayName: string
  avatarPath: string | null
  scopes: readonly {
    organizationId: string
    organizationName: string
    organizationRoles: readonly Role[]
    departments: readonly { id: string; name: string; roles: readonly Role[]
      teams: readonly { id: string; name: string; roles: readonly Role[] }[] }[]
  }[]
}
```

- Einmal pro Sitzung über `authz.membership_scopes()` geladen, in `useState` gehalten.
- `useScope.ts` hält die aktive Auswahl (Organisation, optional Abteilung, optional Team), persistiert sie in einem Cookie und **validiert sie bei jedem Laden gegen `useSession`**. Eine gespeicherte Abteilung, in der der Nutzer keine Mitgliedschaft mehr hat, wird verworfen, nicht angezeigt.
- `useCan(permission, scope)` kapselt `hasPermission` aus `packages/authorization`. Die Oberfläche blendet Aktionen aus, für die keine Permission vorliegt. **Das ist Komfort, keine Sicherheit** — die Durchsetzung liegt in RLS und API.

### 4. Autorisierungsgrenze in Fastify

- `apps/api/src/supabase.ts`: zwei Factories. `createUserClient(accessToken)` erzeugt einen Client, der unter der Identität des Nutzers arbeitet und damit RLS unterliegt. `createServiceClient()` nur für Operationen, die RLS bewusst umgehen müssen, mit Pflicht-Audit-Eintrag.
- `apps/api/src/auth.ts`: Fastify-Hook `preHandler`, der
  1. das Bearer-Token aus dem Header liest,
  2. es gegen Supabase verifiziert — bevorzugt lokal per JWKS/`SUPABASE_JWT_SECRET`, sonst per `auth.getUser()`,
  3. `request.auth = { userId, accessToken }` setzt,
  4. bei Fehlschlag 401 mit `correlationId` und ohne Detailgrund antwortet.
- `requirePermission(permission, scopeFrom)`: lädt die Rollen des Nutzers im Zielscope, prüft gegen `packages/authorization` und antwortet 403. Das Ergebnis wird pro Request gecacht, nicht global.
- `parseApiEnvironment` in `packages/config` erweitern: `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`. `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` werden von `optional` auf **pflichtig in `production`** gehoben. Heute darf die API produktiv ohne Datenbankzugang starten (`packages/config/src/index.ts:12-13`).
- `requireAuth` (`app.ts:66-72`) wird gelöscht, nicht erweitert. Die bestehenden Endpunkte `/v1/submissions`, `/v1/media/uploads`, `/v1/media/:assetId/complete`, `/v1/media/gate` erhalten den neuen Hook. `/health` bleibt offen und gibt weiterhin keine internen Details preis.

### 5. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `composables/useDemoData.ts` | Organisation, Abteilungen, Entwürfe hartkodiert | Datei entfällt vollständig. Entwürfe kommen in 009/010 aus der Datenbank; bis dahin leere Liste plus Empty State. |
| `layouts/default.vue:5` | `useDemoData()` | `useSession()` und `useScope()` |
| `layouts/default.vue:81` | „Lena Müller / Social Managerin“ | Anzeigename und höchste Rolle im aktiven Scope, plus Abmelden-Aktion |
| `layouts/default.vue:13` | `badge: 2` bei Freigaben | echte Anzahl offener Freigaben oder kein Badge |
| `pages/erstellen.vue:14` | nie gesetzter `useState('content-scope')` | `useScope()` |
| `pages/erstellen.vue:25-29,41,47` | `localPreview()`-Fallback erzeugt eine Vorschau ohne API | entfällt. Ohne API gibt es einen Fehlerzustand, keine erfundene Vorschau. Eine Vorschau, die nichts speichert, sieht für Nutzer wie Fortschritt aus und ist genau die Art Dummy, die zurückgebaut werden soll. |
| `pages/index.vue:4` | `department` und `drafts` aus `useDemoData()` | `department` durch `useScope()`; `drafts` durch benannten Empty State (Liste mit echten Daten kommt in 009/010) |
| `pages/index.vue:5` | `firstName = 'Lena'` | Anzeigename aus `useSession()` |
| `pages/beitraege.vue:3` | `drafts` aus `useDemoData()` | benannter Empty State; echte Liste kommt in 010 |
| `README.md:35` | „funktioniert im lokalen Demo-Modus auch ohne Datenbank und API“ | Aussage entfernen. Ab hier braucht die Oberfläche Supabase. |
| `supabase/seed.sql` | manuelle Profilanlage | bleibt als **Entwicklungs-Seed** erhalten und wird über die Trigger-Logik konsistent gehalten. Der Seed ist bewusst weiter Dummy-Daten, aber ausschließlich lokal; er ist nie Quelle für Anwendungscode. |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- `pnpm db:start && pnpm db:reset && pnpm db:test`
- neue pgTAP-Fälle in `supabase/tests/`: Trigger legt Profil an; Nutzer sieht ausschließlich eigenes Profil; `authz.has_team_permission` positiv für Teammitglied, negativ für fremdes Team, positiv für Abteilungsadmin; `authz.membership_scopes()` gibt für einen fremden Nutzer keine Zeile zurück.
- neue API-Tests: Anfrage ohne Token → 401; Anfrage mit gefälschter Signatur → 401; Anfrage mit gültigem Token ohne Permission → 403; Anfrage mit Permission → 2xx. Der Fall „gefälschte Signatur“ ist der wichtigste, weil er heute durchgeht.
- Browser-Ende-zu-Ende nachvollzogen (Playwright gegen den laufenden lokalen Stack, 2026-08-04, Reviewer-Anmerkung zur vorherigen unbelegten Behauptung damit ausgeräumt): Registrieren → Bestätigungsmail aus Mailpit abgerufen → Bestätigungslink über `/auth/callback` gefolgt → Sitzung etabliert, Landung auf `/onboarding` (korrekt, da der neue Nutzer noch keine Organisation hat) → Neuladen behält die Sitzung. Zusätzlich mit einem Seed-Nutzer mit echter Vereinsmitgliedschaft: Anmelden zeigt echten Vereinsnamen und Anzeigenamen in der Sidebar, Neuladen behält die Sitzung, Abmelden leitet auf `/anmelden` um, ein Aufruf einer geschützten Route im abgemeldeten Zustand leitet mit `?redirect=`-Parameter um, erneutes Anmelden kehrt zur ursprünglich angefragten Seite zurück.
- Dabei einen echten, vorher unentdeckten Bug gefunden und behoben: `supabase/seed.sql` legte `confirmation_token`/`recovery_token`/`email_change_token_new`/`email_change` als `NULL` an (keine Spaltenvorgabe). GoTrue schlägt beim Passwort-Login mit `converting NULL to string is unsupported` fehl, sobald diese Spalten `NULL` sind — die Seed-Nutzer (`lena@example.local`, `jonas@example.local`) konnten sich dadurch nie anmelden. Behoben durch explizite `''`-Werte beim Insert.

## Risiken und offene Entscheidungen

- **Bestandsseed**: `seed.sql` legt Nutzer direkt in `auth.users` ein. Der neue Trigger feuert dabei mit; das `on conflict do nothing` in beiden Richtungen muss stimmen, sonst bricht `db:reset`.
- **Token-Verifikation**: lokale Verifikation per Secret ist schnell, koppelt aber an das Supabase-Signaturverfahren. Wenn das Projekt auf asymmetrische JWTs wechselt, ist JWKS-Caching nötig. Deshalb liegt die Verifikation hinter einer Funktion, nicht inline im Hook.
- **E-Mail-Versand**: lokal übernimmt Inbucket. Für Staging und Produktion braucht Supabase Auth einen SMTP-Anbieter. Das ist eine Beschaffungsentscheidung und blockiert dieses Paket nicht, aber Paket 010 (Einladungen) hängt daran.
- Die Middleware-Regel „Sitzung ohne Organisation → `/onboarding`“ zeigt bis 009 auf eine Platzhalterseite. Beide Pakete sollten unmittelbar hintereinander umgesetzt werden.
- **`/v1/media/:assetId/complete` bleibt ohne `requirePermission`**: Die Route erhält nur `requireAuth`, weil weder `assetId` noch `sha256` eine `organizationId`/`departmentId` tragen und `LocalUploadService` (noch ein Stub) keine Zuordnung persistiert, die sich nachschlagen ließe. Sobald ein künftiges Paket echte Medien-Assets persistiert, muss die Zugehörigkeit dort nachgeschlagen und gegen `post.edit` geprüft werden — im Code an der Stelle vermerkt.

## Phase 3 – adversariale Prüfung (nachträglich, vor Merge)

Fünf unabhängige Prüfungen (Mandantentrennung, Rechte, Geheimnisse, Verträge, Rückbau) liefen gegen den Stand vor dem Merge. Drei reale Befunde, alle behoben:

- **Mandantentrennung**: `authz.membership_scopes()` filterte Organisation und Abteilung ausschließlich über `is_organization_member`/`is_department_member`. Ein Nutzer, der ausschließlich über `team_memberships` an einem Team hängt (keine Abteilungs- oder Vereinsmitgliedschaft), bekam `[]` zurück, obwohl `authz.has_team_permission` für ihn korrekt eine Berechtigung bestätigt — die Sidebar hätte für diesen Nutzer trotz echter Berechtigung nichts angezeigt. Behoben durch neue Hilfsfunktion `authz.has_team_membership(team_id)`, bewusst getrennt von `is_department_member`, damit reine Teammitgliedschaft keinen zusätzlichen RLS-Zugriff auf `submissions`/`posts` eröffnet. Zwei neue pgTAP-Fälle: `membership_scopes()` für Team-only-Mitglied, negativer Insert-Test für `profiles_insert_self`.
- **Verträge**: `useSession.ts` übernahm die Antwort von `authz.membership_scopes()` per Type-Cast ohne Laufzeitprüfung — eine echte Systemgrenze ohne Zod. Behoben mit `MembershipScopesSchema` in `packages/contracts` (dort bereits Zod-Abhängigkeit vorhanden, kein neuer Cross-Package-Zugriff nötig).
- **Geheimnisse**: der im Scope zugesicherte Lint-/Testcheck gegen `SUPABASE_SERVICE_ROLE_KEY` unter `apps/web/app/` existierte nicht. Ergänzt als `apps/web/app/security.test.ts`.

Rechte- und Rückbau-Prüfung ergaben keine Befunde. Nicht übernommen (Vorschläge, kein Defekt): Cross-Org-Testfall für die neuen `authz`-Funktionen, Kommentar-Parität für `/v1/media/gate` (ergänzt, da trivial).

## Phase 3b – CodeRabbit-Review auf PR #3

Zusätzlich zur eigenen adversarialen Prüfung meldete CodeRabbit 13 Befunde auf der PR. Reale Befunde, behoben:

- **Offener Redirect (CWE-601)**: `route.query.redirect.startsWith('/') && !startsWith('//')` ließ `/\evil.example` durch — Browser normalisieren `\` zu `/` bei speziellen Schemas, das Ziel landet außerhalb der eigenen Origin. Behoben mit `resolveSafeRedirect()` (`apps/web/app/utils/safeRedirect.ts`), das über `new URL(ziel, location.origin)` auflöst und nur bei gleicher Origin akzeptiert. Betraf `pages/auth/callback.vue` und `pages/anmelden.vue`.
- **SSR überschrieb den Scope-Cookie**: `useScope()` schrieb `remembered.value = active.value` unconditional — auf dem Server ist `useSession()` immer leer, also wurde der echte, zuvor gespeicherte Cookie bei jedem SSR-Durchlauf mit `null` überschrieben. Behoben: der Schreibzugriff läuft nur noch clientseitig (`if (import.meta.client)`). Per Browsertest verifiziert, dass ein Reload die Sitzung jetzt tatsächlich behält.
- **`useSession()` markierte sich vor Fehlerprüfung als geladen**: `loaded.value = true` stand vor den Supabase-Aufrufen, Fehler von `getUser()`/`membership_scopes()` wurden ignoriert und eine leere Scope-Liste dauerhaft gecacht — ein transienter Fehler hätte einen echten Nutzer dauerhaft als „ausgeloggt“ erscheinen lassen. Behoben mit einem geteilten Ladevorgang (`useSessionLoad()`), der bei Fehlschlag zurückgesetzt wird, damit der nächste Aufruf erneut versucht, statt den Fehlerzustand zwischenzuspeichern.
- **`passwort-vergessen.vue` meldete „E-Mail unterwegs“ auch bei echtem API-Fehler**: `resetPasswordForEmail()` liefert `{data, error}`, der `finally`-Block setzte `sent = true` unabhängig vom Ergebnis. Behoben: `error` wird geprüft, nur ein echter Fehlschlag zeigt jetzt eine Fehlermeldung; die Uneindeutigkeit „E-Mail existiert oder nicht“ bleibt bewusst erhalten.
- **`jsonb_agg` ohne `order by`**: die Oberfläche wählt `scopes[0]` als Standard-Scope; ohne stabile Sortierung kann die Reihenfolge zwischen Aufrufen wechseln. Alle sechs Aggregationen in `membership_scopes()` sortieren jetzt stabil (Name bzw. Rolle).
- **`handle_new_user()` konnte NULL in eine `not null`-Spalte schreiben**: bei fehlender E-Mail (z. B. Telefon-/OAuth-Signup ohne E-Mail-Scope) war der `display_name`-Fallback leer. Zusätzlicher letzter Fallback `'Mitglied'` ergänzt.
- **Tote Bedienelemente**: Vereinsauswahl-Button in `layouts/default.vue` (Chevron ohne Funktion, kein Mehrfach-Verein-Feature in diesem Paket) zu statischer Anzeige reduziert; Such-/Filterzeile in `beitraege.vue` entfernt, solange die Liste ausschließlich den Empty State zeigt (keine Funktion, die sie beeinflussen könnte).
- **Dokumentationsungenauigkeit**: „lehnt jede Anfrage ohne passende Permission ab“ war zu pauschal (`/health` offen, zwei Endpunkte nur `requireAuth`) — Ergebnis-Absatz und `README.md:35` präzisiert.
- **Unbelegte „erledigt“-Behauptung**: siehe Verifikation oben — durch echten, reproduzierten Playwright-Lauf ersetzt, der dabei zusätzlich den Seed-Login-Bug aufdeckte.

Bewusst nicht übernommen: Vollständiger Rückbau der verbleibenden Demo-Zahlen in `pages/index.vue` (`stats`, `week`, feste Kalenderwoche) — laut Rückbau-Inventar in `plans/README.md` ausdrücklich den Paketen 009/016/019 zugewiesen, nicht 008. Deaktivierung von `/v1/media/:assetId/complete` — der Stub persistiert nichts und hat aktuell keinen Effekt jenseits einer festen 202-Antwort; die Route ist im Code bereits als temporär und unvollständig dokumentiert, echte Berechtigungsprüfung kommt mit echter Medien-Persistenz. Idempotenz von `create trigger`/`create policy` in der Migration — Nitpick, diese Migration läuft nur per `db reset` (Neuaufbau), nicht als wiederholtes Apply auf bestehende Datenbanken.
