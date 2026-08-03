import { createLogger } from '@vereinsfunk/observability'
import { concurrency } from './workflows.js'

const logger = createLogger({ name: 'worker' })
let stopping = false

logger.info(
  { adapter: process.env.HATCHET_CLIENT_TOKEN ? 'hatchet' : 'local', concurrency },
  'worker scaffold ready',
)

const shutdown = (signal: string) => {
  if (stopping) return
  stopping = true
  logger.info({ signal }, 'worker stopped gracefully')
  process.exit(0)
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

// Keep the local worker health process alive until the Hatchet adapter is configured.
setInterval(() => logger.debug({ status: 'healthy' }, 'worker heartbeat'), 30_000).unref()
