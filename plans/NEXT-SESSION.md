# Prompt für die nächste Session

Alles unter der Trennlinie in eine neue Claude-Code-Session kopieren. Die Pläne selbst liegen in `plans/008`–`plans/023`, der Index in [plans/README.md](README.md).

---

Wir setzen die Planserie aus `plans/README.md` fort. Lies zuerst `plans/README.md` vollständig — dort stehen Reihenfolge, übergreifende Regeln, Rückbau-Inventar und offene Entscheidungen. Danach `AGENTS.md` und `docs/product/implementation-plan.md`.

**Du darfst und sollst Subagents und Workflows benutzen.** Die Pläne sind breit, viele Prüfungen laufen unabhängig voneinander.

## Stand

Erledigt: **008, 009, 010, 022, 023, 011**. Paket 011 ist als PR #18 (`worktree-plan-011-regelwerk-richtlinien-und-kontingente`) offen — **prüfe zuerst, ob er gemergt ist** (`gh pr view 18`). Falls nicht: entweder auf den Merge warten oder für das nächste Paket von diesem Branch statt von `main` abzweigen, falls es `policy_settings`/`channel_quotas`/`member_review_trust` aus 011 direkt weiterverwendet (012 tut das).

**Beginne mit Paket 012** (Kanäle und Social-Accounts). 013 (Marke/Branding) ist unabhängig und kann parallel/davor laufen. 016 (Auswertung) und 021 (Abomodelle) sind seit 011 ebenfalls möglich, 016 trifft aber sofort auf die Inhalts-Pipeline-Lücke unten — nicht als erstes Paket empfohlen.

## Was 011 mitbringt (012/016/021 bauen darauf auf)

