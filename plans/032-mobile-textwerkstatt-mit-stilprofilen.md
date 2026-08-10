# Plan 032: Eine mobile Textwerkstatt mit Stilprofilen sowie Foto- und Video-Anhang liefern

> **Executor instructions**: Folge diesem Plan vollständig. Die Werkstatt ist ein neuer, versionsgebundener Content-Pfad; sie darf weder die Faktenbindung noch die Unveränderlichkeit freigegebener Versionen abschwächen. Nach jedem Schritt die angegebene Prüfung ausführen. Bei einer STOP-Bedingung anhalten und berichten, nicht improvisieren.
>
> **Drift check (run first)**: `git diff --stat 5fccd6fa..HEAD -- apps/api/src apps/web/app packages/content-engine/src packages/contracts/src packages/domain/src packages/authorization/src supabase/migrations supabase/tests docs/adr docs/product`

## Status

- **Implementation note (2026-08-10)**: Teilphase 1 ist umgesetzt: additive Verträge, die tenant-sicheren Tabellen `content_style_profiles`, `composition_sessions`, `composition_session_media`, `generation_candidates` und `post_generation_provenance`, kontrollierte Kompressionsprovenienz, RLS-/Negativtests sowie ADR-010. Die neue Textwerkstatt ist **nicht aktiv**, weil Plan 004 keinen funktionierenden transaktionalen Outbox-/Worker-Pfad und Plan 002 keinen echten privaten Upload-/Normalisierungs-/Freigabegate-Pfad bereitstellt. Es wurde bewusst kein synchroner LLM-Shortcut, kein Original-Anhang und keine UI-Halbfunktion eingeführt.
- **Produktentscheidung geändert (2026-08-11)**: Das ursprüngliche Verbot der Personenimitation ist zurückgenommen (Betreiberentscheidung). Stilprofile dürfen jetzt eine reale Person benennen und imitieren -- kuratiert (Plattform) oder selbst angelegt (Verein). Absicherung erfolgt organisatorisch über Rollenvergabe und die bestehenden Freigaberouten (Plan 011/024), nicht technisch. Der zugehörige Zod-Refine und die zwei DB-CHECKs auf `content_style_profiles.name`/`description` sind entfernt; die Details stehen im Abschnitt "Produktentscheidung" unten.
- **Priority**: P1
- **Effort**: L
- **Risk**: MED — berührt LLM, private Medien, neue Mandantendaten und den Freigabeweg
- **Depends on**: 002-private-media-consent-and-approval-gate.md, 004-hatchet-production-orchestration.md, 025-inhalts-pipeline-entwurf-und-veroeffentlichung.md, 030-reviewer-snapshot-ohne-autor.md
- **Category**: direction, migration, tests
- **Planned at**: commit `5fccd6fa`, 2026-08-10

## Ergebnis

Vereinsfunk erhält eine mobile-first Textwerkstatt als primären Einstieg: Ein Redakteur schreibt Stichpunkte, unvollständige Sätze oder einen vorhandenen Text, hängt optional Fotos oder ein eigenes Video an, wählt Ziel, Plattformen und einen Stilmodus und erhält einen faktengebundenen Textentwurf. Er kann diesen direkt bearbeiten oder mit einer kurzen Änderungsanweisung eine weitere KI-Runde starten. Erst das bewusste Übernehmen erzeugt eine neue unveränderliche `post_version`; anschließend läuft der vorhandene Freigabe- und Publishingpfad unverändert weiter.

Die erste Auslieferung erstellt ausschließlich den **Text** eines Beitrags. Sie kann ihn mit optionalen Fotos oder einem nutzerhochgeladenen Video verbinden, erzeugt aber weder Bilder noch Videos und übermittelt keine Medien an das LLM. Für sichtbare Medieninhalte liefert der Mensch nötigen Kontext als Text; so bleiben Datenschutz, Faktenbindung und Qualität nachvollziehbar.

## Produktentscheidung: Kreativität ohne AI-Slop, mit kuratierten und selbst angelegten Persona

