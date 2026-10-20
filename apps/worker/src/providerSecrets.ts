import { byteaToBuffer, createSecretBox, parseSecretBoxKeys } from '@vereinsfunk/secrets'
import type { WorkerEnvironment } from '@vereinsfunk/config'
import { WorkflowExecutionError } from './workflows.js'

/** Shared by every executor that loads an llm_provider_configurations row (text, vision, ...). */
export function openProviderSecret(config: WorkerEnvironment, ciphertext: string, keyVersion: string, providerId: string): string {
  let keys: Record<string, string>
  try { keys = parseSecretBoxKeys(config.SECRET_BOX_KEYS) } catch { throw new WorkflowExecutionError('secret_configuration', false) }
  let sealed: Buffer
  try { sealed = byteaToBuffer(ciphertext) } catch { throw new WorkflowExecutionError('provider_secret_encoding', false) }
  // Fehlender Schluessel, falsche Version oder ein nicht authentifizierbarer Ciphertext scheitern
  // bei jedem Versuch gleich -- als Konfigurationsfehler gemeldet statt als Hatchet-Wiederholung.
  try { return createSecretBox(keys, config.SECRET_BOX_CURRENT_KEY_VERSION).open(sealed, keyVersion, providerId) } catch { throw new WorkflowExecutionError('secret_configuration', false) }
}
