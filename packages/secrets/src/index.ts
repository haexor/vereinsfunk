import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

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
      const nonce = ciphertext.subarray(0, NONCE_LENGTH)
      const authTag = ciphertext.subarray(NONCE_LENGTH, NONCE_LENGTH + AUTH_TAG_LENGTH)
      const encrypted = ciphertext.subarray(NONCE_LENGTH + AUTH_TAG_LENGTH)
      const decipher = createDecipheriv('aes-256-gcm', key, nonce)
      decipher.setAAD(Buffer.from(aad, 'utf8'))
      decipher.setAuthTag(authTag)
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    },
  }
}
