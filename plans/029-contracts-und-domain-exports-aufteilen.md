# Plan 029: Contracts und Domain-Exports fachlich aufteilen

> **Executor instructions**: Behalte den öffentlichen Paket-Import `@vereinsfunk/contracts` und `@vereinsfunk/domain` kompatibel. Keine Schema- oder Laufzeitsemantik allein zur besseren Ordnerstruktur ändern.
>
> **Drift check (run first)**: `git diff --stat 1883758f..HEAD -- packages/contracts packages/domain`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/027-api-route-module-boundaries.md`
- **Category**: tech-debt, tests
- **Planned at**: commit `1883758f`, 2026-08-09

## Why this matters

`packages/contracts/src/index.ts` hat 1.746 LoC und enthält nahezu alle Zod-Schemas, Typ-Ableitungen und bereichsübergreifenden Query-Validatoren. `packages/domain/src/index.ts` bündelt zusätzlich Richtlinien, Freigaben, Medienregeln, Branding und Exporte. Kleine Änderungen erzeugen dadurch große Diffs und unnötige Import-/Merge-Konflikte.

## Current state

- `packages/contracts/src/index.ts:1-90` enthält Inhalts-/Workflow-Schemas; ab Zeile 1450 Analytics; dazwischen liegen Organisation, Richtlinien, Kanäle, Integrationen, Verzeichnis und Compliance.
- `packages/contracts/src/contracts.test.ts` testet den Sammel-Export.
- `packages/domain/src/index.ts` enthält `mergeEffectiveConfig`, Freigaberoute, Kanäle und Re-Exports aus `metrics`, `brand`, `consent` und `fonts`.
- Alle Apps importieren aus den Paket-Wurzel-Exports; dies ist die kompatible öffentliche Grenze.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Contracts | `pnpm --filter @vereinsfunk/contracts test` | exit 0 |
| Domain | `pnpm --filter @vereinsfunk/domain test` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Full gate | `pnpm check` | exit 0 |

## Scope

**In scope**

- Dateien unter `packages/contracts/src/` und `packages/domain/src/`
- zugehörige Tests

**Out of scope**

- keine Änderungen an Paketnamen, `exports` in `package.json` oder externen Importpfaden
- keine Umbenennung öffentlicher Schemas/Typen
- keine fachliche Änderung von Zod-Validierung

## Steps

### Step 1: Contracts nach Domäne gliedern

Lege Module wie `content.ts`, `organization.ts`, `policy.ts`, `channels.ts`, `integrations.ts`, `directory.ts`, `consent.ts`, `compliance.ts` und `analytics.ts` an. Jeder Typ steht neben dem Schema, von dem er abgeleitet wird. `index.ts` wird ein sortierter, expliziter Barrel-Export; zyklische Importe sind verboten.

**Verify**: `pnpm --filter @vereinsfunk/contracts test` und `pnpm --filter @vereinsfunk/contracts typecheck` → exit 0.

### Step 2: Domain-Verantwortungen sichtbar trennen

Verschiebe Konfigurationsmerge und Freigaberoute in eigene Dateien; belasse bestehende `metrics.ts`, `brand.ts`, `consent.ts` und `fonts.ts` als Muster. Das Barrel exportiert unverändert alle heutigen Symbole. Jede Domain-Datei darf nur Domain-Abhängigkeiten importieren, keine App-, Fastify- oder Supabase-Module.

**Verify**: `pnpm --filter @vereinsfunk/domain test` → exit 0.

### Step 3: Tests fachnah ordnen und Export-Kompatibilität absichern

Teile die großen Testdateien analog auf. Ergänze einen kleinen Kompatibilitätstest, der repräsentative öffentliche Exporte weiter aus `@vereinsfunk/contracts` und `@vereinsfunk/domain` importiert. Behalte Edge-Case-Tests beim verschobenen Schema, statt sie zu reduzieren.

**Verify**: `pnpm typecheck && pnpm test` → exit 0.

## Done criteria

- [ ] Kein Contracts-/Domain-Sourcefile ist größer als 500 LoC.
- [ ] Root-Imports aller Anwendungen bleiben gültig.
- [ ] Keine Framework- oder Datenbankabhängigkeit landet im Domain-Paket.
- [ ] `pnpm check` besteht.

## STOP conditions

- Ein Importzyklus entsteht.
- Ein Schema muss geändert werden, um es zu verschieben.
- Ein Consumer benötigt einen neuen Deep-Import.

## Maintenance notes

Neue Verträge gehören nach Fachbereich, der Barrel bleibt nur Kompatibilitätsgrenze. Reviewer sollen Export-Duplikate und Zod-Defaults besonders prüfen.
