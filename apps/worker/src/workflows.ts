import { HatchetClient, type Worker } from '@hatchet-dev/typescript-sdk/v1/index.js'
import type { WorkerEnvironment } from '@vereinsfunk/config'

export const concurrency = {
  llm: { global: 20, organization: 4, department: 2 }, image: { global: 12, organization: 3, department: 1 },
  video: { global: 4, organization: 1, department: 1 }, publishing: { global: 20, organization: 4, department: 2 },
} as const
/** Creates a worker without registering product workflows until their durable handlers exist. */
export async function createHatchetWorker(config: WorkerEnvironment): Promise<Worker> {
  const client = HatchetClient.init({
    token: config.HATCHET_CLIENT_TOKEN,
    host_port: config.HATCHET_CLIENT_HOST_PORT,
    tls_config: { tls_strategy: config.HATCHET_TLS ? 'tls' : 'none' },
  })
  return client.worker('vereinsfunk-worker', { slots: config.HATCHET_WORKER_SLOTS })
}
