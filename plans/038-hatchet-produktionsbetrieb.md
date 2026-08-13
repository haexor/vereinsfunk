# 038 – Hatchet produktiv betreiben (das Operations-Gate aus Plan 004 schließen)

- **Category**: infrastructure, reliability
- **Planned at**: commit `4a701cad`, 2026-08-13
- **Umsetzungsstand**: geplant, noch nicht begonnen.

## Why this matters

Plan 004 (gemergt 2026-08-11) hat den echten Hatchet-TypeScript-SDK, die Orchestrierungsgrenze,
Outbox/Run-Mapping und Fairness/Retry-Logik gebaut und verifiziert — aber ausschließlich gegen
einen lokalen, auf dem Entwicklerrechner laufenden Hatchet-Stack (`infrastructure/hatchet/`,
`docs/operations/hatchet.md`). `plans/README.md` (Zeile 25) markiert das explizit als offenes
Gate: „produktiver Last-/Fairnessnachweis bleibt Operations-Gate". Dieses Gate wurde nie
aufgegriffen — im `ansible`-Repository (separates Repository, Rolle `vereinsfunk`) kommt der
Suchbegriff „hatchet" in der gesamten Historie kein einziges Mal vor.

Seit dem 11.08. registriert `apps/worker` beim Start echte Hatchet-Workflows
(`parseWorkerEnvironment()`, `WorkerEnvironmentSchema.HATCHET_CLIENT_TOKEN: z.string().min(1)`,
keine Optional-/Lokal-Adapter-Alternative mehr im Code). Auf haex.space existiert kein
Hatchet-Server und `secrets.vereinsfunk.hatchet_client_token` ist per Default ein leerer String
— `vereinsfunk-worker` kann seitdem nicht mehr starten und crash-loopt, seit dem ersten
Watchtower-Swap auf ein Image nach diesem Merge (sichtbar geworden erst am 2026-08-13 durch einen
Ansible-Lauf für Plan 036, der den Container neu erzeugte und damit den `RestartCount` zurücksetzte
— das Problem selbst ist vermutlich seit dem 11.08. durchgehend vorhanden). Damit lief seit
mindestens zwei Tagen keine Hintergrundverarbeitung in Produktion: Textgenerierung-Dispatch,
Recovery-Scan (Plan 035), Veröffentlichung.

Zusätzlicher, unabhängiger Fund: `roles/vereinsfunk/templates/docker-compose.yml.j2` und die
Quadlet-Vorlage setzen `HATCHET_SERVER_URL`/`HATCHET_API_URL` — Namen, die es in
`WorkerEnvironmentSchema` nicht (mehr) gibt. Das Schema erwartet `HATCHET_CLIENT_HOST_PORT`
(gRPC, `host:port`) und `HATCHET_CLIENT_API_URL` (REST). Selbst mit einem echten Token wären diese
beiden Werte bisher nie angekommen — vermutlich ein stiller Namensdrift seit einer SDK-/Schema-
Änderung nach dem ursprünglichen Ansible-Templating.

## Entscheidungen

