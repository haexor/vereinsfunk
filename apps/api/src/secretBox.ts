import type { ApiEnvironment } from '@vereinsfunk/config'
import { createChainSigner, createSecretBox, type ChainSigner, type SecretBox } from '@vereinsfunk/secrets'
import { z } from 'zod'

// Gemeinsam fuer LLM-Provider-Schluessel (Paket 011) und Social-Connection-Tokens (Paket 012) --
// beide Verwendungen teilen denselben Schluesselsatz, statt einen zweiten mit eigenen Env-Variablen
// einzufuehren (Plan 012 sah urspruenglich SOCIAL_TOKEN_KEYS vor; SECRET_BOX_KEYS existierte zu dem
// Zeitpunkt bereits aus Paket 011 und wird stattdessen wiederverwendet).
// Absichtlich lazy statt beim Serverstart geprueft (wie createServiceClient/createUserClient):
// nicht jede Umgebung nutzt LLM-Provider- oder Kanalverwaltung, ein hartes Startup-Erfordernis waere
// verfruehte Kopplung an Features, die ein Deployment vielleicht nie anfasst.
export function createSecretBoxFromEnvironment(environment: ApiEnvironment): SecretBox {
  if (!environment.SECRET_BOX_KEYS || !environment.SECRET_BOX_CURRENT_KEY_VERSION) {
    throw new Error('SECRET_BOX_KEYS and SECRET_BOX_CURRENT_KEY_VERSION are required to manage encrypted secrets')
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

// Paket 020: signiert den Kopf-Hash der Audit-Event-Kette je Verein mit demselben Schluesselsatz --
// eine eigene Env-Variable wollte der Plan ausdrücklich nicht ("packages/secrets, SECRET_BOX_KEYS").
// createChainSigner leitet daraus per HKDF einen eigenen HMAC-Schluessel ab, keine Wiederverwendung
// des rohen AES-Schluessels ueber zwei Algorithmen hinweg.
export function createChainSignerFromEnvironment(environment: ApiEnvironment): ChainSigner {
  if (!environment.SECRET_BOX_KEYS || !environment.SECRET_BOX_CURRENT_KEY_VERSION) {
    throw new Error('SECRET_BOX_KEYS and SECRET_BOX_CURRENT_KEY_VERSION are required to sign the audit chain')
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
  return createChainSigner(parsed as Record<string, string>, environment.SECRET_BOX_CURRENT_KEY_VERSION)
}

// bytea-Spalten erwarten ueber PostgREST/supabase-js die Postgres-Hex-Escape-Form, kein
// rohes Buffer-Objekt (das wuerde als {"type":"Buffer","data":[...]} serialisiert).
export function ciphertextToBytea(ciphertext: Buffer): string {
  return `\\x${ciphertext.toString('hex')}`
}

// Kehrseite von ciphertextToBytea -- gebraucht, wo ein gespeichertes Geheimnis wieder entschluesselt
// wird, bisher nur in POST /v1/channels/:id/verify (Paket 012).
export function byteaToBuffer(value: string): Buffer {
  if (!value.startsWith('\\x')) throw new Error('Unexpected bytea encoding')
  return Buffer.from(value.slice(2), 'hex')
}

// llm_provider_secrets kommt ueber PostgREST' !inner-Embed entweder als Objekt oder als
// Ein-Element-Array zurueck (PostgREST kann die Kardinalitaet der Beziehung nicht immer statisch
// bestimmen) -- Form und Unwrap wurden bisher in app.ts und routes/shared.ts dupliziert.
export const EmbeddedProviderSecretSchema = z.union([
  z.object({ api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1) }),
  z.array(z.object({ api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1) })).min(1),
])

export function unwrapEmbeddedSecret<T>(secret: T | T[]): T {
  return Array.isArray(secret) ? secret[0]! : secret
}
