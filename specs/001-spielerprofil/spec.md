# Feature Specification: Spielerprofil auf Vereinsebene

**Feature Branch**: `feat/spielerprofil`

**Created**: 2026-10-17

**Status**: Draft

**Input**: User description: "Jede Person im Verein (Verzeichnisperson, z. B. ein Spieler) bekommt eine eigene Profilseite auf Vereinsebene, nicht im Kader einer Mannschaft, weil eine Person in mehreren Teams spielen kann. Überall, wo in der App der Name eines Spielers angezeigt wird, soll er ein Link auf diese Profilseite sein: Punkteeingabe im Training, interne Rangliste und Saisonübersicht, Kader, Foto-Zuordnung sowie Veo-Tabellen und Spielkarten. Die öffentliche Rangliste bleibt anonym und wird nicht verlinkt. Die Profilseite zeigt mindestens Name, Mannschaften mit Trikotnummer und Position sowie die Punkte über die Saison; was jemand sehen darf, richtet sich nach seinen Rechten (Mandantentrennung, Minderjährige, keine E-Mail-Adressen für Mitspieler)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Vom Namen direkt zum Profil (Priority: P1)

Eine Trainerin trägt im Training Punkte ein und sieht in der Liste einen Spielernamen, zu dem sie mehr wissen will (Position, in welchen Mannschaften er spielt, Punkte der Saison). Sie klickt auf den Namen und landet auf der Profilseite dieser Person. Mit „Zurück“ kommt sie zum Training zurück.

**Why this priority**: Das ist der Auslöser der Anfrage. Ohne Profilseite gibt es kein Linkziel, ohne Link keinen Nutzen. Beides zusammen ist der kleinste sinnvolle Umfang.

**Independent Test**: Auf der Trainingsseite einen Spielernamen anklicken und prüfen, dass die Profilseite genau dieser Person erscheint und Name, Mannschaften mit Trikotnummer und Position sowie Saisonpunkte zeigt.

**Acceptance Scenarios**:

1. **Given** ein abgeschlossenes Training mit Spielern, **When** ein Trainer den Namen eines Spielers anklickt, **Then** öffnet sich die Profilseite dieser Person auf Vereinsebene.
2. **Given** ein Spieler, der in zwei Mannschaften des Vereins im Kader steht, **When** sein Profil geöffnet wird, **Then** erscheinen beide Mannschaften jeweils mit Trikotnummer und Position, und es gibt nur dieses eine Profil, egal aus welcher Mannschaft man kommt.
3. **Given** ein Trainer tippt auf dem Handy am Platzrand auf einen Namen, **When** die Seite öffnet, **Then** bleibt die Punkteeingabe im Training unverändert und ungespeicherte Werte gehen nicht verloren (die bestehende Rückfrage beim Verlassen greift).

---

### User Story 2 - Überall derselbe Link (Priority: P1)

Wer den Namen eines Spielers sieht, kann ihn anklicken, ohne sich merken zu müssen, wo das geht. Das gilt für die Punkteeingabe im Training, die interne Rangliste und die Saisonübersicht, den Kader, die Foto-Zuordnung sowie die Veo-Spielerübersichten und Spielkarten.

**Why this priority**: Die Anfrage lautet „immer“. Ein Name, der an einer Stelle klickbar ist und an einer anderen nicht, wirkt wie ein Fehler.

**Independent Test**: Jede der genannten Ansichten mit Spielern öffnen und prüfen, dass jeder dort angezeigte Spielername auf das passende Profil führt.

**Acceptance Scenarios**:

1. **Given** die interne Rangliste einer Mannschaft, **When** ein Name angeklickt wird, **Then** öffnet sich das Profil dieser Person (das Aufklappen der Punkte je Kategorie bleibt über die übrige Zeile erreichbar).
2. **Given** die Foto-Zuordnung eines Trainings, **When** der Name eines zugeordneten Spielers angeklickt wird, **Then** öffnet sich dessen Profil.
3. **Given** die öffentliche Rangliste mit Einträgen wie „#7 M. K.“, **When** sie angezeigt wird, **Then** gibt es dort keine Links und keine zusätzlichen Hinweise auf die Person.
4. **Given** ein Spieler, der inaktiv gesetzt wurde, **When** sein Name in einer älteren Ansicht erscheint, **Then** ist er ebenfalls verlinkt und das Profil zeigt ihn als nicht mehr aktiv.