Die Oberfläche bietet fünf kuratierte, attributbasierte Stilmodi: `klar_erklaerend`, `warm_gemeinschaftlich`, `lebendig_sportlich`, `leicht_humorvoll` und `feierlich_wertschaetzend`. Jeder Modus wird als sichtbares Stilprofil beschrieben (z. B. Satzlänge, Perspektive, Energie, Humor, CTA-Stärke), nicht als versteckter Prompt. Die Plattform ergänzt diese Basis-Modi künftig um ein kuratiertes Set benannter Persona (z. B. eine historische oder öffentliche Persönlichkeit) als weitere `kind=system`-Registry-Einträge -- der konkrete Persona-Katalog ist eine eigene inhaltliche Kuration (ggf. inkl. Rechteprüfung) und nicht Teil dieses Fundaments.

Organisationen können zusätzlich eigene Stilprofile anlegen, einschließlich eigener, selbst benannter Persona. Sie speichern Name, kurze Zielbeschreibung, Stilregeln, No-Gos und optional eine Inspirationsnotiz -- und dürfen dabei ausdrücklich eine reale Person benennen und imitieren, auch mit charakteristischen Formulierungen. Jedes Mitglied, das an einer Stelle Beiträge erstellen darf (`post.create`), darf dort auch eigene Stilprofile/Persona anlegen und nutzen -- dafür ist keine gesonderte Konfigurationsberechtigung nötig. Die Sichtbarkeit (vereins-, abteilungs- oder teamweit) folgt der bestehenden Scope-Struktur; ein selbst angelegtes Profil an einer Stelle zu ändern, an der man selbst nicht schreiben darf, bleibt Admin-Sache. Es gibt **keine** automatisierte Prüfung, die eine Imitation technisch unterbindet -- ein Keyword-Filter kann die Absicht eines Textes ohnehin nicht zuverlässig erkennen. Die Absicherung ist organisatorisch: Vereine vergeben die Rolle zum Erstellen/Veröffentlichen von Beiträgen nur an vernünftige Personen, und jeder Entwurf durchläuft die bestehende Freigaberoute (Plan 011/024) -- insbesondere wenn (jüngere) Mitglieder Beiträge einstellen, muss ein Trainer/Verantwortlicher vor Veröffentlichung freigeben und kann dort Entgleisungen stoppen. Ein Organisationsprofil kann die kuratierten Regeln nur präzisieren, nie Faktenbindung, Verbote oder Plattformlimits übersteuern.

Qualität wird als Produktfunktion behandelt: Der Generator muss konkrete Details aus dem Brief zuerst verwenden, leere Einleitungen und abgenutzte Social-Phrasen vermeiden, maximal eine CTA anbieten, keine Emoji-/Hashtag-Füllung erzeugen und bei dünner Faktenlage nachfragen statt ausschmücken. Der Nutzer sieht vor Übernahme eine kurze Qualitätskarte („belegte Details“, „offene Angaben“, „Stilprofil“, „bearbeitet durch KI“) und behält immer den manuellen Editor.

**Offen: KI-Kennzeichnungspflicht.** Ob und wie ein von der KI erzeugter oder überarbeiteter Text im veröffentlichten Beitrag selbst als KI-unterstützt gekennzeichnet werden muss (z. B. EU-KI-Verordnung Art. 50, Transparenzpflicht für synthetische Inhalte), ist rechtlich noch nicht abschließend geklärt. Für Video/Bild gilt eine Kennzeichnungspflicht als gesichert, für reinen Text ist das noch zu bestätigen. Solange das offen ist, darf keine Veröffentlichungsroute für Textwerkstatt-Entwürfe live gehen, ohne diese Frage vorher zu klären -- siehe „Done criteria“.

## Current state

