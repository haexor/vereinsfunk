# 038 – Hatchet produktiv betreiben (das Operations-Gate aus Plan 004 schließen)

- **Category**: infrastructure, reliability
- **Planned at**: commit `4a701cad`, 2026-08-13
- **Umsetzungsstand**: erledigt — im `ansible`-Repo umgesetzt (Commits `ed096a2`/`f08a6c1`,
  2026-08-13), unabhängig von dieser Codebasis. Details und eine Abweichung von Entscheidung 1
  (Shared-Network statt `host.docker.internal`) stehen in `docs/operations/hatchet.md`. Diese
  Plandatei bleibt als historischer Entwurf stehen; die Umsetzung selbst weicht an einer Stelle
  begründet davon ab.

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

1. **Deployment-Topologie: co-located auf haex.space, nur Loopback, kein Traefik-Routing.**
   `infrastructure/hatchet/docker-compose.yml` bindet `hatchet-engine` (gRPC, 7077) und
   `hatchet-api` (REST/Dashboard, 8080) bereits nur an `127.0.0.1` und trägt den Kommentar „gRPC ist
   loopback-only, sodass der root application compose stack darüber via `host.docker.internal`
   erreichen kann" — das war offenbar von Anfang an für genau dieses Produktions-Szenario gedacht,
   nicht nur für lokale Entwicklung. Läuft Hatchet auf demselben Host wie `vereinsfunk-api`/
   `-worker`, brauchen wir weder ein öffentliches Hostname/TLS-Zertifikat noch eine
   Netzwerk-Härtung über den Host hinaus — nur `extra_hosts: ["host.docker.internal:host-gateway"]`
   in `vereinsfunk-api`/`-worker`s Compose-Service (Docker-Pfad) bzw. `AddHost=` in der Quadlet-Unit
   (Podman-Pfad unterstützt dieselbe Syntax), damit die Container den Host unter diesem Namen
   erreichen. Alternative (ein zentral geteilter Hatchet für mehrere Hosts mit echtem TLS) wäre mehr
   Betriebsaufwand für einen Bedarf, der heute nicht existiert — `haex.cloud`s `vereinsfunk`-Eintrag
   hat `supabase.url: ""` und ist laut Kommentar „Bootstrap-only", also nicht produktiv aktiv (siehe
   STOP conditions, falls sich das ändert).
2. **Eigene, dedizierte Postgres-Instanz für Hatchet**, kein Anschluss an eine geteilte
   Postgres-Rolle. Präzedenzfall im Repository: `roles/postgres` ist trotz generischen Namens
   `specifyr`-spezifisch, es gibt kein Muster für eine von mehreren Apps geteilte Postgres-Instanz.
   Isolierter Fehlerraum, keine Versions-/Migrationskopplung mit anderen Diensten, deckt sich mit
   `infrastructure/hatchet/docker-compose.yml`s eigenem `hatchet-postgres`-Service.
3. **`SERVER_AUTH_COOKIE_INSECURE`/`SERVER_GRPC_INSECURE` bleiben `true`.** Beide Ports sind
   Loopback-only und verlassen den Host nie — dieselbe Vertrauensgrenze, die schon für
   `DATABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` auf demselben Host gilt. Echtes TLS wäre zusätzlicher
   Zertifikats-/Rotationsaufwand ohne echten Sicherheitsgewinn, solange Entscheidung 1 gilt.
4. **Dashboard (`hatchet-api`, Port 8080) bleibt ohne Traefik-Route.** Für Betriebsvorfälle
   (`docs/operations/hatchet.md`, „Tokenrotation", „Outbox-Stau") reicht ein SSH-Tunnel
   (`ssh -L 8080:127.0.0.1:8080 haex.space`) — eine öffentliche Route für ein internes Admin-UI
   wäre zusätzliche Angriffsfläche ohne begründeten Bedarf. Kann jederzeit nachgerüstet werden, ohne
   an dieser Entscheidung hier zu hängen.
5. **Namensfehler in den bestehenden Templates korrigieren**: `HATCHET_SERVER_URL`/`HATCHET_API_URL`
   → `HATCHET_CLIENT_HOST_PORT`/`HATCHET_CLIENT_API_URL`, passend zu `WorkerEnvironmentSchema`.
   Kein neues Feld, reine Korrektur eines stillen Drifts.
6. **Bootstrap-Reihenfolge für das Worker-Token ist zweistufig, nicht in einem Playbook-Lauf
   lösbar.** `hatchet-admin token create` kann erst laufen, nachdem der frisch geseedete Tenant
   existiert — das Token kann also nicht vorab in `secrets/<host>.yml` stehen wie jedes andere
   Secret. Ablauf: (a) Playbook einmal nur mit der neuen `hatchet`-Rolle laufen lassen (Tag-Filter),
   (b) Operator erzeugt das Token manuell nach dem in `docs/operations/hatchet.md` beschriebenen
   Muster, aber mit einer produktionstauglichen Ablaufzeit (nicht `--expiresIn 1h`), (c) Token in
   `secrets/haex.space.yml` unter `vereinsfunk.hatchet_client_token` eintragen, (d) Playbook erneut
   voll laufen lassen. Dasselbe Muster wie `PLATFORM_ADMIN_DEFAULT_EMAIL` (Konto muss vorher per Hand
   existieren, bevor die Rolle es referenzieren kann).

## Steps

### Step 0 (Spike): Hatchet-CLI-Images und Health-Reihenfolge gegen einen Wegwerf-Host verifizieren

