# Feature Specification: Veo-Analyse im PlayerBoard

**Feature Branch**: `feat/veo-analyse`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "Ich möchte gerne die Veo-Daten und -Übersicht mehr in Vereinsfunk übernehmen, vor allem auch die Charts wie Heatmaps, Schusskarte, Pässe etc. Alles, was in Veo für das Team und die Spieler angezeigt wird, möchte ich in Vereinsfunk haben." Ergänzt: "möglichst eine 1:1-Kopie"; "es gelten die gleichen Regeln über stats_visibility".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ein Spiel der Mannschaft auswerten (Priority: P1)

Ein Trainer will nach dem Wochenende das Spiel verstehen, ohne Veo zu öffnen. In Vereinsfunk wählt er das Spiel und sieht dieselbe Auswertung wie in Veo: die Gegenüberstellung der Spielwerte (wir gegen Gegner, gesamt und je Halbzeit), die Schusskarte beider Mannschaften, die Heatmap der Mannschaft für einen frei wählbaren Zeitabschnitt, wo die Pässe und der Ballbesitz lagen (Verteidigungs-, Mittel- und Angriffsdrittel), die Passketten, den Spielverlauf (wer wann Druck machte) und die Liste der Spielereignisse mit Filtern.

**Why this priority**: Das ist die Ansicht, die Trainer nach jedem Spiel öffnen, und sie ist die Grundlage für alle weiteren Ansichten. Allein mit ihr ersetzt Vereinsfunk den häufigsten Gang zu Veo.

**Independent Test**: Ein Spiel mit vollständiger Veo-Analyse öffnen und jede Teilansicht mit derselben Ansicht in Veo für dasselbe Spiel und dieselbe Halbzeit vergleichen: Zahlen, Markierungen und Zonenanteile stimmen überein.

**Acceptance Scenarios**:

1. **Given** ein abgeglichenes Spiel mit Veo-Analyse, **When** ein Trainer die Spielauswertung öffnet, **Then** sieht er die Spielwerte als Gegenüberstellung wir gegen Gegner und kann auf eine einzelne Halbzeit umschalten.
2. **Given** dasselbe Spiel, **When** er die Schusskarte öffnet, **Then** sind Tore und Schüsse beider Mannschaften an ihrem Ort markiert, beide Mannschaften spielen in der Darstellung in dieselbe Richtung wie in Veo, und Treffer- sowie Abschlussquoten (gesamt, im und außerhalb des Strafraums) werden angezeigt.
3. **Given** dasselbe Spiel, **When** er die Heatmap öffnet und eine Halbzeit sowie einen Zeitabschnitt in Minutenschritten wählt, **Then** zeigt die Heatmap die Verteilung seiner Mannschaft in genau diesem Abschnitt.
4. **Given** dasselbe Spiel, **When** er Pass- oder Ballbesitzzonen öffnet, **Then** sieht er die Anteile je Drittel für die gewählte Mannschaft und Halbzeit.
5. **Given** dasselbe Spiel, **When** er die Passketten öffnet, **Then** sieht er, wie oft 3, 4, … und 10 oder mehr Pässe in Folge gelangen, sowie die längste Kette.
6. **Given** dasselbe Spiel, **When** er den Spielverlauf öffnet, **Then** sieht er über die Spielzeit, auf welcher Spielfeldseite das Geschehen lag, mit dem Anteil je Seite.
7. **Given** ein Spiel, für das Veo eine Teilansicht nicht liefert (z. B. ältere Analyseversion oder fehlende Seiten- und Halbzeitangaben), **When** die Auswertung geöffnet wird, **Then** erscheint für diese Teilansicht ein verständlicher Hinweis statt einer leeren oder falschen Grafik, und die übrigen Teilansichten funktionieren.

---

### User Story 2 - Spieler eines Spiels ansehen (Priority: P1)

Eine Spielerin will wissen, wie ihr Spiel war. In der Spielauswertung öffnet sie die Spielertabelle mit den Werten aller Spieler des Spiels und tippt auf ihren Namen. Eine Spielerkarte zeigt ihre wichtigsten Werte (passend zu ihrer Position), alle Spielwerte, ihre Laufwerte und ihre Karten: die Heatmap für einen wählbaren Zeitabschnitt und ihre Schüsse.

**Why this priority**: Spieler sind die größte Nutzergruppe des PlayerBoards; ihre eigenen Daten sind der Hauptgrund, die App zu öffnen. Die Spielertabelle gibt es in einfacher Form schon, sie wird hier auf den Veo-Umfang gebracht.