---

### User Story 3 - Profil sieht nur, was man sehen darf (Priority: P1)

Ein Spieler sieht das Profil eines Mitspielers, ein Trainer sieht mehr. Niemand sieht Personen anderer Vereine. Bei Minderjährigen werden keine Angaben gezeigt, die Mitspieler oder Eltern nichts angehen.

**Why this priority**: Die App verarbeitet Daten von Kindern und Jugendlichen. Eine Profilseite, die mehr preisgibt als die bisherigen Ansichten, wäre ein Datenschutzproblem und ein Grund, das Feature nicht auszuliefern.

**Independent Test**: Dasselbe Profil mit drei Konten öffnen (Trainer der Mannschaft, Mitspieler, Mitglied eines anderen Vereins) und die jeweils sichtbaren Angaben vergleichen.

**Acceptance Scenarios**:

1. **Given** ein Mitspieler ohne Trainerrechte, **When** er ein Profil öffnet, **Then** sieht er Name, Mannschaften, Trikotnummer, Position und Saisonpunkte, aber keine E-Mail-Adresse.
2. **Given** ein Trainer der Mannschaft, **When** er das Profil öffnet, **Then** sieht er zusätzlich die Angaben, die er auch im Kader sieht (z. B. E-Mail-Adresse, ob ein Konto besteht).
3. **Given** ein Konto aus einem anderen Verein, **When** es die Adresse eines Profils aufruft, **Then** erhält es dieselbe Antwort wie bei einer nicht vorhandenen Person (kein Hinweis, dass es sie gibt).
4. **Given** eine minderjährige Person, **When** ein Mitspieler ihr Profil öffnet, **Then** erscheinen weder Geburtsjahr noch Kontaktdaten.
5. **Given** ein Mitglied, das mit einer Person in keiner gemeinsamen Mannschaft ist und kein Verzeichnisrecht hat, **When** es das Profil aufruft, **Then** erhält es dieselbe Antwort wie bei einer nicht vorhandenen Person.

---

### User Story 4 - Saisonverlauf im Profil (Priority: P2)

Eine Spielerin will wissen, wie sie in der Saison dasteht. Im Profil sieht sie ihre Punkte der laufenden Saison je Mannschaft, aufgeteilt nach Kategorien, und kann auf die gesamte Zeit umschalten.

**Why this priority**: Das macht das Profil nützlich über den bloßen Sprung hinaus. Die Seite funktioniert aber auch ohne, solange Name und Mannschaften da sind.

**Independent Test**: Das Profil einer Person mit Punkten in zwei Mannschaften öffnen und prüfen, dass die Summen je Mannschaft und Kategorie mit der Saisonübersicht der jeweiligen Mannschaft übereinstimmen.

**Acceptance Scenarios**:

1. **Given** eine Person mit Punkten in zwei Mannschaften, **When** das Profil geöffnet wird, **Then** erscheinen die Punkte getrennt je Mannschaft und stimmen mit der Saisonübersicht dieser Mannschaft überein.
2. **Given** eine Person ohne Punkte in der gewählten Saison, **When** das Profil geöffnet wird, **Then** erscheint ein klarer Hinweis statt einer leeren Fläche.

---

### Edge Cases

