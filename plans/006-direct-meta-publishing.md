# 006 – Direkte Meta-Veröffentlichung

## Ergebnis

Freigegebene Varianten werden über einen direkten `MetaPublisher` auf Instagram-Professional-Konten und Facebook-Seiten veröffentlicht. Hatchet steuert Zeitpunkt und Retry; Fastify verwaltet OAuth/Webhooks; der Adapter kapselt Graph-API-Details. Postiz/Mixpost sind für den MVP nicht erforderlich.

## Ausgangslage und Evidenz

Geplant auf `unborn HEAD` am 2026-08-02.

- `packages/publishing/src/index.ts:23-28` besitzt bereits eine sinnvolle `SocialPublisher`-Grenze.
- `packages/publishing/src/index.ts:30-55` implementiert ausschließlich `FakePublisher`.
- `PublicationInput.mediaUrl` kann nur ein Medium ausdrücken und modelliert keine Container-/Uploadzustände.
- `apps/api/src/app.ts` hat noch keine echte Auth-/OAuth-/Webhookintegration.
- Der alte Produktplan nennt Mixpost zuerst; diese Entscheidung ist nach der Repository-/Produktbewertung überholt.
- Metas offizielle Instagram-Publishing-Dokumentation nennt Einzelbilder, Videos, Reels und Carousels für professionelle Konten. Stories werden nicht als garantiertes MVP-Ziel angenommen; das Spike prüft den dann gültigen Stand.

Baseline:

```text
330106ed295a55aa84852daa2cae7086ed47b5947affb84d7ada27f07288c1a9  packages/publishing/src/index.ts
579b98597a3207941a121ed8202a98c73db0945b666a94974a351403b1bf8f1d  apps/api/src/app.ts
b2990427ebcb00454cdf90db26c1b3839b126840e2cda5008df4028197177302  apps/worker/src/workflows.ts
6b197d8532dd068adc3263567621444a6329b238ee5ce1f45432958ea02f2b81  docs/product/implementation-plan.md
```

Primärquellen, vor Umsetzung erneut gegen die dann aktuelle Graph-Version prüfen:

- https://developers.facebook.com/docs/instagram-platform/content-publishing/
- https://developers.facebook.com/docs/pages-api/posts/
- https://developers.facebook.com/docs/facebook-login/guides/access-tokens/
- https://developers.facebook.com/docs/graph-api/webhooks/

## Scope

- Meta OAuth, Konten-/Seitenauswahl, Token-Lifecycle und Webhooks
- Social-Connection-/Publication-Datenmodell
- `MetaPublisher` für nach Spike bestätigte IG-/FB-Formate
- kurzlebiger Providerzugriff auf ausschließlich freigegebene Derivate
- Publishing über Hatchet mit Idempotenz und Reconciliation
- App-Review-Evidence, Sandbox-/Testkonten, Monitoring und Runbook

Nicht enthalten: persönliche Profile, Facebook-Gruppen, weitere Netzwerke, Postiz/Mixpost, automatisches Veröffentlichen ohne Freigabe oder Analytics jenseits eines minimalen Statuschecks.

## Phase-0-Gate: reale Meta-Sandbox

Vor breiter Implementierung mit einer Development-App und dedizierten Testseiten/-konten nachweisen:

| Plattform/Format | Muss für MVP | Fallback |
|---|---:|---|
| Instagram Feed-Bild | ja | keiner |
| Instagram Carousel | ja | einzelnes Bild |
| Instagram Reel | Pilotziel | Export/Download |
| Instagram Story | nur wenn offiziell stabil unterstützt | Export/Download |
| Facebook Seitenpost mit Bild/Text | ja | keiner |
| Facebook Carousel/Mehrfachbild | Spike | Einzelbild |
| Facebook Reel | Pilotziel | Export/Download |

Dokumentiere in `docs/evidence/meta-publishing-spike.md`: Graph-Version, Accounttyp, Endpunkte, Scopes, App-Review-Anforderungen, Medienlimits, Containerstatus, Rate-Limit-Header, typische Fehler, Tokenablauf und getestete Resultate. Keine Tokens/Screenshots mit Geheimnissen einchecken.