**Independent Test**: Für ein Spiel die Spielertabelle und die Spielerkarte einer Spielerin öffnen und mit der Spielerübersicht und der Spielerkarte in Veo vergleichen.

**Acceptance Scenarios**:

1. **Given** ein Spiel mit Veo-Spielerwerten, **When** jemand die Spielertabelle öffnet, **Then** sieht er je Spieler die Werte in denselben Gruppen wie Veo (Allgemein, Physis, Ereignisse), kann Spalten auswählen und nach jeder Spalte sortieren.
2. **Given** die Spielertabelle, **When** ein Spielername angetippt wird, **Then** öffnet sich die Spielerkarte mit den Reitern Übersicht, Werte, Physis und Karten, und von dort führt ein Link auf das Spielerprofil (Spec 001).
3. **Given** die Spielerkarte einer Innenverteidigerin, **When** der Reiter Übersicht offen ist, **Then** zeigen die vier großen Kacheln die für diese Position vorgesehenen Werte (z. B. Abfangen, Tacklings, angekommene Pässe, Zweikämpfe).
4. **Given** der Reiter Karten, **When** eine Halbzeit und ein Zeitabschnitt gewählt werden, **Then** zeigt die Heatmap die Spielerin in genau diesem Abschnitt, und die Schusskarte zeigt ihre Tore und Schüsse mit Trefferquote.
5. **Given** eine Rückennummer, die Veo erkannt hat, die aber keinem Spieler im Kader zugeordnet ist, **When** die Tabelle angezeigt wird, **Then** erscheint die Zeile als „#7“ ohne Link, und ein Trainer kann die Nummer wie bisher zuordnen; danach erscheinen alle Werte und Karten unter dem Spieler.

---

### User Story 3 - Die Saison der Mannschaft verfolgen (Priority: P2)

Die Trainerin will sehen, ob sich die Mannschaft entwickelt. Sie wählt bis zu vier Kennzahlen, die zum Spielstil passen (z. B. Ballbesitz, Tore, Schüsse aufs Tor). Für jede sieht sie den Durchschnitt und einen Verlauf mit einem Balken je Spiel, dazu die Form der letzten Spiele. Sie sieht die Schusskarte und die Pass- und Ballbesitzzonen über alle gewählten Spiele und vergleicht im Radar sechs Kennzahlen mit einer anderen Mannschaft des Vereins oder mit einem früheren Zeitraum der eigenen Mannschaft. Die Spiele lassen sich nach Spielart, Zeitraum, Anzahl oder einzeln eingrenzen.

**Why this priority**: Die Saisonsicht ist der Mehrwert gegenüber dem einzelnen Spiel, baut aber auf den Spieldaten aus Story 1 auf.

**Independent Test**: Für einen festen Zeitraum die Saisonansicht öffnen und Durchschnitte, Balken, Formkurve und Radar mit Veos Analytics Studio für dieselben Spiele vergleichen.

**Acceptance Scenarios**:

1. **Given** eine Mannschaft mit mehreren analysierten Spielen, **When** die Saisonansicht geöffnet wird, **Then** erscheinen die gewählten Kennzahlen mit Durchschnitt und ein Verlauf mit einem Balken je Spiel in zeitlicher Reihenfolge; beim Antippen eines Balkens erscheinen Gegner, Datum und Ergebnis dieses Spiels.
2. **Given** keine Kennzahlen gewählt, **When** die Ansicht geöffnet wird, **Then** gelten dieselben Standardkennzahlen wie in Veo (Ballbesitz %, erzielte Tore, Schüsse aufs Tor).
3. **Given** eine Trainerin mit Verwaltungsrecht für die Mannschaft, **When** sie die Kennzahlen ändert, **Then** sehen alle, die die Werte der Mannschaft sehen dürfen, dieselbe Auswahl; ohne dieses Recht ist die Auswahl nur sichtbar, nicht änderbar.
4. **Given** zwei Mannschaften desselben Vereins mit Veo-Verbindung, **When** im Radar die zweite Mannschaft und je ein Zeitraum gewählt werden, **Then** zeigt das Radar beide Mannschaften über sechs Kennzahlen; ist die zweite Mannschaft für die betrachtende Person nicht sichtbar, steht sie nicht zur Auswahl.
5. **Given** ein Filter auf „nur Ligaspiele, letzte 5“, **When** er gesetzt wird, **Then** beziehen sich alle Teilansichten der Saisonsicht auf genau diese Spiele.

---

### User Story 4 - Spieler über die Saison vergleichen (Priority: P2)

