# Paket 045: Twitter/X und LinkedIn als Kanäle

## Ausgangslage

Instagram und Facebook laufen vollständig (OAuth-Verbindung + echtes Veröffentlichen) über einen
gemeinsamen Meta-Graph-API-Adapter (Paket 012, `packages/publishing`). Twitter/X und LinkedIn waren
an mehreren Stellen im Code als „vorgesehen" kommentiert (`packages/contracts/src/primitives.ts`,
`content.ts`: „X 280, Mastodon 500, LinkedIn 3000"), aber nirgends implementiert — kein
OAuth-Client, kein Publisher, keine DB-Zeile, kein Enum-Wert.

Es liegen keine echten Entwickler-Zugänge (Client-ID/Secret mit Schreibrecht) für X oder LinkedIn
vor. Die Implementierung ist deshalb vollständig, aber ohne Live-Test gegen echte Konten (gleiches
Muster wie der HTTP-Integrationsadapter in Paket 014, der als fertiger Code ohne Testzugang
zurückgestellt wurde).

## Entscheidungen (im Gespräch geklärt, 2026-08-17)

1. **Umfang**: volle Parität zu Instagram/Facebook — OAuth-Verbindung UND echtes Veröffentlichen.
2. **LinkedIn-Modus**: als Vereins-**Unternehmensseite** (`w_organization_social`), nicht als
   persönliches Mitgliedsprofil — dasselbe Muster wie Metas bestehender App-Review
   (`instagram_content_publish`): eine einmalige externe Freigabe ist eine bekannte
   Betreiber-Voraussetzung, kein Blocker für die Implementierung.
3. **Medienpflicht**: für Twitter/LinkedIn ist ein Bild **optional** (beide APIs erlauben
   Text-only-Posts). Facebooks bestehender Foto-Zwang (`MetaPublisher` postete unconditional über
   `/photos`) wurde im selben Zug behoben — Facebook postet jetzt über `/feed`, wenn keine Medien
   vorhanden sind. Instagram bleibt zwingend medienpflichtig (technisch nicht anders möglich).
4. **`PUBLISHING_PROVIDER` wird eine Menge**: vorher ein einzelner Wert (`'fake' | 'meta'`) — für
   eine Produktivumgebung, die alle vier Plattformen gleichzeitig live schalten will, ist das jetzt
   eine kommagetrennte Menge (`meta,twitter,linkedin`). **Bewusst ohne Rückwärtskompatibilität**
   (Betreiberentscheidung) — alte Deployments mit `PUBLISHING_PROVIDER=meta` bleiben zwar gültig
   (ein einzelner Wert ist eine Menge der Größe 1), eine feste Erwartung an das alte Enum-Format gibt
   es aber nicht mehr.

## Architektur

Twitter und LinkedIn haben strukturell andere OAuth-Flows als der gemeinsame Meta-Adapter (X: OAuth2
+ PKCE, LinkedIn: Standard-OAuth2 mit Organisations-Listing) — deshalb keine erzwungene gemeinsame
Abstraktion mit Meta, sondern zwei weitere eigenständige Client-Paare nach demselben Bauplan wie
`MetaOAuthClient`/`MetaPublisher`:

- `TwitterOAuthClient` (`RealTwitterOAuthClient`/`FakeTwitterOAuthClient`), `TwitterPublisher`
- `LinkedInOAuthClient` (`RealLinkedInOAuthClient`/`FakeLinkedInOAuthClient`), `LinkedInPublisher`

Der generische Teil des bestehenden Connect-Flows (`GET /v1/oauth-pending/:id`,
`POST /v1/oauth-pending/:id/select`) bleibt unverändert wiederverwendbar — er arbeitet nur mit
`SocialConnectionSchema`/verschlüsselten `available_accounts`. Nur `/connect/:platform/start` und
`/connect/:platform/callback` (`apps/api/src/routes/channelOAuth.ts`) verzweigen jetzt echt nach
Provider (`OAUTH_PROVIDER_BY_PLATFORM`).

**PKCE (X)**: der `code_verifier` überlebt zwischen Start und Callback in der neuen, nullable Spalte
`oauth_states.code_verifier` — nur für `twitter` gesetzt.

**LinkedIn-Konten-Listing**: `organizationAcls?q=roleAssignee&role=ADMINISTRATOR` liefert die vom
Nutzer administrierten Vereinsseiten — passt direkt in das bestehende `available_accounts`-Schema
(wie Metas `me/accounts`).

