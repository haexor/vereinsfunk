# Prompt für die nächste Session

## Aktueller Refactoring-Stand (2026-08-09)

- Arbeite auf `refactor/continue-web-api-mappers`. Die Folge-PR ist [#34](https://github.com/haexor/vereinsfunk/pull/34) gegen `refactor/dry-web-api-mappers` (PR #33). Neue Änderungen auf diesem Branch committen und pushen.
- Paket 030 ist erledigt: bei verbotener Selbstfreigabe enthält der Reviewer-Snapshot den Autor nicht mehr; die Minderjährigenstufe ist getestet.
- Paket 028 ist in Arbeit. `apps/web/app/composables/useApiClient.ts` delegiert an `apps/web/app/utils/apiClient.ts`: API-Basis-URL, aktueller Bearer-Header ohne Session-Cache, optionale Zod-Validierung und typisierte Fehlercodes sind zentral. Öffentliche Anfragen setzen `authenticate: false`.
- Migriert: `kanaele.vue`, `einstellungen/recht.vue`, die Ladepfade von `mitglieder.vue` sowie alle API-Mutationen von `marke.vue`, `mitglieder.vue` und `integrationen.vue`. In diesen drei Seiten darf kein `$fetch`, `config.public.apiBase` oder `useAuthHeader()` zurückkehren; `pages/apiClientMigration.test.ts` sichert das ab.
- Tests: `apps/web/package.json` verwendet jetzt `vitest run` ohne `--passWithNoTests`. Die drei Testdateien (`security`, `apiClient`, `apiClientMigration`) führen acht Tests aus. `apiClient.test.ts` deckt Auth, öffentliche Aufrufe, Zod-Schemafehler und 401-Fehlercodes ab.
- Ausgelagerte Komponenten: `LegalAuditChain.vue`, `ProcessorAgreements.vue`, `BrandLivePreview.vue`, `IntegrationSourceHeader.vue`, `IntegrationSourceCreateForm.vue`, `IntegrationSourceEditForm.vue`, `IntegrationRunHistory.vue`, `IntegrationConflictList.vue`.
- `integrationen.vue` ist nach der Zerlegung bei 440 LoC. State und API-Logik liegen dort noch in der Seite; ein `useIntegrationSources`-Composable wurde bewusst noch nicht eingeführt. Die Formularkomponenten erhalten State als Props und senden Events, ohne selbst API-Aufrufe auszuführen.
- `marke.vue` (732 LoC), `mitglieder.vue` (588 LoC), `kanaele.vue` (561 LoC) und `einstellungen/recht.vue` (597 LoC) überschreiten weiterhin das 500-LoC-Kriterium. Bei Marke werden temporäre Logo-Object-URLs beim Ersetzen und beim Unmount widerrufen.
- `apps/api/src/apiMappers.ts` enthält die aus `app.ts` gezogenen Mapper und Brand-/Einladungshelfer. `app.ts` bleibt der große nächste Refactoring-Block für Paket 027.

## Nächste Schritte

1. Lies vollständig: `AGENTS.md`, `docs/product/implementation-plan.md`, `plans/README.md`, `plans/NEXT-SESSION.md`, `plans/028-web-api-client-und-grosse-seiten-zerlegen.md` sowie die für Mitglieder/Integrationen relevanten ADRs 008 und 009.
2. Prüfe `git status --short --branch`, PR #34 und den Drift (`git diff --stat 1883758f..HEAD -- apps/web`). Bestehende Änderungen bewahren.
3. Paket 028 fortsetzen: zuerst State und sichtbare Bereiche aus `marke.vue` und `mitglieder.vue` in fachliche Composables/Komponenten ziehen. Danach entscheiden, ob `useIntegrationSources` noch verhältnismäßig ist; keine abstrakte Hülle nur für einen Aufrufer bauen.
4. Die verbleibenden vier großen Seiten unter 500 LoC bringen, Zielwert 250 LoC. Keine API-Verträge, Auth, Cookie-Namen oder Routing ändern; keine Service Role im Browser.
5. Mindestens zwei weitere gezielte Web-Testdateien ergänzen (Load-Erfolg, Berechtigungsfehler, Mutation) und erst dann das Testkriterium „mindestens fünf Testdateien“ abhaken.
6. Bei UI-Änderungen einen manuellen Browser-Smoke-Test mit lokaler Wegwerf-`.env` gemäß `plans/README.md` durchführen. Keine echte `.env` kopieren und temporäre Datei anschließend löschen.
7. Nach jedem kohärenten Schritt ausführen: `pnpm --filter @vereinsfunk/web test`, `pnpm --filter @vereinsfunk/web typecheck`, `pnpm lint`, bei Komponenten-/Template-Änderungen zusätzlich `pnpm --filter @vereinsfunk/web build`. Vor jedem Commit `git diff --check`; dann committen und pushen.

## Weiterer Ablauf

Paket 028 erst abschließen, wenn alle Done-Kriterien des Plans erfüllt sind. Danach Paket 027 (Fastify-Routenmodule) und Paket 029 (fachliche Contracts-/Domain-Exports); keine API-Verträge ohne begründete, dokumentierte Entscheidung ändern.
