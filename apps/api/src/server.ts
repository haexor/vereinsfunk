import { parseApiEnvironment } from '@vereinsfunk/config'
import { buildApp } from './app.js'
import { createServiceClient } from './supabase.js'

const environment = parseApiEnvironment()
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