**X-Konten-Listing**: `GET /2/users/me` liefert genau ein Konto (kein Seiten-Konzept bei X) — die
bestehende Auswahl-UI verarbeitet das als Liste der Länge 1.

## PR-Aufteilung

**PR 1 — Fundament** (dieser PR): Contracts, DB-Migration, `PUBLISHING_PROVIDER`-Set-Umstellung,
`Platform`-Typ-Erweiterung + Fake-Clients in `packages/publishing`, generalisierte
`channelOAuth.ts`-Routen, Facebook-`/feed`-Fix, komplette Web-UI-Arbeit. Mit
`PUBLISHING_PROVIDER=fake` (Default) sind Twitter/LinkedIn im Dev-/Testmodus end-to-end nutzbar —
Kanal verbinden (Fake-OAuth), als Zielplattform in der Textwerkstatt wählen, über `FakePublisher`
veröffentlichen.

**PR 2 — Echter Twitter/X-Adapter** (offen): `RealTwitterOAuthClient` (PKCE-Flow), `TwitterPublisher`
(Text + Chunked-Media-Upload), hinter `TWITTER_*`-Env-Variablen. Die Chunked-Upload-Fläche
(`media/upload` v1.1 vs. v2) hat sich in der Vergangenheit verschoben — vor der Implementierung
gegen die aktuelle X-Entwicklerdoku gegenprüfen.

**PR 3 — Echter LinkedIn-Adapter** (offen): `RealLinkedInOAuthClient` (Standard-OAuth2,
Organisations-Listing), `LinkedInPublisher` (`/rest/posts`, optionaler Bild-Upload), hinter
`LINKEDIN_*`-Env-Variablen.

## Bewusst nicht angefasst

`packages/contracts/src/content.ts` (`PlatformVariantSchema.platform`) und
`packages/content-engine/src/index.ts` (`FakeContentGenerator`) — die vor-Paket-033
Bild/Video-Pipeline, die der aktuelle Text-Pilot nicht nutzt.

## Risiken und offene Punkte

- **LinkedIn-App-Review** (`w_organization_social`) und **X-API-Zugriffsstufe** (Schreibrecht) sind
  externe, betreiberseitige Freigabeprozesse — nicht Teil der Implementierung, wie der bestehende
  Meta App Review. Anmeldedaten dürfen nie eingecheckt werden.
- **X-Token-Refresh**: ein X-OAuth2-Access-Token verfällt nach ~2 Stunden (anders als Metas
  langlebiges Token); `offline.access`-Scope liefert ein Refresh-Token. Für PR 2 vorgesehen:
  verzögertes Refresh direkt vor dem Publish-Aufruf, kein eigener Hintergrund-Job.
- **LinkedIn-Token-Lebensdauer**: ~60 Tage, kein automatisches Refresh im Standardzugriff — Kanal
  braucht nach Ablauf eine erneute manuelle Verbindung (analog zu Metas `action_required`-Zustand).

## Umsetzung: Ergebnis und Abweichungen vom Plan (PR 1)

Wie geplant umgesetzt, mit einer zusätzlichen, im Gespräch entdeckten Korrektur: der bestehende Test
`publishing.routes.test.ts` „rejects with 422 when the post version has no approved media derivative
yet" ging implizit von Facebooks altem Foto-Zwang aus (Datei-Default-Plattform `'facebook'`) — auf
`platform: 'instagram'` umgestellt (dort gilt die Medienpflicht unverändert) und um einen neuen
positiven Test für Facebook-ohne-Medium ergänzt. Zwei weitere pgTAP-Tests (`default_target_platforms
.test.sql`, `text_workshop_foundation.test.sql`) nutzten `'twitter'` als Beispiel für eine
*ungültige* Plattform — auf `'mastodon'` umgestellt, da `'twitter'` seit diesem Paket ein gültiger
Wert ist.

**Nicht lokal gegen eine echte Datenbank verifiziert**: die neuen/angepassten pgTAP-Tests
(`twitter_linkedin_platform_support.test.sql` sowie die beiden oben genannten Anpassungen) sind eng
am Muster bestehender, funktionierender Tests gebaut, aber nicht per `supabase test db` ausgeführt —
lokal belegte ein fremder, nicht zu diesem Projekt gehörender Supabase-Stack (`marketing-saas`)
genau den Datenbank-Port, den `supabase/config.toml` dieses Projekts erwartet. Vor dem Merge einmal
gegen eine echte lokale Instanz laufen lassen.
