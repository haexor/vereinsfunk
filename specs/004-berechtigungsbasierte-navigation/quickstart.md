# Quickstart: Berechtigungsbasierte Navigation

## Voraussetzungen

- Abhängigkeiten des Monorepos sind installiert.
- Im Worktree `fix/hide-unauthorized-navigation` arbeiten.

## Regressionen prüfen

```sh
pnpm --filter @vereinsfunk/web exec vitest run app/modules/frameworkNavigation.test.ts app/modules/registry.test.ts
```

## Erwartetes Verhalten

- Team- und Abteilungsleitung ohne Vereinsrolle sehen keinen Link „Mitglieder“.
- Vereinsadministratoren sehen den Link „Mitglieder“.
- Personen ohne Social-Media-Berechtigung sehen keine Social-Media-Links.
- Personen mit einzelnen Social-Media-Rechten sehen nur passende Seiten, zum Beispiel keine Freigaben ohne `post.approve` und keine Kanäle ohne `social_account.manage`.
- Rechte nur in einer Abteilung zeigen keine Seitenlinks, die im aktiven Vereinsscope dieselbe Berechtigung benötigen; beim Wechsel in die berechtigte Abteilung erscheinen sie.
- PlayerBoard-Seitenberechtigungen werden je Link ausgewertet; Verwaltungsseiten erfordern `playerboard.manage`.
- Leere Gruppen und Überschriften erscheinen nicht.
