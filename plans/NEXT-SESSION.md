# Prompt für die nächste Session

Alles unter der Trennlinie in eine neue Claude-Code-Session kopieren. Die Pläne selbst liegen in `plans/008`–`plans/023`, der Index in [plans/README.md](README.md).

---

Wir setzen die Planserie aus `plans/README.md` fort. Lies zuerst `plans/README.md` vollständig — dort stehen Reihenfolge, übergreifende Regeln, Rückbau-Inventar und offene Entscheidungen. Danach `AGENTS.md` und `docs/product/implementation-plan.md`.

**Du darfst und sollst Subagents und Workflows benutzen.** Die Pläne sind breit, viele Prüfungen laufen unabhängig voneinander.

## Stand

Erledigt: **008, 009, 010, 022, 023**. Paket 023 ist als PR #17 (`worktree-worktree-plan-023-sichtbarkeit-mitgliederverwaltung`) offen — **prüfe zuerst, ob er gemergt ist** (`gh pr view 17`). Falls nicht: entweder auf den Merge warten oder für 011 von diesem Branch statt von `main` abzweigen, da 011 `policy_settings`/`policy_scope` aus 023 direkt weiterverwendet.

**Beginne mit Paket 011** (Regelwerk: Freigaberouten, Vertrauen je Mitglied, Kontingente). 013 ist unabhängig und kann parallel/davor laufen, falls das besser passt.

## Was 023 mitbringt (011 baut direkt darauf auf)

- `public.policy_scope`, `public.policy_settings` (zwei Felder: `invite_allowed`, `posts_visible_org_wide`) existieren bereits — 011 **erweitert** dieselbe Tabelle um Freigabe- und Kontingentfelder, legt sie nicht neu an.
- `authz.resolve_policy_flag(...)` löst die Vererbung auf (`null` = erben, AND-Reduktion über Verein/Abteilung/Team, untere Ebene darf nur verschärfen) — von 011 wiederverwendet, nicht neu gebaut.
- Mitglieder-Detailebene auf `/mitglieder` existiert mit Rolle und Befristung; 011 füllt sie mit Freigabe-Zuständigkeit (`policy_reviewers`) und Vertrauen (`member_review_trust`), statt eine zweite Detailebene zu bauen.
- Die drei Vererbungszustände der Oberfläche (**geerbt**, **verschärft**, **gesperrt**, Komponente `PolicyFlagToggles.vue` auf `/struktur`) sind fertig — 011 erweitert dieselbe Darstellung um seine Felder.
- Capability-Felder (`canChangeRole`/`canRemove`/`canSetExpiry` auf `MemberRoleEntrySchema`) kommen aus der API — dieses Muster für neue Felder (Prüfpflicht, Freigabe-Zuständigkeit) fortführen, nicht im Frontend zweimal herleiten.
- **Abweichung vom ursprünglichen 023-Plan, wichtig für 011**: `invite_allowed` sitzt **nicht** in `authz.has_department_permission`/`has_team_permission`, sondern einzeln an den Neuanlage-Stellen (die drei `*_memberships_insert`-Policies, `invitations_insert`, `create_invitation()`) — sonst hätte es auch `change_membership_role()` (Rollenwechsel Bestehender) blockiert. Wenn 011 weitere policy-gesteuerte Sperren baut (z. B. eine Abteilung, die Einreichen komplett sperrt), dasselbe Muster prüfen: nur an Neuanlage-Stellen, nicht in den geteilten `has_*_permission`-Funktionen, falls diese auch für Bestandsänderungen ausgewertet werden.
- **Neu, nicht im ursprünglichen Plan**: `authz.is_any_member_of_organization` (nicht `authz.is_organization_member`) für „jedes Vereinsmitglied, nicht nur Organisationsrollen". Falls 011 „vereinsweit" im selben Sinn meint, diese Funktion wiederverwenden.

## Kritischer Fund aus 023, betrifft die ganze App

Die CORS-Konfiguration in `apps/api/src/app.ts` setzte nie `methods` — `@fastify/cors` fiel auf seinen Default `GET,HEAD,POST` zurück, wodurch jede PATCH/PUT/DELETE-Anfrage aus dem echten Browser am Preflight scheiterte (seit Paket 008/009, für die ganze App; `vitest`/`app.inject()` umgeht CORS und deckte das nie auf). **Ist inzwischen behoben** (expliziter `methods`-Wert). Für 011: bei neuen mutierenden Routen einen kurzen manuellen Browser-Test einplanen, nicht nur `vitest` — genau dieser Fehlertyp bleibt sonst wieder unsichtbar.

## Bewusst offen gelassene Punkte aus 023

- `UpdateMembershipExpiryRequestSchema` akzeptiert Vergangenheitsdaten ohne Warnung (wirkt als sofortiger, stiller Entzug). Nicht behoben, nur dokumentiert.
- `POST /v1/invitations`/`/resend` lesen den Organisationsnamen weiterhin über den Nutzer-Client (`apps/api/src/app.ts`) — könnte für einen Abteilungs-Admin ohne Organisationsrolle mit „not found" scheitern, analog zum in 023 gefundenen und für die Policy-Settings-Routen behobenen Fall. Nicht Teil von 023, nicht angefasst.

## Vorgehen je Arbeitspaket

Arbeite **ein Paket zu Ende**, bevor du das nächste anfängst. Danach 012, dann 014 mit 019, dann 015. 016 und 021 sind ab 011 möglich, 020 vor jedem Produktivbetrieb mit echten Personendaten. 017/018 hängen an externen Gates.

