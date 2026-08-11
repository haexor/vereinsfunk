# Hatchet-Spike

Stand: 11. August 2026 · SDK: `@hatchet-dev/typescript-sdk` 1.28.1.

Die Worker-Factory verwendet den echten SDK-Client, strikte Zod-Inputvalidierung,
statusbasierte Idempotenz und Group-Round-Robin-Constraints auf Abteilungs-, Vereins- und
globaler Ebene. Ihre Startkonfiguration verlangt explizit `HATCHET_CLIENT_TOKEN`; ohne Zugang
startet kein verdeckter lokaler Ersatz.

Der lokale Nachweis wurde am 11. August 2026 mit dem selbst gehosteten Stack
`infrastructure/hatchet/docker-compose.yml` ausgeführt: eine ID-only Outbox-Zeile wurde vom
Dispatcher an den registrierten `process-submission`-Handler zugestellt und endete als
`workflow_runs.technical_status = succeeded`. Der Worker wartete über das SDK auf echte
Bereitschaft und verwendete keinen lokalen Fake-Adapter. Der Nachweis speichert und protokolliert
weder das kurzlebige Hatchet-Token noch Fachinhalte.

Automatisiert geprüft sind zusätzlich: ungültige/inhaltshaltige Payloads an Zod- und
Datenbankgrenze, atomare Outbox-Acknowledge/Run-Erzeugung, Retry bei noch fehlendem Run-Mapping,
nicht-retrybare Fehler, Lease-CAS bei Doppelzustellung sowie das Überspringen eines bereits
abgeschlossenen Laufs nach Neustart. Ein Load-/Fairness-Test mit 30 Jobs bleibt ein
Kapazitätsnachweis vor Produktionsfreigabe; er ist kein Blocker für den ID-only Textpilot mit den
festen Startgrenzen.
