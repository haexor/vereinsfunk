import { createSecretBox } from '@vereinsfunk/secrets'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { WorkflowExecutionError } from './workflows.js'

/** Shared by every executor that loads an llm_provider_configurations row (text, vision, ...). */
export function openProviderSecret(config: WorkerEnvironment, ciphertext: string, keyVersion: string, providerId: string): string {
  let keys: unknown
  try { keys = JSON.parse(config.SECRET_BOX_KEYS) } catch { throw new WorkflowExecutionError('secret_configuration', false) }
  if (typeof keys !== 'object' || !keys || Array.isArray(keys)) throw new WorkflowExecutionError('secret_configuration', false)
  const secretBox = createSecretBox(keys as Record<string, string>, config.SECRET_BOX_CURRENT_KEY_VERSION)
  if (!ciphertext.startsWith('\\x')) throw new WorkflowExecutionError('provider_secret_encoding', false)
  return secretBox.open(Buffer.from(ciphertext.slice(2), 'hex'), keyVersion, providerId)
}
