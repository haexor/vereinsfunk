# Systemarchitektur

```mermaid
flowchart TD
  UI[Nuxt Web-App] --> API[Fastify API]
  API --> SB[(Supabase)]
  API --> HT[Hatchet]
  HT --> WK[TypeScript Worker]
  WK --> SB
  WK --> CE[ContentGenerator]
  WK --> VR[VideoRenderer]
  WK --> SP[SocialPublisher]
```

Supabase ist die fachliche Source of Truth. Hatchet verwaltet ausschließlich technische Ausführung. Provider liegen hinter Interfaces; der lokale Start verwendet sichere Fake-Implementierungen.

## Abhängigkeitsrichtung

`apps/* → packages/*`. Domain, Contracts und Authorization importieren keine Frameworks oder Provider-SDKs. Browser-Code kennt keine Service-Role und greift für privilegierte Aktionen auf die Fastify-API zu.

## Tenant-Grenze

```mermaid
flowchart LR
  U[auth.uid] --> M[Membership im Scope]
  M --> P[Permission-Funktion]
  P --> RLS[PostgreSQL RLS]
  RLS --> ROW[Zeile mit organization_id]
```

RLS ist auf exponierten Tabellen aktiviert und erzwungen. Organisatorische Unterobjekte werden mit zusammengesetzten Fremdschlüsseln an ihren Mandanten gebunden.