Ein Spieler will wissen, wo er im Team steht. Er sieht Ranglisten (die besten fünf in bis zu drei Kennzahlen), die Spielertabelle über alle gewählten Spiele, die Schusskarte und die Positions-Heatmap je Spieler sowie einen direkten Vergleich zweier Spieler mit allen Werten und beiden Karten nebeneinander. Im Spielerprofil (Spec 001) erscheinen seine Saisonwerte und Karten ebenfalls.

**Why this priority**: Ranglisten und Vergleiche motivieren Spieler, setzen aber die Spieldaten aus Story 2 voraus.

**Independent Test**: Für einen festen Zeitraum Ranglisten, Tabelle, Schusskarte, Heatmap und Vergleich mit Veos „Player stats“ für dieselben Spiele vergleichen.

**Acceptance Scenarios**:

1. **Given** mehrere Spiele mit zugeordneten Rückennummern, **When** die Ranglisten geöffnet werden, **Then** erscheinen je gewählter Kennzahl die fünf besten Spieler mit Wert; ein Spielername führt zur Spielerkarte.
2. **Given** die Positions-Heatmap, **When** ein Spieler gewählt wird, **Then** zeigt sie seine Positionen über alle gewählten Spiele, immer mit Angriffsrichtung von links nach rechts.
3. **Given** der Spielervergleich, **When** zwei Spieler gewählt werden, **Then** stehen ihre Werte gruppiert (Allgemein, Physis, Verteilung, Angriff, Verteidigung, Standards, Torwart) nebeneinander, der höhere Wert ist hervorgehoben, und ihre Heatmaps und Schusskarten erscheinen nebeneinander.
4. **Given** das Spielerprofil einer Person, die in einer Mannschaft mit Veo-Verbindung spielt, **When** es von jemandem geöffnet wird, der die Werte dieser Mannschaft sehen darf, **Then** zeigt es ihre Saisonwerte, ihre Heatmap und ihre Schusskarte aus dieser Mannschaft.

---

### User Story 5 - Spielbericht lesen (Priority: P3)

Nach einem Spiel liest die Trainerin den Spielbericht: eine Seite mit den Abschnitten Übersicht, Verteilung, Angriff, Verteidigung, Physis und Spielerwerte. Oben wählt sie die Sicht (eigene Mannschaft oder Gegner) und die Halbzeit. Die Übersicht zeigt Tore und Schüsse im Verlauf, die wichtigsten Spielwerte beider Mannschaften, die Startaufstellung und die Durchschnittspositionen der Spieler. Die Verteilung zeigt Passorte in neun Zonen, Passrichtungen, Passketten und das Passnetz. Der Angriff zeigt Abschlüsse und Quoten im und außerhalb des Strafraums samt Schusskarte. Die Verteidigung zeigt Tacklings, Abfangen, Ballgewinne, Zweikämpfe und Fouls auf dem Spielfeld. Die Physis zeigt, wie sich die Intensität über das Spiel verteilt (Geschwindigkeitszonen). Kennzahlkarten vergleichen das Spiel mit dem Durchschnitt der letzten Spiele.

**Why this priority**: Der Spielbericht bündelt vieles aus Story 1 und 2 und ergänzt einige eigene Grafiken. Er ist der umfangreichste Teil und liefert erst Wert, wenn die Grundlagen stehen.

**Independent Test**: Den Spielbericht eines Spiels öffnen und Abschnitt für Abschnitt mit Veos Match Report für dasselbe Spiel, dieselbe Sicht und dieselbe Halbzeit vergleichen.

**Acceptance Scenarios**:

1. **Given** ein Spiel, für das Veo einen Spielbericht liefert, **When** der Bericht geöffnet wird, **Then** sind alle sechs Abschnitte über eine Abschnittsnavigation erreichbar, und Sicht und Halbzeit wirken auf alle Abschnitte.
2. **Given** der Abschnitt Verteilung, **When** das Passnetz angezeigt wird, **Then** stehen die Spieler an ihrer durchschnittlichen Ballberührungsposition, und die Linien zwischen ihnen sind umso kräftiger, je mehr Pässe angekommen sind.
3. **Given** der Abschnitt Verteidigung, **When** ein Aktionstyp an- oder abgewählt wird, **Then** erscheinen nur noch Markierungen der gewählten Typen, jeweils mit eigener Form.
4. **Given** mindestens zwei frühere Spiele der Mannschaft, **When** eine Kennzahlkarte angezeigt wird, **Then** nennt sie Zu- oder Abnahme gegenüber dem Durchschnitt dieser Spiele; Trainings- und Testspiele zählen nicht mit.
5. **Given** ein Spiel, für das Veo keinen Spielbericht liefert, **When** jemand den Bericht aufrufen will, **Then** wird kein Bericht angeboten, und die Spielauswertung aus Story 1 bleibt erreichbar.