1. **Deployment-Topologie: co-located auf haex.space, über ein geteiltes Docker-Netzwerk, kein
   Traefik-Routing.** `infrastructure/hatchet/docker-compose.yml`s Kommentar ("gRPC ist
   loopback-only, sodass der root application compose stack darüber via `host.docker.internal`
   erreichen kann") ist **in Step 0 real widerlegt worden**: `host.docker.internal:host-gateway`
   löst auf nativem Linux-Dockerd zur Bridge-Gateway-IP auf (`172.17.0.1`), nicht zu `127.0.0.1` —
   ein an `127.0.0.1:PORT` gebundener Port ist von dort aus unerreichbar (getestet, `curl` liefert
   Timeout/Exit 28). Das funktioniert nur auf Docker Desktop (Mac/Windows), dessen Sonder-Routing
   `host.docker.internal` zusätzlich an loopback-gebundene Ports durchreicht — weshalb es beim
   lokalen `pnpm --filter worker dev` (Worker läuft als nackter Node-Prozess auf dem Host, nicht in
   einem Container) nie auffiel. Reale Lösung, in Step 0 verifiziert: `hatchet-engine`/`hatchet-api`
   OHNE Host-Port-Publishing an ein gemeinsames, benanntes Docker-Netzwerk hängen (`external: true`,
   von `roles/hatchet` angelegt), `vereinsfunk-api`/`-worker` demselben Netzwerk beitreten und
   Hatchet über den Compose-Servicenamen erreichen (`http://hatchet-api:8080`,
   `hatchet-engine:7077`) — bestätigt per `curl` (200) und `nc` (offene gRPC-Verbindung) aus einem
   eigenständigen Container heraus, der nur über dieses geteilte Netzwerk verbunden war. Kein
   öffentliches Hostname/TLS-Zertifikat nötig, da der Traffic nie den Docker-Host verlässt.
   Alternative (ein zentral geteilter Hatchet für mehrere Hosts mit echtem TLS) wäre mehr
   Betriebsaufwand für einen Bedarf, der heute nicht existiert — `haex.cloud`s `vereinsfunk`-Eintrag
   hat `supabase.url: ""` und ist laut Kommentar „Bootstrap-only", also nicht produktiv aktiv (siehe
   STOP conditions, falls sich das ändert).
2. **Eigene, dedizierte Postgres-Instanz für Hatchet**, kein Anschluss an eine geteilte
   Postgres-Rolle. Präzedenzfall im Repository: `roles/postgres` ist trotz generischen Namens
   `specifyr`-spezifisch, es gibt kein Muster für eine von mehreren Apps geteilte Postgres-Instanz.
   Isolierter Fehlerraum, keine Versions-/Migrationskopplung mit anderen Diensten, deckt sich mit
   `infrastructure/hatchet/docker-compose.yml`s eigenem `hatchet-postgres`-Service.
3. **`SERVER_AUTH_COOKIE_INSECURE`/`SERVER_GRPC_INSECURE` bleiben `true`.** Der Traffic verlässt den
   Docker-Host nie (Entscheidung 1: geteiltes Netzwerk, kein Host-Port-Publishing) — dieselbe
   Vertrauensgrenze, die schon für `DATABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` auf demselben Host
   gilt. Echtes TLS wäre zusätzlicher Zertifikats-/Rotationsaufwand ohne echten Sicherheitsgewinn.
4. **Dashboard (`hatchet-api`) bekommt trotzdem einen Loopback-Port für den Operator**, nur
   `127.0.0.1:8080` auf dem Host selbst (kein `0.0.0.0`, keine Traefik-Route) — für Betriebsvorfälle
   (`docs/operations/hatchet.md`, „Tokenrotation", „Outbox-Stau") per SSH-Tunnel
   (`ssh -L 8080:127.0.0.1:8080 haex.space`). Das ist eine andere Verbindung als die von
   `vereinsfunk-api`/`-worker` genutzte (die geht über das geteilte Docker-Netzwerk, nicht über
   diesen Port) — eine öffentliche Route für ein internes Admin-UI wäre zusätzliche Angriffsfläche
   ohne begründeten Bedarf, kann aber jederzeit nachgerüstet werden.
5. **Namensfehler in den bestehenden Templates korrigieren**: `HATCHET_SERVER_URL`/`HATCHET_API_URL`
   → `HATCHET_CLIENT_HOST_PORT`/`HATCHET_CLIENT_API_URL`, passend zu `WorkerEnvironmentSchema`, und
   auf die Compose-Servicenamen aus Entscheidung 1 (`hatchet-engine:7077`, `http://hatchet-api:8080`)
   statt auf einen Host/Port-String.
