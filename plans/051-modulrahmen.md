# 051 – Modulrahmen: Vereinsfunk als Rahmenanwendung mit buchbaren Modulen

## Ergebnis

Vereinsfunk ist nicht mehr nur die Social-Media-Werkstatt, sondern der **Rahmen** für den digitalen Vereinsbetrieb: Verein, Abteilungen, Mannschaften, Mitglieder, Verzeichnis, Einwilligungen, Marke, Spielplan, Integrationen, Recht und Tarif gehören dem Rahmen. Fachliche Anwendungen hängen sich als **Module** darunter. Zum Start gibt es zwei:

| Modul | Schlüssel | Inhalt |
|---|---|---|
| Social-Media-Beiträge | `social_media` | alles, was es heute gibt: Textwerkstatt, Beiträge, Freigaben, Kanäle, Bildstil, Auswertung, Assistent |
| PlayerBoard | `playerboard` | Trainings, Punktekategorien, Rangliste, Trainingsfotos, Veo-Anbindung (Pakete 052/053) |

Ein Verein bucht über seinen Tarif, welche Module er nutzen **darf**, schaltet selbst ein, welche er nutzen **will**, und jede Abteilung bzw. Mannschaft kann ein Modul für sich abwählen — aber nie eines hinzunehmen, das darüber nicht aktiv ist. Navigation, Routen und API zeigen nur aktive Module.

Dieses Paket baut **nur den Rahmen** und ordnet den Bestand dem Modul `social_media` zu. Es verändert kein fachliches Verhalten des Social-Media-Moduls.

## Ausgangslage und Evidenz

Geplant auf `e3fb52d` am 2026-10-05.

- Es gibt **kein Modulkonzept**. Weder Migrationen noch `packages/*` kennen „module“, „feature“ oder „entitlement“ (Suche über `supabase/migrations/*.sql`).
- Die Navigation ist statisch in `apps/web/app/layouts/default.vue:142-165` als zwei Arrays (`navigation`, `organizationNav`) hinterlegt; Fach- und Verwaltungsseiten liegen flach unter `apps/web/app/pages/`.
- `subscription_plans` (Paket 021) begrenzt Speicher, Teams, Abteilungen und Beitragskontingente, aber keine Funktionsbereiche.
- Rechte sind eine flache Liste in `packages/authorization/src/index.ts` (`permissions`, `rolePermissions`), gespiegelt in SQL (`authz.has_department_permission`/`has_team_permission`, `2026080601_structure_and_invitations.sql:115-160`). Die API prüft sie zentral über `requirePermission(request, reply, permission, scope)`.
- `policy_settings` (Paket 023/011) samt `mergeAllowedList` in `packages/domain/src/effectiveConfig.ts` bildet „null = erben, Liste = Schnittmenge“ bereits ab — genau die Semantik, die eine Modulauswahl je Ebene braucht.

## Fachliches Modell

### Was gehört zum Rahmen, was zu einem Modul

Die Trennlinie: **Was mehr als ein Modul braucht, gehört dem Rahmen.**

| Rahmen (immer aktiv) | `social_media` |
|---|---|
| Übersicht, Profil, Anmeldung, Einladungen | Assistent, Beiträge, Freigaben, Erstellen/Textwerkstatt |
| Struktur, Mitglieder, Verzeichnis | Auswertung (Beitragskennzahlen) |
| Einwilligungen (PlayerBoard braucht sie für Trainingsfotos) | Kanäle, Kanal-Kontingente |
| Marke (öffentliche PlayerBoard-Seiten nutzen sie) | Bildstil, Bildkomposition, Stilprofile, Textbausteine |
| Kalender/Spielplan, Veranstaltungen (PlayerBoard verknüpft Veo-Spiele mit `fixtures`) | Freigaberouten, Vertrauen je Mitglied (Richtlinienfelder aus 011) |
| Integrationen, Recht & Datenschutz, Betroffenenanfragen, Tarif, Plattform-Administration | |

Kalender und Einwilligungen bleiben bewusst im Rahmen: Würden sie dem Social-Media-Modul gehören, müsste ein reiner PlayerBoard-Verein Social Media buchen, um einen Spielplan zu pflegen.