---

### Edge Cases

- **Veo rechnet noch:** Veo hat das Spiel aufgezeichnet, die Analyse läuft aber noch. Das Spiel erscheint mit dem Hinweis „Veo wertet noch aus“; die Auswertung kommt mit einem späteren Abgleich.
- **Seiten und Halbzeiten fehlen oder sind falsch:** In Veo sind Seiten und Halbzeiten nicht gesetzt oder vertauscht. Ortsabhängige Grafiken erscheinen nicht, stattdessen kommt ein Hinweis, dass Seiten und Halbzeiten in Veo bestätigt werden müssen. Werden sie in Veo korrigiert, übernimmt der nächste Abgleich die korrigierten Daten.
- **Unterschiedliche Analyseversionen:** Ältere Spiele in Veo haben weniger Daten (z. B. keine Ereigniskarten oder Heatmaps). Die Saisonsicht kennzeichnet, wenn nur ein Teil der Spiele zu einer Kennzahl beiträgt.
- **Veo-Abo ohne Zusatzpaket:** Veo liefert manche Daten nur mit einem bestimmten Abo (z. B. Spieler-Heatmaps oder Spielbericht). Ansichten ohne Daten erscheinen nicht oder mit Hinweis; Werbung für Veo-Abos zeigt Vereinsfunk nicht.
- **Ereignisse ohne Ort:** Für einen Schuss oder eine Defensivaktion gibt es keinen Ort. Er zählt in den Summen mit und erscheint in einer Liste „ohne Ort“ unter der Karte.
- **Rückennummer wechselt:** Ein Spieler trägt in verschiedenen Spielen verschiedene Nummern. Saisonwerte, Heatmaps und Karten fassen ihn trotzdem über die je Spiel zugeordnete Nummer zusammen.
- **Gegnerspieler:** Veo liefert Gegnerspieler nur mit Rückennummer. Sie erscheinen nie mit Namen und nie in Ranglisten oder Vergleichen.
- **Veo ändert seine Schnittstelle:** Kommt eine Antwort in unerwarteter Form, schreibt der Abgleich für dieses Spiel nichts Halbes. Die zuletzt gültigen Daten bleiben sichtbar, und der Trainer erfährt es über den bestehenden Fehlerhinweis.
- **Veo-Verbindung getrennt:** Bereits abgeglichene Auswertungen bleiben sichtbar; neue kommen erst nach dem erneuten Verbinden.
- **Kleiner Bildschirm (360 px):** Spielfeldgrafiken skalieren mit, Tabellen scrollen in sich, und die Seite scrollt nicht seitlich.
- **Viele Spiele:** Eine Saison mit 40 Spielen und 25 Spielern lädt die Saisonsicht ohne spürbare Verzögerung.

## Requirements *(mandatory)*

### Functional Requirements

**Umfang und Treue**

- **FR-001**: Das System MUSS für jede Veo-Ansicht, die Veo einer Mannschaft oder einem Spieler zur Auswertung zeigt, eine entsprechende Ansicht im PlayerBoard anbieten. Ausnahmen MÜSSEN im Umfangsverzeichnis mit Grund stehen (siehe Annahmen). Das Umfangsverzeichnis listet jede Veo-Ansicht mit ihrer Entsprechung oder ihrem Ausschlussgrund.
- **FR-002**: Jede Ansicht MUSS für dasselbe Spiel, dieselbe Sicht (eigene Mannschaft oder Gegner) und denselben Zeitraum dieselben Werte zeigen wie Veo. Abgeleitete Werte (Quoten, Anteile je Zone, Durchschnitte, Minuten) MÜSSEN nach denselben Regeln berechnet und gerundet werden.
- **FR-003**: Das System MUSS Ortsangaben so darstellen wie Veo: beide Mannschaften in einheitlicher Spielrichtung, korrigiert um den Seitenwechsel je Halbzeit.
- **FR-004**: Das System MUSS deutschsprachige Bezeichnungen verwenden, die den Veo-Begriffen inhaltlich entsprechen. Erklärungen zu jeder Grafik („So liest du …“) MÜSSEN auf Deutsch vorhanden sein.

**Spielauswertung der Mannschaft (Story 1)**