- `policy_settings` ist um Freigabe-, Medien- und Kontingentfelder erweitert (`review_required`, `review_mode`, `review_stage_label`, `review_minimum_approvals`, `review_deadline_hours`, `minor_approval_required`, `self_approval_allowed`, `allow_same_reviewer_across_stages`, `allow_review_exemptions`, `media_requires_consent_check`, `allowed_presets`, `allowed_formats`, `allowed_channel_ids`, `forbidden_topics`, `required_hashtags`, `tone`) — nicht doppelt anlegen. `submit_requires_permission` existiert als Spalte, ist aber ohne Verhalten (siehe unten).
- `channel_quotas` existiert bereits: Zeile pro Scope/Periode mit **nullable** FK `social_connection_id` auf `social_connections`, vier CRUD-Endpunkte (`GET/POST/PATCH/DELETE /v1/channel-quotas`), `public.count_publications_in_period()` (nur für `service_role`, kein direkter Aufrufer aus `authenticated`). Vereinsweite Kontingente sind heute nutzbar; kanalspezifische erst sinnvoll bedienbar, sobald 012 echte Kanäle liefert.
- `policy_reviewers`, `member_review_trust`, `approval_stages` mit mehrstufigen `approval_decisions` — der Prüferzugang über Scope-Grenzen hinweg läuft über `authz.is_assigned_reviewer(_of_post)`, Entscheidungen über `authz.can_decide_stage`.
- Vier reine Domain-Funktionen in `packages/domain`: `resolveReviewRoute`, `evaluateSubmitPermission`, `resolveReviewers`, `resolveEffectiveConfig` (Wrapper um das bereits vorhandene `mergeEffectiveConfig`, das jetzt auch aus Produktionscode aufgerufen wird, nicht mehr nur aus Tests). Das geplante `evaluateQuota` ist bewusst **nicht** enthalten: die Durchsetzung gehört wegen der Atomarität in `public.schedule_publication`, und die geplante Signatur konnte zwei Kontingente derselben Ebene und Periode für verschiedene Kanäle nicht unterscheiden. **Für 012**: die Auslastungsanzeige („2 von 3 diese Woche") gehört mit der Kanaldimension neu gebaut, als Anzeige und nie als Gate — Begründung in `plans/011`, Abschnitt „`evaluateQuota` entfernt statt unbenutzt gelassen".
- Drei RPCs für die eigentliche Freigabe: `public.request_approval`, `public.decide_approval_stage`, `public.schedule_publication` — alle `security definer`, alle für `authenticated` per RPC direkt aufrufbar. **Wichtig für 012**: `schedule_publication` ist der tatsächliche Einplanungspfad, nicht eine TS-Funktion. Wer dort neue Prüfungen (Kanal-Scope, `archived`, verantwortliche Person) ergänzen will, muss den SQL-Funktionskörper selbst ändern — siehe der kritische Fund unten.

## Kritischer Fund aus 011, projektweit relevant

`public.request_approval` übernahm `reviewerSnapshot` sowie `self_approval_allowed`/`allow_same_reviewer_across_stages` ungeprüft vom Aufrufer, obwohl die Funktion per `grant execute … to authenticated` direkt per RPC erreichbar ist — unabhängig von der sorgfältigen TS-Berechnung in `apps/api`. Jede Person mit `post.submit` hätte eine fremde `userId` als Prüfer eintragen, mit leerer Stufenliste jede Prüfung (inklusive der unbefreibaren Minderjährigenstufe) umgehen und sich selbst freigeben können. **Behoben**: die Funktion berechnet die sicherheitsrelevanten Werte jetzt selbst aus `policy_settings` und prüft jede genannte Person gegen echte Vereinsmitgliedschaft. **Für 012 und jedes künftige Paket mit einer neuen `security definer`-RPC**: bei jedem Parameter fragen, ob er sicherheitsrelevant ist und was passiert, wenn die RPC direkt (nicht über die API) mit erfundenen Werten aufgerufen wird. Details in `plans/011-regelwerk-richtlinien-und-kontingente.md`, Abschnitt „Umsetzung: Ergebnis und Abweichungen vom Plan".

## Die Inhalts-Pipeline fehlt weiterhin — betrifft 012 und vor allem 016

Kein Code im Repository erzeugt einen `post`/eine `post_version` aus einer `submission` — Pakete 001–007 (LLM-Entwurf, Rendering) sind laut `plans/README.md` weiterhin „in Arbeit". `POST /v1/submissions` persistiert seit 011 echt, aber niemand wandelt eine Submission in einen Beitrag um. Das war eine bewusste, vorab geklärte Scope-Entscheidung für 011 (nicht vorziehen). Konsequenzen:

- `post_versions.effective_config_snapshot` bleibt strukturell ungefüllt.
- `/beitraege` und `/freigaben` zeigen ehrliche Leerzustände (mit erklärendem Kommentar in den Dateien) statt Fakedaten.
- Wer **012** umsetzt: der End-to-End-Test „Beitrag einplanen und veröffentlichen" ist nur über direkte DB-/RPC-Eingriffe durchführbar, nicht über den echten Produktpfad.
- Wer **016** umsetzt: der Funnel „Entwurf → Freigabe → veröffentlicht" hat noch keine echten Nutzungsdaten. `pages/auswertung.vue` sollte mit einem ehrlichen Leerzustand beginnen, nicht mit der Annahme, es gäbe bereits einen Bestand.

## Bewusst offen gelassene Punkte aus 011

- `submit_requires_permission` existiert als Spalte, hat aber keine Bedeutung — der Plan selbst erklärt dieses Feld an keiner Stelle. Braucht eine Festlegung, bevor es etwas durchsetzt.
- Benachrichtigung der Prüfer (E-Mail beim Öffnen einer Stufe, Bündelung, Realtime-Badge) und der tägliche „Stufen als stalled markieren"-Job sind nicht gebaut — kein Scheduler vorhanden (Paket 004, Hatchet-Produktionsintegration, weiterhin „in Arbeit"). `public.mark_stalled_approval_stages()` existiert, wird von nichts aufgerufen. Wer den Job verdrahtet: `stalled` nimmt niemandem ein Recht (`can_decide_stage` und `/v1/approval-stages/mine` behandeln es wie `open`) — das war ein Fund der zweiten Review-Runde und muss so bleiben, sonst blockiert eine Frist die Prüfung, die sie nur beschleunigen soll.
- Eine tatsächlich blockierte Route (benannter Prüfer hat den Verein verlassen, niemand entscheidet) lässt sich noch nicht auflösen. Der Weg dafür ist **Paket 024** (Route bewusst neu auflösen, auditiert und begründet) — ausdrücklich **nicht** „Verwaltende dürfen überfällige Stufen selbst entscheiden", das wäre ein Selbstfreigabe-Pfad über die selbst gesetzte Frist.
- Oberfläche vereinfacht: keine Prosa-Zusammenfassung, keine grafische Routenvorschau, keine Warnung bei weniger als zwei auflösbaren Prüfern.
- `ReviewerRefSchema.role` validiert nicht, dass die Rolle zum jeweiligen `kind` passt (führt zu einem sicher fehlschlagenden `422`, keine Sicherheitslücke). `scheduledFor` erlaubt ein Datum in der Vergangenheit. `allowedChannelIds` prüft nur UUID-Syntax, nicht Existenz.

## Vorgehen je Arbeitspaket

Arbeite **ein Paket zu Ende**, bevor du das nächste anfängst.

### Phase 1 — Plan gegen den Code verifizieren (parallel)

