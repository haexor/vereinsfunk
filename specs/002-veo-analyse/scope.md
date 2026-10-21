# Umfangsverzeichnis: Veo-Ansichten und ihre Entsprechung

Grundlage für FR-001 und SC-002. Jede Veo-Ansicht aus [veo-ui-inventory.md](veo-ui-inventory.md) steht hier mit ihrer Entsprechung in Vereinsfunk oder mit Ausschlussgrund. „PR“ verweist auf die Lieferreihenfolge in [plan.md](plan.md).

Legende: ✅ wird übernommen · ➖ bewusst nicht übernommen · ⚠️ übernommen mit Abweichung

## Mannschaft, ein Spiel (Inventar §1a)

| Veo-Ansicht | Status | Vereinsfunk | PR |
|---|---|---|---|
| Stats (Gegenüberstellung wir/Gegner, je Halbzeit) | ✅ | Spielauswertung → „Spielwerte“ | 2 |
| Shot map (beide Mannschaften, Quoten, ohne Ort) | ✅ | Spielauswertung → „Schusskarte“ | 2 |
| Pass location (Drittel) | ✅ | Spielauswertung → „Passzonen“ | 2 |
| Possession location (Drittel) | ✅ | Spielauswertung → „Ballbesitzzonen“ | 2 |
| Pass strings | ✅ | Spielauswertung → „Passketten“ | 2 |
| Heat map (Mannschaft, Zeitabschnitt) | ⚠️ | Spielauswertung → „Heatmap“. Aus Positionsdaten gerechnet, nicht Veos Bild (R-05); ohne Tracking nur ganze Halbzeiten | 2 |
| Key metrics + Recent form im Spiel | ✅ | Spielauswertung → Kopf mit Kennzahlen und Form der letzten 3 Spiele | 4 |
| Player Stats Overview | ✅ | Spielauswertung → „Spieler“ | 3 |
| Match momentum | ✅ | Spielauswertung → „Spielverlauf“ | 2 |
| Match events (Liste, Filter, Zeitleiste) | ✅ | Spielauswertung → „Ereignisse“ | 2 |
| Ereignisse bearbeiten, Schussorte verschieben, Stats-Zeilen bearbeiten | ➖ | Wird in Veo gepflegt (Annahme „Nur lesen“) | – |
| Seiten und Halbzeiten bearbeiten | ➖ | Wird in Veo gepflegt; Hinweis mit Link zu Veo | – |
| Reduced-accuracy-Hinweis | ✅ | Hinweis in der Spielauswertung, wenn Veo die Qualität als reduziert meldet | 2 |
| Upsell, Teaser, Promo | ➖ | Keine Werbung (FR-066) | – |

## Mannschaft, Saison (Inventar §1b)

| Veo-Ansicht | Status | Vereinsfunk | PR |
|---|---|---|---|
| Filter (Spielart, Formation, Auswahl, Anzahl, Zeitraum) | ⚠️ | Saisonsicht: Spielart, Zeitraum, Anzahl, Auswahl. Formation entfällt, weil sie in Vereinsfunk nicht gepflegt wird | 4 |
| Key metrics (Karten, Verlauf, Siegquote, Spielkarte) | ✅ | Saisonsicht → „Kennzahlen“ | 4 |
| Edit key metrics (max. 4) | ✅ | Trainer mit `training.manage` | 4 |
| Shot map über Spiele | ✅ | Saisonsicht → „Schusskarte“ | 4 |
| Pass location / Possession location über Spiele | ✅ | Saisonsicht → „Zonen“ | 4 |
| Comparison radial | ✅ | Saisonsicht → „Vergleich“ (Mannschaften des Vereins mit Veo-Verbindung) | 4 |
| Coach note | ➖ | Nicht verlangt; Vereinsfunk hat eigene Trainingsnotizen | – |

## Spieler (Inventar §2)

| Veo-Ansicht | Status | Vereinsfunk | PR |
|---|---|---|---|
| Leaderboards | ✅ | Saisonsicht → Spieler → „Ranglisten“ | 5 |
| Player stats table (über Spiele) | ✅ | Saisonsicht → Spieler → „Tabelle“ | 5 |
| Player shot map | ✅ | Saisonsicht → Spieler → „Schusskarte“ | 5 |
| Player position heat map | ⚠️ | Saisonsicht → Spieler → „Heatmap“, gewichtete Summe der Spiele (R-05) | 5 |
| Player comparison | ✅ | Saisonsicht → Spieler → „Vergleich“ | 5 |
| Player focus card (Übersicht, Werte, Physis, Karten) | ✅ | Spielerkarte, im Spiel und in der Saison | 3, 5 |
| Recent form (Altansicht) | ✅ | Im Kopf der Spielerkarte | 3 |
| Player profile `/player` (Remote-Modul, nicht im Inventar) | ⚠️ | Spielerprofil aus Spec 001 mit Veo-Abschnitt; Inhalte wie Spielerkarte Saison | 5 |
| Player Moments / Player Spotlight | ➖ | Videofunktion (Q1, Antwort A) | – |
| Veo Vision (Werte im Video) | ➖ | Videofunktion (Q1, Antwort A) | – |
| 2D Radar | ➖ | Videofunktion (Q1, Antwort A) | – |
| Clip abspielen aus Wert oder Marker | ⚠️ | Link ins Veo-Video an der Stelle (FR-068) | 2–6 |

## Spielbericht (Inventar §3)

| Veo-Ansicht | Status | Vereinsfunk | PR |
|---|---|---|---|
| Einrichtung des Berichts (Mannschaft, Startseite) | ➖ | Wird in Veo gemacht; ohne Einrichtung kein Bericht | – |
| Übersicht: Highlights und Schlüsselereignisse | ⚠️ | Schlüsselereignisse als Liste mit Link ins Video, ohne eingebettetes Video | 6 |
| Übersicht: Key match stats, Startaufstellung, Durchschnittsposition | ✅ | Bericht → „Übersicht“ | 6 |
| Verteilung: Passorte 9 Zonen, Passrichtung, Passketten, Passnetz | ✅ | Bericht → „Verteilung“ | 6 |
| Angriff: Quoten, Schusskarte mit Zonen | ✅ | Bericht → „Angriff“ | 6 |
| Verteidigung: Defensivaktionen | ✅ | Bericht → „Verteidigung“ | 6 |
| Physis: Geschwindigkeitszonen | ✅ | Bericht → „Physis“ | 6 |
| Spielerwerte | ✅ | Bericht → „Spielerwerte“ | 6 |
| Kennzahlkarten mit Vergleich zu den letzten Spielen | ✅ | in allen Abschnitten | 6 |
| Coach Assist (KI-Texte, Chat) | ➖ | Nicht Teil der Spec (Annahme) | – |
| „Update report“ | ⚠️ | „Analyse neu laden“ in `/playerboard/veo` | 1 |
| Basis- und Erweiterungsplan (gesperrte Abschnitte) | ⚠️ | Abschnitte, die Veo nicht liefert, erscheinen nicht; keine Sperrhinweise | 6 |
