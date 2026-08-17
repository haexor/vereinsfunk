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

## Bei Kompromittierungsverdacht: `DATABASE_URL` rotieren

Anders als `SUPABASE_SERVICE_ROLE_KEY` (PostgREST/RLS-Bypass) ist `DATABASE_URL` eine echte
Postgres-Rolle mit vollem Schema-Schreibzugriff -- der größte Blast-Radius eines einzelnen
Credentials in diesem Projekt (Entscheidung 3,
`plans/036-migrationen-beim-container-start-automatisieren.md`). Bei Verdacht auf
Kompromittierung von `vereinsfunk-api` oder `vereinsfunk-worker`:

1. Supabase Dashboard -> Project Settings -> Database -> **Reset database password**. Invalidiert
   sofort jede bestehende Direktverbindung mit dem alten Passwort (Session-Pooler eingeschlossen);
   `SUPABASE_SERVICE_ROLE_KEY`/PostgREST bleiben davon unberührt, das ist ein separates Credential.
2. Neues Passwort in `~/Projekte/ansible`, `secrets/<host>.yml` unter
   `vereinsfunk.supabase_db_url` eintragen.
3. Playbook erneut gegen den betroffenen Host laufen lassen -- das rendert `DATABASE_URL` neu und
   startet `vereinsfunk-api`/`-worker` dabei automatisch neu (`recreate: always` im Docker-Pfad,
   `state: restarted` im Quadlet-Pfad), kein manueller Zusatzschritt nötig.
4. `docker logs vereinsfunk-api`/`-worker` prüfen: "applying pending database migrations" ->
   "database migrations applied" bestätigt, dass der Boot-Hook mit dem neuen Credential
   durchläuft.

## Meta OAuth aktivieren

Die Verbindung von Instagram-Professional-Konten und Facebook-Seiten wird von der
API über eine zentrale Meta-App hergestellt, nicht durch Zugangsdaten eines Vereins.
Die Ansible-Rolle `vereinsfunk` reicht die App-Zugangsdaten nur an den API-Container
weiter; weder Nuxt noch der Worker erhalten sie.

1. In `~/Projekte/ansible/secrets/haex.space.yml` unter `secrets.vereinsfunk`
   `meta_app_id` und `meta_app_secret` aus *Meta for Developers → App settings →
   Basic* eintragen. Diese Datei ist ein Secret-Store und darf nicht ins App-Repository.
2. In `inventory/haex.space.yml` `vereinsfunk.publishing.provider` auf `meta`
   setzen und `meta_graph_version` auf eine von Meta aktuell unterstützte Graph-API-Version
   festlegen.
3. In der Meta-App beide **Valid OAuth Redirect URIs** eintragen:
   `https://vereinsfunk-api.haex.space/v1/channels/connect/instagram/callback`
   und
   `https://vereinsfunk-api.haex.space/v1/channels/connect/facebook/callback`.
4. Die Rolle ausrollen:
   `ansible-playbook -i inventory/haex.space.yml haex.space.play.yml --tags vereinsfunk`.

Die API startet fail-closed, falls bei `PUBLISHING_PROVIDER=meta` eine dieser
Pflichtangaben fehlt. Der Meta-App-Secret gehört ausschließlich in den Secret-Store,
nie in `.env.example`, Inventories oder Browser-Konfiguration.
