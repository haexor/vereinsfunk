# Phase-0-Spikes

Diese Arbeitspakete müssen vor Aktivierung realer Provider einzeln umgesetzt und abgenommen werden.

1. Hatchet-Fairness: TypeScript-SDK integrieren, Group Round Robin mit mindestens zwei Vereinen und drei Abteilungen messen, Worker-Neustart testen.
2. Supabase-RLS: Migration auf leerer lokaler Datenbank ausführen, komplette pgTAP-Matrix in CI aktivieren, Mutation fremder `organization_id` negativ testen.
3. Remotion Lambda: private Outputs, Reserved Concurrency, Kosten pro Template und Fehlerpfade messen.
4. Medienablage: große Uploads mit Supabase Storage und S3 vergleichen, Lifecycle und Transferkosten dokumentieren.
5. Mixpost: Lizenz, Workspace-/Token-Isolation, Reels, Scheduling, Webhooks, Analytics und Timeout-Semantik prüfen.
6. LLM Structured Output: faktentreuen Evaluationsdatensatz gegen mindestens einen Provider fahren; PII-Minimierung und Kosten messen.

Jeder Spike ergänzt ein ADR, eine Fake-Implementierung, reproduzierbare Schritte und ein klares Go/No-Go.
