# 058 – Spielerprofil auf Vereinsebene

## Ergebnis

Jede Person im Verein hat eine Profilseite unter `/personen/[id]`, und überall in PlayerBoard, wo ein Spielername steht, ist er ein Link darauf. Das Profil gehört der Verzeichnisperson, nicht einem Kader-Eintrag: Wer in mehreren Mannschaften spielt, hat genau eine Seite.

- **Profil:** Name, Mannschaften mit Trikot, Position, Platz und Punkten, aufklappbar je Kategorie; Umschalter „Laufende Saison“ / „Gesamte Zeit“. Trainer sehen zusätzlich E-Mail und Kontostatus.
- **Links:** Punkteeingabe im Training, Rangliste, Saisonübersicht (`/playerboard` und Startseitenkachel), Kader, Einstellungen (Spieler ohne Einwilligung), Foto-Prüfung, Veo-Saisontabelle und Veo-Spielkarte.
- **Nicht verlinkt:** die öffentliche Mannschaftsseite (bleibt anonym, `#7 M. K.`) und nicht zugeordnete Veo-Rückennummern.

Spec, Plan und Aufgaben: `specs/001-spielerprofil/`.

## Umsetzung

- **Datenbank** (`supabase/migrations/2026101701_person_profile.sql`, keine neue Tabelle):
  - `public.person_profile(target_person_id, period)` liefert das Profil als `jsonb`, bei unbekannter **und** nicht sichtbarer Person `null`.
  - Sichtbar ist eine Person, wenn der Aufrufer die Kennzahlen mindestens einer ihrer Mannschaften sieht (`authz.can_view_playerboard_stats`) oder sie im Verzeichnis lesen darf (Bedingung von `directory_people_select`).
  - Die Punkte kommen aus `authz.playerboard_ranking_rows` und stimmen damit mit Rangliste und Saisonübersicht überein; Entwürfe zählen nie.
  - `authz.current_season_start` spiegelt `currentSeasonStart` aus `packages/domain`; pgTAP prüft dieselben Fälle.
  - Geburtsjahr, Minderjährigkeit, E-Mail und Konto liefert die Funktion nie.
- **API** (`apps/api/src/routes/playerboard/personProfile.ts`): `GET /v1/people/:id/profile?period=season|all`.
  - Keine Scope-Vorabprüfung, weil sie die Existenz verriete; `null` ergibt `404 not_found`.
  - Die Antwort der Datenbank wird an der Grenze validiert, eine abweichende Form ist ein 500, kein halbes Profil.
  - `email` und `hasAccount` setzt nur die Route, nur mit `training.manage` in mindestens einer sichtbaren Mannschaft (wie GET `.../players`); ohne das Recht fehlen die Schlüssel.
  - `Cache-Control: private, no-store`.
- **Vertrag** (`packages/contracts/src/personProfile.ts`): `PersonProfileSchema`, `PersonProfileQuerySchema`.
- **Web:**
  - `pages/personen/[id].vue` (Profil), `components/PersonLink.vue` und `utils/personProfile.ts` (`personProfilePath`: ohne Id kein Link).
  - Die Id stammt aus dem Kader, der in den Ansichten ohnehin geladen ist (`usePlayerboardRanking`, `pages/playerboard/spiele.vue`, `PlayerboardVeoOverview.vue`); RPCs und Ranglistenvertrag bleiben unverändert.
  - `PlayerboardRankingList.vue`: ein Link darf nicht in einem Button stehen. Der Aufklapp-Button liegt als Fläche hinter der Zeile, nur der Namenslink liegt darüber; die ganze Zeile bleibt Klickziel.

## Verifikation

