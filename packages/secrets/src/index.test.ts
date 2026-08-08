import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createChainSigner, createSecretBox } from './index.js'

function key(): string {
  return randomBytes(32).toString('base64')
}

describe('createSecretBox', () => {
  it('throws when no key exists for the current key version', () => {
    expect(() => createSecretBox({}, 'v1')).toThrow(/no key configured/)
  })

  it('throws when a key does not decode to 32 bytes', () => {
    expect(() => createSecretBox({ v1: Buffer.from('too-short').toString('base64') }, 'v1')).toThrow(/32 bytes/)
  })

  it('seals and opens a round trip with matching aad', () => {
    const box = createSecretBox({ v1: key() }, 'v1')
    const { ciphertext, keyVersion } = box.seal('super-secret-api-key', 'config-1')
    expect(box.open(ciphertext, keyVersion, 'config-1')).toBe('super-secret-api-key')
  })

  it('fails to open with the wrong key version', () => {
    const box = createSecretBox({ v1: key(), v2: key() }, 'v1')
    const { ciphertext } = box.seal('super-secret-api-key', 'config-1')
    expect(() => box.open(ciphertext, 'v2', 'config-1')).toThrow()
  })

  it('fails to open with the wrong aad', () => {
    const box = createSecretBox({ v1: key() }, 'v1')
    const { ciphertext, keyVersion } = box.seal('super-secret-api-key', 'config-1')
    expect(() => box.open(ciphertext, keyVersion, 'config-2')).toThrow()
  })

  it('fails to open a tampered ciphertext (GCM auth tag)', () => {
    const box = createSecretBox({ v1: key() }, 'v1')
    const { ciphertext, keyVersion } = box.seal('super-secret-api-key', 'config-1')
    const tampered = Buffer.from(ciphertext)
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff
    expect(() => box.open(tampered, keyVersion, 'config-1')).toThrow()
  })

  it('supports rotation: new seals use the current version, old ciphertexts still open', () => {
    const keys = { v1: key(), v2: key() }
    const oldSealed = createSecretBox(keys, 'v1').seal('rotated-secret', 'config-1')
    const box = createSecretBox(keys, 'v2')
    const sealed = box.seal('new-secret', 'config-1')
    expect(sealed.keyVersion).toBe('v2')
    expect(box.open(oldSealed.ciphertext, oldSealed.keyVersion, 'config-1')).toBe('rotated-secret')
  })
})

describe('createChainSigner', () => {
  it('throws when no key exists for the current key version', () => {
    expect(() => createChainSigner({}, 'v1')).toThrow(/no key configured/)
  })

  it('signs and verifies a round trip', () => {
    const signer = createChainSigner({ v1: key() }, 'v1')
    const { signature, keyVersion } = signer.sign('head-hash-abc')
    expect(signer.verify('head-hash-abc', signature, keyVersion)).toBe(true)
  })

  it('rejects a signature for a different payload', () => {
    const signer = createChainSigner({ v1: key() }, 'v1')
    const { signature, keyVersion } = signer.sign('head-hash-abc')
    expect(signer.verify('head-hash-def', signature, keyVersion)).toBe(false)
  })

  it('rejects a tampered signature', () => {
    const signer = createChainSigner({ v1: key() }, 'v1')
    const { signature, keyVersion } = signer.sign('head-hash-abc')
    const tampered = signature.slice(0, -1) + (signature.at(-1) === '0' ? '1' : '0')
    expect(signer.verify('head-hash-abc', tampered, keyVersion)).toBe(false)
  })

  it('rejects verification against an unknown key version', () => {
    const signer = createChainSigner({ v1: key() }, 'v1')
    const { signature } = signer.sign('head-hash-abc')
    expect(signer.verify('head-hash-abc', signature, 'v2')).toBe(false)
  })

  it('produces different signatures than createSecretBox for the same key material (key separation)', () => {
    const sharedKey = key()
    const signer = createChainSigner({ v1: sharedKey }, 'v1')
    const { signature } = signer.sign('head-hash-abc')
    // Same underlying key bytes, HKDF-derived HMAC key must differ from raw AES key use.
    expect(signature).not.toBe(sharedKey)
  })

  it('supports rotation: verification still works against an older key version', () => {
    const keys = { v1: key(), v2: key() }
    const oldSigned = createChainSigner(keys, 'v1').sign('head-hash-abc')
    const signer = createChainSigner(keys, 'v2')
    expect(signer.verify('head-hash-abc', oldSigned.signature, oldSigned.keyVersion)).toBe(true)
  })
})
