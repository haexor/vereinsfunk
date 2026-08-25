# ADR-012: Agenten-Command-Plane vor einem Remote-MCP

Status: angenommen · 24. August 2026

## Kontext

Der Vereinsagent soll innerhalb der Web-App Beiträge, Veranstaltungen, Einladungen,
Freigaben und Veröffentlichungen per natürlicher Sprache organisieren. Diese Aktionen
sind mandantenbezogen, teilweise extern wirksam und unterliegen den bestehenden
Permission-, Freigabe-, Versions-, Medien- und Audit-Regeln.

Ein Remote-MCP wäre ein möglicher Transport, um einen Agenten mit Produktfunktionen
zu verbinden. Er darf aber weder eine zweite fachliche API noch eine Umgehung der
Fastify-Autorisierung werden. Als zusätzliche externe Verbindung erhöht er zudem die
Angriffs-, Datenschutz- und Betriebsfläche.

## Entscheidung

Wir führen zuerst eine interne **Agenten-Command-Plane** in der Fastify-API ein.
Sie besteht aus eng typisierten Lese- und Aktionswerkzeugen mit Zod-Verträgen. Jedes
Werkzeug ruft dieselben fachlichen Use Cases auf wie die normalen API-Routen und führt
bei jedem Aufruf die Authentifizierung, Scope-Prüfung, Permission-Prüfung,
Zustandsübergänge, Auditierung und Idempotenz erneut aus.

Ein LLM erhält keine Datenbank- oder Service-Role-Zugänge. Es kann ausschließlich
die allow-gelisteten Werkzeuge aufrufen. Der Browser erhält weder Provider-Secrets
noch Zugang zum LLM-Anbieter.

Schreibende oder extern wirksame Aktionen werden zunächst als unveränderlicher
Aktionsvorschlag erzeugt. Die Ausführung verlangt eine explizite Bestätigung des
angemeldeten Nutzers, gebunden an Nutzer, Scope, Payload-Hash, Zielversion und kurze
Ablaufzeit. Beim Bestätigen wird die Fachlage erneut geprüft. Publishing verlangt
stets eine solche Bestätigung; Freigabe- und Minderjährigenschutzregeln bleiben
unverändert gültig.

Chat-Nachrichten dürfen private Medien ausschließlich als begrenzte `media_asset`-IDs
referenzieren. Asset-Bytes und ihre Metadaten werden weder in die Unterhaltung noch in den
normalen Text-LLM-Kontext übernommen. Ein künftiger Bild-Edit-Command darf ein explizit
ausgewähltes Bild nur nach einer eigenen Bestätigung an einen dafür konfigurierten Bild-/Vision-
Provider übergeben; Eingabe, Provider, Ergebnis-Asset und Auftrag werden dabei auditiert.

Ein optionaler Remote-MCP-Adapter darf erst nach Stabilisierung der Command-Plane
entstehen. Er ist dann ein dünner Server-zu-Server-Adapter auf eine dokumentierte,
gezielt kleine Teilmenge der Commands. Er ist weder Teil des Browser-Produkts noch
Voraussetzung für die Agenten-Seite.

## Konsequenzen

- Die Nutzeroberfläche kann früh einen sicheren, dialogischen Arbeitsablauf anbieten.
- Normale UI-Routen, Agent und späteres MCP teilen Fachregeln statt diese zu duplizieren.
- Alle Datenwege bleiben an der bisherigen Fastify-/Supabase-Sicherheitsgrenze.
- Ein späterer MCP benötigt eigene OAuth-, Rate-Limit-, Datenschutz-, Tool- und
  Penetrationstests; bis dahin entsteht kein zusätzlicher externer Datenpfad.
- Die Command-Plane ist kein Generalschlüssel: neue Actions sind einzeln zu modellieren,
  zu autorisieren, zu testen und zu auditieren.
