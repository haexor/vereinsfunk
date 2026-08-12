# Deploy und Migrationen

Plan 036: `apps/api` und `apps/worker` wenden `supabase/migrations` seit diesem Plan selbst an,
bei jedem eigenen Prozessstart -- nicht mehr manuell per `supabase db push` von einem
Entwicklerrechner aus.

## Warum am Prozessstart, nicht in Ansible

`.github/workflows/images.yml` baut bei jedem Merge auf `main` neue Images. Watchtower auf
haex.space pollt GHCR pro Container und tauscht sie automatisch aus -- unabhängig von jedem
Ansible-Lauf (`~/Projekte/ansible`, Rolle `vereinsfunk`, rendert nur Config und lässt Images danach
von selbst weiterrollen). Ein Migrationsschritt, der nur in Ansible oder nur in der CI-Pipeline
liefe, würde bei einem reinen Watchtower-Swap nie erneut ausgeführt. Ein Hook direkt im
Prozessstart ist der einzige Punkt, den dieses Rollout-Modell zuverlässig trifft.

## Ablauf

1. Watchtower ersetzt `vereinsfunk-api`/`vereinsfunk-worker` durch ein neues Image.
2. Der Container startet neu. `packages/db-migrate`s `runPendingMigrations()` läuft als
   allererste Aktion (`apps/api/src/server.ts`, `apps/worker/src/index.ts`) -- vor jeder
   Route-Registrierung, vor jedem Repository-Zugriff.
3. `supabase db push --yes --workdir <erkannt> --db-url $DATABASE_URL` wendet ausstehende
   Migrationen an. Ohne ausstehende Migrationen ist das ein schneller No-Op.
4. Erst danach startet die Anwendung (`app.listen()` bzw. der Hatchet-Worker).

## Wenn der Container crash-loopt

Ein fehlgeschlagener Push wirft `MigrationError` unbehandelt -- der Prozess beendet sich mit
Exit-Code ≠ 0, `restart: unless-stopped`/`on-failure` startet ihn erneut, der nächste Versuch
scheitert an derselben Migration wieder. Das ist beabsichtigt: eine API, die still gegen ein halb
migriertes Schema weiterläuft, ist der unsichtbare Fehler, den dieser Plan beheben sollte (siehe
`plans/036-migrationen-beim-container-start-automatisieren.md`, "Why this matters").

Reaktion: `docker logs vereinsfunk-api` (bzw. `-worker`) zeigt die stderr-Ausgabe von
`supabase db push` mit der genauen fehlgeschlagenen Migration. Die Migrationsdatei korrigieren,
erneut nach `main` mergen -- **nicht** den Boot-Hook umgehen oder den Container manuell mit einer
älteren Migration weiterlaufen lassen.

## DATABASE_URL

Direkte Postgres-Verbindung (nicht die PostgREST-URL aus `SUPABASE_URL`), mit vollen
Schema-Änderungsrechten -- das einzige Credential in diesem Projekt, das nicht über
`service_role`/PostgREST läuft. Lokal: `supabase status` zeigt den Wert (siehe `.env.example`).
Produktiv: Supabase Dashboard → Project Settings → Database → Connection string →
**Session pooler** (Port 5432), nicht "Transaction pooler" (6543, für DDL/Advisory-Locks
ungeeignet) -- die direkte Verbindung (`db.<ref>.supabase.co`) braucht IPv6 und ist von
IPv4-only-Umgebungen aus nicht erreichbar.

Verwaltet in `~/Projekte/ansible` (separates Repository), Rolle `vereinsfunk`,
`secrets/<host>.yml` unter `vereinsfunk.database_url` -- siehe dortige
`roles/vereinsfunk/defaults/main.yml` für den bisherigen manuellen Weg, den dieser Plan ablöst.
