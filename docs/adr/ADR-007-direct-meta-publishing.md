# ADR-007: Direkter Meta-Adapter im MVP

Status: angenommen, Sandbox-Gate offen · 3. August 2026

Instagram Professional und Facebook Pages werden hinter `SocialPublisher` über einen direkten `MetaPublisher` integriert. Browser, Hatchet-Payloads und Logs erhalten weder Tokens noch Originalmedien. Der Provider darf ausschließlich kurzlebige, auf eine freigegebene Derivat-ID beschränkte Medien-Grants abrufen.

Timeouts und unklare Providerantworten führen zu Reconciliation statt Blind-Retry. Die produktive Aktivierung bleibt gesperrt, bis die in `docs/evidence/meta-publishing-spike.md` beschriebene Sandbox-Matrix mit der aktuellen Graph-Version nachgewiesen ist.
