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
   _hatchet_token="$(docker compose -f infrastructure/hatchet/docker-compose.yml --env-file infrastructure/hatchet/.env run --rm --no-deps --entrypoint /hatchet/hatchet-admin hatchet-admin token create --expiresIn 1h)"
   _hatchet_token_status=$?
   [ "$_hatchet_restore_xtrace" -eq 1 ] && set -x
   if [ "$_hatchet_token_status" -ne 0 ]; then
     echo "hatchet-admin token create failed" >&2
     unset _hatchet_restore_xtrace _hatchet_token _hatchet_token_status
     return 1 2>/dev/null || exit 1
   fi
   export HATCHET_CLIENT_TOKEN="$_hatchet_token"
   unset _hatchet_restore_xtrace _hatchet_token _hatchet_token_status
   ```
   Das Token nicht in Shell-Historie, Git oder Logs speichern; `set -x` bleibt während Erzeugung
   und Zuweisung deaktiviert. Bei einem fehlgeschlagenen `token create` wird kein Worker mit einem
   leeren oder ungültigen Token gestartet.

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

## Recovery-Scan (`generation-recovery-scan`)

Ein einziger, deklarativ per `onCrons: ['*/5 * * * *']` geplanter Workflow
(`apps/worker/src/generationRecovery.ts`, registriert in `createHatchetWorker`), unabhängig von
`WorkflowNameSchema`s Pro-Entity-Schleife. Alle fünf Minuten prüft er, ob ein Textgenerierungs-
Kandidat seit über 15 Minuten auf `generating` hängt (`claim_stalled_generation_candidates`) —
das ist der Fall, wenn ein Worker mitten in der Generierung abgestürzt ist und Hatchets eigenes
Wiederholungsbudget (`retries: 3`, `executionTimeout: '10m'`) bereits vor dieser Schwelle
aufgebraucht war. Jeder gefundene Kandidat ist ein **Wiederherstellungsversuch**, kein garantiertes
Neuaufsetzen: `claim_stalled_generation_candidates` erneuert nur den Fencing-Token und `updated_at`
(bewusst analog zur Reeroberung in `acquire_generation_candidate`, nicht zu
`mark_generation_candidate_failed`), damit ein Absturz zwischen Claim und Ersatzversuch den
Kandidaten nicht endgültig verliert, sondern ihn nach weiteren 15 Minuten erneut claimbar macht.
Erst nachdem `create_text_generation_session` (`triggered_by = 'automatic_recovery'`) einen
Ersatzversuch erzeugt hat oder das Kandidatenlimit (`composition_session_candidate_limit_reached`)
erreicht ist, setzt `finalize_stalled_generation_recovery` den alten Kandidaten ehrlich `failed`.
Kann keine Sitzung mehr geladen werden, endet ebenfalls hier ohne neuen Kandidaten. Ein
außergewöhnlich lange laufender Hatchet-Versuch, der die 15-Minuten-Schwelle selbst überschreitet,
ist durch denselben Fencing-Token vor einer konkurrierenden Reeroberung geschützt.

Kein eigener `workflow_runs`/`workflow_outbox`-Eintrag: `claim_stalled_generation_candidates`s
`for update skip locked` macht jeden Tick bereits sicher gegen gleichzeitige oder wiederholte
Ausführung, unabhängig davon, wie viele Worker-Replikas denselben Cron registriert haben.

**Pausieren/Löschen im Betrieb** (z. B. bei einer versehentlich zu aggressiven Reeroberung): über
das Hatchet-Dashboard (Bereich „Scheduled"/„Cron") den Eintrag für `generation-recovery-scan`
suchen und pausieren oder löschen, oder programmatisch über den SDK-`CronClient`:
`await client.crons.list({ workflow: 'generation-recovery-scan' })` zum Auffinden, danach
`await client.crons.delete(cron)`. Ein pausierter/gelöschter Scan lässt hängende Kandidaten
einfach liegen (keine andere Fachaktion hängt daran) — beim nächsten Worker-Neustart mit
unverändertem Code registriert sich der Cron erneut.

Für Produktionsfreigabe ist zusätzlich ein dokumentierter Fairness-Lasttest mit **genau 30 Jobs**
über drei Abteilungen erforderlich. Er muss faire Fortschritte zeigen und vier Ergebnisse belegen:
Prozessabbruch während eines Laufs wird nach Lease-Ablauf genau einmal fortgesetzt, Cancel endet
fachlich als `cancelled`, Reschedule erzeugt nur die neue Revision, und ein doppelt gesendeter
Idempotenzschlüssel erzeugt keine zweite Fachaktion.