- Teilphase 1 (`2026081003_text_workshop_foundation.sql`) hält Stilprofile, Kompositionssitzungen, zugehörige Asset-IDs, getrennte Generierungskandidaten und akzeptierte Versionsprovenienz mandantensicher vor. Historische `reel`-Werte bleiben lesbar; neue Kompositionsbefehle kennen nur `text_post|photo_post|video_post`. Die neue pgTAP-Datei testet erlaubtes Lesen, team-only Sichtbarkeit, Cross-Tenant- und direkte Browser-Write-Negativfälle sowie die reservierten System-Slugs, `communication_goal` und die `video_post`-Exklusivität; ein benannt-imitierendes Profil ist als Positivfall abgedeckt. Der zugehörige Test besteht separat; der vollständige bestehende `pnpm db:test`-Lauf scheitert unabhängig davon derzeit an Fixture-Kollisionen in `consent_management` und `metrics`.
- `apps/web/app/pages/erstellen.vue` ist derzeit ein dreistufiger, desktop-lastiger Wizard. Er kennt `reel` in `availableFormats`, akzeptiert `image/*,video/*`, lädt die ausgewählte Datei aber nicht hoch und kann nach der Vorschau nur zu `/freigaben` navigieren.
- `packages/contracts/src/index.ts:5-76` definiert `OutputFormatSchema` mit `feed_image|carousel|story|reel`, `CreateSubmissionSchema` und ein Zod-validiertes `GeneratedPostSchema`. Die Ausgabe ist bereits faktengestützt: `PlatformVariant.claimSourceIds` referenziert Quellen.
- `packages/content-engine/src/index.ts` besitzt `GroundedContentBrief`, `assertGroundedPost` und ausschließlich `FakeContentGenerator`. Der Fake-Text wiederholt Quellen als Aufzählung; ein produktiver Provideradapter fehlt. Die Plattformkonfiguration liegt verschlüsselt in `llm_provider_configurations`/`llm_provider_secrets` (Migration `2026080502_platform_administration.sql`), wird aber bislang nur vom Plattform-Admin verwaltet.
- `apps/api/src/app.ts:1331-1537` legt bei vollständigem Quellmaterial synchron eine `submission`, `posts`, `post_versions` und `post_variants` an. Jede erzeugte Version speichert bereits `source_facts_snapshot`, `effective_config_snapshot`, `created_by_type` und Auditdaten. Eine Bearbeitung bzw. KI-Revision einer vorhandenen Version gibt es nicht.
- `posts` und `post_versions` sind durch ADR-003 und das Schema (`supabase/migrations/202608020001_initial_tenant_foundation.sql:151-198`) versioniert; Freigaben referenzieren `post_version_id`. Jede inhaltliche Änderung muss folglich eine neue Version erzeugen und darf niemals eine bestehende Version aktualisieren.
- Die Tabellen für private Medien und deren Zuordnung (`media_assets`, `media_derivatives`, `post_media`, `approval_media_snapshots`) existieren seit `202608030001_content_media_workflows_publishing.sql`; `media_assets` hat bereits `mime_type`, Maße und `duration_ms`. Der echte Upload-, Normalisierungs- und Freigabegate-Pfad aus Plan 002 fehlt noch. `post_media` referenziert deshalb ausschließlich fertige Derivate, niemals Originale.
- `apps/worker` und die `workflow_outbox`/`workflow_runs`-Tabellen sind vorbereitet, werden aber noch nicht produktiv verwendet. ADR-002 erlaubt in Hatchet nur IDs, Revision, Correlation-ID und kleine technische Metadaten — niemals Inhalte, Fotos oder Secrets.
- `apps/web/app/pages/beitraege.vue` ist weiterhin ein Leerzustand, obwohl echte Posts seit Plan 025 entstehen. Ein Editor braucht dort eine echte Liste und einen Deep Link auf den Entwurf.

Verbindliche Architektur aus `AGENTS.md` und ADRs:

