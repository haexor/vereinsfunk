# 025 – Inhalts-Pipeline schließen: Entwurfserzeugung und Veröffentlichung ausführen

## Ergebnis

`POST /v1/submissions` erzeugt bei vollständigem Quellmaterial tatsächlich einen `post`/eine `post_version` — nicht mehr nur eine Vorschau. Das bereits fertige Freigabegate (Paket 011), die Einwilligungsprüfung (015) und der Kalender (019) haben damit erstmals echte Daten zum Zeigen. Ein neuer Endpunkt führt eine freigegebene, fällige Veröffentlichung tatsächlich aus: `SocialPublisher.publish()` (Paket 006, bisher nirgends aufgerufen) wird über eine sichere, kurzlebige Medienübergabe angebunden.

> **Abgleich mit Paket 032 (2026-08-10)**: Paket 032 baut eine getrennte Kandidaten-/Provenienzgrundlage für spätere KI-Revisionen, verändert diesen synchronen Legacy-Entwurfspfad aber nicht. Ein externer LLM-Aufruf bleibt bis zum Abschluss von Paket 004 ausschließlich ein Blocker, nie ein Fastify-Shortcut.

## Ausgangslage und Evidenz

Fünf parallele Recherche-Agents haben unabhängig denselben Befund direkt am Code verifiziert (Sitzung vom 2026-08-08, gegen `main` nach Merge von PR #24/Paket 015):

- `POST /v1/submissions` (`apps/api/src/app.ts:1440-1589`) persistiert echt in `submissions`, ruft danach `new FakeContentGenerator().generate(input)` (reine Funktion, `packages/content-engine/src/index.ts:21-44`) und `orchestrator.trigger('process-submission', …)` (`FakeOrchestrator`, In-Memory-Map, `packages/orchestration/src/index.ts:8-11`) auf. Das generierte Ergebnis geht ausschließlich als `preview` an den Client zurück.
- Selbst mit echtem Hatchet-Worker: `apps/worker/src/workflows.ts` `processSubmission` ruft `context.enqueueDraft(...)` — eine Interface-Methode ohne jede Implementierung im gesamten Repository (nur ein `vi.fn()`-Mock im Test). `apps/worker/src/index.ts` startet `createHatchetWorker()` ohnehin nie.
- Repo-weite Suche nach `insert into public.posts` / `insert into public.post_versions` (SQL und Supabase-Client-Syntax) ergibt außerhalb von pgTAP-Testfixtures **keinen einzigen Treffer**.
- Tabellen `posts`, `post_versions`, `post_variants`, `media_assets`, `face_regions`, `consent_records`, `media_derivatives`, `post_media`, `approval_media_snapshots`, `publications`, `publication_attempts`, `publication_media_grants` existieren bereits vollständig (`supabase/migrations/202608020001_initial_tenant_foundation.sql`, `202608030001_content_media_workflows_publishing.sql`) — **dieses Paket braucht keine neue Migration**, nur Anwendungscode.
- `assertGroundedPost`/`createGroundedContentBrief` (`packages/content-engine/src/index.ts:10-18,47-50`) existieren fertig, werden aber nirgends aufgerufen.
- `request_approval` (`2026080606_policies_and_review_routes.sql:775`) verlangt `post.status in ('draft_ready', 'rendering', 'changes_requested')` — der neue Entwurf muss also exakt in `draft_ready` enden.
- `schedule_publication` (`2026080701_channel_scoping_and_secrets.sql:286`, überschreibt die Fassung aus `2026080606`) prüft `post.status = 'approved'`, Kanal-Scope, `effective_config_snapshot->'config'->'allowedChannelIds'` und Kontingente, legt dann eine `publications`-Zeile (`status='queued'`) an und setzt `posts.status = 'scheduled'`. **Danach passiert nichts mehr** — kein Code ruft je `SocialPublisher.publish()` auf (bestätigt durch Repo-weite Suche nach `.publish(`, `MetaPublisher`, `SocialPublisher` in `apps/api`/`apps/worker`).
- **Kritischer Fund beim Nachvollziehen des Schreibpfads**: `GET /v1/post-versions/:id/available-channels` (`apps/api/src/app.ts:4915-4916`) und `schedule_publication` lesen `effective_config_snapshot->'config'->'allowedChannelIds'` — also `config.allowedChannelIds` **direkt**, nicht `config.policies.allowedChannelIds`. Die tatsächliche `EffectiveConfig`-Struktur (`packages/domain/src/index.ts:47-69`, `resolveScopedEffectiveConfig` in `apps/api/src/app.ts:2793-2796`) verschachtelt `allowedChannelIds` aber unter `.policies`. Da bisher nichts `effective_config_snapshot` beschreibt, wurde dieser Mismatch nie ausgelöst. Würde die Spalte naiv mit der echten `EffectiveConfig`-Verschachtelung befüllt, würde `schedule_publication`s Kanal-Beschränkung **stillschweigend wirkungslos** (jede Kanal-ID wäre erlaubt, weil `allowed_channels is not null` fehlschlägt). Dieses Paket muss die Spalte deshalb geflacht befüllen (siehe Umsetzung Abschnitt 1).
- `FakePublisher.validate()`/`MetaPublisher.validate()` (`packages/publishing/src/index.ts:12,22`) lehnen **unconditional** jede Veröffentlichung ohne mindestens ein Medium ab (`input.media.length === 0` → Fehler), unabhängig von der Plattform. Da die Upload-/Freigabe-Pipeline (Pläne 002/003) weiterhin nicht existiert, hat jeder aus diesem Paket entstehende `post_version` null `post_media`-Zeilen — ein echter Veröffentlichungsversuch schlägt deshalb *korrekt* mit „At least one approved derivative is required" fehl. Das ist erwartetes Verhalten, kein Fehler dieses Pakets.
- `publication_media_grants` (Tabelle bereits vorhanden, `select`-Policy `using (false)` für `authenticated`) hat keine servierende Route — nichts liest/schreibt diese Tabelle bisher.
- `posts`/`post_versions`/`post_variants`/`publications`/`publication_attempts`/`publication_media_grants` haben keine `insert`/`update`-Policy für `authenticated` (nur `select`); Schreibzugriff läuft wie bei `directory_people`/`fixtures`/`consent_records` ausschließlich über die API mit Service Role nach `requirePermission`.

## Scope

- `apps/api/src/app.ts`: `POST /v1/submissions` um echte Entwurfserzeugung erweitern (Teil A); neuer Endpunkt `POST /v1/publications/:id/execute` (Teil B); neuer öffentlicher Endpunkt `GET /v1/media-grants/:token` (Teil B).
- `packages/config/src/index.ts`: neues Feld `API_PUBLIC_BASE_URL` (Pflicht bei `PUBLISHING_PROVIDER=meta`), analog zu den bestehenden `META_*`-Pflichtfeldern.
- `packages/contracts/src/index.ts`: Response-Schema für den neuen Publish-Execute-Endpunkt.
- Tests in `apps/api/src/app.test.ts`, ggf. `packages/content-engine`.

Nicht enthalten (bewusst, siehe Begründung je Punkt unten): Medien-Gate als echter Blocker in `decide_approval_stage`/`schedule_publication` (vom Nutzer für dieses Paket ausdrücklich ausgeschlossen), `assertApprovalSnapshot`-Verdrahtung (keine Grundlage ohne echte Medien), echtes LLM, echte Gesichtserkennung/-verdeckung, Hatchet-Cron/echter Worker-Betrieb, Meta-App-Review/Sandbox-Livetest (keine echten Zugangsdaten in dieser Umgebung).

## Umsetzung

### 1. Entwurfserzeugung in `POST /v1/submissions`

Nach dem bestehenden `insert` in `submissions` und `FakeContentGenerator().generate(input)`, nur wenn `accepted.status === 'queued'` (vollständige Fakten):

- `const brief = createGroundedContentBrief(input); assertGroundedPost(generated, brief)` — Sicherheitsnetz, wirft bei ungegroundeten Aussagen (mit `FakeContentGenerator` deterministisch nie der Fall, aber die Invariante aus Plan 001 wird damit erstmals durchgesetzt statt nur definiert).
- **`effective_config_snapshot` geflacht befüllen**: `{ config: { tone: config.tone, goals: config.goals, hashtags: config.hashtags, ...config.policies } }` — nicht die unveränderte `EffectiveConfig`-Verschachtelung. Begründung: siehe Ausgangslage, sonst stiller Policy-Bypass in `schedule_publication`.
- Mit Service Role (`supabaseClients.forService()`, `posts`/`post_versions` haben keine Insert-Policy für `authenticated`): `posts`-Zeile anlegen (`status='draft_ready'`, `submission_id`, `created_by`), dann `post_versions`-Zeile v1 (`source_facts_snapshot = input.sourceMaterial`, `title = generated.headline`, `caption`, `call_to_action`, `hashtags`, `alt_text`, `safety_flags = generated.safetyFlags`, `created_by_type = 'llm'`, `created_by_user_id = null`), dann `posts.current_version_id` auf die neue Version setzen (deferred FK, in derselben Transaktion zulässig).
- Für jede `generated.variants`-Zeile einen `post_variants`-Datensatz anlegen (`variant` = das vollständige `PlatformVariant`-Objekt, `schema_version='1'`, `prompt_version=generated.templateId`). Kein Zwischenzustand `generating` wird persistiert — die Erzeugung ist synchron und augenblicklich, ein eigener gespeicherter Übergangszustand dafür wäre erfundene Granularität.
- Antwort um `postId`/`postVersionId` ergänzen (Response-Schema entsprechend erweitern), damit die Oberfläche direkt zur Freigabe-Anfrage verlinken kann — kein UI-Umbau in diesem Paket, nur der API-Vertrag.
- Bleibt `accepted.status === 'facts_required'`: unverändertes Verhalten, kein Entwurf.

**Design-Entscheidung, hier dokumentiert**: `post_variants` werden befüllt, weil das Datenmodell sie erwartet und `generated.variants` sie bereits vollständig liefert — aber der Veröffentlichungsschritt (Teil B) liest Caption/Hashtags/Alt-Text direkt von `post_versions`, nicht von `post_variants`. Welche Variante/welches Format zu welcher Veröffentlichung gehört, ist Teil des noch fehlenden Kreativsystems (Plan 005) und würde hier eine Entscheidung ohne Grundlage erzwingen.

### 2. Veröffentlichung ausführen: `POST /v1/publications/:id/execute`

Kein Hatchet-Scheduler verfügbar (siehe Ausgangslage) — dieser Endpunkt ist ein expliziter, synchron ausgeführter Trigger, nach demselben Muster wie der bestehende `POST /v1/integration-sources/:id/sync`. Er führt eine **fällige** Veröffentlichung tatsächlich aus, plant aber nichts automatisch zu einem künftigen Zeitpunkt — das bleibt wie mehrfach dokumentiert dem Hatchet-Cron aus Paket 004 vorbehalten.

- `requireAuth`, dann `publications`/`post_versions`/`posts` per Service Role laden (Kette wie bei `available-channels`), `requirePermission('post.publish', {organizationId, departmentId})`.
- `scheduled_for is not null and scheduled_for > now()` → `409 not_due_yet`. `status !== 'queued'` → `409 invalid_status` (bereits ausgeführt/fehlgeschlagen/in Arbeit; kein automatischer Retry hier).
- Compare-and-Set: `update publications set status='uploading' where id=$1 and status='queued'` — genau ein gewinnender Aufruf bei gleichzeitigen Versuchen (dieselbe Lehre wie `schedule_publication`s Advisory Lock, hier reicht CAS statt Lock, da nur eine Zeile betroffen ist).
- `post_media`/`media_derivatives` für die Version laden, pro Zeile einen `publication_media_grants`-Eintrag anlegen: zufälliges Token (32 Byte, base64url), `token_hash = sha256(token)` gespeichert (Rohtoken nie persistiert, analog zu den Einwilligungs-Tokens aus Paket 015), `expires_at = now() + 15 Minuten`. `grantUrl = ${API_PUBLIC_BASE_URL}/v1/media-grants/${token}`.
- `PublicationInput` bauen (`caption`/`altText` aus `post_versions`, `media` aus den Grants, `idempotencyKey = publications.idempotency_key`), `publisher.validate(input)` aufrufen. Ungültig → `publication_attempts`-Zeile (`status='failed'`, `error_class='validation'`), `publications.status='failed'`, `422` mit den Validierungsfehlern.
- Gültig → `publisher.publish(input)`. Erfolg: `publications.status='published'`, `provider_publication_id` setzen, `publication_attempts`-Zeile (`status='published'`). Fehler: Klassifikation nach Plan 004 (4xx-Provider-Antwort = `error_class='non_retryable'`, Netzwerk/5xx = `retryable`, unbekannt = `unknown`), `publications.status` entsprechend (`failed`/`action_required`), `publication_attempts`-Zeile mit `response_summary` (redigiert, keine Tokens).
- Bereits verwendete/abgelaufene Grants werden nach dem Aufruf (Erfolg oder endgültiger Fehlschlag) mit `revoked_at = now()` markiert.

### 3. Medienübergabe: `GET /v1/media-grants/:token`

Kein Login, kein `requireAuth` — Meta ruft diese URL serverseitig ab. Nach dem Muster der öffentlichen Einwilligungs-Token-Seiten aus Paket 015 (Rate-Limit, keine Unterscheidung zwischen ungültig/abgelaufen/bereits verwendet, Service Role für den Lookup, `token_hash`-Vergleich statt Rohtoken-Suche):

- Token hashen, `publication_media_grants` per `token_hash` laden. Kein Treffer, `revoked_at is not null` oder `expires_at < now()` → einheitlich `404`.
- `media_derivatives` laden (muss `status='ready'` sein, sonst `404`), Bytes aus dem privaten Storage-Bucket lesen, mit korrektem `content-type`/`content-length` ausliefern. Kein Directory-Listing, keine anderen Felder.
- `accessed_at` beim ersten erfolgreichen Abruf setzen (Audit-Spur, kein Widerruf allein dadurch — der Grant bleibt bis TTL/expliziter Widerruf gültig, falls Meta erneut abruft).

### 4. Konfiguration

`packages/config/src/index.ts`: `API_PUBLIC_BASE_URL: optionalUrl`, in die `PUBLISHING_PROVIDER='meta'`-Pflichtfeldliste aufgenommen (analog `META_APP_ID` etc.) — ohne diese URL kann Meta nie auf die Grant-Route zugreifen.

## Tests und Verifikation

```bash
pnpm --filter @vereinsfunk/config test
pnpm --filter @vereinsfunk/api test
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm db:start && pnpm db:reset && pnpm db:test
```

Keine neue Migration, aber `db:test` läuft trotzdem gegen den vollen Stand. Manueller Test (`run-web`-Skill): Beitrag über `erstellen.vue` einreichen → Freigabe über `freigaben.vue` (Paket 011, jetzt mit echten Daten) → Einplanen. Für den Veröffentlichungs-Endpunkt selbst: ohne echte Medien schlägt der Aufruf korrekt mit `422`/`At least one approved derivative is required` fehl — end-to-Ende-Erfolg nur durch einen händisch per SQL eingefügten `media_derivative`/`post_media`-Datensatz verifizierbar (gleiches Vorgehen wie beim Kalender-Test aus Paket 019, keine erfundene Produktionsdatenquelle).

## Done-Kriterien

- Ein vollständig eingereichter Beitrag erzeugt echte `posts`/`post_versions`/`post_variants`-Zeilen mit korrektem `effective_config_snapshot` und `status='draft_ready'`.
- `request_approval` funktioniert end-to-end mit einem so erzeugten Beitrag (bisher nur per pgTAP-Fixture nachgestellt).
- `POST /v1/publications/:id/execute` ruft `SocialPublisher.publish()` tatsächlich auf, mit korrekter Idempotenz (CAS), Fehlerklassifikation und `publication_attempts`-Aufzeichnung.
- `GET /v1/media-grants/:token` liefert ausschließlich das referenzierte, freigegebene Derivat, zeitlich begrenzt, ohne Unterscheidung zwischen den Fehlerfällen.
- Kein Token/keine Rohmedien-URL landet in Logs oder Client-Antworten außerhalb der kurzlebigen Grant-URL selbst.

## STOP-Bedingungen

- `effective_config_snapshot` würde ohne die geflachte Form geschrieben: sofort stoppen, das ist ein Policy-Bypass, keine Stilfrage.
- Ein Veröffentlichungsversuch mit vorhandenen Medien schlägt aus einem anderen Grund als fehlender Freigabe/abgelaufenem Token fehl: vor Rollout klären, nicht als Kollateralschaden hinnehmen.

## Pflegehinweis

Sobald Plan 002/003 (Upload, Freigabegate, Gesichtsverdeckung) echte `media_derivatives` erzeugen, wird `POST /v1/publications/:id/execute` ohne weitere Änderung erfolgreich Medien mitschicken — dieses Paket baut den Mechanismus bewusst so, dass er dann sofort greift, statt eine zweite Anpassung zu brauchen.

## Umsetzung: Ergebnis und Abweichungen vom Plan

Wie geplant umgesetzt, keine neue Migration nötig — alle sechs beteiligten Tabellen (`posts`, `post_versions`, `post_variants`, `publications`, `publication_attempts`, `publication_media_grants`) existierten bereits additiv aus einer frühen, ungenutzten Migration (`202608030001_content_media_workflows_publishing.sql`).

- **`POST /v1/submissions`** legt bei vollständigem Quellmaterial jetzt echt `posts`/`post_versions`/`post_variants` an (Service Role, `status='draft_ready'`, `created_by_type='llm'`), ruft vorher `assertGroundedPost` auf und gibt `postId`/`postVersionId` in der Antwort zurück. Manuell im Browser verifiziert: `erstellen.vue` → „Entwurf erstellen" erzeugte eine echte Zeile, `posts.current_version_id` korrekt gesetzt, `post_variants` mit vier Zeilen (zwei Formate × zwei Plattformen).
- **`effective_config_snapshot` wird geflacht geschrieben** (`{config: {...top-level Felder, ...policies-Felder}}`), nicht mit der unveränderten `EffectiveConfig`-Verschachtelung — sonst hätte der erste echte Schreibzugriff die von `schedule_publication` und `GET /v1/post-versions/:id/available-channels` bereits gelesene, aber nie beschriebene Form verfehlt und die Kanal-Beschränkung aus 011/012 stillschweigend wirkungslos gemacht. Im Browser-Test bestätigt: `config.allowedChannelIds` liegt direkt (nicht unter `config.policies`).
- **`orchestrator`/`FakeOrchestrator`/`priorityToHatchet` aus `apps/api/src/app.ts` entfernt.** `POST /v1/submissions` war der einzige Aufrufer (`orchestrator.trigger('process-submission', …)`); mit der jetzt synchronen Entwurfserzeugung hätte der Trigger nichts mehr zu tun gehabt, was ein reales Hatchet-Setup nicht ohnehin schon synchron erledigt hätte — ein no-op-Aufruf wäre irreführender gewesen als seine Entfernung (`packages/orchestration` selbst bleibt unangetastet, für einen späteren echten Aufrufer).
- **`POST /v1/publications/:id/execute`** neu: lädt die fällige `publications`-Zeile, Compare-and-Set auf `status='uploading'`, entschlüsselt das Kanal-Token (`packages/secrets`, gleiches Muster wie `/v1/channels/:id/verify`), baut Medien-Grants für vorhandene `post_media`, ruft `SocialPublisher.validate()`/`.publish()` auf, schreibt `publication_attempts` und auditiert. Automatisiert getestet (7 Szenarien: not_found, forbidden, not_due_yet, CAS-Verlust, fehlendes Medium, Erfolg mit injiziertem `SocialPublisher`, Provider-Fehler) — ein Live-Test gegen die echte Meta-Sandbox ist in dieser Umgebung nicht möglich (keine Zugangsdaten), entspricht aber demselben, bereits vor diesem Paket akzeptierten Vorbehalt aus Plan 006.
- **Code-Review-Nachhärtung (PR #25)**: jeder Abbruch zwischen dem CAS-Claim und `publisher.publish()` gibt die Publikation wieder auf `status='queued'` frei (`releaseClaim`), statt sie dauerhaft in `uploading` hängen zu lassen; jeder abgeschlossene Versuch (422/200/502) widerruft die für ihn erzeugten `publication_media_grants` (`revokeGrants`); `attempt_number` wird als `max(attempt_number)+1` je `publication_id` ermittelt statt hartkodiert `1` (sonst hätte `unique(publication_id,attempt_number)` jeden zweiten Versuch verhindert); fehlt `API_PUBLIC_BASE_URL` bei vorhandenen Medien, bricht der Endpunkt vor der Grant-Erzeugung mit `503` ab, statt eine `undefined/…`-Grant-URL anzulegen. Die in Abschnitt 2 verlangte Fehlerklassifikation nach Plan 004 (4xx=`non_retryable`/`failed`, 5xx=`retryable`/`action_required`, unbekannt=`unknown`/`action_required`) ist umgesetzt, aber mit einer dokumentierten Grenze: `SocialPublisher.publish()` liefert keinen strukturierten Fehler, `MetaPublisher` kodiert den HTTP-Status nur als Textfragment `(404)` im Fehlertext — die Klassifikation parst dieses Fragment per Regex aus der Fehlermeldung, statt das `SocialPublisher`-Interface um einen typisierten Fehler zu erweitern (das hätte auch `FakePublisher` und künftige Provider-Adapter betroffen und war nicht Teil des mit dem Nutzer abgestimmten Umfangs dieses Reviews). `GET /v1/media-grants/:token` hat jetzt dasselbe Rate-Limit-/Header-Muster wie die Einwilligungs-Token-Seiten aus 015 (`checkRateLimit`, `X-Robots-Tag`, `X-Content-Type-Options`). `MetaPublisher.publish()` bricht nach 15s per `AbortSignal.timeout` ab, statt den Request unbegrenzt offen zu halten. Ein fehlgeschlagener `post_versions`/`post_variants`-Insert in `POST /v1/submissions` löscht jetzt die zuvor angelegte `posts`-Zeile wieder, statt einen `draft_ready`-Post ohne jede Version zurückzulassen.
- **`GET /v1/media-grants/:token`** neu, nach dem Muster der öffentlichen Einwilligungs-Token-Seiten aus 015 (Hash- statt Rohtoken-Vergleich, keine Unterscheidung zwischen den Fehlerfällen, Service Role).
- **Bestätigt, nicht behoben (bewusst außerhalb des mit dem Nutzer abgestimmten Umfangs)**: `evaluateMediaGate`/`computeMediaGateBlockersForPostVersion` bleiben rein informativ für Reviewer, nicht als echter Blocker in `decide_approval_stage`/`schedule_publication` verdrahtet. `assertApprovalSnapshot` bleibt unverdrahtet — ohne echte Medien keine sinnvolle Grundlage.
- **Nebenbefund, nicht behoben (außerhalb des Scopes)**: `erstellen.vue`s „Zur Freigabe geben"-Button navigiert nur zu `/freigaben`, ruft aber `request_approval` nicht auf — die Freigabeanfrage selbst braucht weiterhin einen eigenen, nicht gebauten UI-Trigger. Damit bleibt `freigaben.vue` auch nach diesem Paket leer, bis dieser Trigger existiert; das erzeugte `post_versions`-Objekt selbst ist aber jetzt real und mit `request_approval` direkt nutzbar (mit `curl`/einem künftigen UI-Trigger verifiziert, nicht mit einem eigenen Oberflächenumbau, der nicht Teil dieses Pakets war).
- **`GeneratedPost.callToAction`/`.hashtags`/`.altText` sind für alle Formate/Plattformen identisch** (Fake-Generator liefert dieselben Werte für jede Variante) — `post_versions` übernimmt sie einmalig von der ersten Variante; das ist keine Regression dieses Pakets, sondern eine bereits vorher bestehende Grenze des Fake-Generators (Plan 005 löst das erst mit einem echten, plattformspezifischen LLM-Adapter).