Pläne zitieren konkrete `file:line`-Stellen. Vor dem Bauen mehrere Agents parallel prüfen lassen, ob diese Aussagen noch stimmen — pro Agent ein Abschnitt „Ausgangslage und Evidenz", Meldung je Behauptung: bestätigt, verschoben, oder falsch. Weicht etwas ab: zuerst den Plan aktualisieren und mir sagen, was sich geändert hat, bevor gebaut wird.

### Phase 2 — Umsetzen

`EnterWorktree` vor der ersten Codeänderung, ein Branch je Paket. Migration → Domain → API → Oberfläche → Rückbau ist überwiegend seriell. Parallelisierbar: reine Domainfunktionen mit Tests sobald das Modell feststeht, pgTAP-Tests parallel zur Migration, Oberflächenarbeit sobald die Contracts fest sind. **Nicht** parallel: zwei Agents an derselben Migrationsdatei, an `packages/contracts/src/index.ts` oder `packages/domain/src/index.ts`.

### Phase 3 — Adversarial prüfen (parallel, unterschiedliche Blickwinkel)

1. **Mandantentrennung** — `organization_id` auf jeder neuen Tabelle, zusammengesetzte Fremdschlüssel, positive **und** negative RLS-Tests. Bei jeder neuen `security definer`-RPC mit `grant … to authenticated` zusätzlich prüfen, ob sie sicherheitsrelevante Parameter vom Aufrufer übernimmt, statt sie selbst herzuleiten (siehe Fund oben).
2. **Rechte** — kommt jemand an Aktionen/Daten, die der Plan ausdrücklich verwehrt?
3. **Geheimnisse** — Token, Elternkontakt, Einwilligung, Provenienz-Felder (`updated_by`/`granted_by`/`created_by`): landen sie in einem `select` für `authenticated`, der breiter ist als nötig?
4. **Verträge** — jede Systemgrenze mit Zod, Grenzfälle abgedeckt, jeder SQL-Fehlerpfad auf einen sinnvollen HTTP-Status gemappt (nicht nur die Fehlerpfade, die beim ersten Test auftauchen).
5. **Rückbau** — jeder Inventar-Eintrag erledigt, kein erfundener Wert durch Null/Platzhalter ersetzt.

Ein Fund gilt erst als echt, wenn reproduzierbar. Unklare Funde von einem zweiten Agent widerlegen lassen.

### Phase 4 — Manueller Browser-Test bei UI-Änderungen

`run-web`-Skill nutzen. Nicht nur auf grüne Tests verlassen.

## Definition of Done je Paket

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Bei Datenbankänderungen zusätzlich:

```bash
pnpm db:start && pnpm db:reset && pnpm db:test
```

Alles muss grün sein. Danach Statuswert in `plans/README.md` auf `erledigt` setzen, Rückbau-Inventar abhaken, abhängige Pläne (die auf dieses Paket verweisen) mit dem tatsächlichen Ergebnis aktualisieren — siehe wie 011 dies für 012/016 nachgezogen hat.

## Verbindliche Regeln

- `AGENTS.md` gilt: jede mandantenbezogene Tabelle mit `organization_id`, zusammengesetzte Fremdschlüssel, RLS mit positiven und negativen Tests, Service Role nur in API und Workern, Provider nur hinter Interfaces, Zod an jeder Systemgrenze.
- Übergreifende Regeln in `plans/README.md` sind bindend.
- **Kein erfundener Wert wird durch eine Null oder einen grauen Balken ersetzt.**
- Chirurgische Änderungen: nur anfassen, was das Paket verlangt. Kein Refactoring angrenzenden Codes, kein Aufräumen fremden toten Codes — nur erwähnen.
- Minimaler Code. Keine Abstraktion für einen einzigen Aufrufer, keine ungefragte Konfigurierbarkeit.
- Commits und PR-Beschreibungen ohne jeden Hinweis auf Claude, Anthropic oder Claude Code.
- Deutsch in Produkttexten, Plänen und Commit-Messages. Code, Bezeichner und SQL bleiben englisch.
- Bei echten Mehrdeutigkeiten fragen, nicht raten. Bei eindeutigen Aufgaben direkt umsetzen.
- Design-Entscheidungen, die sich beim Bauen als nötig erweisen, im Plan selbst dokumentieren statt still anzuwenden.

## Offene Entscheidungen

`plans/README.md` listet sie am Ende. Für 012/013 blockiert laut letztem Stand keine davon. Vor 014, 015 und 020 werden meine Antworten gebraucht, bei 021 alles, was Geld betrifft. Frag gezielt nach, statt eine Annahme zu treffen.

Fang mit Paket 012 an. Zeig mir nach Phase 1 kurz, was von der Evidenz abgewichen ist, bevor du baust.
