# Implementation Plan: Berechtigungsbasierte Navigation

**Branch**: `fix/hide-unauthorized-navigation` | **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-berechtigungsbasierte-navigation/spec.md`

## Summary

Die Berechtigungsmetadaten aller Sidebar-Links werden an die Seitenberechtigungen angepasst. Die Shell blendet Links aus, wenn die Person die erforderliche Seitenberechtigung nicht besitzt, und lässt leere Modulgruppen entfallen. Insbesondere erfordert die vereinsweite Mitgliederseite `organization.manage`. Serverseitige Autorisierung bleibt unverändert.

## Technical Context

**Language/Version**: TypeScript strict (bestehendes Webprojekt)

**Primary Dependencies**: Nuxt/Vue, Vitest, bestehende Authorization- und Navigation-Module

**Storage**: N/A

**Testing**: Ein gezielter Vitest-Aufruf für `apps/web/app/modules/frameworkNavigation.test.ts` und `apps/web/app/modules/registry.test.ts`

**Target Platform**: Web

**Project Type**: Nuxt-Webanwendung im Monorepo

**Performance Goals**: Keine zusätzliche Laufzeit- oder Netzwerklast

**Constraints**: Berechtigungsfilter sind Komfort; API und RLS bleiben die Sicherheitsgrenze. Keine neue Berechtigung, kein Datenmodell und keine Migration.

**Scale/Scope**: Berechtigungsmetadaten aller geschützten Rahmen-, Social-Media- und PlayerBoard-Navigationslinks sowie Rollenregressionen. Allgemein verfügbare Links wie Übersicht und Kalender bleiben als solche bestehen.

## Constitution Check

- **Sicherheit und Mandanten**: Keine Zugriffskontrolle wird entfernt oder in die UI verlagert; Navigation blendet lediglich einen nicht verfügbaren Vereinsbereich aus.
- **Architektur**: Änderung bleibt in `apps/web`; vorhandene Permission- und Navigationsabstraktionen werden erweitert.
- **Graphify first**: `visibleFrameworkNavigation`, den vorhandenen Modulfilter und die bestehenden Navigationstests wurden konsultiert; bestehende Metadaten und Filter werden erweitert.
- **Worktree/Branch**: Änderung erfolgt in einem registrierten Worktree auf einem Topic-Branch.
- **Tests**: Regressionen liegen getrennt vom Produktionscode in der bestehenden Testdatei.
- **Speckit**: Spec, Plan, Tasks und Implementierung folgen dem aktiven Workflow; die Spezifikation wurde als Nutzeranforderung bestätigt.

**Gate result**: PASS. Es gibt keine Migration, keinen neuen Systemrand und keine Änderung an API/RLS.

## Project Structure

### Documentation (this feature)

```text
specs/004-berechtigungsbasierte-navigation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
apps/web/app/modules/frameworkNavigation.ts
apps/web/app/modules/frameworkNavigation.test.ts
apps/web/app/modules/registry.ts
apps/web/app/modules/registry.test.ts
apps/web/app/composables/useShellNavigation.ts
```

**Structure Decision**: Die bestehende Navigation und deren isolierte Unit-Tests sind der zuständige Ort; es werden keine neuen Produktionsmodule eingeführt.

## Complexity Tracking

Keine Abweichungen von der Projektverfassung.