- **FR-010**: Das System MUSS je Spiel die Spielwerte beider Mannschaften als Gegenüberstellung zeigen, gesamt und je Halbzeit. Dazu gehören Tore, Schüsse, Abschlüsse gesamt, Ecken, Freistöße, Abstöße, Strafstöße, Einwürfe, Fouls, Ballbesitz in Prozent und in Minuten (samt Zeit ohne Ballbesitz), angekommene Pässe, Ballgewinne sowie, soweit Veo sie liefert, Tacklings, Zweikämpfe, Dribblings, Abfangen, Ballgewinne nach losem Ball und Paraden.
- **FR-011**: Das System MUSS eine Schusskarte beider Mannschaften mit Toren und Schüssen zeigen, wählbar nach Mannschaft und Halbzeit, mit Anzahl Tore, Schüsse und Abschlüsse sowie den Quoten gesamt, im und außerhalb des Strafraums.
- **FR-012**: Das System MUSS eine Heatmap der Mannschaft je Halbzeit für einen in Minutenschritten wählbaren Zeitabschnitt zeigen.
- **FR-013**: Das System MUSS Pass- und Ballbesitzzonen als Anteile je Drittel (Verteidigung, Mitte, Angriff) zeigen, wählbar nach Mannschaft und Halbzeit.
- **FR-014**: Das System MUSS Passketten als Häufigkeit je Kettenlänge (3 bis 9 sowie 10 oder mehr) zeigen, dazu „3 bis 5 Pässe“, „6 oder mehr Pässe“ und die längste Kette.
- **FR-015**: Das System MUSS den Spielverlauf (Momentum) über die Spielzeit zeigen, mit Lücken außerhalb der Halbzeiten und dem Anteil des Geschehens je Spielfeldseite.
- **FR-016**: Das System MUSS die Spielereignisse als Liste und Zeitleiste zeigen, filterbar nach Ereignisart, Mannschaft, Spieler und Halbzeit.

**Spieler je Spiel (Story 2)**

- **FR-020**: Das System MUSS je Spiel eine Spielertabelle mit allen von Veo gelieferten Spielerwerten zeigen: Spielminuten, Distanz, Durchschnitts- und Höchstgeschwindigkeit, Sprints, hochintensive Läufe, Tore, Vorlagen, Torbeteiligungen, Trefferquote, Schüsse, Abschlüsse, Pässe (gesamt, angekommen, nicht angekommen, Quote), Tacklings, Zweikämpfe, Dribblings, Abfangen, Ballgewinne, Paraden und Standards. Spalten MÜSSEN wählbar und sortierbar sein, und die Auswahl MUSS für die Person erhalten bleiben.
- **FR-021**: Das System MUSS eine Spielerkarte mit den Reitern Übersicht, Werte, Physis und Karten bieten. In der Übersicht MÜSSEN die vier Kacheln nach der Position des Spielers gewählt werden, wie in Veo.
- **FR-022**: Die Spielerkarte MUSS eine Heatmap des Spielers je Halbzeit für einen wählbaren Zeitabschnitt und eine Schusskarte mit Toren, verfehlten Schüssen, Abschlüssen und Trefferquote zeigen.
- **FR-023**: Werte und Karten MÜSSEN dem Kader über die je Spiel zugeordnete Rückennummer zugeordnet werden, wie bisher in Paket 053. Eine geänderte Zuordnung MUSS alle Ansichten dieses Spiels umfassen, auch Karten und Saisonwerte.

**Saison der Mannschaft (Story 3)**

- **FR-030**: Das System MUSS eine Saisonsicht mit Filtern nach Spielart, Zeitraum, Anzahl der letzten Spiele und einzeln gewählten Spielen bieten. Alle Teilansichten der Saisonsicht MÜSSEN denselben Filter verwenden.
- **FR-031**: Das System MUSS bis zu vier Kennzahlen der Mannschaft mit Durchschnitt und Verlauf je Spiel zeigen, dazu die Siegquote mit Sieg/Remis/Niederlage je Spiel. Die Auswahl der Kennzahlen MUSS je Mannschaft gespeichert und nur mit Verwaltungsrecht für die Mannschaft änderbar sein; ohne Auswahl gelten Veos Standardkennzahlen.
- **FR-032**: Das System MUSS die Form der letzten drei Spiele vor einem Spiel mit dem Wert der gewählten Kennzahl zeigen.
- **FR-033**: Das System MUSS eine Schusskarte sowie Pass- und Ballbesitzzonen über alle gefilterten Spiele zeigen.
- **FR-034**: Das System MUSS ein Vergleichsradar mit sechs Kennzahlen zeigen: zwischen der eigenen Mannschaft und einer anderen Mannschaft desselben Vereins mit Veo-Verbindung oder zwischen zwei Zeiträumen der eigenen Mannschaft. Zur Auswahl stehen nur Mannschaften, deren Werte die betrachtende Person sehen darf.

