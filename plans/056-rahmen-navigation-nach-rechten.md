# 056 – Rahmen-Navigation nach Rechten

## Ergebnis

„Verein verwalten“ in der Seitenleiste zeigt nur noch Einträge, auf denen die Person etwas sehen oder tun kann (Betreiberentscheidung 2026-10-08: „es macht keinen Sinn, Punkte anzuzeigen, wenn derjenige nichts dazu sehen kann“). Ohne einen solchen Eintrag entfällt die Überschrift ganz.
- **Spielerin:** sieht keine Verwaltung.
- **Trainer:** Marke, Mitglieder und Verzeichnis seiner Mannschaft.
- **Abteilungsleitung:** zusätzlich Struktur, Einwilligungen, Integrationen, Module und Einstellungen.
- **Vereinsinhaberin:** wie bisher alles.

Ausgewertet wie die Module in 055: auf den Ebenen im Arbeitsbereich, auf denen die Person eine Rolle hat. Die Seiten selbst, API und RLS bleiben unverändert. Ein Direktaufruf zeigt weiterhin den jeweiligen Hinweis der Seite.

## Ausgangslage und Evidenz

Geplant auf `82f35da` (Branch von 055, PR #213) am 2026-10-08.

- Die Einträge standen fest in `apps/web/app/layouts/default.vue` (`organizationNav`), nur mit `organizationOnly` gefiltert.
- Die Seiten prüfen ihre Rechte selbst:

| Seite | Prüfung |
|---|---|
| `verzeichnis.vue` | `directory.read` |
| `einwilligungen.vue` | `consent.manage` |
| `integrationen.vue` | `integration.manage` |
| `einstellungen/tarif.vue` | `billing.manage` oder `organization.manage` |
| `einstellungen/recht.vue`, `datenschutz/anfragen.vue` | `organization.manage` |
| `struktur.vue` | `organization.manage`, `department.manage` oder `team.manage` |
| `mitglieder.vue` | `member.invite` oder Verwaltungsrecht der Ebene |
| `einstellungen/module.vue` | Verwaltungsrecht der Ebene (`canEdit`, `POLICY_MANAGE_PERMISSION` in der API) |
| Marke | Bearbeiten mit `brand.manage` |

- **„Einstellungen“ (`einstellungen/index.vue`)** sind die Richtlinien für Beiträge: verbotene Themen, Pflicht-Hashtags, Freigaben. Nach Plan 051 gehören sie fachlich zu Social Media.

## Umsetzung

- `apps/web/app/modules/frameworkNavigation.ts`:
  - Einträge mit `permissions` (eines genügt), optional `module` und `organizationOnly`;
  - `visibleFrameworkNavigation()` als reine Funktion.
- `layouts/default.vue` filtert mit `canUse()` und `isEnabled()` aus `useScopeModules()` (055); die Überschrift erscheint nur mit Einträgen.

| Eintrag | sichtbar mit |
|---|---|
| Marke | `brand.manage` |
| Struktur, Module | `organization.manage`, `department.manage` oder `team.manage` |
| Mitglieder | `member.invite`, `member.remove` oder ein Verwaltungsrecht der Ebene |
| Verzeichnis | `directory.read` |
| Einwilligungen | `consent.manage` |
| Integrationen | `integration.manage` |
| Einstellungen | Verwaltungsrecht der Ebene **und** Social Media sichtbar |
| Tarif | `billing.manage` oder `organization.manage`, nur Arbeitsbereich „Verein“ |
| Recht & Datenschutz, Betroffenenanfragen | `organization.manage`, nur Arbeitsbereich „Verein“ |

„Übersicht“ und „Kalender“ bleiben für alle; der Spielplan ist auch für Spieler nützlich.

## Umsetzung: Ergebnis und Abweichungen

Umgesetzt am 2026-10-08, wie oben.

Verifiziert:
- Sechs Vitest-Fälle mit echten Rollen über `anchorScopes()`/`canUsePermission()`: Spielerin, Trainer, Abteilungsleitung, Vereinsinhaberin (auch im Arbeitsbereich einer Abteilung), Social Media nicht sichtbar, Tarifverwaltung.
- `pnpm lint`, `typecheck`, `test`, `build` grün.
- Im Browser gegen den lokalen Stack:
  - **Vereinsinhaberin:** alle elf Einträge.
  - **Spielerin:** keine Überschrift „Verein verwalten“.
  - **Trainer nur der U13:** Marke, Mitglieder, Verzeichnis.

Abweichung: „Einstellungen“ hängt zusätzlich an der Sichtbarkeit von Social Media, weil die Seite nur Beitragsrichtlinien enthält.