- Supabase bleibt fachliche Source of Truth; neue Mandantentabellen erhalten `organization_id`, zusammengesetzte Tenant-FKs, RLS und positive **und negative** Isolationstests (ADR-001).
- API und Worker sind die einzigen Orte mit Service Role. Zod validiert jede Systemgrenze.
- Private Medien bleiben privat (ADR-004). Freigaben bleiben versions- und derivatgebunden (ADR-003/006).
- Die KI formuliert ausschließlich aus bestätigten Fakten, Beobachtungen und freigegebenen Zitaten; offene Angaben werden nicht plausibel ergänzt (ADR-005).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Contract/content tests | `pnpm --filter @vereinsfunk/contracts test && pnpm --filter @vereinsfunk/content-engine test` | exit 0 |
| API/worker tests | `pnpm --filter @vereinsfunk/api test && pnpm --filter @vereinsfunk/worker test` | exit 0 |
| Web tests/typecheck | `pnpm --filter @vereinsfunk/web test && pnpm --filter @vereinsfunk/web typecheck` | exit 0 |
| Database isolation | `pnpm db:start && pnpm db:reset && pnpm db:test` | all pgTAP tests pass |
| Full gate | `pnpm check` | lint, typecheck, tests and build exit 0 |

## Scope

**In scope**

- additive Supabase migration(s), `supabase/tests/*` and an ADR for style profiles / generation provenance
- `packages/contracts`, `packages/content-engine`, `packages/domain`, API content routes and their tests
- completing the Plan-002 private upload/normalisation path, inklusive Video-Kompressionspipeline, wo sie für Foto- oder Video-Anhänge benötigt wird
- `apps/worker` generation/revision workflow and its tests after Plan 004 has provided outbox dispatch
- `apps/web/app/pages/erstellen.vue`, a new post-editor route, posts list, and focused components/composables under `apps/web/app/components/content` and `apps/web/app/composables`
- relevant product documentation and `plans/README.md`

**Out of scope**

- KI-Videoerzeugung, Remotion-Video-Renderings, Videoschnitt, automatische Untertitel, Audio-Generierung, TikTok oder YouTube
- image/video understanding by an LLM, face recognition, automated person matching or video face tracking
- a raw organisation-controlled system prompt that can override grounding, safety or platform rules
- automatic publication, changes to reviewer selection, or bypassing the existing approval policy
- a curated persona catalogue (which real people, licensing/rights review) -- only the capability for named, imitating style profiles is in scope here

## Target design and data contract

### 1. Composition session and text-first output

Introduce `text_post`, `photo_post` and `video_post` presentation choices. `text_post` means the caption itself is the deliverable; `photo_post` attaches approved image derivatives; `video_post` attaches one approved, user-provided video derivative while retaining a caption. Do not model text as an empty image format and do not call a user-uploaded video a Reel. Add a platform capability map behind the publishing interface so the eventual publisher validates text/photo/video support rather than globally requiring media. An incompatible selection must be shown before generation — for example Instagram text-only — rather than being silently converted into a graphic.

The creation request becomes a small composition-session command:

```ts
{
  organizationId, departmentId, teamId?, presetSlug, communicationGoal,
  requestedFormats: ['text_post' | 'photo_post' | 'video_post'],
  styleProfileId?, sourceMaterial, mediaAssetIds?: string[]
}
```

The client validates with Zod before sending; the API independently validates membership, `post.create`, asset ownership, asset readiness and scope. It stores the original input in `submissions` and only IDs in the outbox workflow. Existing historic formats/slugs remain readable; do not mutate old post data just to remove `reel`.

### 2. Style profiles and snapshots

Create `content_style_profiles` with `id`, `organization_id`, optional `department_id`/`team_id`, `slug`, `name`, `kind` (`system|custom`), `description`, `style_rules jsonb`, `avoid_rules text[]`, `is_active`, `created_by`, timestamps and `(organization_id,id)` plus tenant-safe scope FKs. The five system modes are registry data (`kind=system`), not duplicated rows. Custom profiles are tenant rows and use a fixed Zod schema, for example:

```ts
{ sentenceLength: 'short'|'mixed'|'long', energy: 1|2|3|4|5,
  humour: 'none'|'light', formality: 'casual'|'balanced'|'formal',
  perspective: 'we'|'club'|'you', bannedPhrases: string[],
  additionalInstructions: string /* max 1,000 chars */ }
```

`additionalInstructions` is a constrained editorial preference, not an executable system prompt -- it stays bounded and low-priority in prompt assembly so it can never override grounding, safety or platform rules, independent of what it names. Person-name fields and „write like …“ directives are explicitly allowed (Produktentscheidung above). The API resolves the closest allowed scope; anyone who holds `post.create` at that scope may create and use their own custom style profile there too -- creating a persona is not gated behind a separate configuration permission (e.g. `department.manage`). Editing/deleting a profile someone else created remains a scope-admin action.

