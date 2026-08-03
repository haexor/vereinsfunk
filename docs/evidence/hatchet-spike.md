# Hatchet-Spike

Stand: 3. August 2026 · SDK: `@hatchet-dev/typescript-sdk` 1.28.0.

Die Worker-Factory verwendet den echten SDK-Client, Zod-Inputvalidierung, statusbasierte Idempotenz und Group-Round-Robin-Constraints auf Abteilungs- und Vereinsebene. Ihre Startkonfiguration verlangt explizit `HATCHET_CLIENT_TOKEN`; ohne Zugang startet kein verdeckter lokaler Ersatz.

Offen vor Produktionsfreigabe: Reproduzierbarer Lauf gegen lokalen Hatchet mit Supabase-Testzeile für Retry, Cancel/Reschedule, Prozessneustart und 30-Jobs-Fairness. Dieses Dokument ist absichtlich kein positiver Nachweis dieser externen Integration.