### Aktivierung: drei Schichten, nur verengend

```text
effektive Module(Ebene) = Tarif.included_modules
                        ∩ Verein.enabled_modules       (null = alles aus dem Tarif)
                        ∩ Abteilung.enabled_modules    (null = erben)
                        ∩ Mannschaft.enabled_modules   (null = erben)
```

Das ist exakt `mergeAllowedList` aus Paket 011 — keine neue Vererbungslogik. Eine untere Ebene kann ein Modul abwählen („die Abteilung Tischtennis braucht kein PlayerBoard“), aber keines aktivieren, das oben fehlt. `[]` heißt „kein Modul“, `null` heißt „erben“.

### Abschalten ist eine Sichtbarkeits-, keine Löschentscheidung

Ein abgeschaltetes Modul blendet Daten aus und sperrt Schreibpfade; es löscht nichts. Wieder eingeschaltet, ist alles da. Aufbewahrungsfristen (Paket 020) laufen unabhängig vom Modulstatus weiter — sonst würde ein Verein Löschpflichten durch Abschalten aussetzen.

Laufende, bereits eingeplante Veröffentlichungen eines abgeschalteten `social_media`-Moduls: siehe „Offene Entscheidungen“.

### Rechte gehören einem Modul

Jede Permission bekommt genau ein Modul oder `core`:

```ts
export const permissionModule: Readonly<Record<Permission, AppModule | 'core'>> = {
  'organization.manage': 'core', 'department.manage': 'core', 'team.manage': 'core',
  'member.invite': 'core', 'member.remove': 'core', 'brand.manage': 'core',
  'billing.manage': 'core', 'directory.read': 'core', 'integration.manage': 'core',
  'fixture.manage': 'core', 'event.manage': 'core', 'consent.manage': 'core',
  'post.create': 'social_media', 'post.edit': 'social_media', 'post.submit': 'social_media',
  'post.approve': 'social_media', 'post.publish': 'social_media',
  'social_account.manage': 'social_media', 'analytics.view': 'social_media',
}
```

`requirePermission` prüft danach zusätzlich, ob das Modul der Permission im Ziel-Scope aktiv ist. Weil alle bestehenden Routen bereits über `requirePermission` laufen, deckt **eine** Änderung den gesamten Bestand ab. Rollen bleiben modulübergreifend (ein `team_manager` ist Mannschaftsverantwortlicher, egal welches Modul); welche Rechte eine Rolle in welchem Modul hat, steht in `rolePermissions` wie bisher.

## Datenmodell

Migration `<datum>_app_modules.sql`:

```sql
create type public.app_module as enum ('social_media', 'playerboard');

alter table public.subscription_plans
  add column included_modules public.app_module[] not null default '{social_media}';

alter table public.policy_settings
  add column enabled_modules public.app_module[];      -- null = erben

-- Bestand: jeder heutige Tarif enthält beide Module, damit kein Verein durch die
-- Migration etwas verliert und PlayerBoard sofort testbar ist.
update public.subscription_plans set included_modules = '{social_media,playerboard}';
```

Auflösung in SQL, für RLS der Modultabellen (PlayerBoard ab Paket 052) und für die API:

```sql
create or replace function authz.module_enabled(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid,
  module public.app_module
) returns boolean
language sql stable security definer set search_path = public, pg_temp
-- Tarif des Vereins enthält das Modul UND keine Ebene im Pfad hat eine Liste ohne
-- das Modul (null-Zeilen und fehlende Zeilen sind neutral).
```

Kein eigener Katalog-Table: Die Modulmenge ist Code (Routen, Seiten, Worker), nicht Daten. Ein neues Modul ist immer ein Deploy, also gehört es in den Enum und in `packages/domain`.

## Umsetzung

### PR 1 – Datenmodell, Domain, Verträge