6. **Bootstrap-Reihenfolge für das Worker-Token ist zweistufig, nicht in einem Playbook-Lauf
   lösbar.** `hatchet-admin token create` kann erst laufen, nachdem der Tenant existiert — das Token
   kann also nicht vorab in `secrets/<host>.yml` stehen wie jedes andere Secret. Ablauf: (a)
   Playbook einmal nur mit der neuen `hatchet`-Rolle laufen lassen (Tag-Filter), (b) Operator ruft
   **explizit `hatchet-admin seed`** auf, um den Tenant anzulegen — **in Step 0 real gefunden**: ohne
   diesen Schritt schlägt `token create` mit `APIToken_tenantId_fkey`-Verletzung fehl, weil noch kein
   Tenant existiert; die reine Doku in `docs/operations/hatchet.md` erwähnt das zwar, ist aber leicht
   zu überspringen, (c) danach `hatchet-admin token create` mit einer produktionstauglichen
   Ablaufzeit (nicht `--expiresIn 1h`), (d) Token in `secrets/haex.space.yml` unter
   `vereinsfunk.hatchet_client_token` eintragen, (e) Playbook erneut voll laufen lassen. Dasselbe
   Muster wie `PLATFORM_ADMIN_DEFAULT_EMAIL` (Konto muss vorher per Hand existieren, bevor die Rolle
   es referenzieren kann). **Zusätzlich in Step 0 beobachtet**: `hatchet-admin`s Standard-Kommando
   (ohne explizites `seed`, das läuft bei jedem `docker compose up`/`start` als Teil der
   `depends_on`-Kette vor `hatchet-engine`/`hatchet-api`) legt bei jedem Start einen **weiteren,
   ungenutzten Tenant** an — das bestehende Token bleibt dabei gültig und an seinen ursprünglichen
   Tenant gebunden (verifiziert: Neustart des gesamten Stacks inklusive Postgres, Token- und
   Tenant-Zeile überlebten unverändert), aber jeder erneute Ansible-Lauf, der die Container
   neu erzeugt, hinterlässt eine verwaiste `Tenant`-Zeile. Kosmetisch, kein Blocker — falls das
   stört, vor Produktivbetrieb bei Hatchet erfragen, ob sich das unterdrücken lässt.

## Steps

### Step 0 (Spike): erledigt, real gegen einen lokalen Wegwerf-Stack verifiziert

`infrastructure/hatchet/docker-compose.yml` mit frisch generierten Secrets (keine Platzhalter)
unter einem eigenen Compose-Projektnamen hochgezogen (nicht der Repo-lokale Loopback-Stack, der
über `pnpm`-Skripte läuft, um dessen laufenden Zustand nicht zu stören). Ergebnisse:

- Boot-Reihenfolge `hatchet-postgres` → `hatchet-migrate` → `hatchet-admin` → `hatchet-engine`/
  `hatchet-api` funktioniert wie dokumentiert; `hatchet-api`s `/api/live` antwortet mit 200.
- **`host.docker.internal` widerlegt** (siehe Entscheidung 1) — durch ein geteiltes, benanntes
  Docker-Netzwerk ersetzt; Erreichbarkeit von `hatchet-api`/`hatchet-engine` über den
  Compose-Servicenamen aus einem separaten, nur über dieses Netzwerk verbundenen Container heraus
  bestätigt (`curl` → 200, `nc` → offene gRPC-Verbindung).
- **Fehlender `hatchet-admin seed`-Schritt real reproduziert** (siehe Entscheidung 6) —
  `token create` schlägt ohne ihn mit `APIToken_tenantId_fkey`-Verletzung fehl.
- Token-/Tenant-Persistenz nach vollem Stack-Neustart (inkl. Postgres) bestätigt; dabei den in
  Entscheidung 6 dokumentierten verwaisten-Tenant-Nebeneffekt gefunden.
- Ein echter `vereinsfunk-worker`-Container gegen dieses Setup wurde in diesem Spike nicht
  gestartet (kein lokal laufendes Supabase-Projekt für die übrigen Pflichtfelder verfügbar) — das
  bleibt für Step 3 gegen haex.space die erste echte End-to-End-Verifikation mit echtem Worker-Code.

### Step 1: `roles/hatchet` (neue, eigenständige Ansible-Rolle im `ansible`-Repository)

