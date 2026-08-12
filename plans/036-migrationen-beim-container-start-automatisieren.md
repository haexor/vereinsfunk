# Plan 036: Datenbank-Migrationen automatisch beim Container-Start anwenden

> **Executor instructions**: Dieses Dokument vollständig lesen, die Schritte in Reihenfolge ausführen und nach jedem Schritt verifizieren. Bei einer STOP-Bedingung anhalten und berichten. Danach den Status dieses Plans im Index (`plans/README.md`) aktualisieren.
>
> **Drift check (run first)**: `git log -1 --format=%H -- supabase/migrations` und vergleichen, ob seither neue Migrationen dazugekommen sind, die dieser Plan noch nicht kennt. Zusätzlich prüfen, ob `supabase` in der Root-`package.json` noch `2.111.0` ist (Step 0 hängt an der genauen `db push`-Flag-Syntax dieser Version) und ob `/home/haex/Projekte/ansible/roles/vereinsfunk` seit `2026-08-12` verändert wurde (Cross-Repo-Abhängigkeit, siehe Step 4).
>
> **Cross-Repo-Hinweis**: Dieser Plan liegt im App-Repository (`vereinsfunk`), verlangt aber zwingend eine begleitende Änderung im separaten Infrastruktur-Repository unter `~/Projekte/ansible` (Rolle `roles/vereinsfunk`). Ohne Step 4 ist dieser Plan nicht vollständig umsetzbar — die Reihenfolge in „Steps" markiert das explizit.

## Status

