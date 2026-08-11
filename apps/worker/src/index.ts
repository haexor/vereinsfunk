import { createLogger } from '@vereinsfunk/observability'
import { createSupabaseWorkflowContext, createWorkflowOutboxRepository } from './context.js'
import { createHatchetClient, HatchetOrchestrator, WorkflowOutboxDispatcher } from '@vereinsfunk/orchestration'
import { concurrency, createHatchetWorker } from './workflows.js'

const logger = createLogger({ name: 'worker' })
let stopping = false
let worker: Awaited<ReturnType<typeof createHatchetWorker>> | undefined

const shutdown = async (signal: string) => {
  if (stopping) return
  stopping = true
  await worker?.stop()
  logger.info({ signal }, 'worker stopped gracefully')
  process.exitCode = 0
}

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })

async function main() {
  worker = await createHatchetWorker(createSupabaseWorkflowContext(), process.env)
  await worker.start()
  const dispatcher = new WorkflowOutboxDispatcher(createWorkflowOutboxRepository(), new HatchetOrchestrator(createHatchetClient()))
  const dispatch = async () => { try { await dispatcher.dispatchPending() } catch (error) { logger.error({ err: error }, 'workflow outbox dispatch failed') } }
  await dispatch()
  setInterval(() => { void dispatch() }, 1_000).unref()
  logger.info({ adapter: 'hatchet', concurrency }, 'Hatchet worker started')
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Hatchet worker failed to start')
  process.exitCode = 1
})
