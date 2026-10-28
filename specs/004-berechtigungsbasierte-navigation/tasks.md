# Tasks: Berechtigungsbasierte Navigation

**Input**: Design documents from `specs/004-berechtigungsbasierte-navigation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md

## Phase 1: User Story 1 - Nicht verfügbare Verwaltungsbereiche ausblenden (P1)

**Goal**: Geschützte Navigationslinks erscheinen nur mit passender Seitenberechtigung; nicht erlaubte Links und leere Gruppen verschwinden.

**Independent Test**: Framework- und Modulnavigation mit Spieler-, Teamleitungs-, Abteilungsleitungs-, approver- und Vereinsadmin-Rollen prüfen.

- [x] T001 [US1] Setze die Anforderungen für alle Social-Media- und PlayerBoard-Links in `apps/web/app/modules/registry.ts` anhand der jeweiligen Seitenberechtigung und deren Scope, einschließlich Kanäle, Freigaben, Auswertung und PlayerBoard-Verwaltungsseiten.
- [x] T002 [US1] Begrenze den vereinsweiten Mitgliederlink auf `organization.manage` in `apps/web/app/modules/frameworkNavigation.ts` und behalte die bisherigen Berechtigungen der übrigen Rahmenlinks bei.
- [x] T003 [US1] Ergänze Regressionen für Rollen-, Link- und Scope-Berechtigungen sowie die vollständige Permission-Metadatenabdeckung in `apps/web/app/modules/registry.test.ts` und `apps/web/app/modules/frameworkNavigation.test.ts`.
- [x] T004 [US1] Versuche die beiden gezielten Navigationstests auszuführen und prüfe `git diff --check` sowie den finalen Diff; dokumentiere fehlendes lokales Testwerkzeug.

## Dependencies & Execution Order

- T001 und T002 legen die Permission-Metadaten in getrennten Produktionsdateien fest; T003 prüft beide Registries und ist von ihnen abhängig.
- T004 folgt auf die Änderungen und Regressionen.

## MVP

US1 ist der vollständige Umfang dieser Änderung.

## Ausführungsnotiz

Beide gezielten Vitest-Aufrufe wurden versucht, konnten aber nicht starten, weil `pnpm` in dieser Umgebung fehlt; `node` und `corepack` sind ebenfalls nicht verfügbar. `git diff --check` ist erfolgreich.