- **Priority**: P1 (die konkrete Lücke, die am 2026-08-12 zum produktiven Ausfall der Plattform-Admin-Übersicht geführt hat: Migration `2026081208` war Minuten nach dem Merge live im Code, aber nicht in der Datenbank)
- **Effort**: M
- **Risk**: MEDIUM-HIGH — führt das erste direkte, DDL-fähige Postgres-Credential in einen bisher rein PostgREST/Service-Role-basierten Codepfad ein; Fehlverhalten bei einer kaputten Migration ist bewusst ein harter Container-Crash-Loop, kein stiller Fallback.
- **Depends on**: keine (unabhängig von den übrigen offenen Plänen); betrifft aber jedes künftige Paket mit einer neuen Migration
- **Category**: infrastructure, reliability, ops
- **Planned at**: commit `a8707e63`, 2026-08-12
- **Umsetzungsstand**: App-Repo-Teil (Steps 0–3, 5) erledigt und lokal verifiziert; Step 4 (Ansible-Repo) aussteht als eigener PR in `~/Projekte/ansible`. Der akute Produktionsausfall ist bereits behoben (19 nachgezogene Migrationen, siehe „Umsetzung: Ergebnis und Abweichungen vom Plan").

## Why this matters

Am 2026-08-12 zeigte `/plattform-admin` (Übersicht) `{"error":"internal_error"}` statt der Vereinsliste. Ursache, direkt gegen die produktive Supabase-Instanz verifiziert (PostgREST-Fehler `PGRST202: Could not find the function public.count_platform_admin_organization_totals ... in the schema cache`): Die Migration `supabase/migrations/2026081208_platform_admin_org_counts_batch.sql`, Teil desselben Merges wie der Code, der die Funktion aufruft (`apps/api/src/routes/platformAdmin.ts:180`), war zwar im Repository und im gebauten Image, aber nie gegen die produktive Datenbank angewendet worden.

Root Cause, nicht nur Symptom: Der Rollout-Mechanismus dieses Projekts entkoppelt Code-Deploy und Schema-Migration vollständig, ohne dass irgendein Bestandteil das merkt.

- `.github/workflows/images.yml` baut bei jedem Merge auf `main` neue Images und pusht sie zu GHCR.
- Watchtower auf haex.space pollt GHCR pro Container (`com.centurylinklabs.watchtower.enable: true`) und tauscht `vereinsfunk-api`/`-web`/`-worker` automatisch aus, sobald ein neues `:latest`-Image erscheint — vollautomatisch, ohne dass ein Mensch oder ein anderes System beteiligt ist.
- Die Ansible-Rolle, die `docker-compose.yml`/`.env` rendert, läuft laut eigenem Kommentar (`roles/vereinsfunk/tasks/main.yml:2-5`) nur bei Config-Änderungen erneut — „Re-running the role is how config changes ship, not how new code ships." Sie hat mit dem laufenden Watchtower-Rollout nichts zu tun.
- Dieselbe Rolle fasst Supabase bewusst nicht an (`main.yml:25-27`, Verweis auf ADR-001: ein geteiltes, gemanagtes Supabase-Projekt statt einer selbst betriebenen Instanz).
- Nirgendwo in dieser Kette — nicht in `images.yml`, nicht in der Ansible-Rolle, nicht im Container selbst — gibt es einen Schritt, der `supabase/migrations/*.sql` gegen die produktive Datenbank anwendet.

Ergebnis: Ein Merge, der eine neue RPC/Spalte voraussetzt, geht binnen Minuten live; die Migration, die diese RPC erst anlegt, bleibt liegen, bis sie jemand manuell pusht. Der Nutzer hat vorgeschlagen, die Migration bei jedem Container-Start laufen zu lassen — dieser Plan arbeitet das aus.

## Current state

- `apps/api/src/server.ts:1-15` — einziger heutiger Boot-Hook: `bootstrap_platform_admin` per RPC, Fehler wird nur geloggt (`app.log.warn`), der Server startet trotzdem. Bewusst so, weil ein fehlender `auth.users`-Eintrag kein Blocker sein soll — **kein Vorbild für Migrationsfehler** (siehe Entscheidung 4 unten).
- `apps/api/Dockerfile` (multi-stage, `node:24-bookworm-slim`, `pnpm --filter @vereinsfunk/api deploy --legacy --prod`) und `apps/worker/Dockerfile` (identisches Muster) kopieren nur `packages/`, `apps/` und deren `--prod`-Abhängigkeiten in das Laufzeit-Image. `supabase/migrations/` wird von keinem der beiden Images kopiert; die Root-`devDependency` `supabase` (npm-Wrapper um die Go-Binary) landet nicht im `--prod`-Baum.
- Root-`package.json:34` — `supabase: 2.111.0` bereits vorhanden, genutzt für `db:start`/`db:reset`/`db:test` (`package.json:16-19`), aber nur lokal/CI, nie im produktiven Laufzeit-Image.
- Kein Paket in diesem Repository hält eine direkte Postgres-Verbindung oder einen `pg`/`postgres`-npm-Treiber (Grep über `apps/api`, `apps/worker`: nur `@supabase/supabase-js`, also PostgREST/Auth-Admin-API, nie ein roher SQL-Connect). Dieser Plan führt diese Fähigkeit zum ersten Mal ein.
- `packages/config/src/index.ts` — zod-validiertes Environment-Schema, das `apps/api` und `apps/worker` importieren; bestehendes Muster für Pflicht-/Optional-Felder (`SUPABASE_URL: z.url()`, `SUPABASE_SERVICE_ROLE_KEY: z.string().min(1)`, `superRefine` für bedingte Pflichtfelder).
- `apps/api/Dockerfile:40-41` — `HEALTHCHECK` gegen `/health`. `apps/worker/Dockerfile` hat **keinen** Healthcheck (Kommentar: „the worker pulls work rather than serving it"). Für diesen Plan irrelevant, da die Migrations-Serialisierung nicht über Healthchecks gelöst wird (siehe Entscheidung 5).
- `~/Projekte/ansible/roles/vereinsfunk/` (separates Repository) — rendert `.env` (`templates/env.j2`, 0600) und `docker-compose.yml` (`templates/docker-compose.yml.j2`, 0644) aus Ansible-Variablen; `tasks/deploy_docker.yml` macht `docker compose pull && up`. Aktuell keine `DATABASE_URL`/Postgres-Connection-Variable vorgesehen — nur `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_JWT_SECRET`.
- Produktives Supabase-Projekt: `kykcbpcwmmahinpvzaqt.supabase.co` (Supabase Cloud, geteiltes Projekt für alle Vereine laut ADR-001) — kein selbst gehosteter Postgres-Container, der Server hat nur einen REST/Auth-Endpunkt, keine direkte DB-Erreichbarkeit heute konfiguriert.

## Entscheidungen (mit dem Nutzer abgestimmt, 2026-08-12)

1. **Auslöseort: innerhalb des eigenen Boots von `vereinsfunk-api` UND `vereinsfunk-worker`**, nicht ein separater One-Shot-Compose-Service mit `depends_on: condition: service_completed_successfully`. Ein solcher sauberer, eigenständiger Migrations-Service wurde erwogen und verworfen: er liefe nur bei einem expliziten `docker compose up` — also einem erneuten Ansible-Lauf — mit, nicht bei einem reinen Watchtower-Image-Swap, der laut „Why this matters" der eigentliche, unbeaufsichtigte Rollout-Pfad ist. Nur ein Hook, der bei **jedem Prozessstart** läuft, wird von Watchtowers Modell zuverlässig ausgelöst — exakt der vom Nutzer vorgeschlagene Ansatz.
2. **Werkzeug: die Supabase-CLI (`supabase db push`)**, kein selbstgebauter Migrations-Runner. Begründung: bereits Root-`devDependency`, exakt dasselbe Werkzeug wie der heutige manuelle Push vom Entwicklerrechner, schreibt in dieselbe `supabase_migrations.schema_migrations`-Tabelle wie lokale Entwicklung — kein zweites, parallel gepflegtes Tracking-Format, keine neue Ordnungslogik für Migrationsdateien.
3. **Zugriffsrechte: volle `postgres`-Verbindung** (Nutzer hat sich für diese Option entschieden, gegen eine eigens zugeschnittene Migrations-Rolle). Dieselben Rechte, mit denen Migrationen heute schon manuell vom Entwicklerrechner eingespielt werden. Bewusster Trade-off: größerer Blast-Radius als das bestehende `service_role`-Muster (das nur PostgREST/RLS-Bypass kann, kein DDL) — falls der `vereinsfunk-api`- oder `vereinsfunk-worker`-Prozess je kompromittiert wird, hätte ein Angreifer damit vollen Schreib-/Schema-Zugriff, nicht nur API-Zugriff. Akzeptiert für den Preis, keine zusätzliche Postgres-Rolle in Supabase anlegen und pflegen zu müssen. Nachträglich ergänzte Auflagen (CodeRabbit-Review PR #54; Entscheidung selbst bleibt bestehen, das sind zusätzliche Sicherungen dagegen): `DATABASE_URL` darf nie geloggt werden (auch nicht versehentlich über `stderr` des `supabase`-Kindprozesses — Step 2 muss diesen vor dem Weiterreichen an `logger` maskieren); `docs/operations/deploy.md` (Step 5) muss beschreiben, wie das `postgres`-Credential im Vault/Ansible-Inventory rotiert wird und was bei Verdacht auf Kompromittierung des `vereinsfunk-api`- oder `vereinsfunk-worker`-Prozesses zu tun ist.
4. **Fehlverhalten bei einer kaputten Migration: hart fehlschlagen.** Prozess beendet sich mit Exit-Code ≠ 0, **nicht** wie `bootstrap_platform_admin` nur loggen und weiterlaufen. Ein Container, der wegen einer fehlerhaften Migration über die bestehende `restart: unless-stopped`/`on-failure`-Policy endlos neu startet, ist ein sichtbarer, in `docker ps`/Watchtower-Logs erkennbarer Zustand. Eine API, die still gegen ein halb migriertes Schema weiterläuft, ist genau der unsichtbare Fehler, der diesen Plan ausgelöst hat — dasselbe Muster darf sich hier nicht wiederholen.
5. **Nebenläufigkeit zwischen `vereinsfunk-api` und `vereinsfunk-worker`** (beide migrieren bei ihrem jeweils eigenen, unabhängigen Start): **kein** expliziter Advisory-Lock, **keine** neue `pg`-Laufzeitabhängigkeit im Anwendungscode. `supabase db push` wendet jede Migration in einer eigenen Transaktion an und trägt die Version in `schema_migrations` ein; starten beide Prozesse zufällig gleichzeitig und wollen dieselbe, noch ausstehende Migration anwenden, kollidieren sie auf Postgres-Ebene (Objekt-Lock bzw. Primärschlüsselverletzung in `schema_migrations`) — der Verlierer bricht mit einem klaren Fehler ab und startet über die vorhandene Restart-Policy neu; zu dem Zeitpunkt ist die Migration vom Gewinner bereits angewendet, der zweite Versuch findet nichts Ausstehendes mehr vor. Dieses Verhalten wird in Step 0 tatsächlich am produktiven Projekt-Klon (bzw. einem Vorschau-Zweig) verifiziert, nicht nur angenommen. Skaliert der Dienst je auf mehrere Replikas **desselben** Service, ist das neu zu bewerten (siehe STOP conditions) — heute laufen laut `docker-compose.yml` je Dienst genau eine Instanz.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| CLI-Verhalten spiken (Step 0) | `pnpm exec supabase db push --db-url "$DATABASE_URL"` gegen ein Wegwerf-/Vorschau-Projekt | wendet ausstehende Migrationen an, exit 0; erneuter Aufruf ohne Änderungen: exit 0, „Already up to date" |
| Unit-Tests betroffener Pakete | `pnpm --filter @vereinsfunk/api --filter @vereinsfunk/worker --filter @vereinsfunk/config test` | exit 0 |
| Typecheck | `pnpm --filter @vereinsfunk/api --filter @vereinsfunk/worker --filter @vereinsfunk/config typecheck` | exit 0 |
| Docker-Image lokal bauen und Boot-Hook prüfen (API) | `docker build -f apps/api/Dockerfile -t vereinsfunk-api:test .` dann `docker run --rm -e DATABASE_URL=... -e ... vereinsfunk-api:test` | Log zeigt Migrationslauf vor „server listening"; Container beendet sich bei absichtlich kaputter Test-Migration mit Exit ≠ 0 |
| Docker-Image lokal bauen und Boot-Hook prüfen (Worker) | `docker build -f apps/worker/Dockerfile -t vereinsfunk-worker:test .` dann `docker run --rm -e DATABASE_URL=... -e ... vereinsfunk-worker:test` | Log zeigt Migrationslauf vor der ersten Hatchet-Worker-Registrierung; Container beendet sich bei absichtlich kaputter Test-Migration mit Exit ≠ 0, ohne dass je ein Hatchet-Worker registriert wird |
| Voller Gate | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | exit 0 |
| Ansible-Rolle syntaktisch prüfen (im ansible-Repo) | `ansible-playbook --syntax-check <playbook>.yml` | exit 0 |

## Scope

**In scope**

- Neue, gemeinsam genutzte Boot-Funktion `runPendingMigrations()` (neues, kleines Package, z. B. `packages/db-migrate`), die `supabase db push --db-url $DATABASE_URL` als Kindprozess ausführt und bei Exit ≠ 0 selbst mit Exit ≠ 0 beendet.
- `apps/api/src/server.ts`: Aufruf direkt nach `parseApiEnvironment()` (Zeile 5, unverändert die erste Zeile der Datei — `DATABASE_URL` muss validiert vorliegen, bevor der Hook es verwenden kann), aber **vor** `buildApp()`/`app.listen()` und vor dem bestehenden `bootstrap_platform_admin`-Aufruf.
- `apps/worker/src/index.ts`: identischer Aufruf direkt nach `const config = parseWorkerEnvironment()` in `main()` (Zeile 57, unverändert), vor jeder Hatchet-Worker-Registrierung (`createHatchetWorker(...)`, Zeile 66).
- `apps/api/Dockerfile`, `apps/worker/Dockerfile`: `supabase/migrations/` in das Laufzeit-Image kopieren; die `supabase`-CLI als Production-Dependency des neuen `packages/db-migrate` mitziehen (nicht mehr nur Root-`devDependency`).
- `packages/config`: neues Pflichtfeld `DATABASE_URL` (validiert als Postgres-Connection-String) in `ApiEnvironmentSchema` und im Worker-Pendant.
- `~/Projekte/ansible/roles/vereinsfunk`: `templates/env.j2` um `DATABASE_URL` erweitern, `templates/docker-compose.yml.j2` gibt sie an `vereinsfunk-api` und `vereinsfunk-worker` weiter (nicht an `vereinsfunk-web`), `defaults/main.yml`/Vault-Variablen entsprechend ergänzen. **Eigene PR in diesem separaten Repository.**
- `docs/operations/deploy.md` (neu): der jetzt automatisierte Migrationsweg, plus was zu tun ist, wenn ein Container deshalb crash-loopt.
- `plans/README.md`: Eintrag für Plan 036.

**Out of scope**

- Ein eigens zugeschnittenes Postgres-Rollenmodell für Migrationen (Entscheidung 3 — bewusst zurückgestellt, volle `postgres`-Verbindung gewählt).
- Expliziter Advisory-Lock/`pg`-Abhängigkeit (Entscheidung 5 — natürliche DB-Kollision plus Restart-Policy reicht für den heutigen Single-Instance-Betrieb).
- Ein separater One-Shot-Compose-Migrations-Service (Entscheidung 1 — passt nicht zu Watchtowers Rollout-Modell).
- Automatisierte `down`-Migrationen/Rollback-Tooling — dieser Plan macht das Anwenden zuverlässig, nicht das Zurückrollen einer bereits angewendeten Migration.
- Jede Änderung an `vereinsfunk-web` — der Web-Container spricht nie direkt mit Postgres.
- Multi-Replika-Betrieb desselben Dienstes (siehe STOP conditions).

## Steps

### Step 0 (Spike, vor jedem Code): CLI-Non-Interaktivität und Kollisionsverhalten verifizieren

Bevor irgendein Container-/Ansible-Code entsteht, am produktiven `supabase`-CLI-Stand (`2.111.0`) gegen ein Wegwerf-Supabase-Projekt (nicht `kykcbpcwmmahinpvzaqt`) klären:

- Exakte non-interaktive Flag-Syntax für `db push` gegen eine reine `--db-url`-Verbindung, ohne vorheriges `supabase link` und ohne Rückfrage-Prompts (für einen unbeaufsichtigten Container-Start zwingend).
- Ob die direkte Verbindung (`db.<ref>.supabase.co:5432`) oder der Session-Mode-Pooler nötig ist — Transaction-Mode-Pooling ist für DDL/Advisory-Locks bekanntermaßen ungeeignet und muss ausdrücklich vermieden werden.
- Das in Entscheidung 5 angenommene Kollisionsverhalten: zwei parallele `db push`-Aufrufe gegen dieselbe ausstehende Migration tatsächlich gleichzeitig auslösen und beobachten, dass einer sauber fehlschlägt statt die Migration doppelt/teilweise anzuwenden.
- Ob `supabase db push` bei bereits vollständig angewendetem Stand tatsächlich exit 0 liefert (Idempotenz für den Normalfall „nichts Neues zu tun" bei jedem gewöhnlichen Container-Neustart ohne neue Migration).

**Verify**: alle vier Punkte oben tatsächlich beobachtet, nicht nur aus der CLI-Dokumentation übernommen. Ergebnis kurz in diesem Plan unter „Umsetzung: Ergebnis und Abweichungen vom Plan" festhalten, bevor Step 1 beginnt.

### Step 1: `DATABASE_URL` als validiertes Pflichtfeld einführen

`packages/config/src/index.ts`: `DATABASE_URL` als eigenes Zod-Schema, das nicht nur „nicht leer" prüft, sondern tatsächlich ein Postgres-Connection-String-Schema verlangt (`z.string().regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// or postgresql:// connection string')` o. Ä. — `z.url()` scheidet aus, da es beliebige Schemata akzeptiert und damit auch nicht-Postgres-URLs durchließe; `optionalUrl` scheidet aus, weil das Feld nicht optional ist) zu `ApiEnvironmentBaseSchema` und zum Worker-Pendant hinzufügen, in die `required`-Liste (Zeile ~83) aufnehmen. Lokale `.env`/`supabase/seed`-Dokumentation ergänzen, welchen Wert die lokale Supabase-Instanz dafür liefert (`supabase status` zeigt die lokale Connection-URL).

**Verify**: `pnpm --filter @vereinsfunk/config test` — neue Testfälle: (1) fehlendes `DATABASE_URL` verweigert den Server- bzw. Worker-Start mit einer klaren Fehlermeldung, analog zu den bestehenden Tests für `SUPABASE_URL`; (2) ein gültiger `postgresql://...`-Wert wird akzeptiert; (3) ein nichtleerer, aber schemafremder Wert (z. B. `not-a-url`, `https://example.com`) wird abgelehnt, statt unbehandelt bis in den Boot-Hook durchzurutschen.

### Step 2: `packages/db-migrate` — der gemeinsame Boot-Hook

Neues, kleines Package `packages/db-migrate` mit einer Funktion `runPendingMigrations({ databaseUrl, migrationsDir, logger })`, die die `supabase`-CLI als Kindprozess (`node:child_process`, `execFileSync` oder äquivalent) mit der in Step 0 verifizierten Flag-Syntax aufruft. Bei Exit ≠ 0: die Funktion wirft; der Aufrufer (Step 3) lässt diesen Fehler unbehandelt den Prozess beenden (Entscheidung 4 — kein try/catch, das den Fehler nur loggt).

Die CLI-Binary wird **nicht** über `PATH` aufgelöst (`execFileSync('supabase', ...)` würde im Laufzeit-Image mit `ENOENT` scheitern, da `apps/api/Dockerfile`/`apps/worker/Dockerfile` `PATH` nicht um `node_modules/.bin` erweitern), sondern über einen deterministisch aufgelösten absoluten Pfad, z. B. `path.join(path.dirname(require.resolve('supabase/package.json')), 'bin', 'supabase')` (exakten Pfad anhand des installierten `supabase`-npm-Pakets in Step 0/2 verifizieren).

`stdout`/`stderr` des Kindprozesses dürfen nie ungeprüft geloggt werden, ohne vorher `databaseUrl` darin zu maskieren (siehe Entscheidung 3) — die Fehlermeldung, die die Funktion wirft, ersetzt jedes Vorkommen der Connection-URL durch einen Platzhalter.

Hartes Timeout für den Kindprozess (begründeter Wert, z. B. 120 s — deutlich über der in Step 0 beobachteten Normal-Laufzeit von `db push` gegen wenige ausstehende Migrationen, aber klein genug, um einen hängenden Container nicht unbegrenzt im Crash-Loop zu belassen): läuft die Zeit ab, wird der Kindprozess beendet (`kill`) und die Funktion wirft mit einer eindeutigen Timeout-Fehlermeldung statt unbegrenzt zu blockieren.

`supabase` wandert von einer Root-`devDependency` zu einer Production-`dependency` von `packages/db-migrate` (bleibt zusätzlich Root-`devDependency` für lokale `db:*`-Skripte — beide Einträge koexistieren, keine Dopplung der eigentlichen Binary dank pnpms Content-addressed Store).

**Verify**: `packages/db-migrate` bekommt einen eigenen Test mit einem Fake-Kindprozess (kein echter Datenbankzugriff im Unit-Test) — Exit 0 löst nichts aus, Exit ≠ 0 wirft mit dem (maskierten) `stderr`-Inhalt in der Fehlermeldung, ein Timeout-Fall beendet den Kindprozess und wirft mit einer Timeout-Fehlermeldung statt zu hängen.

### Step 3: Boot-Hooks in `apps/api` und `apps/worker`, Laufzeit-Images erweitern

`apps/api/src/server.ts`: `await runPendingMigrations(environment.DATABASE_URL, ...)` direkt nach der bestehenden `parseApiEnvironment()`-Zeile (Zeile 5) und noch vor `buildApp()` (Zeile 6) einfügen — die Konfiguration muss zuerst validiert werden (sonst hat der Hook kein geprüftes `DATABASE_URL`), aber nichts danach im Prozess darf vor einer erfolgreichen Migration auch nur eine Route registrieren oder eine DB-Abfrage vorbereiten. Der bestehende `bootstrap_platform_admin`-Aufruf (Zeile 10-15) bleibt unverändert danach.

`apps/worker/src/index.ts`: identischer Aufruf in `main()` direkt nach `const config = parseWorkerEnvironment()` (Zeile 57) und vor `createHatchetWorker(...)` (Zeile 66).

`apps/api/Dockerfile`, `apps/worker/Dockerfile`: `COPY supabase/migrations ./supabase/migrations` in der `runtime`-Stage ergänzen (Pfad relativ zum `WORKDIR /app`, konsistent mit dem CLI-Aufruf aus Step 0/2). Prüfen, ob `supabase db push` zusätzlich `supabase/config.toml` oder nur den `migrations`-Ordner braucht (Ergebnis aus Step 0).

**Verify**: beide Kommandos aus der Tabelle oben („Docker-Image lokal bauen und Boot-Hook prüfen (API)" **und** „... (Worker)") — je ein frisch gebautes Image gegen die lokale Supabase-Instanz zeigt den Migrationslauf im Log vor „server listening" (API) bzw. vor der ersten Hatchet-Worker-Registrierung (Worker); ein Testlauf mit einer absichtlich fehlerhaften zusätzlichen Migrationsdatei beendet **beide** Container mit Exit ≠ 0, ohne dass die API je auf Port `4201` lauscht oder der Worker je einen Hatchet-Worker registriert.

### Step 4: Ansible-Rolle erweitern (separates Repository `~/Projekte/ansible`)

Eigene PR in diesem Repository, nicht Teil des `vereinsfunk`-Merges:

- `roles/vereinsfunk/templates/env.j2`: neue Zeile für `DATABASE_URL`.
- `roles/vereinsfunk/templates/docker-compose.yml.j2`: `DATABASE_URL: ${DATABASE_URL}` bei `vereinsfunk-api` und `vereinsfunk-worker` ergänzen (nicht bei `vereinsfunk-web`).
- `roles/vereinsfunk/templates/quadlet/vereinsfunk-api.container.j2`, `vereinsfunk-worker.container.j2`: dieselbe Variable für den Podman/Quadlet-Pfad (haex.cloud), damit beide Laufzeit-Varianten (Docker auf haex.space, Quadlet auf haex.cloud laut `main.yml:7-12`) konsistent bleiben.
- Wo auch immer die übrigen Secrets (`SUPABASE_SERVICE_ROLE_KEY` etc.) für dieses Rollen-Inventar verwaltet werden (Vault/Inventory-Datei, nicht Teil dieses Repositorys) — `DATABASE_URL` nach demselben Muster ablegen, mit dem echten `postgres`-Connection-String für `kykcbpcwmmahinpvzaqt.supabase.co` aus dem Supabase-Dashboard (Project Settings → Database → Connection string, **Direct connection**, nicht „Transaction pooler").
- Danach: **einmalig** `ansible-playbook` gegen haex.space laufen lassen, um `.env`/`docker-compose.yml` mit der neuen Variable neu zu rendern und die drei Container einmal neu zu starten — ab diesem Zeitpunkt genügt jeder weitere Watchtower-Swap von selbst.

**Verify**: nach dem Ansible-Lauf `ssh haex.space` und `docker inspect vereinsfunk-api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -c DATABASE_URL` liefert `1` (nur die Existenz prüfen, niemals den Wert ausgeben/loggen). Danach einen harmlosen, bereits angewendeten Zustand beobachten: `docker logs vereinsfunk-api` zeigt den Migrationslauf mit „nothing to do"/Äquivalent, keine Fehlermeldung.

### Step 5: Dokumentation und Plan-Index aktualisieren

Neue Datei `docs/operations/deploy.md`: beschreibt den jetzt automatischen Migrationsweg (Watchtower-Swap → Container-Boot → `runPendingMigrations` → Server startet erst danach), was ein crash-loopender Container wegen einer kaputten Migration bedeutet und wie man reagiert (Migration korrigieren und neu pushen zu `main`, **nicht** den Container manuell mit `--no-verify`-artigen Mitteln am Boot-Hook vorbeischleusen). Ergänzt außerdem, wie das `postgres`-Credential aus Entscheidung 3 im Vault/Ansible-Inventory rotiert wird und was bei Verdacht auf Kompromittierung von `vereinsfunk-api`/`vereinsfunk-worker` zu tun ist. `plans/README.md`: Zeile für Plan 036 in der Tabelle „Vierte Serie: Review und nachhaltiges Refactoring" ergänzen, inklusive der Abhängigkeit von der separaten Ansible-PR aus Step 4.

**Verify**: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, danach `pnpm db:reset && pnpm db:test`.

## Bewusst nicht gebaut

- **Eigens zugeschnittene Migrations-Rolle in Postgres.** Siehe Entscheidung 3 — mit dem Nutzer bewusst gegen den kleineren Blast-Radius entschieden, für weniger einmaligen Setup-Aufwand.
- **Expliziter Advisory-Lock zwischen `vereinsfunk-api` und `vereinsfunk-worker`.** Siehe Entscheidung 5 — die natürliche Postgres-Kollision plus die vorhandene Restart-Policy genügt für den heutigen Single-Instance-Betrieb je Dienst.
- **Ein separater One-Shot-Migrations-Compose-Service.** Siehe Entscheidung 1 — passt architektonisch sauberer, aber nicht zu Watchtowers Rollout-Modell, das dieser Plan gerade adressiert.
- **Automatisiertes Rollback/`down`-Migrationen.** Dieser Plan schließt die Lücke „Migration wird nicht angewendet", nicht „eine fehlerhaft angewendete Migration wird automatisch zurückgerollt".
- **Kontingent-/Kostenüberwachung für den zusätzlichen `postgres`-Connection-Verbrauch.** Supabase Cloud begrenzt gleichzeitige direkte Verbindungen je Tarif; zwei zusätzliche kurzlebige Verbindungen (eine je Container-Boot) sind bei der heutigen Ein-Instanz-Topologie vernachlässigbar, aber bei künftiger Skalierung neu zu prüfen (siehe STOP conditions).

## Done criteria

- [x] Step 0 durchgeführt, Ergebnis dokumentiert; die in Entscheidung 5 angenommene Kollisionssicherheit tatsächlich beobachtet, nicht nur angenommen.
- [x] `DATABASE_URL` ist ein validiertes Pflichtfeld in `packages/config`, fehlt es, verweigern `apps/api` (in Produktion) und `apps/worker` (in jeder Umgebung) den Start mit einer klaren Fehlermeldung.
- [x] `packages/db-migrate` existiert, ist getestet (inkl. Fehlerfall mit `stderr`-Weitergabe), und wird von `apps/api/src/server.ts` unmittelbar nach `parseApiEnvironment()` sowie von `apps/worker/src/index.ts` unmittelbar nach `parseWorkerEnvironment()` aufgerufen — jeweils vor jedem weiteren App-/Worker-Start.
- [x] Beide Laufzeit-Images enthalten `supabase/migrations/` und lösen die `supabase`-CLI über einen deterministischen, nicht von `PATH` abhängigen Pfad auf; ein lokal gebautes Image (API **und** Worker) wendet beim Start tatsächlich ausstehende Migrationen an und startet den Server/Worker erst danach.
- [x] Eine kaputte Verbindung/Migration lässt **beide** Container (API und Worker) mit Exit ≠ 0 fehlschlagen, ohne dass der Server je auf seinem Port lauscht oder der Worker je einen Hatchet-Worker registriert.
- [ ] Ansible-PR in `~/Projekte/ansible` gemergt und einmal gegen haex.space ausgerollt; `DATABASE_URL` ist in `vereinsfunk-api` und `vereinsfunk-worker`, nicht in `vereinsfunk-web`.
- [x] `docs/operations/deploy.md` beschreibt den neuen Migrationsweg und das erwartete Crash-Loop-Verhalten bei einer kaputten Migration.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` sowie `pnpm db:reset && pnpm db:test` bestehen vollständig.
- [x] Die aktuell fehlende Migration `2026081208_platform_admin_org_counts_batch.sql` ist gegen die Produktionsdatenbank angewendet — tatsächlich stellte sich heraus, dass 19 Migrationen seit `2026080903` fehlten (Produktion lag über eine Woche hinter `main` zurück); alle 19 wurden am 2026-08-12 manuell per `supabase db push` über den Session-Pooler nachgezogen und verifiziert (`--dry-run` meldet „up to date", die zuvor mit `PGRST202` fehlschlagende RPC liefert jetzt korrekt `42501 permission denied` für den Publishable-Key).

## Umsetzung: Ergebnis und Abweichungen vom Plan

Steps 0–3 und 5 sind umgesetzt und lokal vollständig verifiziert (App-Repo-Teil). Step 4
(Ansible-Repo) ist bewusst als eigener PR in einem anderen Repository ausstehend.

- **Step 0, real verifiziert statt nur angenommen:** `--db-url` funktioniert ohne `supabase login`/`link`. Die direkte Verbindung (`db.<ref>.supabase.co:5432`) scheiterte von dieser Umgebung aus mit `ECONNREFUSED` auf einer IPv6-Adresse — der Session-Pooler (`postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432`) funktionierte. `--yes` unterdrückt die interaktive Bestätigung. Die Kollisionsannahme aus Entscheidung 5 wurde nicht als echtes Wettrennen erzwungen (zwei quasi-gleichzeitige lokale Aufrufe liefen faktisch sequenziell: der zweite sah bereits „up to date" ohne Fehler) — das bestätigt zumindest, dass ein zweiter Aufruf niemals etwas doppelt anwendet, auch wenn ein echtes Low-Level-Wettrennen auf Postgres-Ebene damit nicht erzwungen wurde.
- **Neu gegenüber der ursprünglichen Ausplanung: `resolveMigrationsWorkdir()`.** Der Plan hatte nicht explizit ausgearbeitet, dass `supabase db push` das Verzeichnis kennen muss, das `supabase/migrations` enthält (`--workdir`), und dass dessen Tiefe relativ zum Prozess-cwd zwischen den beiden Aufrufkontexten dieses Pakets unterschiedlich ist: `pnpm --filter @vereinsfunk/api dev` startet mit cwd=`apps/api` (zwei Ebenen unter dem Repo-Root), das Laufzeit-Image dagegen mit cwd=`/app`, wohin die Dockerfiles `supabase/migrations` direkt hineinkopieren (null Ebenen). `packages/db-migrate` löst das über eine Existenzprüfung beider Kandidaten (`process.cwd()` und zwei Ebenen darüber) statt über eine weitere Umgebungsvariable — eine dritte, potenziell falsch gesetzte Variable wäre selbst wieder ein Ort für die Art von Drift, die dieser Plan beheben soll. Real getestet aus beiden cwd-Kontexten (Repo-Root und `apps/api/`).
- **Docker-Smoke-Test real durchgeführt** (nicht nur die in „Commands you will need" vorgesehene Kommandozeile beschrieben): beide Images lokal gebaut und mit `--network host` gegen die lokale Supabase-Instanz gestartet. Erfolgspfad: `"applying pending database migrations"` → `"database migrations applied"` → Server/Hatchet-Start läuft an. Fehlerpfad (absichtlich falsche `DATABASE_URL`/TLS-Mismatch): Prozess wirft `MigrationError` unbehandelt, Exit-Code 1, Server erreicht `app.listen()` nie.
- **Akuter Produktionsausfall behoben, Umfang größer als ursprünglich diagnostiziert:** Ein `--dry-run` gegen die produktive Datenbank zeigte 19 ausstehende Migrationen (`2026080903` bis `2026081208`), nicht nur die eine, die den gemeldeten Fehler auslöste — die Produktionsdatenbank lag seit über einer Woche hinter `main` zurück. Alle 19 wurden nach Bestätigung durch den Nutzer angewendet; `--dry-run` meldet seither „up to date".
- **Nicht verifiziert, wie in den STOP conditions vorgesehen:** ein echtes gleichzeitiges Wettrennen zweier `db push`-Prozesse auf Postgres-Ebene (Objekt-Lock/Primärschlüsselverletzung in `schema_migrations`) — die beiden Testläufe liefen faktisch sequenziell. Vor einem Wechsel auf mehrere Replikas desselben Dienstes sollte das gezielt nachgeholt werden (siehe STOP conditions unten, unverändert).

## STOP conditions

- Der Spike aus Step 0 zeigt, dass zwei parallele `db push`-Aufrufe eine Migration **teilweise** statt sauber gescheitert anwenden (z. B. weil eine der bestehenden Migrationsdateien nicht rein transaktional ist, etwa durch `CREATE INDEX CONCURRENTLY` oder eine explizite `COMMIT`-Anweisung) — dann vor Step 3 auf einen expliziten Advisory-Lock umsteigen (Entscheidung 5 revidieren), nicht mit der optimistischen Kollisionsannahme fortfahren.
- Supabase Cloud erlaubt für den gebuchten Tarif keine direkte (non-pooled) Postgres-Verbindung von außerhalb des Projekts, oder die Verbindungsobergrenze reicht nicht für zwei zusätzliche kurzlebige Verbindungen je Deploy — dann vor Step 1 mit dem Nutzer klären, ob der Session-Mode-Pooler eine echte Alternative ist oder ein Tarif-Upgrade nötig wird.
- Der Dienst skaliert künftig auf mehrere Replikas **desselben** Containers (heute laut `docker-compose.yml` je Dienst genau eine Instanz) — dann Entscheidung 5 neu bewerten, da die Kollisionswahrscheinlichkeit und die Kosten wiederholter Fehlstarts mit der Replika-Zahl steigen.
- Die Ansible-Rolle wird zwischen Planung und Umsetzung so verändert, dass der Drift-Check am Kopf dieses Dokuments nicht mehr zutrifft — dann Step 4 gegen den tatsächlichen aktuellen Stand der Rolle neu abgleichen, nicht blind nach diesem Plan patchen.

## Maintenance notes

Jede künftige Migration muss weiterhin denselben Regeln folgen, die die Supabase-CLI ohnehin voraussetzt (eine Datei je Migration, aufsteigend benannt, rein additiv wo möglich) — dieser Plan ändert daran nichts, er automatisiert nur das Anwenden. Ein Entwickler, der eine Migration lokal mit `supabase db reset`/`db:test` geprüft hat, muss sich nicht mehr merken, sie zusätzlich manuell gegen Produktion zu pushen — das ist ab diesem Plan die eigentliche Verhaltensänderung. Der akute Vorfall vom 2026-08-12 (`2026081208` fehlte in Produktion) sollte unabhängig von diesem Plan sofort manuell nachgeholt werden, damit `/plattform-admin` wieder funktioniert, während dieser Plan umgesetzt wird.