- `pnpm lint`, `typecheck`, `test`, `build` grün; `pnpm db:test:isolation` und `db:test:timestamps` grün.
- pgTAP `supabase/tests/person_profile.test.sql` (31 Fälle): positiv (Trainer, Mitspieler, Verzeichnisrecht, Person in zwei Mannschaften) und negativ (Nachbarmannschaft, andere Abteilung, fremder Verein, unbekannte Id, ohne Anmeldung); Zeiträume, Entwurf, Gleichheit mit `playerboard_team_ranking`, `stats_visibility`.
- `apps/api/src/personProfile.routes.test.ts`: Abbildung, 401/400/404/500, identische 404-Antworten, Verwaltungsfelder nur für Trainer, kein Geburtsjahr, `period`.
- **Lokal im Browser** (Magic Link über Mailpit, Demo-Verein, danach entfernt):
  - Profil: Zahlen stimmen (8 in der Saison, 12 gesamt, Entwurf zählt nie); Spieler sieht nur seine Mannschaft, keine E-Mail und „Du“; fremder Verein sieht „nicht gefunden“ (API 404).
  - Ungespeicherte Punkte beim Klick auf einen Namen: Rückfrage erscheint, Seite bleibt.
  - Alle Ansichten (Rangliste, Übersicht, Startseite, Kader, Einstellungen, Foto-Prüfung, Spiele als Spieler): Namen sind Links; öffentliche Mannschaftsseite abgemeldet ohne Links und ohne Person-Id im Quelltext.
  - 360 px ohne Querscrollen, Trefferfläche 46 px, Tab erreicht Namenslink und Aufklapp-Knopf getrennt.

## Nachtrag: Klick auf Namen der öffentlichen Rangliste

- **Fehler:** Auf der öffentlichen Mannschaftsseite ließ sich eine Ranglistenzeile nicht mehr über den Namen aufklappen. Dort hat der Name keine Person-Id und wird ohne Link als `<span>` gerendert, trug aber `pointer-events-auto`; der Klick erreichte den Aufklapp-Button hinter der Zeile nicht.
- **Lösung (c912d99):** `pointer-events-auto` nur setzen, wenn eine Person-Id und damit ein Link existiert.
- **Warum nicht früher gefunden:** Die Browserprüfung klickte auf die Summe der Zeile, nicht auf den Namen, und prüfte die öffentliche Seite nur auf fehlende Links. Der Quelltext-Test prüft die Struktur, nicht das Klickverhalten; bei der öffentlichen Rangliste braucht es dafür einen Klick auf den Namen im Browser.

## Nachtrag: veralteter Ladefehler auf der Profilseite

- **Fehler:** Wechselte man den Zeitraum, während die vorige Anfrage noch lief und scheiterte, konnte deren Fehler die Anzeige des neuen Zeitraums überschreiben. Die Seite prüfte im Fehlerfall nur die Person, nicht den Zeitraum.
- **Lösung (2ed26c0):** Im Fehlerfall greift dieselbe Prüfung wie im Erfolgsfall (Person **und** Zeitraum), plus ein Quelltext-Test.

## Abweichungen und offene Punkte

- **Kein Geburtsjahr im Profil**, auch nicht für Trainer (Spec FR-009 damit ohne Sonderfall erfüllt); es bleibt im Kader und im Verzeichnis.
- **Zeitraum statt benannter Saisons:** Die App kennt je Mannschaft einen Saisonbeginn, daher „Laufende Saison“ oder „Gesamte Zeit“.
- **Entwürfe zählen nie**, wie in Rangliste und Saisonübersicht.
- **Kategorien direkt aus `playerboard_point_categories`**, nicht über die wirksamen: sonst fehlten deaktivierte Kategorien mit Punkten und die Summe passte nicht.
- **Rang kann leer sein:** Ein inaktiver Spieler ohne Punkte im Zeitraum steht nicht in der Rangliste.
- **Keine Komponententests im Web-Paket:** Es hat kein DOM-Werkzeug, eine neue Abhängigkeit wäre gegen die Constitution. Getestet sind `personProfilePath` und die Struktur per Quelltext-Test; die Darstellung ist im Browser geprüft.
- **Foto-Prüfung öffnet das Profil in einem neuen Tab**, damit angekreuzte Personen nicht verloren gehen.
- **Veo-Zuordnungsmodus:** Trainer sehen dort je Rückennummer eine Auswahl statt des Namens, also keinen Link.
- **Bekannt, nicht Teil dieses Pakets:** Ein Spieler mit 0 Punkten steht in der Rangliste auf Platz 1, wenn alle 0 haben; das Profil zeigt denselben Platz wie die Rangliste.
