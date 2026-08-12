# Plan 034: Ausgehende LLM-Provider-Aufrufe absichern und Kandidaten-Wiederherstellung nach Absturz

> **Executor instructions**: Dieses Dokument vollständig lesen, die Schritte in Reihenfolge ausführen und nach jedem Schritt verifizieren. Bei einer STOP-Bedingung anhalten und berichten. Danach den Status dieses Plans im Index (`plans/README.md`) aktualisieren.
>
> **Drift check (run first)**: `git diff --stat c854faf1..HEAD -- packages/content-engine/src/index.ts apps/api/src/outboundFetch.ts apps/api/src/app.ts apps/worker/src/textGeneration.ts apps/worker/src/workflows.ts supabase/migrations supabase/tests`. Prüfe zusätzlich per `gh pr view 50 --json state`, ob PR #50 (Anthropic-Adapter) inzwischen gemergt ist — dieser Plan baut auf dessen Ergebnis auf.

## Status

- **Priority**: P1 (Schritt 1: Sicherheitslücke), P1 (Schritt 2: stiller Datenverlust/hängender Job)
- **Effort**: M
- **Risk**: MEDIUM — neues Paket, geänderte Default-Abhängigkeit im Generierungspfad, eine additive Migration.
- **Depends on**: 033 (Echter Textgenerator und Provider-Routing), PR #50 (Anthropic-Adapter/Provider-Routing-UI)
- **Category**: bug, security, migration
- **Planned at**: commit `c854faf1`, 2026-08-12

## Why this matters

Zwei zusammenhängende Lücken kamen beim Review von PR #50 (Anthropic-Adapter für die Textgenerierung) heraus und wurden dort bewusst zurückgestellt, weil beide einen eigenen Architektur-Entscheid statt eines Review-Nebenfixes brauchen.

**1. SSRF im Generierungspfad.** `OpenAiCompatibleStructuredContentGenerator` und `AnthropicStructuredContentGenerator` (`packages/content-engine/src/index.ts`) rufen `provider.base_url` mit dem rohen globalen `fetch` auf. `base_url` kommt aus einem Plattform-Admin-Formular (`POST`/`PATCH /v1/llm-providers`, `apps/api/src/app.ts`) und wird bei **jedem** Generierungslauf im Worker verwendet — ohne die Zieladressenprüfung, die `apps/api/src/outboundFetch.ts` für genau diesen Zweck bereits an anderer Stelle durchsetzt (Modell-Abfrage-Route `POST /v1/llm-providers/models`, iCal-Feeds aus Paket 014). Eine falsch oder böswillig gesetzte Basis-URL (`http://169.254.169.254/...`, ein internes Verwaltungssystem) würde der Worker serverseitig aufrufen, mit dem entschlüsselten API-Key im Header. Plattform-Admin ist eine vertrauenswürdigere Rolle als ein normales Mitglied, aber genau diese Asymmetrie (Formular validiert die URL nirgends gegen interne Netze) hat dieselbe Codebase an der Modell-Abfrage-Route in PR #50 selbst schon für denselben Akteur geschlossen — der Generierungspfad ist die einzige verbleibende Lücke.

**2. Kandidat bleibt nach Absturz für immer hängen — und der Retry meldet trotzdem Erfolg.** Stirbt der Worker-Prozess mitten in `generator.generateText(...)` (OOM, harter Kill, Netzwerkpartition), bleibt der `generation_candidates`-Datensatz für immer auf `generating` stehen: `acquire_generation_candidate` (`supabase/migrations/2026081105_text_generation_review_fixes.sql:147-160`) nimmt ausschließlich Zeilen mit `status = 'pending'`. Hatchet wiederholt den Workflow zwar automatisch (`retries: 3`, `executionTimeout: '10m'`, `apps/worker/src/workflows.ts:60-62`), aber `TextGenerationExecutor.execute()` gibt bei einem nicht mehr `pending`-Kandidaten kommentarlos zurück (`if (!candidate) return`, `apps/worker/src/textGeneration.ts:63`). Der Retry-Aufruf von `runs.succeed(...)` (`apps/worker/src/workflows.ts:77`) markiert den Workflow-Run damit als **erfolgreich abgeschlossen**, obwohl nie ein Ergebnis entstanden ist. Die `composition_session` bleibt für die Vereinsmitglieder für immer auf „wird generiert" stehen, ohne dass je ein weiterer Versuch stattfindet oder ein Fehler sichtbar wird.

