# ADR-011: Provider-Aufgabenrouting mit einem Text-only-Adapter

Status: angenommen · 11. August 2026

Providerkonfigurationen sind Plattformressourcen. Sie werden nach `task_kind`, Aktivität und
niedrigster Priorität aufgelöst; fehlende oder gleichrangig mehrdeutige aktive Konfigurationen
schlagen kontrolliert fehl. Die Konfiguration speichert nur nicht geheime Laufzeitparameter.
Schlüssel liegen separat verschlüsselt und werden ausschließlich im Worker entschlüsselt.

Aktiv implementiert ist nur `text_generation` über einen OpenAI-kompatiblen, strukturierten
Adapter. `image_generation` und `video_generation` sind lediglich reservierte Bezeichner und
werden von der API abgewiesen. Kein Fastify-Handler führt einen Provideraufruf aus.

Der Worker lädt Session, bestätigte Quellen und Stil-Snapshot aus Supabase, erzeugt einen getrennten
Kandidaten und validiert die Antwort mit Zod und Faktenbindung vor dem Schreiben. Hatchet erhält
nur IDs und technische Metadaten. Weder Prompt, Antwort, Beitrag, Medien noch Geheimnisse werden
geloggt oder in Hatchet gespeichert. Erst die atomare Kandidatenübernahme erzeugt eine immutable
`post_version` mitsamt Provenienz.

Ein künftiger Bild-/Video-Task braucht vor einer Aktivierung einen eigenen Adapter-Spike,
Kosten-/Rate-Limits, asynchrone Ergebniseinholung, Rechte- und Inhaltsprüfung, Kennzeichnung,
private Output-Ablage sowie eine Freigabeentscheidung. Vor Publishing von KI-Text bleibt die
rechtliche Kennzeichnungsfrage aus ADR-010 ein Release-Blocker.