When a draft is accepted, store a complete `style_profile_snapshot`, a `prompt_template_version`, the selected provider model identifier and provider configuration ID (not key), plus a deterministic input hash on the new `post_version` or a linked immutable `post_generation_provenance` record. Persist no raw provider prompt, original media bytes, secret or free-form chain-of-thought. The effective configuration snapshot continues to include content policy and required hashtags so an approved version is reproducible.

### 3. Generation and iteration contracts

Extend the content engine with a provider-neutral `StructuredContentGenerator`. It receives only `GroundedContentBrief`, the resolved style profile, current candidate text where applicable, chosen platforms and an explicit `generationIntent` (`initial|revise`). It returns the existing structured schema plus `qualityFlags` and source references for every generated claim. The hard system layer is assembled by code in this fixed order:

1. grounding, prohibited claims, platform limits and data minimisation;
2. the selected structured style profile;
3. the user’s facts/observations/freigegebenen quotes;
4. a bounded revision instruction (max 500 chars) or the current text.

The custom profile and revision instruction are data, never higher-priority instructions. On conflicting user text, preserve the hard layer. Validate the returned JSON with Zod and `assertGroundedPost`; malformed, unsupported or ungrounded output must fail closed and show a recoverable status, not be inserted as a post version.

Use the completed Hatchet outbox from Plan 004 for external LLM calls. The API returns a composition/session ID and the UI subscribes or polls status, so the mobile screen appears responsive while the LLM runs. Hatchet receives the ID, source revision, correlation ID and idempotency key only; the worker reloads current state via service role, invokes the selected provider with a timeout/cost limit, writes the result and emits a safe status. A retry must not produce a second accepted version; its key includes session/version/input hash.

For a first generation and every AI revision, keep a candidate separate from the immutable accepted version. The user can compare it with the current version and choose **Übernehmen**, **erneut anweisen** or **selbst bearbeiten**. Only **Übernehmen** creates `post_versions` vN+1 (`created_by_type='llm'`); saving manual editor text creates vN+1 (`created_by_type='user'`). Both atomically update `posts.current_version_id`, invalidate prior approval where applicable and audit the action. Never update vN in place. An abandoned candidate may be retained as a short-lived, access-controlled generation session for reload/retry, then removed under a documented retention rule; it must never become publishable.

### 4. Private photos and compressed user videos

Complete the private media path from Plan 002 before allowing attachments. Images accept JPEG, PNG, WebP and HEIC; videos initially accept a deliberately small, documented allow-list compatible with the selected publisher (target: MP4 container with H.264 video and AAC audio). Enforce per-type count, duration, dimensions and byte limits at API and worker boundaries, inspect the actual bytes rather than trusting filename/MIME, normalise image orientation, remove EXIF/GPS, and associate only a private ready derivative with the accepted `post_version` through `post_media`. The browser receives only short-lived upload/download URLs and never a Service Role credential.

Video upload uses a two-stage, user-visible compression policy:

1. **Device-first, before transfer.** After selecting a video, a dedicated browser worker detects codec support, free-memory/size guardrails and connection conditions. On supported devices it transcodes locally to the configured delivery profile, constraining the longer edge to 1080px, frame rate to at most 30 fps and bitrate by duration/resolution. It shows estimated size saving, real progress, cancel and retry; only the compressed blob gets a signed upload URL. Temporary blobs/object URLs are revoked when the action ends. The normal path never uploads the chosen original.
2. **Safe fallback, explicitly disclosed.** Browsers do not provide dependable hardware video encoding on every mobile device and a WebAssembly transcoder can exceed memory/battery limits for long clips. If the device cannot meet the profile, the UI explains this before any network transfer and offers either cancellation or a resumable upload into a short-lived **private quarantine** object. A worker then transcodes to the same profile before the asset can be attached, previewed by reviewers or published; the source is deleted according to the documented short raw-media retention rule. This fallback is an exception metric, not a silent default.