Templates aus `infrastructure/hatchet/docker-compose.yml`/`.env.example` übernehmen (Jinja2-Werte
statt `${...}`-Platzhaltern, kein Host-Port-Publishing für `hatchet-engine` mehr, `hatchet-api`
nur noch `127.0.0.1:8080` für den Operator-Tunnel aus Entscheidung 4), beide an ein neues, von
dieser Rolle angelegtes externes Netzwerk gehängt (Entscheidung 1). Schlüsselgenerierung
(`hatchet-admin keyset create-local-keys`) als einmaliger `command`-Task mit `creates:`-Guard
(idempotent — nur ausführen, wenn `keys/` noch nicht existiert). Rolle unabhängig von `vereinsfunk`
in `haex.space.play.yml` einhängen (wie `postgres` unabhängig von `specifyr` eingehängt ist), nicht
als Sub-Task der `vereinsfunk`-Rolle — Hatchet ist konzeptionell eine eigene, von mehreren
zukünftigen Konsumenten nutzbare Abhängigkeit, keine vereinsfunk-spezifische Ressource.

### Step 2: `vereinsfunk`-Rolle korrigieren

`HATCHET_SERVER_URL`/`HATCHET_API_URL` in `env.j2` und `docker-compose.yml.j2` durch
`HATCHET_CLIENT_HOST_PORT`/`HATCHET_CLIENT_API_URL` ersetzen, Werte auf die Compose-Servicenamen
aus Entscheidung 1 (`hatchet-engine:7077`, `http://hatchet-api:8080`) setzen (Entscheidung 5).
`vereinsfunk-api`/`-worker` treten `roles/hatchet`s externem Netzwerk bei (zusätzliches
`networks:`-Eintrag neben `traefik`, kein `extra_hosts`/`host.docker.internal` mehr nötig). Nur der
Docker-Pfad (haex.space) ist hier im Scope; die Quadlet-Vorlagen bleiben unverändert, bis
`haex.cloud` produktiv aktiviert wird (siehe STOP conditions) — sie tragen denselben Namensfehler,
aber ihn dort jetzt zu fixen hieße, einen ungetesteten Podman-Netzwerkpfad mitzuziehen, ohne dass
irgendein aktiver Konsument existiert. `vereinsfunk.hatchet.server_url`/`api_url` in
`roles/vereinsfunk/defaults/main.yml` und `inventory/haex.space.yml` entsprechend
umbenennen/anpassen.

### Step 3: Bootstrap gegen haex.space durchführen (Entscheidung 6, Schritte a–d)

Real gegen haex.space ausführen, nicht nur beschreiben — inklusive des manuellen
Token-Erzeugungsschritts durch den Operator und der Bestätigung, dass `docker logs
vereinsfunk-worker` nach dem zweiten vollen Playbook-Lauf tatsächlich einen laufenden
Hatchet-Worker zeigt (kein Crash-Loop, keine `ZodError`).

### Step 4: `docs/operations/hatchet.md` und `plans/README.md` (Plan 004) aktualisieren

Produktions-Setup ergänzen (nicht nur den lokalen Nachweis), Verweis auf `roles/hatchet` im
`ansible`-Repository. Plan 004s Status „produktiver Last-/Fairnessnachweis bleibt Operations-Gate"
auf den tatsächlich erreichten Stand aktualisieren.

## Commands you will need

```bash
# Step 3: Keys, Tenant-Seed (nicht vergessen -- siehe Entscheidung 6), Token mit
# produktionsnaher Ablaufzeit statt der lokalen 1h
docker run --rm -v "$PWD/keys:/keys" --entrypoint /hatchet/hatchet-admin \
  ghcr.io/hatchet-dev/hatchet/hatchet-admin:v0.98.9 keyset create-local-keys --key-dir /keys
docker compose run --rm --no-deps --entrypoint /hatchet/hatchet-admin hatchet-admin seed
docker compose run --rm --no-deps --entrypoint /hatchet/hatchet-admin hatchet-admin \
  token create --expiresIn 8760h

# Step 3 Verifikation
ssh haex.space "docker logs vereinsfunk-worker --tail 50"
ssh haex.space "docker inspect vereinsfunk-worker --format 'RestartCount={{.RestartCount}}'"
```

## Not in scope

- **Ein zentral geteilter Hatchet für mehrere Hosts.** Siehe Entscheidung 1 — `haex.cloud` ist heute
  keine aktive vereinsfunk-Produktion, dafür bräuchte es kein echtes TLS/Netzwerk-Design.
