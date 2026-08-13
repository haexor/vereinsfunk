import { parseApiEnvironment } from '@vereinsfunk/config'
import { runPendingMigrations } from '@vereinsfunk/db-migrate'
import { buildApp } from './app.js'
import { createServiceClient } from './supabase.js'

const environment = parseApiEnvironment()

// Plan 036: laeuft vor jeder Route-Registrierung und jeder Abfrage -- Watchtower tauscht dieses
// Image unabhaengig von jedem Ansible-Lauf aus, ein Hook direkt im Prozessstart ist der einzige
// Punkt, den dieses Rollout-Modell zuverlaessig trifft. DATABASE_URL ist in Produktion Pflicht
// (packages/config), lokal optional -- ohne sie ueberspringt der Hook sich selbst, mit ihr laeuft
// er identisch zu Produktion (siehe .env.example). Ein Fehler hier wird bewusst NICHT abgefangen:
// anders als der bootstrap_platform_admin-Aufruf unten (der einen fehlenden auth.users-Eintrag
// tolerieren darf) muss ein Migrationsfehler den Start verweigern, nicht still weiterlaufen.
if (environment.DATABASE_URL) {
  await runPendingMigrations(environment.DATABASE_URL, { log: (message) => console.log(message) })
}

const app = await buildApp()

// Bootstrap ist idempotent (siehe bootstrap_platform_admin) -- ein fehlender auth.users-
// Eintrag (Nutzer hat sich noch nicht registriert) darf den Serverstart nicht verhindern.
if (environment.PLATFORM_ADMIN_DEFAULT_EMAIL) {
  const rpc = await createServiceClient(environment).rpc('bootstrap_platform_admin', {
    target_email: environment.PLATFORM_ADMIN_DEFAULT_EMAIL,
  })
  if (rpc.error) app.log.warn({ err: rpc.error }, 'bootstrap_platform_admin did not run to completion')
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown started')
  await app.close()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ host: environment.API_HOST, port: environment.API_PORT })