Run a technical spike before choosing the browser implementation. Compare a WebCodecs-based worker with a lazily loaded WebAssembly transcoder on current iOS Safari, Android Chrome and desktop browsers using synthetic clips. Select a strategy only if it meets crash-free, time, memory, bundle-download and resulting-codec acceptance thresholds; otherwise retain the explicit server fallback. Do not load a large transcoder bundle on the creation screen until the user selects a video.

Persist controlled compression provenance on the asset/derivative (`device|server`, input/output byte count, codec/container, width, height, duration, profile version and failure reason class); never log filenames, media bytes, signed URLs or video content. The worker performs a final codec/duration/hash check even after device compression. A video does not go to the LLM. If its visual content matters for wording, the form offers an optional “Was ist im Video relevant?” note that enters `observations` after the user confirms it.

Before request approval, reuse `evaluateMediaGate`, create the ordered derivative/hash approval snapshot and enforce the gate in both the request-approval and publication boundaries. Without automated video face tracking, every video needs an explicit human declaration for recognisable people and minors; a minor or missing/unclear consent blocks the same way as a photo until the existing consent process resolves it. The UI must explicitly say that photos/videos are not analysed by the LLM.

### 5. Mobile interaction design

Replace the wizard as the default flow with a single, thumb-friendly composition surface:

- top: auto-saving plain-language input field, accepting bullets, sentences, complete copy or pasted text; the placeholder teaches what details produce a distinctive result;
- underneath: optional “Fakten präzisieren” disclosure plus an attachment strip for photos or one video, with local compression progress, estimated saving, fallback disclosure and visible upload/consent state;
- compact chips for goal, text/photo/video format, target channels and style mode; an “Mehr” sheet holds advanced choices, preserving a one-hand primary path;
- sticky bottom action: `Entwurf erstellen`/generation status, with accessible progress and retry rather than a blocking spinner;
- result: editable caption first, an expandable facts/quality card, selected-style badge, candidate-vs-current diff, and actions for direct save, one-line change request, regenerate and submit for approval;
- all controls have 44px minimum targets, keyboard focus, screen-reader labels, explicit error text, no hover-only states, and no data loss when changing profile or navigating back.

Build a real `/beitraege` list that shows status, current version, selected mode and latest update; its card opens the editor/resume route. The approval CTA calls `POST /v1/post-versions/:id/request-approval` for the chosen current version, then either shows the required approver state or offers scheduling only after approval. It must not merely navigate to `/freigaben`.

## Steps

### Step 1: Lock the text-first, photo/video attachment contract

Write the Zod schemas and type exports for text/photo/video presentation, image/video metadata, compression provenance, style profile fields, composition sessions, generation commands/results, accepted-version creation and revision feedback. New creation rejects `reel` as a generated format while historic rows remain parseable through a read schema. Add a content platform-capability interface rather than assuming every platform supports every output. The creation input accepts only the explicit image/video allow-list; it never accepts a generated-video request.

**Verify**: `pnpm --filter @vereinsfunk/contracts test && pnpm --filter @vereinsfunk/web typecheck` → exit 0; contract tests accept the supported upload-video metadata, reject unsupported container/codec/duration, reject generated `reel`, and keep an old stored `reel` record readable.

### Step 2: Add tenant-safe style profiles and provenance

Create the additive migration, RLS policies and pgTAP tests described in “Target design”. Ensure each profile’s department/team belongs to its organisation with composite FKs. Add service-role-only writes where that matches existing post/configuration mutations and user-role read policies no broader than necessary. Add profile CRUD routes with Zod plus audit events, and the compact mobile profile picker/management UI.

Write an ADR recording the non-imitative style-profile rule, priority order of prompt layers, data minimisation and version snapshot requirement. Update the product plan to state that v1 generates text and supports user-provided photos/videos; it never generates a video.

**Verify**: `pnpm db:reset && pnpm db:test && pnpm --filter @vereinsfunk/api test` → all pass, including positive and negative two-organisation tests for profiles and profile-to-team cross-tenant references.

### Step 3: Build a real structured LLM adapter and evaluation suite

