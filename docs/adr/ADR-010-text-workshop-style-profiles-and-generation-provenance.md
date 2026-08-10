# ADR-010: Beschreibbare Stilprofile und versionierte Textgenerierung

Status: angenommen · 10. August 2026 · geändert 11. August 2026 (Personenimitation freigegeben)

Die Textwerkstatt generiert ausschließlich Text. Fotos und Videos bleiben private Anhänge
und werden weder an ein LLM übertragen noch von ihm ausgewertet. Es gibt keine Video- oder
Bildgenerierung, keinen Videoschnitt, keine Gesichtserkennung und kein Face-Tracking.

Stilprofile bestehen aus überprüfbaren redaktionellen Eigenschaften (Satzlänge, Energie,
Humor, Formalität, Perspektive, verbotene Formulierungen und begrenzte Zusatzhinweise) und
dürfen ausdrücklich eine reale Person benennen und imitieren -- kuratiert von der Plattform
oder von jedem Mitglied mit `post.create` an der jeweiligen Stelle selbst angelegt (Plan 032,
Produktentscheidung). Ein technischer Filter dafür existiert bewusst nicht: Absicherung ist
organisatorisch (Rollenvergabe, bestehende Freigaberouten), nicht ein Keyword-Blocklist, der
Absicht ohnehin nicht zuverlässig erkennen kann. Unverändert verboten bleibt ein freier
Systemprompt: `additionalInstructions` bleibt begrenzt und niedrig priorisiert (siehe unten) und
kann Faktenbindung, Sicherheits- oder Plattformgrenzen nie überschreiben, unabhängig davon, wen
es benennt. Die fünf kuratierten Basis-Systemprofile bleiben versionierte Registry-Daten und
werden künftig um ein kuratiertes Persona-Set ergänzt (eigene inhaltliche Kuration, kein Teil
dieses ADRs); Vereine speichern zusätzlich eigene, tenant-scoped Profile.

**Offen:** Ob generierter Text im veröffentlichten Beitrag als KI-unterstützt gekennzeichnet
werden muss (z. B. EU-KI-Verordnung Art. 50), ist noch nicht rechtlich bestätigt. Keine
Veröffentlichungsroute für Textwerkstatt-Entwürfe darf live gehen, bevor das geklärt ist.

Die Prompt-Reihenfolge ist fest: Faktenbindung/Sicherheits- und Plattformgrenzen,
Stilprofil, bestätigte Fakten und schließlich eine begrenzte Änderungsanweisung. Stilprofil
und Änderungsanweisung sind Daten niedriger Priorität. Jede akzeptierte KI-Version erhält
einen unveränderlichen Provenienzdatensatz mit Stil-Snapshot, Prompt-Template-Version,
Provider-Modell und -Konfigurations-ID sowie Eingabehash. Der Datensatz enthält keinen
Rohprompt, kein Secret, keine Medienbytes und keine Gedankenkette.

LLM-Aufrufe erfolgen ausschließlich über die transaktionale Outbox und den ID-only Worker.
Generierungskandidaten bleiben von `post_versions` getrennt; erst eine explizite Übernahme
erzeugt eine neue unveränderliche Version.