### Phase 1 — Plan gegen den Code verifizieren (parallel)

Pläne zitieren konkrete `file:line`-Stellen, zuletzt am 2026-08-06 (nach Paket 023) gegen den Code geprüft. Vor dem Bauen mehrere Agents parallel prüfen lassen, ob diese Aussagen noch stimmen — pro Agent ein Abschnitt „Ausgangslage und Evidenz", Meldung je Behauptung: bestätigt, verschoben, oder falsch. Weicht etwas ab: zuerst den Plan aktualisieren und mir sagen, was sich geändert hat, bevor gebaut wird.

### Phase 2 — Umsetzen

`EnterWorktree` vor der ersten Codeänderung, ein Branch je Paket. Migration → Domain → API → Oberfläche → Rückbau ist überwiegend seriell. Parallelisierbar: reine Domainfunktionen mit Tests sobald das Modell feststeht, pgTAP-Tests parallel zur Migration, Oberflächenarbeit sobald die Contracts fest sind. **Nicht** parallel: zwei Agents an derselben Migrationsdatei, an `packages/contracts/src/index.ts` oder `packages/domain/src/index.ts`.

### Phase 3 — Adversarial prüfen (parallel, unterschiedliche Blickwinkel)

1. **Mandantentrennung** — `organization_id` auf jeder neuen Tabelle, zusammengesetzte Fremdschlüssel, positive **und** negative RLS-Tests.
2. **Rechte** — kommt jemand an Aktionen/Daten, die der Plan ausdrücklich verwehrt? Capability-Felder müssen exakt widerspiegeln, was die Route durchsetzt.
3. **Geheimnisse** — Token, Elternkontakt, Einwilligung, `updated_by`-artige Provenienz-Felder: landen sie in einem `select` für `authenticated`, der breiter ist als nötig?
4. **Verträge** — jede Systemgrenze mit Zod, Grenzfälle (Vergangenheit, leere Werte, widersprüchliche IDs) abgedeckt.
5. **Rückbau** — jeder Inventar-Eintrag erledigt, kein erfundener Wert durch Null/Platzhalter ersetzt.

Ein Fund gilt erst als echt, wenn reproduzierbar. Unklare Funde von einem zweiten Agent widerlegen lassen.

### Phase 4 — Manueller Browser-Test bei UI-Änderungen

`run-web`-Skill nutzen (lokaler Dev-Server, Login mit Seed-Usern aus `supabase/seed.sql`). Nicht nur auf grüne Tests verlassen — `vitest`/`app.inject()` deckt CORS- und andere Browser-spezifische Fehler nicht ab, siehe Fund oben.

## Definition of Done je Paket

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Bei Datenbankänderungen zusätzlich:

```bash
pnpm db:start && pnpm db:reset && pnpm db:test
```

Alles muss grün sein. Ein rotes Ergebnis wird gemeldet, nicht umgangen. Danach Statuswert in `plans/README.md` auf `erledigt` setzen, Rückbau-Inventar abhaken, abhängige Pläne (die auf dieses Paket verweisen) mit dem tatsächlichen Ergebnis aktualisieren — siehe wie 023 dies in 010/011/012 nachgezogen hat.

## Verbindliche Regeln

- `AGENTS.md` gilt: jede mandantenbezogene Tabelle mit `organization_id`, zusammengesetzte Fremdschlüssel, RLS mit positiven und negativen Tests, Service Role nur in API und Workern, Provider nur hinter Interfaces, Zod an jeder Systemgrenze.
- Übergreifende Regeln in `plans/README.md` sind bindend — insbesondere: Vererbung verschärft nur, Freigabestufen sind additiv, eine Befreiung wirkt nur nach unten, keine Befreiung entfällt die Minderjährigenstufe, Zeit rechnet in der Vereinszeitzone, kein Import löscht, Datenminimierung durch Schema.
- **Kein erfundener Wert wird durch eine Null oder einen grauen Balken ersetzt.**
- Chirurgische Änderungen: nur anfassen, was das Paket verlangt. Kein Refactoring angrenzenden Codes, kein Aufräumen fremden toten Codes — nur erwähnen.
- Minimaler Code. Keine Abstraktion für einen einzigen Aufrufer, keine ungefragte Konfigurierbarkeit.
- Commits und PR-Beschreibungen ohne jeden Hinweis auf Claude, Anthropic oder Claude Code. Kein `Co-Authored-By`, kein Generator-Footer.
- Deutsch in Produkttexten, Plänen und Commit-Messages. Code, Bezeichner und SQL bleiben englisch.
- Bei echten Mehrdeutigkeiten fragen, nicht raten. Bei eindeutigen Aufgaben direkt umsetzen.
- Design-Entscheidungen, die sich beim Bauen als nötig erweisen (Plan war unpräzise oder falsch), im Plan selbst dokumentieren statt still anzuwenden — siehe wie 023 das für `authz.is_any_member_of_organization` und die `invite_allowed`-Verdrahtung gemacht hat.

## Offene Entscheidungen

`plans/README.md` listet sie am Ende. Für 011 blockiert laut letztem Stand keine davon. Vor 014, 015 und 020 werden meine Antworten gebraucht, bei 021 alles, was Geld betrifft. Frag gezielt nach, statt eine Annahme zu treffen.

Fang mit Paket 011 an. Zeig mir nach Phase 1 kurz, was von der Evidenz abgewichen ist, bevor du baust.