Keep `FakeContentGenerator` for deterministic local tests. Add an injected production generator behind the existing `ContentGenerator` boundary; the API/worker selects only an active platform-admin configuration and decrypts the provider secret only server-side. Use provider-native structured output where the configured protocol supports it, then Zod-parse as a second boundary. Include a provider health/error taxonomy with timeouts and redacted, structured telemetry; never log caption/source text, API keys, full prompts or media URLs.

Create a checked-in, synthetic evaluation fixture set: terse bullet input, full pasted post, missing facts, forbidden topic, required hashtag, a warm club-life example, a light-humour example, a custom profile, a malicious instruction embedded in source text, and an image-context note. Assert schema, source IDs, no invented claim, style constraints, absence of banned filler phrases, token/cost ceiling and correct “ask for details” outcome. Do not use real member names or photos in fixtures.

**Verify**: `pnpm --filter @vereinsfunk/content-engine test && pnpm --filter @vereinsfunk/api test` → exit 0; tests prove an ungrounded provider response and prompt-injection-like source text cannot create a candidate/version.

### Step 4: Implement composition jobs, candidates and immutable revisions

After Plan 004 supplies a working outbox and worker, add composition-session persistence/status and the ID-only `generate-text-post`/`revise-text-post` workflows. The API must create the session transactionally with its outbox record, authorise it by post scope, and return an idempotent session handle. The worker reloads facts/style/current version, writes a candidate or controlled failure, and never writes an accepted version as a side effect of generation.

Add explicit API commands to accept a candidate and to save manual content. Implement the post/version write as one transaction/RPC, including version-number allocation, current-version update, media associations, previous-approval invalidation and audit event. Do not copy the current `apps/api/src/app.ts` sequence of several PostgREST writes; the race-sensitive revision path needs a database transaction. Use compare-and-set/session state to prevent double acceptance.

**Verify**: `pnpm --filter @vereinsfunk/api test && pnpm --filter @vereinsfunk/worker test && pnpm db:test` → tests cover duplicate trigger, two simultaneous accepts, AI acceptance, manual save, candidate abandonment, edit after approval, tenant denial and revision failure without a partial post.

### Step 5: Deliver device-first video compression, private media attachment and approval snapshots

First execute and document the browser-compression spike described above. Implement the selected local compressor as a lazily loaded worker with explicit capability detection, bounded input, cancellation, progress and cleanup. It must create the selected MP4/H.264/AAC output before requesting an ordinary signed upload URL. Implement the disclosed quarantine + worker-transcode fallback with resumable upload, strict short retention, final validation and no publication path to the raw object. Build a ready image/video derivative even when no visual edit is requested, link it only after candidate acceptance, and enforce media/consent checks during approval request and before publishing. A text-only post bypasses media checks but not text/approval policy; a photo/video post with a pending, invalid or unreviewed derivative is blocked with an actionable reason. Add deletion/retention handling for abandoned uploads, fallback sources and candidates consistent with Plan 020.

**Verify**: `pnpm --filter @vereinsfunk/api test && pnpm --filter @vereinsfunk/worker test && pnpm --filter @vereinsfunk/domain test && pnpm db:test` → two-tenant storage/RLS tests and scenarios for text-only, image-ready, device-compressed video, unsupported video, compression cancellation, quarantine fallback, pending derivative and a minor/consent blocker all pass.

### Step 6: Deliver and test the mobile editor end-to-end

Extract focused Vue components from `erstellen.vue` (composer, style picker, photo strip, generation state, candidate diff, quality card and editor) and use the existing `useApiClient` boundary. Preserve unsent input locally per session with a bounded draft strategy and clear recovery/discard controls. Add `beitraege.vue` list/load/resume flow and make approval an actual API action.

Write component tests for narrow and wide viewports, keyboard traversal, 44px action controls, changing profiles without losing text, photo/video upload progress, local compression, fallback disclosure, cancellation, generation retry, direct edit, AI revision and approval submission. Add one authenticated browser smoke test when the repository’s browser test harness is available; otherwise document a manual mobile-viewport script for iOS Safari and Android Chrome in the plan’s implementation notes.