- Migration wie oben, inklusive `authz.module_enabled` mit `revoke … from public` und Grant an `authenticated, service_role`.
- `packages/domain/src/modules.ts`: `appModules`, `AppModule`, `resolveEnabledModules({ plan, organization, department, team })` auf Basis von `mergeAllowedList`.
- `packages/authorization`: `permissionModule` wie oben. Ein Typtest stellt sicher, dass jede Permission einem Modul zugeordnet ist (`Record<Permission, …>` erzwingt das bereits zur Kompilierzeit).
- `packages/contracts`: `AppModuleSchema`; `enabled_modules` in den Policy-Settings-Verträgen; `includedModules` im Tarif-Vertrag.
- pgTAP: Tarif ohne Modul → überall aus; Verein `null` → Tarif gilt; Abteilung `'{}'` → aus, Mannschaft darunter mit `'{playerboard}'` bleibt aus (keine Erweiterung); Mannschaft ohne Zeile erbt.

### PR 2 – Durchsetzung in der API

- `requirePermission` ermittelt das Modul der Permission und prüft `module_enabled` für den Scope; Antwort `403 module_disabled` mit Modulschlüssel, unterscheidbar von `403 forbidden`.
- `GET /v1/scopes/modules?organizationId=…&departmentId=…&teamId=…` liefert die effektiven Module samt Herkunft je Modul (`plan`, `organization`, `department`, `team`) für die Oberfläche.
- `PUT` der Policy-Settings akzeptiert `enabledModules`; Validierung: auf jeder Ebene nur Module, die oberhalb aktiv sind (sonst 422, analog zu `allowedChannelIds`).
- Plattform-Admin: Tarif-Editor (Paket 021) um `includedModules` erweitern.
- Worker: Jobs eines abgeschalteten Moduls prüfen den Status beim Start erneut (dieselbe Begründung wie die Kontingentprüfung beim Veröffentlichen in Paket 011: zwischen Einplanung und Ausführung liegt Zeit).

### PR 3 – Oberfläche als Rahmen

- `apps/web/app/modules/registry.ts`: je Modul `key`, `label`, `icon`, Navigationseinträge, Routenpräfixe bzw. Routenliste.
- `default.vue` baut die Navigation aus Rahmen-Einträgen plus den Einträgen aktiver Module, gruppiert nach Modul. Die bestehenden URLs des Social-Media-Moduls bleiben unverändert (`/beitraege`, `/freigaben`, …) — keine Umbenennung, keine toten Lesezeichen. Neue Module bekommen ein eigenes Präfix (`/playerboard/...`).
- `middleware/module.global.ts`: eine Route eines inaktiven Moduls führt auf eine erklärende Seite („In dieser Abteilung ist PlayerBoard nicht aktiviert — zuständig: …“), nicht auf einen leeren Bildschirm.
- Einstellungsseite „Module“ je Ebene mit den drei bekannten Zuständen aus `PolicyFlagToggles.vue`: **geerbt**, **abgewählt**, **gesperrt** (oben nicht aktiv oder nicht im Tarif, mit Begründung).
- Übersicht (`index.vue`): bestehende Social-Media-Kacheln nur bei aktivem Modul. Eine modulübergreifende Kachel-API ist **nicht** Teil dieses Pakets; PlayerBoard bringt in 052 eine eigene Kachel mit, die direkt eingehängt wird.

## Verifikation

- pgTAP für `authz.module_enabled` (Matrix oben) und für die Schreibvalidierung der Policy-Settings.
- API-Tests: jede bestehende `requirePermission`-Route, deren Permission dem Modul `social_media` zugeordnet ist, liefert bei abgeschaltetem `social_media` `403 module_disabled`; Core-Routen des Rahmens (Struktur, Mitglieder, Kalender, Einwilligungen) funktionieren weiter.
- Ein Durchlauf aller bestehenden API-Tests mit `social_media` aktiv ist grün und unverändert — der Rahmen darf das heutige Verhalten nicht ändern.
- Playwright: Navigation zeigt bei abgeschaltetem Modul keine Social-Media-Einträge; Direktaufruf von `/beitraege` landet auf der Erklärseite.

## Risiken und offene Entscheidungen

