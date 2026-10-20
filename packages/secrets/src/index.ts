import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const SecretBoxKeysSchema = z.record(z.string(), z.string())

/**
 * Liest SECRET_BOX_KEYS (JSON-Objekt Schluesselversion -> base64-Schluessel). API und Worker teilen
 * diese eine Pruefung; der Worker castete den Wert zuvor an einer Stelle ungeprueft. Die
 * Fehlermeldungen nennen den Wert nie -- er ist das Schluesselmaterial selbst.
 */
export function parseSecretBoxKeys(raw: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('SECRET_BOX_KEYS must be valid JSON')
  }
  const keys = SecretBoxKeysSchema.safeParse(parsed)
  if (!keys.success) throw new Error('SECRET_BOX_KEYS must be a JSON object mapping key versions to base64-encoded keys')
  return keys.data
}

// bytea-Spalten erwarten ueber PostgREST/supabase-js die Postgres-Hex-Escape-Form, kein
// rohes Buffer-Objekt (das wuerde als {"type":"Buffer","data":[...]} serialisiert).
export function ciphertextToBytea(ciphertext: Buffer): string {
  return `\\x${ciphertext.toString('hex')}`
}

// Kehrseite von ciphertextToBytea -- gebraucht, wo ein gespeichertes Geheimnis wieder
// entschluesselt wird (API-Routen und Worker).
export function byteaToBuffer(value: string): Buffer {
  if (!value.startsWith('\\x')) throw new Error('Unexpected bytea encoding')
  return Buffer.from(value.slice(2), 'hex')
}

// llm_provider_secrets kommt ueber PostgREST' !inner-Embed entweder als Objekt oder als
// Ein-Element-Array zurueck (PostgREST kann die Kardinalitaet der Beziehung nicht immer statisch
// bestimmen) -- Form und Unwrap lagen zuvor getrennt in API und Worker.
// Genau ein Element, nicht min(1): llm_provider_configuration_id ist in llm_provider_secrets
// PRIMARY KEY, eine gueltige Antwort kann also nie mehr als eine Zeile enthalten.
export const EmbeddedProviderSecretSchema = z.union([
  z.object({ api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1) }),
  z.array(z.object({ api_key_ciphertext: z.string().min(1), key_version: z.string().trim().min(1) })).length(1),
])

export function unwrapEmbeddedSecret<T>(secret: T | T[]): T {
  return Array.isArray(secret) ? secret[0]! : secret
}

export interface SecretBox {
  seal(plaintext: string, aad: string): { ciphertext: Buffer; keyVersion: string }
  open(ciphertext: Buffer, keyVersion: string, aad: string): string
}

const NONCE_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function decodeKey(base64Key: string, keyVersion: string): Buffer {
  const key = Buffer.from(base64Key, 'base64')
  if (key.length !== 32) throw new Error(`createSecretBox: key "${keyVersion}" must decode to exactly 32 bytes (AES-256)`)
  return key
}

export function createSecretBox(keys: Readonly<Record<string, string>>, currentKeyVersion: string): SecretBox {
  if (!keys[currentKeyVersion]) {
    throw new Error(`createSecretBox: no key configured for current key version "${currentKeyVersion}"`)
  }
  // Fail fast: validate the current key's length now rather than at the first seal() call.
  decodeKey(keys[currentKeyVersion]!, currentKeyVersion)

  return {
    seal(plaintext, aad) {
      const key = decodeKey(keys[currentKeyVersion]!, currentKeyVersion)
      const nonce = randomBytes(NONCE_LENGTH)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(Buffer.from(aad, 'utf8'))
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const ciphertext = Buffer.concat([nonce, cipher.getAuthTag(), encrypted])
      return { ciphertext, keyVersion: currentKeyVersion }
    },
    open(ciphertext, keyVersion, aad) {
      const encodedKey = keys[keyVersion]
      if (!encodedKey) throw new Error(`createSecretBox: no key configured for key version "${keyVersion}"`)
      const key = decodeKey(encodedKey, keyVersion)
      // Ohne Laengenpruefung lieferte subarray() bei einem gekuerzten Ciphertext einen kuerzeren
      // Auth-Tag, und GCM akzeptiert Tags ab 4 Byte -- ein 4-Byte-Tag ist mit 2^32 Versuchen
      // faelschbar. authTagLength erzwingt zusaetzlich genau die Laenge, die seal() schreibt.
      if (ciphertext.length < NONCE_LENGTH + AUTH_TAG_LENGTH) throw new Error('createSecretBox: ciphertext is too short')
      const nonce = ciphertext.subarray(0, NONCE_LENGTH)
      const authTag = ciphertext.subarray(NONCE_LENGTH, NONCE_LENGTH + AUTH_TAG_LENGTH)
      const encrypted = ciphertext.subarray(NONCE_LENGTH + AUTH_TAG_LENGTH)
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: AUTH_TAG_LENGTH })
      decipher.setAAD(Buffer.from(aad, 'utf8'))
      decipher.setAuthTag(authTag)
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    },
  }
}

export interface ChainSigner {
  sign(payload: string): { signature: string; keyVersion: string }
  verify(payload: string, signature: string, keyVersion: string): boolean
}

const HMAC_KEY_LENGTH = 32

// Eigener HMAC-Schluessel per HKDF aus dem SECRET_BOX_KEYS-Material abgeleitet (Paket 020, Plan
// Abschnitt "4b. Manipulationssicherer Audit-Trail" schlaegt Wiederverwendung von SECRET_BOX_KEYS
// vor, statt eine dritte Env-Variable einzufuehren) -- ein AES-GCM-Schluessel direkt auch als
// HMAC-Schluessel zu verwenden waere Schluesselwiederverwendung ueber zwei Algorithmen hinweg;
// die Ableitung mit einem festen Kontext-String haelt beide Verwendungen kryptografisch getrennt.
function deriveSigningKey(base64Key: string, keyVersion: string): Buffer {
  const material = decodeKey(base64Key, keyVersion)
  return Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), 'vereinsfunk-audit-chain-v1', HMAC_KEY_LENGTH))
}

// Signiert den Kopf-Hash der Audit-Event-Kette je Verein (Paket 020) mit einem Schluessel, der
// nicht in der Datenbank liegt -- die Signatur beweist auch nach einer spaeteren
// Aufbewahrungsloeschung aelterer audit_events, dass die Kette zum Signaturzeitpunkt unverändert war.
export function createChainSigner(keys: Readonly<Record<string, string>>, currentKeyVersion: string): ChainSigner {
  if (!keys[currentKeyVersion]) {
    throw new Error(`createChainSigner: no key configured for current key version "${currentKeyVersion}"`)
  }
  decodeKey(keys[currentKeyVersion]!, currentKeyVersion)

  return {
    sign(payload) {
      const key = deriveSigningKey(keys[currentKeyVersion]!, currentKeyVersion)
      const signature = createHmac('sha256', key).update(payload, 'utf8').digest('hex')
      return { signature, keyVersion: currentKeyVersion }
    },
    verify(payload, signature, keyVersion) {
      const encodedKey = keys[keyVersion]
      if (!encodedKey) return false
      const key = deriveSigningKey(encodedKey, keyVersion)
      const expected = createHmac('sha256', key).update(payload, 'utf8').digest('hex')
      const expectedBuffer = Buffer.from(expected, 'hex')
      const actualBuffer = Buffer.from(signature, 'hex')
      if (expectedBuffer.length !== actualBuffer.length) return false
      return timingSafeEqual(expectedBuffer, actualBuffer)
    },
  }
}