**Verify**: `pnpm --filter @vereinsfunk/web test && pnpm --filter @vereinsfunk/web typecheck && pnpm check` → exit 0. On a 360px viewport a user can make and submit a text-only post, photo post and supported video post without horizontal scrolling or a desktop-only interaction.

## Test plan

- Contracts: output compatibility, bounded user instructions, style profile validation and immutable historic reads.
- Content engine: every claim maps to GroundedContentBrief, custom profile cannot change hard rules, thin source input becomes a question/flag, and style output avoids defined generic filler.
- API/worker: authorization at organisation/department/team scope; active provider selection; no secret/prompt leak; idempotent jobs; concurrent acceptance; manual/LLM version provenance; audit entries.
- Database: RLS positive/negative isolation for profiles, sessions, candidates and every new FK; approved-version immutability; snapshot invalidation; no cross-tenant photo/video attachment.
- Web: mobile composer, draft recovery, accessibility, device compression/fallback disclosure, direct and AI-driven editing, real approval call.
- Manual acceptance script: create from bullets with no attachment; create from a pasted paragraph plus photo; create a supported video post on iOS Safari and Android Chrome, measuring original/output bytes and ensuring progress/cancel works; exercise fallback deliberately; ask for two revisions; edit manually; approve; verify a version change invalidates approval; inspect logs to confirm no content/media/secret payload is present.

## Done criteria

- [ ] New creation paths generate text and accept optional photos or supported user videos; no AI-video/Reel generation path is reachable from the textwerkstatt.
- [ ] A contributor can complete the first draft from a 360px-wide screen with one primary action and can resume it later.
- [ ] At least five visible curated modes and tenant-scoped custom style profiles work; anyone with `post.create` at a scope can create and use their own named/imitating style profile there.
- [ ] Before any publishing route for textwerkstatt drafts goes live: the AI-content labelling question (EU AI Act Art. 50, text) is resolved, and the required disclosure (if any) is implemented.
- [ ] Every LLM response is structured, Zod-validated, grounded and versioned only after explicit user acceptance.
- [ ] Direct editing and AI revision both create new `post_versions`; no approved version is mutated.
- [ ] Text-only, approved-photo and approved-video posts enter the existing approval/publishing flow correctly; invalid/unreviewed media cannot.
- [ ] On supported mobile browsers the compressed video blob, not the original, is uploaded; fallback raw uploads are explicitly confirmed, quarantined, measured and removed on schedule.
- [ ] RLS positive/negative tests, contract/content/API/worker/web tests and `pnpm check` all pass.
- [ ] Audit/telemetry contain IDs, hashes and controlled status data only — no raw media, post text, prompts or provider secret.

## STOP conditions

- Plan 004 does not provide a working transactional outbox/ID-only worker path: do not make an external LLM call synchronously from Fastify as a shortcut; complete or re-scope the orchestration prerequisite first.
- Plan 002 cannot produce an immutable, private ready image/video derivative and real media gate: do not attach original uploads to a post or silently treat them as publishable.
- Provider structured output cannot be enforced/validated for the selected provider: do not fall back to free-text parsing in a publishable path.
- Any implementation needs an arbitrary custom system prompt, raw photos in an LLM request, a cross-tenant read, or an in-place update of `post_versions`: stop and escalate the design conflict.
- A platform selected for text-only/video publishing does not support that content in the implemented publisher: expose the incompatibility in UI and block scheduling; do not manufacture another medium.
- Local compression fails the mobile-device thresholds or the browser cannot encode the accepted target profile: do not silently upload the original. Offer only cancellation or the explicit private-quarantine fallback.

## Maintenance notes

Review monthly: candidate acceptance rate, manual edit distance, regeneration count, time to first usable draft, grounded-claim failures, provider latency/cost and approval rejection reasons. Use these signals to refine the five style modes and evaluation fixtures, not to loosen grounding.

The next independent content investment should be a small, consented editorial evaluation set from pilot clubs and an approval-quality review, not AI video generation. Reconsider multimodal image/video understanding only after a documented privacy, consent and quality decision; it is deliberately absent here.