Ein verwandter, kleinerer Fund gehört in denselben Schritt: eine blockierte Adresse (Schritt 1) darf nicht als *retryable* Netzwerkfehler behandelt werden — sonst verbraucht sie exakt die drei Hatchet-Versuche, bis der Kandidat bei einer *permanent* falschen Konfiguration am Ende doch nur auf `pending` landet, ohne dass je wieder etwas passiert (Hatchet gibt den Workflow-Run nach drei Versuchen endgültig auf; nur `markFailed`, nicht `releaseCandidate`, macht den Fehler für einen Menschen sichtbar).

## Current state

- `packages/content-engine/src/index.ts:118-214` — beide `StructuredContentGenerator`-Implementierungen, `constructor(private readonly fetcher: FetchLike = fetch)`, `FetchLike = (input: string, init: RequestInit) => Promise<Response>` (Zeile 115). Der Konstruktor-Parameter ist laut Kommentar „deliberately worker injectable" — aktuell injiziert niemand etwas, beide Aufrufstellen in `apps/worker/src/textGeneration.ts:47-50` verwenden den Default.
- `apps/api/src/outboundFetch.ts` (192 Zeilen) — vollständige Zieladressenprüfung (`isAllowedOutboundUrl`, IPv4/IPv6-Sperrlisten inkl. DNS-Rebinding-Schutz über `assertResolvesPublicly`), Weiterleitungsverfolgung mit Zieladressenprüfung je Hop und Credential-Header-Entfernung bei fremder Herkunft (`fetchPublicUrl`, `stripCredentialHeadersOnCrossOrigin`). Bisher ausschließlich in `apps/api` nutzbar — `apps/worker` hat keine Abhängigkeit auf `apps/api` (Apps hängen nicht von anderen Apps ab) und `packages/content-engine` hat nur eine Abhängigkeit auf `@vereinsfunk/contracts`.
- `apps/worker/src/textGeneration.ts:47-50` — `GENERATORS`-Map, konstruiert beide Adapter ohne Argumente. `execute()` (Zeilen 57-84): `acquirePendingCandidate` → `generator.generateText(...)` → `markReady` bei Erfolg, sonst `releaseCandidate` (retryable) oder `markFailed` (terminal), Zeilen 78-83.
- `apps/worker/src/workflows.ts:52-86` — Hatchet-Task-Definition: `retries: 3`, `backoff: { factor: 2, maxSeconds: 60 }`, `executionTimeout: '10m'` (Zeile 60-62). `runs.begin()` (workflow_runs-Lease, siehe unten) muss erfolgreich sein, bevor `executor.execute()` überhaupt aufgerufen wird.
- `supabase/migrations/2026081102_workflow_run_lifecycle.sql:7-8,53,132-137` — bestehendes Vorbild für Lease-Wiederherstellung: `workflow_runs.worker_lease_until`/`worker_lease_token`, `begin_workflow_run` erobert eine Zeile zurück, wenn `technical_status = 'running' and worker_lease_until < now()`. Dieses Muster deckt nur die Workflow-Run-Buchhaltung ab, nicht den fachlichen `generation_candidates`-Status.
- `supabase/migrations/2026081003_text_workshop_foundation.sql:139-164` — `generation_candidates`-Tabelle, hat bereits `updated_at`, keine eigene Lease-Spalte.
- `supabase/migrations/2026081105_text_generation_review_fixes.sql:147-203` — `acquire_generation_candidate`, `mark_generation_candidate_ready`, `mark_generation_candidate_failed`, `release_generation_candidate`. `release_generation_candidate` (Zeilen 192-203) macht bereits exakt den Übergang, den eine Wiederherstellung braucht (`generating` → `pending` beim Kandidaten, `generating` → `queued` bei der Sitzung) — es fehlt nur der Aufrufer für den Absturzfall.
- `ContentGenerationError` (`packages/content-engine/src/index.ts:59-63`) kennt `errorClass: 'provider_network' | 'provider_rate_limit' | 'provider_server' | 'provider_schema' | 'ungrounded'`. `generation_candidates.failure_code` ist freier Text ohne CHECK — ein neuer Klassenwert ist rückwirkungsfrei.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Neues Paket anlegen/installieren | `pnpm install` (nach Anlegen von `packages/outbound-fetch/package.json`) | Lockfile aktualisiert, Paket im Workspace sichtbar |
| Unit-Tests betroffener Pakete | `pnpm --filter @vereinsfunk/outbound-fetch --filter @vereinsfunk/content-engine --filter @vereinsfunk/api --filter @vereinsfunk/worker test` | exit 0 |
| Typecheck | `pnpm --filter @vereinsfunk/outbound-fetch --filter @vereinsfunk/content-engine --filter @vereinsfunk/api --filter @vereinsfunk/worker typecheck` | exit 0 |
| DB-Reset + pgTAP | `pnpm db:reset && pnpm db:test` | exit 0, neue Kandidaten-Recovery-Tests bestehen |
| Voller Gate | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | exit 0 |