**Spieler über die Saison (Story 4)**

- **FR-040**: Das System MUSS Ranglisten mit den fünf besten Spielern je Kennzahl für bis zu drei wählbare Kennzahlen zeigen.
- **FR-041**: Das System MUSS die Spielertabelle über alle gefilterten Spiele zeigen, ergänzt um Spiele, Startelf-Einsätze, Kapitänseinsätze und „Spieler des Spiels“, soweit Veo sie liefert.
- **FR-042**: Das System MUSS je Spieler eine Schusskarte (filterbar nach Toren, Schüssen und allen Abschlüssen) und eine Positions-Heatmap über alle gefilterten Spiele zeigen, mit einheitlicher Angriffsrichtung.
- **FR-043**: Das System MUSS einen Vergleich zweier Spieler mit gruppierten Werten, hervorgehobenem höheren Wert sowie Heatmaps und Schusskarten nebeneinander bieten.
- **FR-044**: Das Spielerprofil (Spec 001) MUSS je Mannschaft mit Veo-Verbindung die Saisonwerte, die Heatmap und die Schusskarte der Person zeigen, für alle, die die Werte dieser Mannschaft sehen dürfen.

**Spielbericht (Story 5)**

- **FR-050**: Das System MUSS für Spiele, zu denen Veo einen Spielbericht liefert, einen Spielbericht mit den Abschnitten Übersicht, Verteilung, Angriff, Verteidigung, Physis und Spielerwerte bieten, mit gemeinsamer Wahl von Sicht und Halbzeit.
- **FR-051**: Die Übersicht MUSS die Schlüsselereignisse (Tore und Schüsse mit Minute, Spielstand, Schütze und Vorlage), die wichtigsten Spielwerte beider Mannschaften, die Startaufstellung mit Auswechselspielern und Kapitän sowie die Durchschnittsposition der Spieler zeigen.
- **FR-052**: Die Verteilung MUSS Passorte in neun Zonen, Passrichtungen (vorwärts, seitwärts, rückwärts; jeweils angekommen und nicht angekommen), Passketten und das Passnetz der eigenen Mannschaft zeigen.
- **FR-053**: Der Angriff MUSS Abschlüsse, Tore und Quoten gesamt, im und außerhalb des Strafraums sowie eine Schusskarte mit Filter nach Spieler und Abschlussart zeigen. Auf die Karten MÜSSEN sich wie in Veo Zoneneinteilungen legen lassen.
- **FR-054**: Die Verteidigung MUSS Tacklings, Abfangen, Ballgewinne, Zweikämpfe und Fouls auf dem Spielfeld zeigen, je Typ mit eigener Markierung und einzeln ein- und ausblendbar.
- **FR-055**: Die Physis MUSS Distanz, hochintensive Läufe, Sprints und Höchstgeschwindigkeit sowie die Verteilung der Intensität (unter Schwelle, hochintensiv, Sprint) über Zeitabschnitte des Spiels zeigen, mit Liste der Spieler.
- **FR-056**: Kennzahlkarten MÜSSEN das Spiel mit dem Durchschnitt der letzten Spiele vergleichen, wenn mindestens zwei vergleichbare Spiele vorliegen. Trainings- und Testspiele zählen nicht.

**Daten, Sichtbarkeit und Betrieb**

