import { describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { parseApiEnvironment } from '@vereinsfunk/config'
import { createAuthGuards, type PlatformAdminProvider, type RoleProvider } from './auth.js'

const roleProvider: RoleProvider = { async rolesForScope() { return [] } }
const platformAdminProvider: PlatformAdminProvider = {
  async statusFor() { return { isPlatformAdmin: false, isDefaultAdmin: false } },
}

function fakeRequest(accessToken?: string): FastifyRequest {
  return {
    id: 'test-request',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  } as unknown as FastifyRequest
}

function fakeReply() {
  const reply = { code: vi.fn(() => reply), send: vi.fn(() => reply) }
  return reply as unknown as FastifyReply & { code: typeof reply.code; send: typeof reply.send }
}

const SUPABASE_URL = 'https://project-ref.supabase.co'

// Regression: Supabase legt seit 1. Mai 2025 neue Projekte standardmaessig mit asymmetrischen JWT
// Signing Keys an. Ein reiner HS256-Pfad (der alte Code) wies jeden solchen Token mit einem
// Algorithmus-Mismatch ab -- diese Tests decken den JWKS-Pfad ab, der genau das behebt.
describe('createAuthGuards JWKS verification', () => {
  it('accepts a token signed by a key published in the project JWKS', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256')
    const kid = 'test-key'
    const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }] }

    const jwksFetch = vi.fn(async (url: string) => {
      expect(url).toBe(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
      return new Response(JSON.stringify(jwks), { headers: { 'content-type': 'application/json' } })
    })

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid })
      .setSubject('user-123')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    const environment = parseApiEnvironment({ SUPABASE_URL })
    const { requireAuth } = createAuthGuards(environment, roleProvider, platformAdminProvider, { jwksFetch })

    const request = fakeRequest(token)
    const reply = fakeReply()
    const authenticated = await requireAuth(request, reply)

    expect(authenticated).toBe(true)
    expect(request.auth).toEqual({ userId: 'user-123', accessToken: token })
    expect(reply.code).not.toHaveBeenCalled()
  })

  it('rejects a token signed by a key absent from the project JWKS', async () => {
    const { publicKey } = await generateKeyPair('ES256')
    const { privateKey: otherPrivateKey } = await generateKeyPair('ES256')
    const kid = 'test-key'
    const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }] }

    const jwksFetch = async () => new Response(JSON.stringify(jwks), { headers: { 'content-type': 'application/json' } })

    // Signiert mit einem Schluessel, der nicht im JWKS steht -- z.B. ein gefaelschter oder abgelaufen
    // rotierter Token.
    const forgedToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid })
      .setSubject('user-123')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(otherPrivateKey)

    const environment = parseApiEnvironment({ SUPABASE_URL })
    const { requireAuth } = createAuthGuards(environment, roleProvider, platformAdminProvider, { jwksFetch })

    const request = fakeRequest(forgedToken)
    const reply = fakeReply()
    const authenticated = await requireAuth(request, reply)

    expect(authenticated).toBe(false)
    expect(reply.code).toHaveBeenCalledWith(401)
  })
})
