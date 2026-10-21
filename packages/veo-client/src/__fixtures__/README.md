# Veo-Testdaten

Antworten der inoffiziellen Veo-Web-API für die Parser-Tests in `packages/veo-client` und die Rechenregeln in `packages/domain`.

## Herkunft

`matches-list-response.json` und `analysis-stats-response.json` stammen aus Paket 053.

Alle anderen Dateien kommen aus dem lesenden Testabruf vom 2026-10-21 (Spec 002, `research.md`):

- Spiel einer C-Jugend-Mannschaft mit Analyseversion 2: zwei Halbzeiten, Spielbericht `advanced`, Positionsdaten vorhanden.
- `periods-missing.json` stammt aus einer Trainingsaufnahme ohne Halbzeiten.

## Anonymisierung

- Namen, Titel, Slugs und URLs wurden ersetzt durch `Name <feld>` bzw. `example-<feld>`.
- Veo-IDs wurden durch feste Dummy-UUIDs ersetzt (`00000000-0000-0000-0000-00000000000N`). Bezüge zwischen den Dateien bleiben erhalten.
- Rechte, Kamera- und Videoangaben wurden entfernt.
- Unverändert sind Werte, Orte, Zeiten und Rückennummern.

## Gekürzt

| Datei | Kürzung |
|---|---|
| `match-events.json` | alle Schüsse und Tore, je weiterer Typ höchstens 4 Ereignisse, dazu 2 ohne Ort |
| `analysis-stats-match-all-players.json` | 4 Spieler |
| `analysis-player-heatmaps.json` | 3 Spieler |
| `ras-match-details.json` | 8 Passorte je Seite, 2 Szenen je Passkette |
| `match-momentum.json` | die ersten 40 Punkte |
| `match-report.json` | 10 Ereignisse |
| `player-tracking.json` | 5 Bilder eines 30-s-Fensters |

Zahlen, die aus gekürzten Listen berechnet werden, stimmen deshalb nicht mit den Summen in Veo überein. Für den Vergleich mit Veo gilt `quickstart.md` §2.