- **FR-060**: Das System MUSS alle Daten für diese Ansichten im bestehenden Veo-Abgleich mitholen und in Vereinsfunk speichern. Die Ansichten MÜSSEN auch funktionieren, wenn Veo gerade nicht erreichbar ist.
- **FR-061**: Der Abgleich MUSS je Spiel alles oder nichts schreiben (wie in Paket 053). Ein Spiel, das Veo noch auswertet, MUSS in einem späteren Lauf nachgeholt werden. Werden Seiten, Halbzeiten oder Ereignisse in Veo korrigiert, MUSS der Abgleich die Änderungen übernehmen.
- **FR-062**: Wer welche Ansicht sehen darf, MUSS sich wie die bestehenden Veo-Werte nach `stats_visibility` richten: innerhalb der Mannschaft für alle mit Einblick in die Kennzahlen, darüber hinaus je Ebene nach der wirksamen Einstellung. Das gilt auch für Heatmaps und Ereigniskarten einzelner Spieler.
- **FR-063**: Kein Konto eines anderen Vereins und keine Mannschaft ohne Einblick DARF Daten dieser Ansichten erhalten oder aus Antworten auf ihre Existenz schließen können.
- **FR-064**: Gegnerspieler DÜRFEN nur mit Rückennummer erscheinen und NICHT in Ranglisten, Vergleichen oder Profilen.
- **FR-065**: Die öffentliche Mannschaftsseite DARF durch dieses Feature keine zusätzlichen Inhalte zeigen.
- **FR-066**: Ansichten ohne Daten MÜSSEN einen verständlichen Grund nennen: Veo wertet noch aus, Seiten und Halbzeiten fehlen, das Spiel hat eine ältere Analyseversion, Veo liefert das nicht, oder es gibt keine zugeordnete Rückennummer. Hinweise auf Veo-Abos oder Werbung DÜRFEN NICHT erscheinen.
- **FR-067**: Alle Grafiken MÜSSEN auf 360 px Breite ohne seitliches Scrollen der Seite bedienbar sein. Sie MÜSSEN ihre Kernaussage zusätzlich als Text oder Zahl zugänglich machen (Bildschirmleser) und DÜRFEN Information nicht allein über Farbe vermitteln.
- **FR-068**: Wo Veo eine Stelle im Video anbietet (Klick auf Schuss, Ereignis, Szene oder Wert), MUSS das System einen Link anbieten, der das Spiel in Veo an dieser Stelle öffnet. Vereinsfunk selbst spielt kein Video ab und bettet keins ein (Betreiberentscheidung 2026-10-21).

### Key Entities

- **Veo-Spiel**: Ein abgeglichenes Spiel einer Mannschaft (aus Paket 053), ergänzt um Analysestand und -version, Halbzeiten mit Zeitfenster und Spielrichtung der eigenen Mannschaft sowie die Herkunft aus Veo.
- **Spielereignis**: Ein Ereignis eines Spiels (Tor, Schuss, Pass, Tackling, Zweikampf, Abfangen, Ballgewinn, Foul, Parade, Standard) mit Mannschaft, Rückennummer, Zeitpunkt, Halbzeit, Ort (falls vorhanden) und Ausgang.
- **Positionsverteilung (Heatmap)**: Die Aufenthaltsdichte eines Spielers oder einer Mannschaft auf dem Spielfeld für ein Spiel, eine Halbzeit oder einen Zeitabschnitt, mit Spielrichtung und Durchschnittsposition.
- **Pass- und Ballbesitzdaten**: Je Halbzeit und Mannschaft die Passorte, die Passketten nach Länge, die Ballbesitzanteile je Drittel und das Passnetz (wer wem wie oft zuspielt).
- **Spielverlauf**: Die Druckkurve über die Spielzeit.
- **Intensitätsverteilung**: Je Zeitabschnitt die Anteile unter Schwelle, hochintensiv und Sprint, für die Mannschaft und je Spieler, mit den Schwellen der Mannschaft.
- **Spielbericht**: Die von Veo zusammengestellten Werte eines Spiels je Abschnitt, mit Vergleich zum Durchschnitt der letzten Spiele.
- **Mannschaftseinstellung Analyse**: Je Mannschaft die gewählten Kennzahlen (bis vier) und die Radar-Konfiguration (sechs Kennzahlen, Vergleichsmannschaft, Zeiträume).
- **Persönliche Ansichtseinstellung**: Je Person gewählte Spalten der Spielertabelle, Ranglisten-Kennzahlen und zuletzt verglichene Spieler.
- **Umfangsverzeichnis**: Die Liste aller Veo-Ansichten mit ihrer Entsprechung in Vereinsfunk oder dem Ausschlussgrund; Grundlage für die Abnahme von FR-001.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Für drei Referenzspiele der C1 stimmen in 100 % der verglichenen Werte, Zonenanteile und Ereigniszahlen alle Ansichten mit Veo überein, je Spiel, Sicht und Halbzeit.
- **SC-002**: Jede Veo-Ansicht im Umfangsverzeichnis hat eine Entsprechung in Vereinsfunk oder einen dokumentierten Ausschlussgrund; keine Ansicht fehlt ohne Eintrag.
- **SC-003**: Ein Spiel, dessen Analyse Veo abgeschlossen hat, ist spätestens nach dem nächsten regulären Abgleich vollständig in Vereinsfunk sichtbar.
- **SC-004**: Eine Spielauswertung, eine Spielerkarte und die Saisonsicht (Saison mit 40 Spielen und 25 Spielern) erscheinen auf einem Mittelklasse-Handy mit normaler Mobilverbindung innerhalb von 2 Sekunden.
- **SC-005**: In den Isolationstests erhält kein Konto ohne Einblick nach `stats_visibility` Daten dieser Ansichten (0 Treffer); innerhalb der Mannschaft sehen alle mit Einblick 100 % der Ansichten.
- **SC-006**: Bei 360 px Breite scrollt keine Ansicht seitlich, und jede Grafik ist mit dem Finger bedienbar (Touchziele ≥ 44 px).
- **SC-007**: Trainer der C1 öffnen für die wöchentliche Spielnachbereitung Veo nicht mehr, außer für das Video selbst. Geprüft wird das durch Befragung der Trainer nach vier Spielwochen.