## Scope

**In scope**

- Neues Paket `packages/outbound-fetch` (verschiebt `apps/api/src/outboundFetch.ts` samt Tests, ergänzt eine Response-zurückgebende Guard-Variante).
- `apps/api/src/app.ts`, `apps/api/package.json` — Import-Umstellung auf das neue Paket.
- `packages/content-engine/src/index.ts`, `packages/content-engine/package.json` — Default-`fetcher` beider Generatoren, Fehlerklassifikation für eine blockierte Adresse.
- Eine additive Migration für `acquire_generation_candidate` (Wiederherstellung hängender `generating`-Zeilen) plus pgTAP-Regressionstest.
- `plans/README.md` (Status-Eintrag).

**Out of scope**

- Provider-seitige Idempotenz-Schlüssel (`Idempotency-Key`-Header o.ä. an OpenAI/Anthropic) gegen einen tatsächlich doppelt abgerechneten LLM-Aufruf im Absturzfall — siehe Abschnitt „Bewusst nicht gebaut" unten.
- Jede Änderung an Bild-/Video-Generierung (weiterhin nicht implementiert).
- Jede Änderung an `apps/api/src/outboundFetch.ts`s Verhalten für iCal-Feeds oder die Modell-Abfrage-Route — nur der Speicherort ändert sich, nicht die Logik.

## Steps

### Step 1: `packages/outbound-fetch` anlegen und `apps/api` umstellen

Lege `packages/outbound-fetch/package.json` nach dem Muster von `packages/secrets/package.json` an (`name: "@vereinsfunk/outbound-fetch"`, `exports: { ".": "./src/index.ts" }`, `devDependencies: { typescript, vitest }`, keine Laufzeit-Abhängigkeiten). Verschiebe `apps/api/src/outboundFetch.ts` unverändert nach `packages/outbound-fetch/src/index.ts` und `apps/api/src/outboundFetch.test.ts` nach `packages/outbound-fetch/src/index.test.ts`. Ergänze `packages/outbound-fetch/tsconfig.json` nach dem Muster eines bestehenden kleinen Pakets.

Aktualisiere `apps/api/src/app.ts` (Import von `./outboundFetch.js` auf `@vereinsfunk/outbound-fetch`) und `apps/api/package.json` (neue `workspace:*`-Abhängigkeit). Lösche `apps/api/src/outboundFetch.ts` und `apps/api/src/outboundFetch.test.ts`.

**Verify**: `pnpm install && pnpm --filter @vereinsfunk/outbound-fetch --filter @vereinsfunk/api test && pnpm --filter @vereinsfunk/api typecheck` — alle vorher in `apps/api/src/outboundFetch.test.ts` laufenden Tests bestehen unverändert am neuen Ort.

### Step 2: Guard-Variante ergänzen und in `content-engine` verdrahten

