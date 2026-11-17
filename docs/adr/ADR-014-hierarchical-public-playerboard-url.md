# ADR-014: Hierarchische öffentliche PlayerBoard-URL

Status: angenommen · 17. November 2026 · ersetzt die URL-Entscheidung von [ADR-013](ADR-013-public-playerboard-display.md)

## Kontext

ADR-013 bildete das Mannschaftssegment aus Abteilungsname, Mannschaftsname und der vollständigen Team-ID (`/mannschaft/<verein>/<verein-abteilung-mannschaft-uuid>`). Das ist eindeutig, aber weder lesbar noch teilbar, und eine Umbenennung der Abteilung änderte jede Adresse darunter. Die öffentliche Adresse soll Verein, Abteilung und Mannschaft je als eigenes lesbares Segment zeigen.

## Entscheidung

- Die Adresse lautet `/mannschaft/<verein>/<abteilung>/<mannschaft>`. Die API folgt demselben Pfad unter `/v1/public/playerboard/<verein>/<abteilung>/<mannschaft>[/trainings[/<id>]|/ranking|/veo|/photos]`.
- Quellen der Segmente:

  | Segment | Quelle | Stabilität |
  |---|---|---|
  | Verein | `organizations.slug` | fest |
  | Abteilung | `departments.slug` | fest, eine Umbenennung ändert sie nicht |
  | Mannschaft | `playerboard_settings.public_slug`, erzeugt aus dem Mannschaftsnamen (`authz.team_url_slug`) | folgt dem Namen, höchstens 80 Zeichen, keine ID und kein Zähler |

  Nur das Mannschaftssegment wird erzeugt, und es ist weder über API noch über die Oberfläche editierbar. Verein und Abteilung dürfen bis zu 200 Zeichen lang sein, das Mannschaftssegment bis zu 80; der gesamte Pfad bleibt unter 512 Zeichen. Die Segmentschemas liegen einmal in `packages/contracts` und werden von API, Seite, Middleware und dem Pfadbau der Einstellungen genutzt.
- Eindeutigkeit des letzten Segments liegt bei den Mannschaften: ein partieller Unique-Index `teams_active_url_slug_unique` über `(organization_id, department_id, authz.team_url_slug(name))` für aktive Mannschaften. Zwei aktive Mannschaften einer Abteilung können nie dieselbe Adresse haben; dieselben Namen in verschiedenen Abteilungen oder Vereinen sind erlaubt. Archivierte Mannschaften sind ausgenommen, das Wiederherstellen in einen Namenskonflikt wird vom selben Index abgelehnt. Die Prüfung nutzt dieselbe Normalisierung wie der Generator und kann daher nicht davon abweichen. Der bisherige Unique-Constraint `(organization_id, public_slug)` auf den Einstellungen entfällt, weil er `archived_at` nicht kennt.
- Die Auflösung prüft Verein, Abteilung und Mannschaft gemeinsam in einer `security definer`-Funktion (`authz.playerboard_public_team`, drei Argumente). Eine nicht passende Kombination, eine archivierte Abteilung oder Mannschaft, ein geschlossener Schalter und ein unbekanntes Segment liefern dieselbe 404-Antwort. Die Info-Funktion gibt zusätzlich die internen IDs an die API zurück, die damit Vereinsfarben und Saisonbeginn lädt; öffentliche Antworten enthalten nie eine ID. Die alten Zwei-Argument-Funktionen werden gelöscht und nicht überladen.
- Namensformate, Freigaben (`public_sharing_allowed`, Modul) und die vier Datenschalter bleiben unverändert. Die öffentlichen Nutzlasten ändern sich nicht.
- Alte Links werden nicht weitergeleitet. Die frühere zweiteilige Adresse liefert in Seite und API dieselbe 404-Antwort wie eine unbekannte Mannschaft, für anonyme wie angemeldete Besucher, ohne Daten und ohne Weiterleitung. Ein Mannschaftssegment `trainings`, `ranking`, `veo` oder `photos` bleibt erreichbar, weil die frühere Adresse nur über einen Wildcard-Pfad mit niedrigster Priorität abgefangen wird.
- Teamanlage, Umbenennung, Wiederherstellung und externer Sync melden einen Namenskonflikt: die API antwortet `409 team_name_taken` (ohne Audit-Ereignis), der Sync macht aus der Zeile einen `invalid_record`-Konflikt auf dem Namen und schreibt die übrigen Zeilen weiter. Der Sync legt dazu stillgelegte Mannschaften zuerst still, damit ein Ersatz im selben Lauf den Namen belegen kann.

## Bekannte Eigenheit

`create_department()` bildet den Abteilungs-Slug ohne Umlautabbildung (`Fußball` ergibt `fu-ball`), der Mannschaftsgenerator bildet Umlaute und `ß` ab (`Fußball` ergäbe `fussball`). Die Entscheidung nutzt den bestehenden Abteilungs-Slug unverändert; eine Angleichung wäre eine eigene Änderung an stabilen Adressen.

## Migration und Wiederherstellung

- `2026111702_playerboard_hierarchical_public_url.sql` beginnt mit einer Vorprüfung. Sie bricht mit einer lesbaren Liste ab und ändert nichts, wenn aktive Mannschaften einer Abteilung nach der Normalisierung kollidieren oder wenn Vereins- oder Abteilungs-Slugs mit Mannschaftseinstellungen länger als 200 Zeichen sind oder nicht `^[a-z0-9]+(-[a-z0-9]+)*$` entsprechen. Es wird nichts automatisch umbenannt, weil das stillschweigend Nutzerdaten und öffentliche Links ändern würde. Vor dem Deployment müssen die aufgelisteten Mannschaften umbenannt oder archiviert werden.
- Danach werden nur bestehende Einstellungszeilen neu erzeugt (`public_slug = public_slug`); es entsteht keine neue Zeile, und Schalter, Freigaben und `public_player_name_format` bleiben unberührt.
- Die Migration ist nicht abwärtskompatibel zu API-Ständen vor diesem Change: sie löscht die Zwei-Argument-Funktionen, die die alten Routen aufrufen. API und Datenbank werden deshalb gemeinsam ausgerollt.
- Rückweg: eine Folgemigration, die die alten Funktionen, den Unique-Constraint auf den Einstellungen und den Abteilungs-Trigger wiederherstellt und den alten Generator erneut ausführt. Er steht unverändert in `2026111701`. Sie wird nicht mitgeliefert; alte, schon ersetzte Links funktionieren danach wieder, die neuen nicht mehr.

## Folgen

- Eine Mannschaftsumbenennung ändert ihre Adresse, und der alte Link zeigt nichts mehr an. Die Einstellungsseite weist darauf hin.
- Die Namenseindeutigkeit gilt für alle aktiven Mannschaften einer Abteilung, auch ohne PlayerBoard-Einstellungen. Namen, die sich erst nach dem 80. Zeichen unterscheiden, kollidieren.
- Fastifys `maxParamLength` wird auf 256 gesetzt, damit Slugs bis 200 Zeichen den Router erreichen.
