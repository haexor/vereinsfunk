# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch`, `git log --oneline main..HEAD` und `gh pr view 50 --json state,mergedAt` — Plan 034 hängt an PR #50 (Anthropic-Adapter/Provider-Routing-UI). Ist der PR inzwischen gemergt, auf einem frischen Branch/Worktree von `main` weiterarbeiten statt auf `worktree-llm-provider-dropdowns`; ist er noch offen, auf diesem Branch fortsetzen. Bewahre vorhandene Änderungen; erst nach ausdrücklicher Aufforderung committen oder pushen.

## Auftrag: Plan 034 umsetzen

Lies vor Änderungen vollständig:

- `plans/034-provider-aufrufe-absichern-und-generation-recovery.md` (der eigentliche Plan — Drift-Check-Befehl steht direkt am Anfang)
- `packages/content-engine/src/index.ts`
- `apps/api/src/outboundFetch.ts`
- `apps/worker/src/textGeneration.ts`, `apps/worker/src/workflows.ts`
- `supabase/migrations/2026081105_text_generation_review_fixes.sql`, `supabase/migrations/2026081102_workflow_run_lifecycle.sql` (Vorbild für den Lease-Rückfall aus Schritt 3)

### Erreichter Ausgangsstand

- PR #50 lieferte den Anthropic-Adapter und die Auswahlfelder im Plattform-Admin-Formular; im Review dieses PRs fielen zwei zusammenhängende, bewusst zurückgestellte Lücken im Textgenerierungspfad auf, die Plan 034 schließt.
- **Lücke 1 (Sicherheit)**: `OpenAiCompatibleStructuredContentGenerator` und `AnthropicStructuredContentGenerator` (`packages/content-engine/src/index.ts`) rufen die admin-konfigurierte `base_url` mit rohem `fetch` auf, ohne die Zieladressenprüfung aus `apps/api/src/outboundFetch.ts`, die für denselben Zweck an anderer Stelle (Modell-Abfrage-Route, iCal-Feeds) schon existiert.
- **Lücke 2 (stiller Datenverlust)**: Stirbt der Worker mitten in `generator.generateText(...)`, bleibt der Kandidat für immer auf `generating` stehen; Hatchets automatischer Retry meldet den Workflow-Run trotzdem als erfolgreich, weil `TextGenerationExecutor.execute()` bei einem nicht mehr `pending`-Kandidaten kommentarlos zurückkehrt.
- Plan 034 löst beides mit einem neuen Paket `packages/outbound-fetch` (verschiebt die bestehende Guard-Logik, ergänzt eine Response-zurückgebende Variante als neuen Default-Fetcher beider Generatoren — `apps/worker` muss dafür nicht geändert werden) und einer additiven Migration, die `acquire_generation_candidate` denselben Lease-Rückfall gibt, den `workflow_runs` bereits hat.

### Nicht verhandelbare Grenzen

- Eine blockierte Zieladresse ist ein dauerhafter Konfigurationsfehler, kein transienter Netzwerkfehler — nicht als `retryable` klassifizieren (siehe Plan, Schritt 2).
- Der neue Guard darf Weiterleitungen fail-closed behandeln (kein legitimer Anwendungsfall bei LLM-Provider-Endpunkten) — keine Redirect-Verfolgung samt Credential-Stripping duplizieren, außer eine STOP-Bedingung aus dem Plan greift tatsächlich.
- Keine neue Spalte und keine neue Funktion für die Kandidaten-Wiederherstellung; `release_generation_candidate` macht den passenden Übergang bereits, `acquire_generation_candidate` braucht nur denselben Rückfall wie `begin_workflow_run`.
- Der Recovery-Schwellenwert muss deutlich über `executionTimeout: '10m'` (`apps/worker/src/workflows.ts`) plus dem Standard-`requestTimeoutMs` (60s) liegen, sonst wird ein noch legitim laufender Versuch überschrieben.
- Kein provider-seitiger Idempotenz-Schlüssel gegen einen theoretisch doppelt abgerechneten LLM-Aufruf — im Plan bewusst als offene Entscheidung markiert, nicht in diesem Umsetzungslauf bauen, außer der Nutzer entscheidet nach Rücksprache aktiv dafür.
- Wenn eine STOP-Bedingung aus Plan 034 greift, nicht improvisieren: Ursache, betroffene Dateien und den kleinsten nächsten Schritt berichten.

### Verifikation

Nach jedem Schritt aus dem Plan die dort angegebene fokussierte Prüfung ausführen. Vor Abschluss mindestens:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:reset
pnpm db:test
```

Stand 2026-08-12: nach dem Review-Fix zu PR #50 (Commit `c854faf1`) bestanden `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` und `pnpm db:test` mit 627 Assertions in 20 Dateien.
