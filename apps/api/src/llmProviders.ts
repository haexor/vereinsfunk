import type { ApiEnvironment } from '@vereinsfunk/config'
import { createSecretBox, type SecretBox } from '@vereinsfunk/secrets'

// Absichtlich lazy statt beim Serverstart geprueft (wie createServiceClient/createUserClient):
// nicht jede Umgebung nutzt die LLM-Provider-Verwaltung, ein hartes Startup-Erfordernis waere
// verfruehte Kopplung an ein Feature, das ein Deployment vielleicht nie anfasst.
export function createSecretBoxFromEnvironment(environment: ApiEnvironment): SecretBox {
  if (!environment.SECRET_BOX_KEYS || !environment.SECRET_BOX_CURRENT_KEY_VERSION) {
    throw new Error('SECRET_BOX_KEYS and SECRET_BOX_CURRENT_KEY_VERSION are required to manage LLM provider secrets')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(environment.SECRET_BOX_KEYS)
  } catch {
    throw new Error('SECRET_BOX_KEYS must be valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('SECRET_BOX_KEYS must be a JSON object mapping key versions to base64-encoded keys')
  }
  return createSecretBox(parsed as Record<string, string>, environment.SECRET_BOX_CURRENT_KEY_VERSION)
}

// bytea-Spalten erwarten ueber PostgREST/supabase-js die Postgres-Hex-Escape-Form, kein
// rohes Buffer-Objekt (das wuerde als {"type":"Buffer","data":[...]} serialisiert).
export function ciphertextToBytea(ciphertext: Buffer): string {
  return `\\x${ciphertext.toString('hex')}`
}

export function mapLlmProviderConfigurationRow(row: Record<string, unknown>, hasSecret: boolean) {
  return {
    id: row.id,
    label: row.label,
    protocol: row.protocol,
    baseUrl: row.base_url,
    model: row.model,
    purpose: row.purpose,
    priority: row.priority,
    isActive: row.is_active,
    systemPromptOverride: row.system_prompt_override,
    hasSecret,
  }
}