## Assumptions

- **Nur lesen, bearbeitet wird in Veo.** Seiten und Halbzeiten, Ereignisse, Schussorte, Aufstellung und Analyseeinstellungen werden weiter in Veo gepflegt. Vereinsfunk zeigt an und übernimmt Änderungen mit dem nächsten Abgleich. Ausnahmen sind die Zuordnung der Rückennummern (bestehend aus Paket 053) und die Vereinsfunk-eigenen Ansichtseinstellungen (Kennzahlen, Spalten, Radar).
- **Nicht übernommen werden** Veos Abo-Werbung und Freischalthinweise, die Bearbeitungsassistenten für Seiten und Halbzeiten, das Anlegen von Clips und Highlights sowie Teilen-Links auf Veo-Inhalte. Ebenso entfallen die videobasierten Ansichten „Player Moments“, „Veo Vision“ und der 2D-Radar (Betreiberentscheidung 2026-10-21). Eine Liste der Szenen mit Link zu Veo kann eine spätere Spec ergänzen.
- **Coach Assist (KI-Zusammenfassungen von Veo)** ist nicht Teil dieser Spec (Betreiberentscheidung 2026-10-21). Vereinsfunk hat eine eigene Textgenerierung; eine spätere Spec kann Spielberichte als Grundlage für Beiträge nutzen.
- **Was Veo liefert, bestimmt den Umfang.** Daten, die das Veo-Abo der Mannschaft nicht enthält, zeigt Vereinsfunk nicht an. Ansichten erscheinen für ein Spiel nur, wenn Veo die Daten dafür liefert.
- **Sichtbarkeit wie bisher.** Es gilt `stats_visibility` aus Paket 052/053 ohne neue Stufen (Betreiberentscheidung 2026-10-21). Innerhalb der Mannschaft sehen alle mit Einblick auch die Karten der Mitspieler. Bei Minderjährigen ist das eine bewusst offene Entscheidung, die in die Verarbeitungsdokumentation (Paket 020) gehört.
- **Öffentlich ändert sich nichts.** Der bestehende öffentliche Veo-Reiter bleibt, wie er ist. Ob dort später Mannschaftsgrafiken ohne Namen erscheinen, entscheidet eine eigene Spec.
- **Ansichtseinstellungen:** Kennzahlen und Radar gelten je Mannschaft und werden von Personen mit Verwaltungsrecht für die Mannschaft gesetzt. Spalten, Ranglisten-Kennzahlen und Vergleichsspieler gelten je Person.
- **Einheiten:** metrisch (Meter, Kilometer, km/h, Minuten).
- **Vergleichbarkeit:** „Gleiche Werte wie Veo“ bezieht sich auf den Stand der Veo-Daten zum Zeitpunkt des letzten Abgleichs.
- **Quelle des Umfangs:** Grundlage ist das Inventar der Veo-Web-App (Stand 2026-10-21, aus den öffentlich ausgelieferten Programmdateien abgeleitet). Es wird mit dem Plan als Recherche abgelegt. Die nicht dokumentierte Veo-Schnittstelle wird vor der Umsetzung mit einem lesenden Testabruf gegen das Konto der C1 belegt. Die Ergebnisse gehen in `research.md`.
- **Abhängigkeiten:** Paket 053 (Veo-Verbindung, Abgleich, Rückennummer-Zuordnung, Spiele im Spielplan) ist live in Gebrauch. Spec 001 (Spielerprofil) liefert die Profilseite für FR-044; ist sie noch nicht ausgeliefert, folgt FR-044 mit ihr.
- **Phasenfolge:** Die Umsetzung liegt im laufenden PlayerBoard-Bereich (Paket 052 ff.) und setzt keine noch nicht genutzte Phase voraus. Sie wird in mehrere PRs in der Reihenfolge der Stories geteilt.