- Die verlinkte Person wurde inzwischen gelöscht oder aus dem Verein entfernt: Das Profil zeigt eine verständliche „nicht gefunden“-Seite, keinen Fehlerdump.
- Der Name steht in einer Ansicht, die nur Platzhalter kennt (öffentliche Rangliste, Veo-Zeilen ohne zugeordneten Spieler): Es entsteht kein Link.
- Eine Person ist Verzeichniseintrag, aber nie im Kader (z. B. Elternteil oder Trainer): Das Profil zeigt Name und Zugehörigkeit, aber keine Mannschafts- oder Punkteabschnitte.
- Zwei Personen heißen gleich: Der Link führt über die eindeutige Person, nicht über den Namen.
- Sehr lange oder zusammengesetzte Namen auf kleinen Bildschirmen (360 px): Der Name bleibt anklickbar und die Zeile läuft nicht über.
- Der Name steht in einer Zeile, die selbst klickbar ist (Rangliste klappt Details auf): Beide Aktionen bleiben unterscheidbar und per Tastatur erreichbar.
- Die Profilseite wird aus einem Lesezeichen oder einem geteilten Link geöffnet, ohne dass vorher eine Mannschaft gewählt war.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS für jede Person im Vereinsverzeichnis genau eine Profilseite auf Vereinsebene bereitstellen, die unabhängig von der gewählten Mannschaft unter einer festen Adresse erreichbar ist.
- **FR-002**: Das Profil MUSS Namen, alle Mannschaften der Person im Verein mit Trikotnummer und Position sowie die Punkte der Saison anzeigen.
- **FR-003**: Das Profil MUSS Personen mit mehreren Mannschaften als eine Person darstellen, nicht als je einen Eintrag pro Mannschaft.
- **FR-004**: Überall, wo ein Spielername angezeigt wird, MUSS er als Link auf das Profil dieser Person erscheinen: in der Punkteeingabe im Training, in der internen Rangliste, in der Saisonübersicht, im Kader, in der Foto-Zuordnung sowie in den Veo-Spielerübersichten und Spielkarten.
- **FR-005**: Die öffentliche Rangliste MUSS anonym bleiben und darf weder Links noch Angaben enthalten, über die eine Person identifiziert werden kann.
- **FR-006**: Ein Name ohne zugeordnete Person (z. B. unzugeordneter Veo-Eintrag) DARF NICHT als Link erscheinen.
- **FR-007**: Das System MUSS bei jedem Profilaufruf prüfen, ob die aufrufende Person den Verein der Profilperson sehen darf, und andernfalls dieselbe Antwort liefern wie für eine nicht vorhandene Person.
- **FR-008**: Das System MUSS Mitspielern ohne Trainerrechte E-Mail-Adresse, Kontostatus und sonstige Verwaltungsangaben vorenthalten; Personen mit Trainerrechten für die Mannschaft sehen dieselben Angaben wie im Kader.
- **FR-009**: Das System MUSS bei minderjährigen Personen Geburtsjahr und Kontaktdaten gegenüber Personen ohne Verwaltungsrecht ausblenden.
- **FR-010**: Das Profil MUSS die Punkte je Mannschaft und Kategorie zeigen und mit der Saisonübersicht derselben Mannschaft übereinstimmen; der Zeitraum MUSS zwischen laufender Saison (Saisonbeginn der jeweiligen Mannschaft) und gesamter Zeit wählbar sein.
- **FR-011**: Das Profil MUSS inaktive Spieler als solche kennzeichnen und weiterhin anzeigen.
- **FR-012**: Die Links MÜSSEN auf 360 px Breite mit ≥ 44 px Touchziel bedienbar bleiben und per Tastatur erreichbar sein; bestehende Aktionen in derselben Zeile (Punkte ändern, Details aufklappen) dürfen dadurch nicht beeinträchtigt werden.
- **FR-013**: Ein Klick auf einen Namen MUSS ungespeicherte Punkte im Training schützen (bestehendes Verhalten beim Verlassen der Seite bleibt erhalten).
- **FR-014**: Das System MUSS für eine nicht auffindbare oder nicht sichtbare Person eine verständliche Seite anzeigen und darf keine technischen Fehlerdetails preisgeben.

### Key Entities

