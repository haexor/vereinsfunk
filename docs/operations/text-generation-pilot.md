# Textgenerierungs-Pilot

Nur synthetische oder ausdrücklich freigegebene Testdaten verwenden. Der Ablauf für einen
`contributor` lautet: Stilprofil wählen → bestätigte Stichpunkte eingeben → Kandidat abwarten →
bei Bedarf neue Sitzung mit korrigierten Fakten starten → Kandidat übernehmen → vorhandene
Freigaberoute verwenden. Publishing ist bis zur rechtlichen Entscheidung über die
KI-Kennzeichnung gesperrt.

## Betrieb

- **Key rotieren:** neuen Schlüssel verschlüsselt an derselben Konfiguration hinterlegen,
  Worker mit dem passenden `SECRET_BOX_KEYS`-Satz deployen, alten Schlüssel erst nach erfolgreichem
  Worker-Smoketest aus dem Secret-Manager entfernen. Schlüssel nie über UI, Logs oder Hatchet teilen.
- **Provider deaktivieren:** `is_active=false` setzen. Neue Sitzungen schlagen kontrolliert fehl;
  bestehende Kandidaten bleiben les- und übernehmbar.
- **Ausfall/429:** Worker speichert nur die Fehlerklasse und nutzt Hatchet-Retry. Keine Outbox-Zeile
  manuell duplizieren. Bei Schema-/Faktenfehler ist der Kandidat `failed`; Fakten korrigieren und
  neue Sitzung anlegen.
- **Kostenlimit:** `max_output_tokens` und Temperatur sind Plattformparameter. Bei auffälligen
  Kosten zunächst die Konfiguration deaktivieren, dann Latenz/Tokenzähler ohne Inhalte auswerten.
- **Qualität:** monatlich Kandidatenübernahme, Regenerationen, Editdistanz, Faktenfehler,
  Providerlatenz, Kosten und Freigabeablehnungen aggregiert prüfen. Keine Rohtexte als Metriklog.

Der lokale technische Nachweis bleibt der Hatchet-Ablauf aus `docs/operations/hatchet.md`:
Outbox → `generate-text-post` → Kandidat, inklusive Retry ohne zweiten Kandidaten.
