# Hatchet-Betrieb

Hatchet ist nur die technische Ausführungsumgebung. Supabase bleibt die fachliche Wahrheit;
Outbox- und `workflow_runs`-Daten enthalten ausschließlich IDs, Revision, Zweck, Priorität,
Korrelation und kontrollierte Fehlerklassen.

## Lokaler Nachweis

1. `pnpm db:start && pnpm db:reset` ausführen.
2. `infrastructure/hatchet/.env.example` nach `infrastructure/hatchet/.env` kopieren und eigene
   lokale Werte setzen. Die Datei ist ignoriert.
3. Einmal lokale Schlüssel erzeugen:
   `docker run --rm -v "$PWD/infrastructure/hatchet/keys:/keys" --entrypoint /hatchet/hatchet-admin ghcr.io/hatchet-dev/hatchet/hatchet-admin:v0.98.9 keyset create-local-keys --key-dir /keys`
4. Control Plane starten und Default-Tenant anlegen:
   `docker compose -f infrastructure/hatchet/docker-compose.yml --env-file infrastructure/hatchet/.env up -d`
   und danach `docker compose -f infrastructure/hatchet/docker-compose.yml --env-file infrastructure/hatchet/.env run --rm --no-deps --entrypoint /hatchet/hatchet-admin hatchet-admin seed`.
5. Ein kurzlebiges Worker-Token ausschließlich in die aktuelle Shell übernehmen. Vorher Shell-Trace
   deaktivieren; nur falls er zuvor aktiv war, danach wieder aktivieren:
   ```bash
   case "$-" in *x*) _hatchet_restore_xtrace=1; set +x;; *) _hatchet_restore_xtrace=0;; esac
   export HATCHET_CLIENT_TOKEN="$(docker compose -f infrastructure/hatchet/docker-compose.yml --env-file infrastructure/hatchet/.env run --rm --no-deps --entrypoint /hatchet/hatchet-admin hatchet-admin token create --expiresIn 1h)"
   [ "$_hatchet_restore_xtrace" -eq 1 ] && set -x
   unset _hatchet_restore_xtrace
   ```
   Das Token nicht in Shell-Historie, Git oder Logs speichern; `set -x` bleibt während Erzeugung
   und Zuweisung deaktiviert.

Der Worker benötigt außerdem `HATCHET_CLIENT_API_URL`, `HATCHET_CLIENT_HOST_PORT` und
`HATCHET_TLS=false` für den lokalen Loopback-Stack. Vor dem Test ist ein ID-only Outbox-Ereignis
über die jeweilige Fachtransaktion anzulegen; danach muss der zugehörige `workflow_runs`-Status
terminal sein.

## Betriebsvorfälle

- **Outbox-Stau:** Nur die Anzahl, das Alter und Fehlerklassen prüfen. Dispatcher und Worker
  neu starten; derselbe Idempotenzschlüssel erzeugt keine zweite technische Aktion.
- **Worker-Neustart:** Läuft eine Lease ab, darf die nächste Hatchet-Zustellung sie erneut
  erwerben. Terminale Läufe bleiben unverändert.
- **Retrybarer Providerfehler:** Als kontrollierte Klasse `failed` speichern und Hatchets
  begrenzten Retry abwarten. Keine manuelle Duplizierung einer Outbox-Zeile.
- **Nicht retrybarer Fehler:** `action_required` setzen, Ursache im fachlichen Datensatz beheben
  und einen neuen fachlich versionierten Auftrag auslösen.
- **Abbruch/Umplanung:** Den Hatchet-Run über die Orchestrierungsgrenze stornieren und den
  fachlichen Run als `cancelled` markieren; ein neuer Termin erhält eine neue Revision.
- **Tokenrotation:** Worker geordnet stoppen, Token im Hatchet-Control-Plane widerrufen/neu
  ausstellen, Secret im Deployment aktualisieren und Worker neu starten. Tokens gehören nie in
  Browser, Outbox, Supabase-Fachdaten oder Logs.

Für Produktionsfreigabe ist zusätzlich ein dokumentierter Fairness-Lasttest mit **genau 30 Jobs**
über drei Abteilungen erforderlich. Er muss faire Fortschritte zeigen und vier Ergebnisse belegen:
Prozessabbruch während eines Laufs wird nach Lease-Ablauf genau einmal fortgesetzt, Cancel endet
fachlich als `cancelled`, Reschedule erzeugt nur die neue Revision, und ein doppelt gesendeter
Idempotenzschlüssel erzeugt keine zweite Fachaktion.