- **Eingeplante Veröffentlichungen beim Abschalten (Betreiberentscheidung 2026-10-06):** Das Abschalten von `social_media` wird verweigert, solange im betroffenen Scope oder darunter Publikationen den Status `scheduled` oder `running` haben. Die API antwortet mit `409 module_has_active_publications` und listet die betroffenen Publikations- und Beitrags-IDs; erst nach Abbruch oder Abschluss kann abgeschaltet werden. Deaktivierung und Workerstart verwenden je Organisations-Scope denselben transaktionalen Advisory-Lock: Der Worker prüft unter diesem Lock den Modulstatus und setzt die Publikation erst danach auf `running`; ist das Modul bereits aus, wird sie mit `cancelled` und dem Grund `module_disabled` beendet und nicht erneut versucht. Die Deaktivierung kann daher nicht zwischen Prüfung und Start eines Jobs committen, und nach ihrem Commit veröffentlicht kein neuer Workerjob mehr.
- **Keine RLS-Nachrüstung für Social-Media-Tabellen.** Der Modulschalter ist eine Produkt- und Tarifgrenze, keine Vertraulichkeitsgrenze: Die Daten bleiben durch die bestehenden Rollen-Policies geschützt. Rund 40 bestehende Policies nachzurüsten wäre großes Risiko für wenig Schutzgewinn. Neue Module (ab 052) bekommen `authz.module_enabled` von Anfang an in ihre Policies, weil es dort nichts kostet.
- **`analytics.view` ist heute Social-Media-spezifisch**, der Name klingt aber modulübergreifend. PlayerBoard bekommt eigene Rechte (052) statt `analytics.view` mitzubenutzen; eine Umbenennung in `post.analytics.view` ist nicht Teil dieses Pakets.
- **Rollen und Rang** (`authz.role_rank`) bleiben modulübergreifend. Ein künftiges Modul mit eigener Rollenhierarchie würde dieses Modell sprengen — bewusst nicht vorweggenommen.

## Umsetzung PR 1: Ergebnis und Abweichungen vom Plan

Umgesetzt am 2026-10-06 in Migration `2026100602_app_modules.sql` plus `packages/domain/src/modules.ts`, `permissionModule` in `packages/authorization` und `packages/contracts/src/modules.ts`. Verifiziert: `pnpm lint`, `typecheck`, `build` grün; `pnpm test` grün bis auf `apps/worker/src/websiteRenderer.logoScoring.test.ts`, das lokal mangels Playwright-Chromium nicht startet (unabhängig von diesem Paket); `pnpm db:test` nach frischem `supabase db reset` grün (46 Dateien, 1163 Assertions, davon 16 in `app_modules.test.sql`).

Abweichungen:

- **Modulauswahl als eigener Vertrag statt in den Policy-Settings-Verträgen.** `ModuleSelectionSchema`, `ScopeModulesSchema` und `UpdateScopeModulesRequestSchema` stehen in `contracts/src/modules.ts`, nicht in `PolicyRuleValues`. Die Freigaberegeln gehören fachlich zum Modul `social_media`; läge die Modulauswahl darin, hinge das Wiedereinschalten eines Moduls an einem Endpunkt, den das abgeschaltete Modul selbst sperrt. Gespeichert wird weiterhin in `policy_settings.enabled_modules`.
- **`includedModules` in der Tarif-API schon in PR 1.** Lesen und Schreiben in `routes/platformAdmin.ts` und `routes/subscriptions.ts` sind bereits enthalten, weil das Tarif-DTO das Feld mit dem Vertrag ohnehin führen muss. Der Tarif-Editor in der Oberfläche bleibt in PR 2.
- **`mergeAllowedList` ist jetzt exportiert und generisch** (`<T extends string>`), damit `resolveEnabledModules` dieselbe Schnittmengenregel nutzt wie `allowedChannelIds`. `resolveEnabledModules` liefert zusätzlich `blockedBy` (äußerste sperrende Stelle je Modul) für die Zustände „abgewählt“ und „gesperrt“ in PR 3.
- **Konsistenztest statt Typtest allein.** `apps/api/src/modules.test.ts` prüft, dass SQL-Enum-Spiegel `AppModuleSchema`, `appModules` und die Modulwerte von `permissionModule` übereinstimmen.