Ergänze in `packages/outbound-fetch/src/index.ts` eine neue Exportfunktion, die eine `Response` statt Text zurückgibt (die bestehenden Generatoren rufen `.status`/`.ok`/`.json()` direkt auf der Antwort auf) — z. B. `createGuardedFetch(options?: { lookupImpl?: AddressLookup; fetchImpl?: typeof fetch }): (input: string, init: RequestInit) => Promise<Response>`. Verhalten je Aufruf:

1. `isAllowedOutboundUrl(input)` prüfen, sonst `OutboundFetchError('blocked_url', ...)` werfen.
2. `assertResolvesPublicly(hostname, lookupImpl)` prüfen (DNS-Rebinding-Schutz, wie in `fetchPublicUrl`).
3. `fetch(input, { ...init, redirect: 'manual' })` aufrufen.
4. Eine Weiterleitungsantwort (Status 300–399, oder `response.type === 'opaqueredirect'`) **nicht verfolgen**, sondern als `OutboundFetchError('blocked_url', ...)` werfen. Begründung: LLM-Provider-Endpunkte (OpenAI-kompatibel, Anthropic Messages, `haex-claude-proxy`) leiten unter normalem Betrieb nicht weiter; eine Weiterleitung fail-closed zu behandeln vermeidet, die Redirect-Verfolgung samt Credential-Header-Entfernung aus `fetchPublicUrl` hierher zu duplizieren, ohne einen legitimen Anwendungsfall zu verlieren.
5. Andernfalls die `Response` unverändert zurückgeben (keine Text-Dekodierung, keine Größengrenze — die Generatoren lesen den Body selbst und die Provider-Antworten sind strukturiert begrenzt, anders als ein beliebiger Feed).

Ergänze `packages/content-engine/package.json` um die neue `workspace:*`-Abhängigkeit. Ändere in `packages/content-engine/src/index.ts` den Default-Parameter beider Konstruktoren von `fetcher: FetchLike = fetch` auf `fetcher: FetchLike = createGuardedFetch()`. Bestehende Tests, die einen eigenen `fetcher` übergeben (`content-engine.test.ts`), sind davon nicht betroffen — sie überschreiben den Default ohnehin.

