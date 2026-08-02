# Vereinswerk – ausführbarer Umsetzungsplan

Stand: 2026-08-02. Das Repository besitzt noch keinen ersten Git-Commit (`unborn HEAD`). Deshalb enthält jedes Arbeitspaket Baseline-Hashes für seine wichtigsten Ausgangsdateien. Vor der Umsetzung müssen diese geprüft werden; bei Abweichungen gilt die jeweilige STOP-Bedingung.

## Zielbild

Vereinswerk wird eine Content-Werkstatt für das gesamte Vereinsleben: Abteilungen erfassen echte Beobachtungen, Fakten, Zitate, Bilder und Clips; das System erstellt daraus markenkonforme Varianten, schützt Personen auf Medien, führt eine konkrete Version durch die Freigabe und veröffentlicht sie geplant auf Instagram und Facebook.

Die Systemgrenzen sind verbindlich:

- Nuxt ist die Arbeitsoberfläche.
- Supabase Auth, Postgres, RLS, Storage und Realtime sind die fachliche Source of Truth.
- Fastify ist die vertrauenswürdige Servergrenze für OAuth, Webhooks, Service-Role-Zugriffe, kurzlebige Medien-URLs und Workflow-Trigger.
- Hatchet ist die einzige technische Workflow- und Zeitplan-Engine. Hatchet-Nachrichten enthalten IDs und kleine Routing-Metadaten, keine Medien, Tokens oder vollständigen Fachobjekte.
- TypeScript-Worker führen Texterstellung, Bildbearbeitung, Remotion-Rendering, Veröffentlichung und spätere Analytics aus.
- `SocialPublisher` bleibt die Provider-Grenze; zuerst wird Meta direkt angebunden. Postiz/Mixpost werden im MVP nicht betrieben. Hive ist kein Ersatz für Hatchet und bleibt außerhalb des Systems.

## Reihenfolge und Abhängigkeiten

| Nr. | Arbeitspaket | Abhängigkeiten | Status |
|---|---|---|---|
| 001 | [Inhaltsmodell und authentische Erfassung](001-content-domain-and-authentic-capture.md) | keine | bereit |
| 002 | [Private Medien, Einwilligungen und Freigabegate](002-private-media-consent-and-approval-gate.md) | 001 | bereit |
| 003 | [Kreative Gesichtsverdeckung für Bilder](003-creative-face-obscuring.md) | 002 | bereit |
| 004 | [Hatchet produktionsreif integrieren](004-hatchet-production-orchestration.md) | keine; parallel zu 001–003 möglich | bereit |
| 005 | [Kreative Plattformvarianten und Rendering](005-creative-platform-variants-and-rendering.md) | 001, 002, 003, 004 | bereit |
| 006 | [Direkte Meta-Veröffentlichung](006-direct-meta-publishing.md) | 002, 004, 005 | bereit |
| 007 | [Pilotbetrieb, Messung und Go/No-Go](007-pilot-readiness-and-go-no-go.md) | 001–006 | bereit |

Empfohlener Ablauf: zuerst 001 und den technischen Spike aus 004; danach 002 und 003; anschließend 005 und 006; zum Schluss 007. Ein Paket wird erst als abgeschlossen markiert, wenn alle Done-Kriterien erfüllt sind. Statuswerte sind `bereit`, `in Arbeit`, `blockiert`, `erledigt`.

## Architekturfluss

```text
Nuxt
  │ Auth-Sitzung / Nutzeraktionen
  ▼
Fastify API ───────────────► Supabase Auth + Postgres + RLS
  │                               │
  │ signierte Uploads             ├── private Originale
  │ OAuth / Webhooks              └── private, abgeleitete Medien
  │
  └── ID-basierter Trigger ─► Hatchet ─► TypeScript Worker
                                  │          ├── ContentGenerator
                                  │          ├── FaceDetector / ImageAnonymizer
                                  │          ├── Remotion
                                  │          └── SocialPublisher → Meta Graph API
                                  │
                                  └──── Status/Fehler nur über Worker/API zurück nach Supabase
```

## Übergreifende Regeln

- Keine erfundenen Vereinsfakten: Texte dürfen nur bestätigte Angaben, Beobachtungen und freigegebene Zitate verwenden. Fehlende Angaben werden als offen markiert.
- Originalmedien bleiben privat. Veröffentlichbar sind ausschließlich geprüfte, unveränderliche Derivate.
- Keine Gesichtserkennung oder biometrischen Profile; nur Gesichtserkennung im Sinn von Lokalisierung (Bounding Boxes).
- Jede Freigabe bindet exakt eine unveränderliche `post_version` und die Prüfsummen ihrer Medien-Derivate.
- Externe Aktionen sind idempotent, auditierbar und nach einem unklaren Provider-Ergebnis erst zu reconciliieren, nicht blind zu wiederholen.
- Jede mandantenbezogene Tabelle trägt `organization_id`, verwendet zusammengesetzte Fremdschlüssel und besitzt positive wie negative RLS-Tests.
- Kinder erfordern eine ausdrücklich bestätigte Medienentscheidung und die strengere Freigaberoute.
- Produkttexte sprechen von „Gesicht verdeckt“, nicht von automatisch hergestellter Rechtssicherheit. Kleidung, Kontext und Umgebung können weiterhin identifizieren.

## Globale Verifikation

Nach jedem Paket mindestens:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Bei Datenbankänderungen zusätzlich:

```bash
pnpm db:start
pnpm db:reset
pnpm db:test
```

Wenn ein externer Sandbox-Zugang nötig ist, dokumentiert der Executor die manuell geprüften Fälle, verwendete API-Version, App-Berechtigungen und das Datum in dem im Paket genannten Evidence-Dokument. Geheimnisse, Tokens und echte Kindermedien dürfen niemals eingecheckt werden.

## Bewusst nicht eingeplant

- Eigener Postiz- oder Mixpost-Betrieb im MVP
- Hive als Agenten-Orchestrierung
- Vollautomatisches Publizieren ohne menschliche Freigabe
- Gesichtserkennung, Personenabgleich oder biometrische Datenhaltung
- Automatisches Face-Tracking in Videos im MVP
- Weitere Netzwerke vor nachgewiesenem Pilotnutzen
