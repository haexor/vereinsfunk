# Prompt für die nächste Session

Alles unter der Trennlinie in eine neue Claude-Code-Session kopieren. Die Pläne selbst liegen in `plans/008`–`plans/024`, der Index in [plans/README.md](README.md).

---

Wir setzen die Planserie aus `plans/README.md` fort. Lies zuerst `plans/README.md` vollständig — dort stehen Reihenfolge, übergreifende Regeln, Rückbau-Inventar und offene Entscheidungen. Danach `AGENTS.md` und `docs/product/implementation-plan.md`.

**Du darfst und sollst Subagents und Workflows benutzen.** Die Pläne sind breit, viele Prüfungen laufen unabhängig voneinander.

## Stand

Erledigt: **008, 009, 010, 022, 023, 011, 012, 013**. Paket 012 ist gemergt (`main` steht auf `d7fa8db6`, PR #19). Paket 013 ist als PR #20 (`worktree-plan-013-marke-branding-assets-und-schriften`, Basis bereits `main` nach dem Merge von PR #19) offen — **prüfe zuerst, ob er gemergt ist** (`gh pr view 20`). Falls nicht: entweder auf den Merge warten oder für das nächste Paket von diesem Branch statt von `main` abzweigen, falls es `brand_assets`/`resolveBrand`/die Font-Registry aus 013 direkt weiterverwendet.

**Empfehlung für das nächste Paket**: die im README empfohlene Reihenfolge nennt jetzt 014 (Integrationsrahmen und Mitgliederverzeichnis) mit 019 (Mannschaften/Spielpläne) als erstem Nutzen davon, danach 015 (Einwilligungsverwaltung). 016 (Auswertung), 021 (Abomodelle) und 024 (Freigaberoute neu auflösen) sind seit 011 ebenfalls jederzeit unabhängig möglich — 016 trifft aber sofort auf die Inhalts-Pipeline-Lücke unten, deshalb nicht als erstes Paket empfohlen.

## Was 013 mitbringt (Marke, Branding-Assets und Schriften)

- `brand_assets`: eine Tabelle für alle Markenmedien (Logovarianten, Wortmarke, Wasserzeichen, eigene Schriftdateien), mit Besitzebene (`organization_id` + optional `department_id`/`team_id`), Status (`processing`/`ready`/`rejected`/`replaced`) und — bei Schriften — Pflichtfeldern für die Lizenzbestätigung, die per CHECK-Constraint vor `status = 'ready'` erzwungen werden. Ein Asset wird nie überschrieben, nur durch ein neues ersetzt (`replaced`).
- `resolveBrand()` und `isBrandAssetSelectable()` (`packages/domain/src/brand.ts`) sowie ihr SQL-Gegenstück `authz.brand_asset_is_selectable()`: Vererbungsmuster **„Ersetzung, nicht Verschärfung“** — anders als das `resolveEffectiveConfig`-Muster aus 011 (das nur verschärft) dürfen Abteilung/Team hier Farben, Schrift und Logo der Vereinsebene komplett **ersetzen**, sofern nicht durch `lockedFields` (kumulativ nach unten vererbt) gesperrt.
- Neue Permission `brand.manage` (TS **und** SQL, `department_admin`/`team_manager`).
- Font-Pipeline (`apps/api/src/brandFont.ts`, `fontkit`/`wawoff2`): eigene Schriftdatei-Uploads (TTF/OTF/WOFF2) werden serverseitig geparst, validiert und zu WOFF2 konvertiert; **WOFF Version 1 bewusst nicht unterstützt**. Kuratierte Schriften (4 Familien: Manrope, DM Sans, Space Grotesk, Karla — bewusst kleiner als die im Plan empfohlenen 6–8) werden seit 013 selbst gehostet (`apps/web/public/fonts/`), nicht mehr von `fonts.googleapis.com` geladen.
- Neue Endpunkte: `POST /v1/brand/assets` (ein einziger Multipart-Upload-Endpunkt für alle Asset-Arten inkl. Schriften), `POST /v1/brand/assets/:id/confirm-license`, `PUT /v1/departments/:id/brand`, `PUT /v1/teams/:id/brand`.
- Remotion-Kompositionen (`apps/remotion/src/ClubPost.tsx`) registrieren jetzt die aufgelöste Marken-Schrift (kuratiert über `@remotion/google-fonts`, eigene über `@remotion/fonts`' `loadFont()`) und das Vereinslogo, statt fest Arial ohne Logo zu rendern.
- Bewusst nicht automatisiert geprüft: Remotion-Pixelvergleich der neuen Font-/Logo-Registrierung und der Erfolgspfad des Storage-Uploads — beide nur manuell verifiziert, siehe Plan.

## Kritischer Punkt aus 013, projektweit relevant (ergänzt die Funde aus 011/012)

Bei jeder Tabelle mit einer FK-Spalte, die **wahlweise** auf eine vereinsweite oder eine untergeordnete (abteilungs-/team-eigene) Zeile zeigen darf — hier: `department_brand_profiles.logo_asset_id` kann ein Verein- **oder** ein Abteilungs-Asset referenzieren —, reicht eine reine Existenz-/`organization_id`-Prüfung per zusammengesetztem Fremdschlüssel **nicht**. Die erste Fassung der Migration prüfte nur, dass das referenzierte Asset zur eigenen Organisation gehört, nicht ob es für **diesen** Scope tatsächlich sichtbar/wählbar ist (`isBrandAssetSelectable` existierte bereits, aber nur als API-seitige Vorabprüfung in `apps/api/src/app.ts`). Ein Abteilungsadmin, der die REST-Schnittstelle direkt statt über `PUT /v1/departments/:id/brand` ansprach, hätte so das Asset einer fremden Abteilung als eigenes Logo eintragen können. Gefunden erst beim eigenen adversarialen Review (Mandantentrennung-Blickwinkel), nicht beim ursprünglichen Schreiben der Policy — dieselbe Fehlerklasse wie beim Fund aus 012 (API-seitige Prüfung reicht nicht, wenn PostgREST/RPC direkt für `authenticated` erreichbar ist), hier aber bei einer normalen `INSERT`/`UPDATE`-Policy statt einer `security definer`-Funktion. Behoben mit `authz.brand_asset_is_selectable()` in der `WITH CHECK`-Klausel von `department_brand_profiles_insert`/`_update` und `team_brand_profiles_insert`/`_update`, plus Regressionstests. **Bei jeder neuen FK dieser Art**: eine `security definer`-Hilfsfunktion schreiben, die die Scope-Regel spiegelt, und sie in `WITH CHECK` aufrufen — nicht nur API-seitig validieren.

## Bekannter, app-weiter Befund (nicht behoben, außerhalb jedes Paket-Scopes)

Beim manuellen Browser-Test von 013 aufgefallen, aber vorbestehend und app-weit: `useSession()`/`useScope()` (`apps/web/app/composables/`) sind laut eigenem Code-Kommentar serverseitig **grundsätzlich leer** — jede organisationsbezogene Seite rendert auf dem Server einen Leer-/Defaultzustand und korrigiert erst beim Client-Hydration, was in der Browser-Konsole als Vue-Hydration-Mismatch sichtbar wird (bestätigt auch in `layouts/default.vue`, nicht nur auf `/marke`). Funktional harmlos (Endergebnis nach Hydration korrekt), aber betrifft potenziell jede künftige UI-Änderung an einer authentifizierten Seite — nicht als neuen, paketspezifischen Bug missverstehen, falls er wieder auffällt. Eine echte Behebung braucht eine serverseitige Sitzungsauflösung (z. B. über einen Auth-Cookie) und ist ein eigenes, app-weites Vorhaben; ein Versuch mit `definePageMeta({ ssr: false })` zeigte keine Wirkung und wurde wieder verworfen. Details in `plans/013-marke-branding-assets-und-schriften.md`.

## Was 012 mitbringt (014/019/020/021 könnten darauf aufbauen)

- `social_connections` trägt jetzt Kanalbesitz (`owner_scope`: `organization` oder `department`, nie `team`), verantwortliche Person (`responsible_profile_id`), Vertraulichkeit (`confidential`), Zweck (`purpose`) und Archivierung (`archived_at`) — Tokens liegen **nicht** mehr in dieser Tabelle, sondern in `social_connection_secrets` (kein Grant, keine Policy für `authenticated`).
- `channel_scopes`: explizite Freigabe eines Kanals für eine Organisations-/Abteilungs-/Team-Ebene, mit `can_schedule`. Ein Kanal ohne Eintrag ist für niemanden bespielbar. Schreibend nur über RLS, die den **Kanalbesitz** prüft, nicht die Ziel-Scope-Berechtigung.
- `resolveAvailableChannels` (`packages/domain`) spiegelt die Auflösungsregel für Oberfläche/API-Vorabprüfung; die tatsächliche Durchsetzung bleibt in `public.schedule_publication` (SQL), die um Kanal-Freigabe-, Status- und Verantwortlichkeitsprüfung erweitert wurde.
- `department_admin` hat jetzt `social_account.manage` (fehlte vorher komplett — ohne diese Berechtigung hätte keine abteilungsscoped Rolle je einen abteilungseigenen Kanal verwalten können).
- Meta-OAuth ist vollständig implementiert (`RealMetaOAuthClient`/`FakeMetaOAuthClient` in `packages/publishing`, Connect-Start/Callback/Kontoauswahl in `apps/api`), aber **nie gegen ein echtes Meta-Testkonto gelaufen** — App Review ist weiterhin ein externes Gate.
- Kein Scheduler für Token-Ablaufprüfung/Schlüsselrotation — dieselbe Lücke wie `mark_stalled_approval_stages()` aus 011 (Paket 004, Hatchet-Produktionsintegration, weiterhin „in Arbeit“). `public.flag_channels_needing_reconnect()` und `public.cleanup_expired_oauth_state()` existieren fertig, nur für `service_role` aufrufbar, warten auf einen Cron.
- `packages/config`: `PUBLISHING_PROVIDER` ist jetzt `'fake' | 'meta'` mit `META_APP_ID`/`META_APP_SECRET`/`META_GRAPH_VERSION`/`META_OAUTH_REDIRECT_URL`. Mixpost ist vollständig entfernt.

## Kritischer Punkt aus 012, projektweit relevant (ergänzt den Fund aus 011)

Bei jeder neuen `security definer`-RPC mit `grant … to authenticated` weiterhin fragen: übernimmt sie sicherheitsrelevante Werte vom Aufrufer statt sie selbst herzuleiten? In 012 kamen zwei **verwandte, aber neue** Fundarten dazu, beide erst beim eigenen Review der neuen RLS-Policies gefunden, nicht in der ursprünglichen Umsetzung bedacht:

1. **Fehlende Permission statt fehlender Prüfung**: `department_admin` hatte `social_account.manage` schlicht nicht in seiner Permission-Liste (weder TS noch SQL) — eine Lücke im Rollenmodell, keine fehlerhafte Prüfung. Bei jedem neuen Paket, das einer Abteilungsrolle eine neue Fähigkeit gibt, `packages/authorization` **und** das SQL-Gegenstück (`authz.has_department_permission`) zusammen prüfen — beide sind bewusst dupliziert, aber genau deshalb leicht einseitig zu vergessen.
2. **RLS-Unterabfragen unterliegen selbst RLS**: `channel_scopes_insert`s `EXISTS`-Bedingung fragte `social_connections` ab, um den Kanalbesitz zu prüfen — aber diese Unterabfrage lief unter der Rolle des Aufrufers und damit unter `social_connections`' **eigener** `SELECT`-Policy. Die verlangte eine Organisationsrolle (`is_organization_member`), wodurch ein reiner Abteilungsadmin die Existenzprüfung für seinen **eigenen** Kanal nie bestand. Bei jeder neuen RLS-Policy, die per `EXISTS`/`JOIN` eine andere Tabelle abfragt: prüfen, ob der vorgesehene Aufrufer diese Tabelle laut deren eigener Policy überhaupt lesen darf — sonst schlägt die äußere Policy für genau die Person fehl, für die sie gedacht war.

## Die Inhalts-Pipeline fehlt weiterhin — betrifft weiterhin 012 und vor allem 016

Kein Code im Repository erzeugt einen `post`/eine `post_version` aus einer `submission` — Pakete 001–007 (LLM-Entwurf, Rendering) sind laut `plans/README.md` weiterhin „in Arbeit“. Das war eine bewusste, vorab geklärte Scope-Entscheidung für 011 (nicht vorziehen), die 012 unverändert übernommen hat. Konsequenzen:

- `resolveAvailableChannels`/`GET /v1/post-versions/:id/available-channels` existieren, haben aber noch **keinen Aufrufer** — die Kanalauswahl beim Einplanen eines Beitrags ist erst sinnvoll baubar, sobald es einen echten Beitrag gibt, der eingeplant wird.
- `post_versions.effective_config_snapshot` bleibt strukturell ungefüllt.
- `/beitraege` und `/freigaben` zeigen weiterhin ehrliche Leerzustände statt Fakedaten.
- Wer **016** umsetzt: der Funnel „Entwurf → Freigabe → veröffentlicht“ hat noch keine echten Nutzungsdaten.
- Der End-to-End-Test „Beitrag einplanen und über einen echten Kanal veröffentlichen“ bleibt nur über direkte DB-/RPC-Eingriffe durchführbar, nicht über den echten Produktpfad — bestätigt in 012s eigener Verifikation (pgTAP/API-Tests bauen Posts direkt in `approved`-Status, nicht über einen Submission-Pfad).

## Offener sicherheitsrelevanter Punkt aus 011 (weiterhin ungeklärt)

`request_approval` prüft nicht, ob die vom Aufrufer genannten Prüfer die in der Richtlinie **konfigurierten** sind — nur Struktur, Vereinsmitgliedschaft und das Vorhandensein der Minderjährigenstufe. `plans/024-freigaberoute-neu-aufloesen.md`, Abschnitt 2, stellt die beiden Auswege gegenüber (Routenauflösung in SQL nachbauen, oder Grant auf `service_role` zurücknehmen und in Fastify durchsetzen) — die Entscheidung gilt für `request_approval` und die geplante Neuauflösungs-RPC gemeinsam. **Vor 024 zu klären, und vor dem ersten echten Verein mit Minderjährigen-Inhalten.**

## Bewusst offen gelassene Punkte aus 011 (unverändert)

- `submit_requires_permission` existiert als Spalte, hat aber keine Bedeutung.
- Benachrichtigung der Prüfer (E-Mail, Bündelung, Realtime-Badge) und der tägliche „Stufen als stalled markieren“-Job sind nicht gebaut — kein Scheduler vorhanden.
- Eine tatsächlich blockierte Freigaberoute lässt sich noch nicht auflösen — Paket 024.
- `ReviewerRefSchema.role` validiert nicht, dass die Rolle zum jeweiligen `kind` passt. `scheduledFor` erlaubt ein Datum in der Vergangenheit. `allowedChannelIds` prüft nur UUID-Syntax, nicht Existenz.

## Vorgehen je Arbeitspaket

Arbeite **ein Paket zu Ende**, bevor du das nächste anfängst.

### Phase 1 — Plan gegen den Code verifizieren (parallel)

Pläne zitieren konkrete `file:line`-Stellen. Vor dem Bauen mehrere Agents parallel prüfen lassen, ob diese Aussagen noch stimmen — pro Agent ein Abschnitt „Ausgangslage und Evidenz“, Meldung je Behauptung: bestätigt, verschoben, oder falsch. Weicht etwas ab: zuerst den Plan aktualisieren und mir sagen, was sich geändert hat, bevor gebaut wird.

### Phase 2 — Umsetzen

`EnterWorktree` vor der ersten Codeänderung, ein Branch je Paket. Migration → Domain → API → Oberfläche → Rückbau ist überwiegend seriell. Parallelisierbar: reine Domainfunktionen mit Tests sobald das Modell feststeht, pgTAP-Tests parallel zur Migration, Oberflächenarbeit sobald die Contracts fest sind. **Nicht** parallel: zwei Agents an derselben Migrationsdatei, an `packages/contracts/src/index.ts` oder `packages/domain/src/index.ts`.

### Phase 3 — Adversarial prüfen (parallel, unterschiedliche Blickwinkel)

1. **Mandantentrennung** — `organization_id` auf jeder neuen Tabelle, zusammengesetzte Fremdschlüssel, positive **und** negative RLS-Tests. Bei jeder neuen `security definer`-RPC mit `grant … to authenticated` zusätzlich prüfen, ob sie sicherheitsrelevante Parameter vom Aufrufer übernimmt, statt sie selbst herzuleiten. Bei jeder neuen RLS-Policy mit `EXISTS`/`JOIN` gegen eine andere Tabelle: prüft der vorgesehene Aufrufer laut deren **eigener** Policy überhaupt diese Tabelle (siehe Fund aus 012 oben)? Bei jeder FK-Spalte, die wahlweise auf eine vereinsweite oder eine untergeordnete (abteilungs-/team-eigene) Zeile zeigen darf: hat die `WITH CHECK`-Klausel eine eigene Selectability-Prüfung per `security definer`-Funktion, oder verlässt sie sich nur auf eine API-seitige Vorabvalidierung (siehe Fund aus 013 oben)?
2. **Rechte** — kommt jemand an Aktionen/Daten, die der Plan ausdrücklich verwehrt? Bekommt jede Rolle, die laut Plan etwas verwalten soll, die dafür nötige Permission auch tatsächlich in **beiden** Permission-Tabellen (TS und SQL)?
3. **Geheimnisse** — Token, Elternkontakt, Einwilligung, Provenienz-Felder (`updated_by`/`granted_by`/`created_by`): landen sie in einem `select` für `authenticated`, der breiter ist als nötig?
4. **Verträge** — jede Systemgrenze mit Zod, Grenzfälle abgedeckt, jeder SQL-Fehlerpfad auf einen sinnvollen HTTP-Status gemappt (nicht nur die Fehlerpfade, die beim ersten Test auftauchen).
5. **Rückbau** — jeder Inventar-Eintrag erledigt, kein erfundener Wert durch Null/Platzhalter ersetzt.

Ein Fund gilt erst als echt, wenn reproduzierbar. Unklare Funde von einem zweiten Agent widerlegen lassen.

### Phase 4 — Manueller Browser-Test bei UI-Änderungen

`run-web`-Skill nutzen. Nicht nur auf grüne Tests verlassen. `apps/api` braucht dafür ein eigenes `.env` im Worktree (aus dem Haupt-Checkout kopieren, `SECRET_BOX_KEYS`/`SECRET_BOX_CURRENT_KEY_VERSION` ergänzen, falls noch nicht vorhanden) — nach dem Test wieder löschen.

## Definition of Done je Paket

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Bei Datenbankänderungen zusätzlich:

```bash
pnpm db:start && pnpm db:reset && pnpm db:test
```

Alles muss grün sein. Danach Statuswert in `plans/README.md` auf `erledigt` setzen, Rückbau-Inventar abhaken, abhängige Pläne (die auf dieses Paket verweisen) mit dem tatsächlichen Ergebnis aktualisieren — siehe wie 011 dies für 012/016 nachgezogen hat und 012 für 006/009/014/023.

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
- Squash-Merges ändern die Commit-SHA auf `main`. Vor dem Erstellen einer PR für ein neues Paket prüfen, ob die eigene Branch-Historie noch auf dem echten `main` aufsetzt (`git log --oneline origin/main -3` gegen die eigene Historie) — sonst zeigt die PR den Diff des bereits gemergten Vorgänger-Pakets erneut. Im Zweifel `git rebase --onto origin/main <alter-Basis-Commit> HEAD`, bevor gepusht/die PR erstellt wird.

## Offene Entscheidungen

`plans/README.md` listet sie am Ende. Für 014/016 blockiert laut letztem Stand keine davon. Vor 014, 015 und 020 werden meine Antworten gebraucht (Drittsysteme-Anbindung, E-Mail-Versand, Einwilligungstext, Aufbewahrungsfristen), bei 021 alles, was Geld betrifft. Frag gezielt nach, statt eine Annahme zu treffen.
