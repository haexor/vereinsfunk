# Vereinsfunk

Multi-Tenant Social-Media-SaaS für Sportvereine. Das Repository setzt die sichere technische Basis und einen vollständig navigierbaren MVP-Produktprototyp aus dem Umsetzungsplan um.

Der priorisierte, ausführbare Ausbauplan liegt in [plans/README.md](plans/README.md). Er deckt das flexible Vereinsleben-Inhaltsmodell, private Medien und kreative Gesichtsverdeckung, die echte Hatchet-Integration, Plattformvarianten, direktes Meta-Publishing sowie den Pilotbetrieb ab.

## Was bereits funktioniert

- responsive Nuxt-Oberfläche für Übersicht, Beiträge, Erstellung, Freigaben, Kalender, Auswertung, Marke und Mitglieder
- dreistufige Beitragserstellung mit strukturierten Fakten und API-/Offline-Vorschau
- Fastify-API mit Health Check, Zod-Validierung, Correlation IDs und redigierten Logs
- zentrale Statusmaschine, Konfigurationsvererbung und rollenbasierte Permissions
- ID-only Worker-Vertrag mit Fairness-Key, Concurrency-Konfiguration und Idempotenz
- Remotion-Kompositionen für Story (1080 × 1920) und Feed (1080 × 1350)
- Supabase-Kernschema mit zusammengesetzten Tenant-FKs, RLS, privaten Buckets und pgTAP-Isolationstests
- idempotenter Fake-Publisher und faktengebundener Fake-Content-Generator für lokale Entwicklung

Echte LLM-, Hatchet-, Remotion-Lambda- und Publishing-Zugänge sind bewusst noch nicht aktiviert. Ihre Adaptergrenzen sind vorhanden, aber produktive Provider erfordern jeweils einen dokumentierten Spike, Zugangsdaten und Kosten-/Datenschutzfreigabe.

## Voraussetzungen

- Node.js 24 oder neuer
- pnpm 11
- Docker-kompatible Laufzeit für Supabase
- optional Hatchet CLI für den Workflow-Spike

## Schnellstart der Oberfläche

```bash
pnpm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env
pnpm dev:web
```

Es gibt zwei Env-Dateien, und zwar mit Absicht: Nuxt lädt `.env` aus seinem eigenen `rootDir`, also aus `apps/web/`. Dort stehen ausschließlich die `NUXT_PUBLIC_*`-Werte, die ohnehin im Client-Payload landen. Die Root-`.env` enthält die serverseitigen Geheimnisse für API und Worker — so hat der Web-Prozess den Service-Role-Key nie in seiner Umgebung. Fehlt `apps/web/.env`, antwortet die Oberfläche mit `500 supabaseUrl is required`.

Die Oberfläche läuft unter `http://localhost:4200`. Anmeldung, Registrierung und Passwortverwaltung setzen eine laufende lokale Supabase-Instanz voraus. Geschützte Inhalte benötigen zusätzlich die API.

## Vollständige lokale Umgebung

Terminal 1:

```bash
pnpm db:start
pnpm db:reset
```

Die von Supabase ausgegebenen lokalen Schlüssel eintragen: Service-Role-Key und `SUPABASE_*` in die Root-`.env`, den Anon-Key zusätzlich als `NUXT_PUBLIC_SUPABASE_ANON_KEY` in `apps/web/.env`. Die lokale Umgebung ist laut offizieller Supabase-Dokumentation nur für Entwicklung vorgesehen und darf nicht öffentlich erreichbar sein.

Wer die Plattform-Administration braucht, setzt `PLATFORM_ADMIN_DEFAULT_EMAIL` in der Root-`.env` auf die Adresse eines **bereits registrierten** Kontos — der Seed liefert `lena@example.local` und `jonas@example.local` mit dem Passwort `local-demo-password`. Die API bootstrappt daraus beim nächsten Start den Default-Admin. Der Vorgang ist einmalig: eine Rotation der Adresse ist danach eine bewusste Ops-Aktion mit direktem DB-Zugriff.

Terminal 2:

```bash
pnpm dev:api
```

Terminal 3:

```bash
pnpm dev:web
```

API-Health-Check: `http://localhost:4201/health`

Für Hatchet lokal die offizielle CLI installieren und separat starten:

```bash
hatchet server start
```

Die Workflow-Implementierung bleibt beim lokalen Adapter, solange `HATCHET_CLIENT_TOKEN` nicht gesetzt und der produktive SDK-Adapter nicht als eigenes Arbeitspaket umgesetzt ist.

## Lokaler Start mit Docker Compose

Alle Node-Services lassen sich auch containerisiert starten:

```bash
docker compose up --build
```

Danach sind die Services hier erreichbar:

- Web: `http://localhost:4200`
- API: `http://localhost:4201/health`
- Remotion Studio: `http://localhost:4202`

Die Compose-Umgebung startet Web, API, Worker und Remotion Studio. Abhängigkeiten werden vorab im `deps`-Service in Docker-Volumes installiert, damit der lokale Arbeitsbaum nicht mit Container-`node_modules` überschrieben wird.

Supabase bleibt lokal bei der offiziellen CLI, weil sie selbst einen abgestimmten Container-Stack verwaltet:

```bash
pnpm db:start
pnpm db:reset
docker compose up --build
```

Wenn Supabase auf dem Host läuft, nutzt die API im Container standardmäßig `http://host.docker.internal:4260`. Die Browser-URLs für Web bleiben weiterhin `http://localhost:4201` und `http://localhost:4260`.

## Qualitätssicherung

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:test      # benötigt laufendes lokales Supabase
```

## Struktur

```text
apps/web          Nuxt-Produktoberfläche
apps/api          privilegierte Fastify-Grenze
apps/worker       Workflow- und Fairness-Grundlage
apps/remotion     visuelle Render-Kompositionen
packages/*        Contracts, Domain, Authz, Provider-Adapter, Config, Logging
supabase/*        Migrationen, private Storage-Policies, Seed und RLS-Tests
docs/*            Architektur, ADRs, Produktplan und nächste Tickets
plans/*           priorisierte, eigenständig ausführbare Implementierungspakete
```

## Sicherheitsmodell

- Tenant-Zugriff wird in PostgreSQL über RLS erzwungen, nicht durch ausgeblendete UI.
- `organization_id` ist auf allen fachlichen Tabellen vorhanden; zusammengesetzte Fremdschlüssel verhindern widersprüchliche Tenant-Referenzen.
- Service-Role-Keys sind ausschließlich für API und Worker vorgesehen.
- Medien-Buckets sind privat und Zugriffspfade werden gegen Memberships geprüft.
- Freigaben beziehen sich immer auf eine unveränderliche Post-Version.
- Der lokale Fake-Generator erfindet keine fehlenden Fakten, sondern markiert sie.

Vor einem Pilotbetrieb gelten die Go/No-Go-Kriterien in [docs/product/implementation-plan.md](docs/product/implementation-plan.md), insbesondere geprüfte RLS-Isolation, Backup-Restore, Kostenlimits, Minderjährigenprozess und Publishing-Idempotenz.
