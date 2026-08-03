import { parseApiEnvironment } from '@vereinsfunk/config'
import { buildApp } from './app.js'

const environment = parseApiEnvironment()
const app = await buildApp()

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown started')
  await app.close()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ host: environment.API_HOST, port: environment.API_PORT })
