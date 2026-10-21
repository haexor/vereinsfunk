# Quickstart: Veo-Analyse prüfen

Dies ist ein Prüfleitfaden, kein Implementierungscode. Die Verträge stehen in [contracts/veo-analysis.md](contracts/veo-analysis.md), das Datenmodell in [data-model.md](data-model.md), die Entscheidungen in [research.md](research.md).

## Voraussetzungen

- Worktree `.worktrees/veo-analyse`, Branch `feat/veo-analyse` (je PR ein eigener Topic-Branch davon)
- `pnpm install`
- Lokale Supabase-Instanz (`pnpm db:start`), Migrationen eingespielt (`pnpm db:reset`)
- Eine lokale Mannschaft mit Veo-Verbindung zum Konto der C1, verbunden über `/playerboard/veo`
- Zum Anschauen der Skill `run-web` (Nuxt-App lokal, Login, Screenshots)

## 1. Automatische Prüfungen

```sh
pnpm db:test      # pgTAP inkl. playerboard_veo_analysis.test.sql
pnpm lint
pnpm typecheck
pnpm test         # veo-client-Parser, domain-Ableitungen, Worker, API-Routen, Web
pnpm build
```

**Erwartung**: Alles ist grün. Pflichtfälle:

| Ebene | Fall | Erwartung |
|---|---|---|
| pgTAP | Mitspieler liest Analyse, Ereignisse, Heatmaps, Positionsdaten (`stats_visibility = team`) | sichtbar |
| pgTAP | Nachbarmannschaft ohne Sicht, Mitglied eines anderen Vereins | keine Zeilen; RPC wirft `insufficient_permission` |
| pgTAP | Nachbarmannschaft bei `stats_visibility = department` | sichtbar |
| pgTAP | `authenticated` schreibt in eine Analysetabelle | verweigert |
| pgTAP | Spieler ohne `training.manage` speichert Kennzahlen | verweigert |
| pgTAP | Kennzahlen speichern mit Vergleichsmannschaft aus anderem Verein | verweigert |
| pgTAP | Rückennummer neu zuordnen | Ereignisse und Heatmaps erscheinen beim neuen Spieler |
| pgTAP | `playerboard_public_veo_stats` nach dem Schreiben einer Analyse | Ausgabe unverändert (FR-065) |
| pgTAP | `apply_analysis` mit fremdem Lauf oder fremdem Spiel | Fehler, nichts geschrieben |
| veo-client | jede Testdatei aus dem Testabruf | wird geparst; eine veränderte Form ergibt `upstream_changed`, 404 ergibt `null` |
| domain | Koordinaten-Spiegelung je Halbzeit, Drittel, Passketten, Quoten, Siegquote, Ranglisten, Radar, Kacheln je Position | gleiche Werte wie die Veo-Regeln im Inventar |
| Worker | ein Teilabruf scheitert | kein Analysepaket geschrieben, Summenwerte geschrieben, Lauf mit Fehlerklasse |
| Worker | Spiel älter als 14 Tage, Analyse `complete` | keine Analyseabrufe |
| API | Spiel einer Mannschaft ohne Sicht oder unbekanntes Spiel | jeweils `404` mit gleichem Body |

## 2. Gleichheit mit Veo (SC-001)

Drei Referenzspiele der C1 auswählen: ein aktuelles mit Analyseversion 2 und Spielbericht, eines mit Version 1.1 und eines mit fehlenden Seiten oder Halbzeiten, falls vorhanden.

1. `/playerboard/veo` → „Jetzt abgleichen“ und warten, bis der Lauf durch ist.
2. Je Spiel `/playerboard/spiele/<fixtureId>` öffnen und in Veo dasselbe Spiel nebeneinanderlegen.
3. Für „Gesamtes Spiel“, „1. Halbzeit“ und „2. Halbzeit“ sowie für beide Mannschaften vergleichen:
   - Spielwerte
   - Schusskarte (Anzahl, Lage, Quoten)
   - Pass- und Ballbesitzdrittel
   - Passketten
   - Anteile im Spielverlauf
   - Spielertabelle
   - Spielerkarte einer Spielerin
4. Spielbericht `/playerboard/spiele/<fixtureId>/bericht` Abschnitt für Abschnitt mit Veos Match Report vergleichen.
5. `/playerboard/saison` mit dem Filter „letzte 5“ gegen Veo Analytics Studio mit derselben Auswahl vergleichen: Kennzahlen, Verlauf, Ranglisten, Tabelle, Spielervergleich.

**Erwartung**: Alle Zahlen sind gleich. Abweichungen sind nur dort erlaubt, wo sie im Umfangsverzeichnis stehen (Heatmap-Pixel, Saison-Heatmap aus Summen).

## 3. Sichtbarkeit im Browser

Mit drei Konten prüfen: Trainer der Mannschaft, Spieler der Mannschaft, Mitglied einer anderen Mannschaft (erst mit `stats_visibility = team`, dann mit `department`).

**Erwartung**:
- Bei `team` sieht das fremde Konto keine Analyse und bekommt eine „nicht gefunden“-Seite.
- Bei `department` sieht es alles, außer Trainingsnotizen und Fotos (die gehören nicht zu diesem Feature).
- Die öffentliche Mannschaftsseite ist unverändert.

## 4. Mobil und Barrierefreiheit (SC-006, FR-067)

Mit `run-web` bei 360 px Breite:
- Spielauswertung, Spielerkarte, Saisonsicht und Spielbericht öffnen.
- Keine Seite scrollt seitlich.
- Schieber und Filter lassen sich antippen.
- Jede Grafik hat einen Textersatz mit den Kernzahlen (Bildschirmleser oder Barrierefreiheitsbaum im Browser).
- Die Markierungen der Defensivaktionen unterscheiden sich in der Form.

## 5. Fehler- und Grenzfälle

| Fall | Herstellen | Erwartung |
|---|---|---|
| Veo rechnet noch | Spiel direkt nach dem Upload abgleichen | Hinweis „Veo wertet noch aus“; der nächste Lauf holt die Analyse nach |
| Seiten und Halbzeiten fehlen | Spiel ohne bestätigte Seiten | Ortsgrafiken mit Hinweis, Spielwerte sichtbar |
| Veo nicht erreichbar | Netz des Workers trennen, Seiten öffnen | Alle Ansichten aus dem gespeicherten Stand |
| Analyse neu laden | `/playerboard/veo` → „Analyse neu laden“ | Der nächste Lauf holt die Analyse aller Spiele der Mannschaft neu |
| Link ins Video | Schuss in der Schusskarte antippen | Veo öffnet in einem neuen Tab an der Spielzeit minus 3 s |