- **Traefik-Route für das Hatchet-Dashboard.** Siehe Entscheidung 4 — SSH-Tunnel reicht für die
  seltenen Betriebsvorfälle.
- **Der in Plan 004 (Done-Kriterien) verlangte 30-Job-Fairness-Lasttest.** Dieser Plan schließt das
  strukturelle Gate (Hatchet läuft überhaupt in Produktion); der eigentliche Lasttest ist eine
  eigene, spätere Verifikation, sobald der Worker durchgehend läuft — nicht Teil dieses Plans, aber
  Voraussetzung für Plan 004s vollständigen Abschluss.
- **Automatisiertes Secret-Rotationstooling für das Hatchet-Worker-Token.** `docs/operations/hatchet.md`
  beschreibt den manuellen Rotationsablauf bereits; dieser Plan ändert daran nichts.
- **Die Quadlet-Vorlagen (`haex.cloud`-Pfad) auf `HATCHET_CLIENT_HOST_PORT`/`HATCHET_CLIENT_API_URL`
  korrigieren.** Tragen denselben Namensfehler, aber ohne aktiven Konsumenten wäre das ein
  ungetesteter Podman-Netzwerkpfad ohne echten Nutzen jetzt — siehe STOP conditions.

## Done criteria

- [ ] `roles/hatchet` existiert im `ansible`-Repository, unabhängig von `vereinsfunk` eingehängt,
      mit frisch generierten (nicht Platzhalter-)Secrets in `secrets/haex.space.yml`.
- [ ] `HATCHET_CLIENT_HOST_PORT`/`HATCHET_CLIENT_API_URL` ersetzen `HATCHET_SERVER_URL`/
      `HATCHET_API_URL` in `roles/vereinsfunk`s Docker-Pfad-Templates; `vereinsfunk-api`/`-worker`
      erreichen `hatchet-engine`/`hatchet-api` über das geteilte Docker-Netzwerk aus Entscheidung 1
      (per Compose-Servicename, kein `host.docker.internal`).
- [ ] Bootstrap-Reihenfolge aus Entscheidung 6 real gegen haex.space durchgeführt, echtes
      Worker-Token in `secrets/haex.space.yml` hinterlegt.
- [ ] `docker logs vereinsfunk-worker` zeigt nach dem zweiten vollen Playbook-Lauf einen
      registrierten Hatchet-Worker statt einer `ZodError`; `docker inspect`s `RestartCount` bleibt
      über mindestens 10 Minuten unverändert.
- [ ] `docs/operations/hatchet.md` und `plans/README.md` (Plan 004) spiegeln den tatsächlich
      erreichten Produktionsstand wider.

## STOP conditions

- `haex.cloud`s `vereinsfunk`-Eintrag wird produktiv aktiviert (echte `supabase.url` statt `""`) —
  dann Entscheidung 1 neu bewerten: entweder eine zweite, eigene co-located Hatchet-Instanz auf
  `haex.cloud`, oder ein Wechsel auf eine zentral geteilte Instanz mit echtem TLS. Dabei auch die
  Quadlet-Vorlagen auf `HATCHET_CLIENT_HOST_PORT`/`HATCHET_CLIENT_API_URL` korrigieren (siehe „Not
  in scope") und das geteilte-Netzwerk-Muster aus Entscheidung 1 auf Podman/Quadlet übertragen
  (`podman network create` + `Network=` in der `.container`-Unit statt Docker Compose `networks:`).
- Ein zweiter Dienst (nicht vereinsfunk) braucht ebenfalls Hatchet — dann `roles/hatchet` von einer
  vereinsfunk-implizierten Annahme lösen und als generische, mandantenfähige Abhängigkeit
  dokumentieren, bevor eine zweite Rolle sie referenziert.
- Der Bootstrap in Step 3 zeigt, dass ein `hatchet-admin`-Token nach einem Hatchet-Container-Neustart
  ungültig wird (persistente Verschlüsselungs-Keys/DB greifen nicht wie erwartet) — dann vor Step 4
  klären, ob das an der Volume-Konfiguration liegt oder ein grundsätzliches Hatchet-Verhalten ist.
