# ADR-002: Hatchet als technische Workflow-Engine

Status: angenommen · lokaler Integrationsnachweis am 11. August 2026

Hatchet erhält nur IDs, Correlation IDs, Revisionen und technische Prioritäten. Inhalte, Medien und Secrets verbleiben in Supabase beziehungsweise privatem Storage. Der fachliche Status darf nie ausschließlich in der Workflow-Historie stehen.

Die transaktionale Outbox ist der Übergang zwischen fachlicher Mutation und technischer
Ausführung. Erst nach Annahme durch Hatchet entsteht oder aktualisiert sie den zugehörigen
`workflow_runs`-Datensatz. Worker erwerben eine zeitlich begrenzte Lease per Compare-and-Set;
doppelte Zustellungen und abgeschlossene Läufe führen daher keine Fachaktion erneut aus. Eine
fehlende Run-Zuordnung direkt nach der Hatchet-Annahme ist retrybar, nie ein Grund eine Aktion
unprotokolliert auszuführen. Die Service-Role-API darf ausschließlich innerhalb der fachlichen
Transaktion einen ID-only-Outbox-Auftrag erzeugen. Nur der Service-Role-Worker darf Outbox-Aufträge
claimen/acknowledgen sowie Run- und Lease-Lifecycle-RPCs aufrufen.