Bevor Ansible-Code entsteht: `infrastructure/hatchet/docker-compose.yml` mit frisch generierten
Secrets (keine Platzhalter) auf einem Wegwerf-Host oder in einer VM hochziehen, exakt die in
Entscheidung 6 beschriebene Bootstrap-Reihenfolge durchspielen (inkl. `hatchet-admin token create`
mit einer langen Ablaufzeit), und mit dem resultierenden Token einen `vereinsfunk-worker`-Container
lokal gegen dieses „produktionsnahe" Setup starten (nicht gegen den Repo-lokalen Loopback-Stack, der
bereits über `pnpm`-Skripte läuft). Bestätigt: Boot-Reihenfolge (`hatchet-migrate` →
`hatchet-admin` → `hatchet-engine`/`hatchet-api`), `host.docker.internal`-Erreichbarkeit aus einem
separaten Compose-Projekt heraus, und dass ein einmal erzeugtes Token nach Neustart aller
Hatchet-Container gültig bleibt (persistente `hatchet-postgres-data`-Volume-Anbindung).

### Step 1: `roles/hatchet` (neue, eigenständige Ansible-Rolle im `ansible`-Repository)

Templates aus `infrastructure/hatchet/docker-compose.yml`/`.env.example` übernehmen (Jinja2-Werte
statt `${...}`-Platzhaltern), Schlüsselgenerierung (`hatchet-admin keyset create-local-keys`) als
einmaliger `command`-Task mit `creates:`-Guard (idempotent — nur ausführen, wenn `keys/` noch nicht
existiert). Rolle unabhängig von `vereinsfunk` in `haex.space.play.yml` einhängen (wie `postgres`
unabhängig von `specifyr` eingehängt ist), nicht als Sub-Task der `vereinsfunk`-Rolle — Hatchet ist
konzeptionell eine eigene, von mehreren zukünftigen Konsumenten nutzbare Abhängigkeit, keine
vereinsfunk-spezifische Ressource.

### Step 2: `vereinsfunk`-Rolle korrigieren

`HATCHET_SERVER_URL`/`HATCHET_API_URL` in `env.j2`, `docker-compose.yml.j2` und beiden
Quadlet-Templates durch `HATCHET_CLIENT_HOST_PORT`/`HATCHET_CLIENT_API_URL` ersetzen
(Entscheidung 5). `extra_hosts` (Docker-Pfad) bzw. `AddHost=` (Quadlet-Pfad) für
`vereinsfunk-api`/`-worker` ergänzen, damit `host.docker.internal` auflösbar ist.
`vereinsfunk.hatchet.server_url`/`api_url` in `roles/vereinsfunk/defaults/main.yml` und
`inventory/haex.space.yml` entsprechend umbenennen/anpassen.

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
# Step 0/3: Keys und Token, produktionsnahe Ablaufzeit statt der lokalen 1h
docker run --rm -v "$PWD/keys:/keys" --entrypoint /hatchet/hatchet-admin \
  ghcr.io/hatchet-dev/hatchet/hatchet-admin:v0.98.9 keyset create-local-keys --key-dir /keys
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

## Done criteria

- [x] `roles/hatchet` existiert im `ansible`-Repository, unabhängig von `vereinsfunk` eingehängt,
      mit frisch generierten (nicht Platzhalter-)Secrets in `secrets/haex.space.yml`.
- [x] `HATCHET_CLIENT_HOST_PORT`/`HATCHET_CLIENT_API_URL` ersetzen `HATCHET_SERVER_URL`/
      `HATCHET_API_URL` im Docker-Pfad (haex.space) — **abweichend von diesem Plan** über ein
      gemeinsames Docker-Netzwerk statt `host.docker.internal` (siehe Umsetzungsstand oben); der
      Quadlet-Pfad (haex.cloud) trägt die alten Namen bewusst weiter, da nicht aktiv.
- [x] Bootstrap-Reihenfolge aus Entscheidung 6 real gegen haex.space durchgeführt, echtes
      Worker-Token in `secrets/haex.space.yml` hinterlegt.
- [x] `docker logs vereinsfunk-worker` zeigt einen registrierten Hatchet-Worker statt einer
      `ZodError`; `docker inspect`s `RestartCount` bestätigt `0` bei laufendem Container,
      `generation-recovery-scan` vollzieht seinen Fünf-Minuten-Takt erfolgreich (verifiziert 2026-08-14).
- [x] `docs/operations/hatchet.md` und `plans/README.md` (Plan 004) spiegeln den tatsächlich
      erreichten Produktionsstand wider.

## STOP conditions

- `haex.cloud`s `vereinsfunk`-Eintrag wird produktiv aktiviert (echte `supabase.url` statt `""`) —
  dann Entscheidung 1 neu bewerten: entweder eine zweite, eigene co-located Hatchet-Instanz auf
  `haex.cloud`, oder ein Wechsel auf eine zentral geteilte Instanz mit echtem TLS.
- Ein zweiter Dienst (nicht vereinsfunk) braucht ebenfalls Hatchet — dann `roles/hatchet` von einer
  vereinsfunk-implizierten Annahme lösen und als generische, mandantenfähige Abhängigkeit
  dokumentieren, bevor eine zweite Rolle sie referenziert.
- Der Bootstrap in Step 3 zeigt, dass ein `hatchet-admin`-Token nach einem Hatchet-Container-Neustart
  ungültig wird (persistente Verschlüsselungs-Keys/DB greifen nicht wie erwartet) — dann vor Step 4
  klären, ob das an der Volume-Konfiguration liegt oder ein grundsätzliches Hatchet-Verhalten ist.