STOP: App Review/benötigte Berechtigungen sind für den Pilot nicht realistisch erreichbar oder Kernformate funktionieren nur über nicht offizielle Browserautomation. Dann Plan 006 pausieren und Export/Download pilotieren; erst danach einen externen Provideradapter neu bewerten.

## Umsetzung

### 1. Verbindungen und Token-Sicherheit

**Bereits vollständig umgesetzt in Paket 012** (`plans/012-kanaele-und-social-accounts.md`, erledigt) — dieser Abschnitt beschreibt keine offene Arbeit mehr, sondern was 006 vorfindet: `social_connections` (Tenant, Plattform, externe Konto-/Seiten-ID, Anzeigename, Scopes, Tokenablauf, Status, letzte Prüfung, Kanalbesitz, Vertraulichkeit, verantwortliche Person), Tokens envelope-verschlüsselt in einer eigenen `social_connection_secrets`-Tabelle ohne jede Policy für `authenticated` (`packages/secrets`, versioniert, rotierbar), OAuth Start/Callback mit signiertem, kurzlebigem `state` in Fastify, explizite Kontenauswahl vor dem Anlegen einer Verbindung, Reconnect/Disconnect. Nicht gebaut: PKCE (Meta unterstützt es serverseitig nicht zwingend) und automatisches Stornieren geplanter Veröffentlichungen bei Disconnect (der Kanal wird `disconnected`/`archived`, eine bereits eingeplante `publication` bleibt bestehen und scheitert beim tatsächlichen Veröffentlichen — 006 sollte das beim Bau des Publish-Workflows berücksichtigen). Für 006 bleibt: der eigentliche Veröffentlichungsaufruf (`SocialPublisher`/`MetaPublisher` existiert bereits in `packages/publishing`, aber ohne Workflow-Anbindung), Retry-/Reconciliation-Verhalten, Provider-Fehlerklassifikation.

### 2. Publication-Modell und Adaptervertrag

- Migration für `publications`, `publication_attempts` und optional `provider_media_containers`, stets tenantgebunden.
- Unique: `(organization_id, platform, post_version_id, social_connection_id)` plus fachlicher `publication_id`.
- Erweitere Input auf eine geordnete Medienliste mit Derivat-ID/Hash/Typ; URLs werden erst im Adapter serverseitig bezogen.
- Ergebniszustände: `queued`, `uploading`, `processing`, `published`, `failed`, `unknown`, `action_required`, `cancelled`.
- Providerantworten werden redigiert und normalisiert; rohe Antwort nur falls nötig verschlüsselt/gekürzt mit Aufbewahrungsfrist.

```ts
interface SocialPublisher {
  validate(input: PublicationInput): Promise<ValidationResult>
  publish(input: PublicationInput): Promise<PublicationResult>
  reconcile(input: PublicationReference): Promise<PublicationResult>
  delete?(input: PublicationReference): Promise<void>
}
```

### 3. Sichere Medienübergabe

- Meta muss Medien serverseitig abrufen können. Fastify stellt dafür einen unerratbaren, gehashten, zeitlich und auf genau ein Derivat begrenzten `publication_media_grant` bereit.
- Endpoint liefert nur das im Approval-Snapshot enthaltene Derivat, mit korrektem MIME/Length, ohne Directory Listing, Range nur falls Provider benötigt, und protokolliert Zugriffe ohne Tokenwert.
- TTL deckt Containerverarbeitung plus Sicherheitsmarge; Grant wird nach erfolgreicher Ingestion/Abbruch widerrufen. Originale sind technisch nicht grantfähig.
- Alternativ dürfen Supabase Signed URLs nur verwendet werden, wenn TTL, Logging, Widerruf und Provider-Abruf im Spike nachgewiesen sind.

### 4. Instagram- und Facebook-Abläufe

- Instagram: Mediencontainer anlegen → bei Video/Carousel Status bis terminal pollen → Container publizieren → Media ID speichern → permalink/status reconciliieren.
- Facebook: pro bestätigtem Format den offiziellen Seiten-Endpunkt nutzen; Upload-/Processing-Phasen explizit modellieren.
- Plattformregeln (MIME, Maße, Länge, Anzahl, Caption) liegen versioniert im Adapter und werden unmittelbar vor Upload validiert.
- Jede externe Antwort mit Provider-ID wird sofort persistiert. Bei Timeout nach Request zuerst anhand persistierter Container/IDs reconciliieren.
- Der Adapter veröffentlicht keine Story/Reel über heuristische/undokumentierte Endpunkte.