- **Person im Verein (Verzeichnisperson)**: Die vereinsweit eindeutige Person mit Name, Zugehörigkeit und Status. Sie ist das Ziel aller Namenslinks.
- **Kadereintrag**: Verbindet eine Person mit einer Mannschaft, mit Trikotnummer, Position und Aktiv-Status. Eine Person kann mehrere haben.
- **Saisonpunkte**: Aufsummierte Punkte einer Person je Mannschaft, Saison und Kategorie, wie sie die Saisonübersicht schon ausweist.
- **Betrachter**: Die aufrufende Person mit ihren Rechten im Verein (Trainer, Mitspieler, Verzeichnisrecht, fremder Verein). Bestimmt, welche Angaben des Profils sichtbar sind.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Von jeder der genannten Ansichten erreicht man das Profil einer Person mit einem Klick; 100 % der dort angezeigten Spielernamen mit zugeordneter Person sind verlinkt.
- **SC-002**: Eine Person mit mehreren Mannschaften hat genau ein Profil; in 100 % der Fälle führen Links aus allen Mannschaften zur selben Adresse.
- **SC-003**: Ein Konto eines anderen Vereins erfährt über das Profil in 100 % der Fälle nicht, ob eine Person existiert (identische Antwort wie bei einer unbekannten Person).
- **SC-004**: Ohne Trainerrechte erscheinen in 100 % der Fälle weder E-Mail-Adresse noch Kontostatus; bei Minderjährigen zusätzlich kein Geburtsjahr.
- **SC-005**: Die Profilseite zeigt Name, Mannschaften und Saisonpunkte innerhalb von 2 Sekunden nach dem Öffnen im Vereinsnetz mit normaler Mobilverbindung.
- **SC-006**: Die Punkteeingabe im Training funktioniert unverändert: Kein Verlust ungespeicherter Werte durch das Antippen eines Namens in Tests mit schlechter Verbindung.

## Assumptions

- **Profil gehört zur Person, nicht zum Kader.** Das Linkziel ist die Verzeichnisperson des Vereins, wie vom Auftraggeber entschieden. Es gibt keine mannschaftsbezogene Profilseite.
- **Sichtbarkeit folgt den bestehenden Regeln.** Wer einen Spieler schon heute in einem abgeschlossenen Training, der internen Rangliste oder dem Kader sieht, darf auch sein Profil öffnen. Das Profil zeigt nicht mehr als diese Ansichten zusammen; darüber hinaus zeigt es nur Verwaltungsangaben, die Trainer ohnehin sehen.
- **Entwürfe bleiben verborgen.** Punkte aus noch nicht abgeschlossenen Trainings zählen im Profil nicht mit, genau wie in Rangliste und Saisonübersicht.
- **Zeiträume wie in der Saisonübersicht.** Die App kennt je Mannschaft einen Saisonbeginn, keine benannten Saisons; „Saison“ heißt deshalb laufende Saison oder gesamte Zeit.
- **Kein Geburtsjahr im Profil.** Das Profil zeigt das Geburtsjahr nie, auch Trainern nicht; dort bleibt es im Kader und im Verzeichnis. Damit ist FR-009 für das Geburtsjahr ohne Sonderfall erfüllt.
- **Der Mindestumfang des Profils** ist Name, Mannschaften mit Trikotnummer und Position sowie Saisonpunkte. Weitere Inhalte (Fotos, Spielstatistiken aus Veo, Trainingsverlauf) sind spätere Erweiterungen und nicht Teil dieser Spec.
- **Bearbeiten bleibt im Kader.** Trikotnummer, Position, E-Mail und Aktiv-Status werden weiter dort geändert; das Profil ist zunächst nur lesend.
- **Eigenes Profil.** Wer sein eigenes Profil öffnet, sieht mindestens das, was ein Mitspieler sieht; zusätzliche Selbstverwaltung ist nicht Teil dieser Spec.
- **Bestehende Anmeldung und Mandantentrennung** bleiben die Grundlage; die Profilseite verlangt eine Anmeldung.
- **Phasenfolge:** Die Umsetzung liegt im laufenden PlayerBoard-Bereich (Paket 052 ff.) und setzt keine noch nicht genutzte Phase voraus.
