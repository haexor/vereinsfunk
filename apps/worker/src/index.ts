import { parseWorkerEnvironment } from '@vereinsfunk/config'
import { createLogger } from '@vereinsfunk/observability'
import { WorkflowOutboxDispatcher } from '@vereinsfunk/orchestration'
import { createWorkflowOutboxRepository } from './context.js'
import { createHatchetClient, HatchetOrchestrator } from './hatchet.js'
import { concurrency, createHatchetWorker } from './workflows.js'

const logger = createLogger({ name: 'worker' })
let stopping = false
let worker: Awaited<ReturnType<typeof createHatchetWorker>> | undefined
let workerStop: Promise<void> | undefined
let dispatchInFlight: Promise<void> | undefined
let dispatchTimer: ReturnType<typeof setInterval> | undefined

/** Stops the registered Hatchet worker at most once, including startup/shutdown races. */
async function stopWorker(): Promise<void> {
  if (!worker) return
  workerStop ??= worker.stop()
  await workerStop
}

/** Executes only one outbox dispatch at a time and retains the original error logging. */
function dispatchOnce(dispatcher: WorkflowOutboxDispatcher): Promise<void> {
  if (dispatchInFlight) return dispatchInFlight
  dispatchInFlight = (async () => {
    try {
      await dispatcher.dispatchPending()
    } catch (error) {
      logger.error({ err: error }, 'workflow outbox dispatch failed')
    } finally {
      dispatchInFlight = undefined
    }
  })()
  return dispatchInFlight
}

/** Serializes teardown with startup and the active outbox dispatch. */
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return
  stopping = true
  if (dispatchTimer) clearInterval(dispatchTimer)
  await startup.catch(() => {})
  await dispatchInFlight
  await stopWorker()
  logger.info({ signal }, 'worker stopped gracefully')
  process.exitCode = 0
}

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })

async function main(): Promise<void> {
  const config = parseWorkerEnvironment()
  const createdWorker = await createHatchetWorker(config)
  worker = createdWorker
  if (stopping) return stopWorker()

  await worker.start()
  if (stopping) return stopWorker()

  const dispatcher = new WorkflowOutboxDispatcher(createWorkflowOutboxRepository(config), new HatchetOrchestrator(createHatchetClient(config)))
  await dispatchOnce(dispatcher)
  if (stopping) return stopWorker()

  dispatchTimer = setInterval(() => { void dispatchOnce(dispatcher) }, 1_000)
  dispatchTimer.unref()
  logger.info({ adapter: 'hatchet', concurrency }, 'Hatchet worker started')
}

const startup = main()
startup.catch((error: unknown) => {
  logger.fatal({ err: error }, 'Hatchet worker failed to start')
  process.exitCode = 1
})