### 5. Hatchet-Scheduling und Exactly-once-Wirkung

- API speichert gewünschte Veröffentlichung und Outbox atomar; Hatchet plant `publish-content` auf UTC, UI zeigt Vereinszeitzone.
- Vor I/O: aktuelle Schedule-Revision, Freigabe, Medienhashes, Verbindung/Scopes und bereits vorhandene Provider-ID prüfen.
- Fachlicher Idempotency-Key: `publish:{publicationId}:{postVersionId}:{connectionId}`.
- Lock/Compare-and-Set stellt sicher, dass nur ein Attempt `uploading` erreicht. Hatchet liefert at-least-once; DB + Reconciliation erzeugen exactly-once-Wirkung soweit Provider-API zulässt.
- 401/abgelaufener Token → einmal kontrolliert erneuern, sonst `action_required`; 429 → Providerhinweis; 5xx → begrenzt; unknown → reconcile; 4xx-Inhalt → non-retryable.

### 6. Webhooks, Status und UX

- Fastify verifiziert Challenge/Signatur, Größenlimit und Replay-Fenster; Webhook schreibt Inbox idempotent, Worker verarbeitet asynchron.
- Kalender/Beitragsseite zeigt pro Plattform getrennten Zustand, externen Link, letzten Fehler in Nutzersprache und Reconnect-Aktion.
- Teilfehler: Instagram veröffentlicht/Facebook fehlgeschlagen bleibt sichtbar; kein Rollback durch automatische Löschung.
- Nutzer kann geplante Veröffentlichung bis zum Providerstart umplanen/stornieren; danach nur explizite Löschaktion, falls API/Produktregel dies erlaubt.

### 7. App Review und Betrieb

- Erstelle Review-Testnutzer, Privacy-/Deletion-URLs, Screencast und Schrittfolge für tatsächlich benötigte Scopes.
- Alerts: bevorstehender Tokenablauf, Verbindungsfehler, unknown > Schwelle, 429-Spike, geplante Veröffentlichung überfällig, Webhook-Signaturfehler.
- Runbook: Tokenrotation, Reconnect, unbekanntes Ergebnis, doppelter Providerpost, Löschung, Graph-Version-Upgrade und App-Review-Verlust.

## Verifikation

```bash
pnpm --filter @vereinsfunk/publishing test
pnpm --filter @vereinsfunk/api test
pnpm --filter @vereinsfunk/worker test
pnpm db:reset
pnpm db:test
pnpm check
```

Sandbox-E2E: OAuth, Feed-Bild, Carousel, bestätigte Videoformate, Zeitplan, Umplanung, Tokenablauf, 429, Timeout nach Containererstellung, doppelter Trigger, Webhook-Replay und mandantenfremde Connection-ID.

## Done-Kriterien

- Mindestens IG Feed/Carousel und FB Seitenpost funktionieren über offizielle APIs in Test und Pilot-App-Review-Pfad.
- Tokens sind verschlüsselt/serverseitig; Hatchet und Browser sehen sie nie.
- Nur freigegebene Derivate sind zeitlich begrenzt für Provider abrufbar.
- Scheduling, Reconciliation und DB-Idempotenz verhindern Doppelposts in den Fehlerszenarien.
- Providerstatus ist pro Plattform sichtbar; Evidence, ADR/Produktplan und Runbook sind aktuell.

## STOP-Bedingungen

- Metas aktuelle Primärdokumentation widerspricht einem geplanten Format/Scope: Implementierung anhalten und Matrix aktualisieren.
- Token oder Originalmedien tauchen in Client/Hatchet/Logs auf: Pilot sperren und Incident behandeln.
- Unknown-Result kann nicht reconciliiert werden: keine automatischen Retries dieses Schritts.

## Pflegehinweis

Graph-Version und Scopes quartalsweise sowie vor jedem Versionsablauf prüfen. Monatlich Tokenfehler, Rate Limits, Unknowns, Dubletten und Formatfehler auswerten. Weitere Plattformen erst hinter `SocialPublisher`, wenn Plan 007 Nachfrage belegt.