Ergänze im `catch`-Block beider `generateText`-Methoden (aktuell `catch { throw new ContentGenerationError('provider_network', true) }`) eine vorgezogene Prüfung: ein `OutboundFetchError` wird zu `ContentGenerationError('provider_configuration', false)` (neuer, nicht wiederholbarer `errorClass`) statt zum generischen, wiederholbaren `provider_network`. Begründung: eine blockierte Adresse ist eine dauerhafte Fehlkonfiguration, kein transienter Netzwerkfehler — drei automatische Hatchet-Wiederholungen wären verschwendet und würden den Kandidaten am Ende unbeobachtet auf `pending` zurücklassen (siehe „Why this matters").

**Verify**: neuer Test in `content-engine.test.ts` — ein Generator mit `baseUrl: 'http://169.254.169.254/...'` und dem echten Default-Fetcher (kein injizierter Fake) wirft `ContentGenerationError` mit `errorClass: 'provider_configuration', retryable: false`, **ohne** einen echten Netzwerkaufruf auszulösen (`lookupImpl`/`fetchImpl` müssen dafür injizierbar bleiben — ggf. `createGuardedFetch` testweise direkt in `outbound-fetch`s eigener Suite mit einem Fake-`lookupImpl` abdecken, `content-engine.test.ts` deckt nur, dass `isAllowedOutboundUrl` selbst schon vor jeder DNS-Auflösung blockiert, z. B. eine IP-Literal-Adresse). `pnpm --filter @vereinsfunk/content-engine --filter @vereinsfunk/worker test`.

### Step 3: Hängende Kandidaten nach Absturz selbst heilen lassen

Ergänze eine additive Migration, die `acquire_generation_candidate`s `UPDATE`-Bedingung erweitert: statt ausschließlich `status = 'pending'` neu `status = 'pending' or (status = 'generating' and updated_at < now() - interval '15 minutes')`. Der Schwellenwert liegt bewusst deutlich über Hatchets `executionTimeout: '10m'` (`apps/worker/src/workflows.ts:62`) plus dem Standard-Provider-Timeout (`requestTimeoutMs` Default `60_000`ms, `packages/content-engine/src/index.ts`) — ein noch legitim laufender Versuch wird nicht vorzeitig überschrieben. Kommentiere die Begründung direkt an der geänderten Zeile (Vorbild: `workflow_runs_recovery_idx`/`begin_workflow_run` in `2026081102_workflow_run_lifecycle.sql`).

Keine neue Spalte, keine neue Funktion nötig: `release_generation_candidate` macht den passenden Übergang bereits, hier braucht `acquire_generation_candidate` nur denselben Rückfall wie `begin_workflow_run` ihn für `workflow_runs` schon hat.

**Verify**: neue pgTAP-Assertion in `supabase/tests/text_workshop_foundation.test.sql` — ein Kandidat, dessen `status='generating'` und `updated_at` künstlich auf `now() - interval '20 minutes'` gesetzt ist, lässt sich erneut über `acquire_generation_candidate` erobern; ein frischer `generating`-Kandidat (`updated_at = now()`) nicht. `pnpm db:reset && pnpm db:test`.

### Step 4: Dokumentation und Plan-Index aktualisieren

Ergänze `plans/README.md` um Zeile 034 in der Tabelle „Vierte Serie: Review und nachhaltiges Refactoring" (Abhängigkeit: 033/PR #50). Falls `docs/adr/ADR-010-text-workshop-style-profiles-and-generation-provenance.md` den Kandidaten-Zustandsautomaten beschreibt, ergänze dort den Wiederherstellungsfall in einem Satz.

**Verify**: `pnpm check` (oder einzeln `pnpm lint && pnpm typecheck && pnpm test && pnpm build`), danach `pnpm db:reset && pnpm db:test`.

## Bewusst nicht gebaut (zur Entscheidung in dieser Session)

- **Provider-seitige Idempotenz gegen einen tatsächlich doppelt abgerechneten LLM-Aufruf.** Schritt 3 heilt einen hängenden Kandidaten selbst, indem ein neuer Versuch denselben `generateText`-Aufruf erneut auslöst. Im theoretischen Worst Case (Prozess durch Netzwerkpartition unerreichbar, aber der ursprüngliche HTTP-Request beim Provider tatsächlich noch in Bearbeitung) entstehen zwei Aufrufe für denselben Kandidaten — das Ergebnis des zweiten gewinnt (`markReady` schreibt einfach den zuletzt eingetroffenen Inhalt), das erste verhallt ungenutzt. Kein Korrektheits- oder Sicherheitsproblem (siehe „Why this matters"-Analyse in der Session, die diesen Plan erzeugt hat), im ungünstigsten Fall doppelte Kosten für einen einzelnen Generierungslauf. Ob OpenAI-kompatible Endpunkte und die Anthropic Messages API tatsächlich einen Idempotenz-Schlüssel-Header unterstützen, ist unklar (`haex-claude-proxy` im Abo-Modus mit Sicherheit nicht, da dort ein CLI-Unterprozess läuft) — vor einer Entscheidung für oder gegen dieses Ausbaustufe die aktuelle Dokumentation der jeweiligen Provider prüfen, nicht annehmen.
- **Ein Cron-/Hatchet-getriebener Recovery-Job statt Selbstheilung beim nächsten Versuch.** Schritt 3 heilt nur, wenn überhaupt noch ein weiterer Versuch stattfindet (also innerhalb der drei Hatchet-Wiederholungen). Ein Kandidat, dessen Workflow-Run nach drei Versuchen bereits endgültig aufgegeben wurde, bleibt weiterhin ohne eigenständigen Wiederanlauf — das deckt sich mit der bestehenden, bewusst manuellen Wiederherstellung für Retention-/Signaturläufe (Paket 020) und Sync-Runs (`POST /v1/integration-sources/:id/sync-runs/:runId/cancel`, Paket 026). Ein eigener geplanter Recovery-Lauf wäre ein eigenständiges Vorhaben, keine Erweiterung dieses Plans.

## Done criteria

- [x] `packages/outbound-fetch` existiert, enthält die vollständige, unveränderte Zieladressenprüfung sowie eine neue Response-zurückgebende Guard-Funktion mit eigener Testabdeckung.
- [x] `apps/api` importiert die Guard-Logik aus dem neuen Paket, keine Duplizierung mehr.
- [x] Beide `StructuredContentGenerator`-Implementierungen sind standardmäßig gegen interne/private Zieladressen abgesichert, ohne dass `apps/worker` seine Konstruktion ändern musste.
- [x] Eine blockierte Zieladresse führt zu einem nicht wiederholbaren, klar erkennbaren `failure_code`.
- [x] Ein nach Absturz auf `generating` hängender Kandidat wird beim nächsten Hatchet-Versuch automatisch zurückerobert; ein noch legitim laufender Versuch wird nicht vorzeitig unterbrochen.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test` bestehen vollständig.

### Offen: CodeRabbit-Zweitrunde auf diesem Plan (PR #50)

CodeRabbit hat den Plan-Text selbst review­t (nachdem er als Commit in PR #50 landete) und drei
Lücken gefunden, die mit Stand dieser Zeile noch nicht geschlossen sind — die sechs Haken oben
decken sie nicht ab, auch wenn Schritt 1–3 sonst umgesetzt sind:

- [ ] `createGuardedFetch` begrenzt die gelesene Antwortgröße (`maxBytes`, analog zu
  `fetchPublicUrl`/`readCapped` in derselben Datei). Stand: fehlt — die Funktion gibt die
  `Response` ungeprüft zurück, ein Provider (oder eine kompromittierte/falsch konfigurierte
  Basis-URL) kann beliebig viel Speicher im Worker belegen. Offener Review-Thread, PR #50, Zeile 83.
- [ ] Die Kandidaten-Wiedereroberung ist gegen einen veralteten Worker abgesichert (Fencing-Token
  oder Lease, geprüft in `mark_generation_candidate_ready`/`mark_generation_candidate_failed`).
  Stand: fehlt — `acquire_generation_candidate` erkennt Wiedereroberung nur über `updated_at`; ein
  Worker, dessen Provider-Antwort verspätet eintrifft, kann nach der Wiedereroberung durch einen
  neuen Worker noch ein veraltetes Ergebnis schreiben. Offener Review-Thread, PR #50, Zeile 93.
- [ ] Ein Hatchet-Retry, der vor Ablauf der 15-Minuten-Schwelle startet, scheitert sichtbar statt
  als No-op erfolgreich zu enden. Stand: nicht behoben — `apps/worker/src/textGeneration.ts` ist in
  dieser Umsetzung unverändert geblieben, `if (!candidate) return` lässt `runs.succeed()` weiterhin
  fälschlich Erfolg melden, wenn die 15 Minuten noch nicht um sind. Offener Review-Thread, PR #50,
  Zeile 95.

## STOP conditions

- Ein LLM-Provider-Endpunkt, den ein bestehender Verein tatsächlich produktiv nutzt, benötigt eine echte Weiterleitung — dann darf Schritt 2 nicht mehr fail-closed auf jede Weiterleitung reagieren, sondern muss die vollständige Redirect-Verfolgung aus `fetchPublicUrl` übernehmen (inkl. Credential-Header-Entfernung bei fremder Herkunft).
- Der gewählte 15-Minuten-Schwellenwert in Schritt 3 erweist sich beim Testen als zu knapp gegenüber der tatsächlichen Provider-Latenz (z. B. bei sehr langen Revisionsläufen) — dann `executionTimeout` in `apps/worker/src/workflows.ts` und den Schwellenwert gemeinsam neu abstimmen, nicht nur einen der beiden Werte isoliert ändern.

## Maintenance notes

Jeder künftige dritte Adapter (`GENERATORS` in `apps/worker/src/textGeneration.ts`) muss seinen `fetcher`-Default ebenfalls auf `createGuardedFetch()` setzen — ein Adapter mit rohem `fetch()` als Default wäre wieder dieselbe Lücke. Dasselbe gilt für jeden künftigen Aufrufer einer vom Verein oder einer Plattform-Administration gesetzten Adresse: über `@vereinsfunk/outbound-fetch`, nie über ein nacktes `fetch()` (bestehende Regel aus `plans/README.md`, Hinweis zu Paket 014, jetzt mit dem neuen Paket als kanonischem Ort statt `apps/api/src/outboundFetch.ts`).
