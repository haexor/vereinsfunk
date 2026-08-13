import { parseWorkerEnvironment } from '@vereinsfunk/config'
import { runPendingMigrations } from '@vereinsfunk/db-migrate'
import { createLogger } from '@vereinsfunk/observability'
import { WorkflowOutboxDispatcher } from '@vereinsfunk/orchestration'
import { createGenerationRecoveryRepository, createTextGenerationRepository, createWorkflowExecutionRepository, createWorkflowOutboxRepository } from './context.js'
import { createHatchetClient, HatchetOrchestrator } from './hatchet.js'
import { concurrency, createHatchetWorker, WorkflowExecutionError, type ProductWorkflowExecutor } from './workflows.js'
import { TextGenerationExecutor } from './textGeneration.js'

const logger = createLogger({ name: 'worker' })
const WORKER_READY_TIMEOUT_MS = 30_000
let stopping = false
let worker: Awaited<ReturnType<typeof createHatchetWorker>> | undefined
let workerStop: Promise<void> | undefined
let workerRun: Promise<void> | undefined
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
  await workerRun?.catch(() => {})
  logger.info({ signal }, 'worker stopped gracefully')
  process.exitCode = 0
}

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })

async function main(): Promise<void> {
  const config = parseWorkerEnvironment()
  // Plan 036: laeuft vor jeder Repository-/Client-Erstellung, aus demselben Grund wie der
  // identische Hook in apps/api/src/server.ts. Ein Fehler wirft hier unveraendert bis zum
  // bestehenden startup.catch(...) unten durch -- derselbe harte Fehlschlag-Pfad, den ein
  // fehlerhaftes parseWorkerEnvironment() schon heute ausloest.
  await runPendingMigrations(config.DATABASE_URL, { log: (message) => logger.info(message) })
  const runs = createWorkflowExecutionRepository(config)
  const textGeneration = new TextGenerationExecutor(config, createTextGenerationRepository(config))
  const executor: ProductWorkflowExecutor = {
    async execute(workflow, payload) {
      if (workflow === 'generate-text-post') return textGeneration.execute(payload)
      throw new WorkflowExecutionError('product_executor_unavailable', false, `no product executor is configured for ${workflow}`)
    },
  }
  const createdWorker = await createHatchetWorker(config, runs, executor, createGenerationRecoveryRepository(config))
  worker = createdWorker
  if (stopping) return stopWorker()

  workerRun = worker.start()
  void workerRun.catch((error: unknown) => {
    if (stopping) return
    logger.fatal({ err: error }, 'Hatchet worker stopped unexpectedly')
    process.exitCode = 1
    void shutdown('worker_run_failed')
  })
  await worker.waitUntilReady(WORKER_READY_TIMEOUT_MS)
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
