import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { VeoError } from './errors.js'
import { veoRequest, type VeoHttpOptions } from './http.js'

// Paket 053, PR 1 (aus playerboard app/server/utils/veo/auth.ts): ein gueltiges auth.veo.co-Session-
// Cookie wird per stiller OIDC-Anmeldung (prompt=none, PKCE) gegen ein etwa einstuendiges
// Zugriffstoken getauscht. Das Cookie ist der einzige dauerhafte Zugang; E-Mail und Passwort werden
// nie gespeichert (siehe login.ts).

const AUTH_BASE = 'https://auth.veo.co/oidc'
// Oeffentliche Client-ID der Veo-Web-App (PKCE ohne Client-Secret, steht im ausgelieferten
// Frontend-Bundle) -- kein Geheimnis.
const CLIENT_ID = 'IzRQtXQ07V7n8uBtpTHzi'
const REDIRECT_URI = 'https://app.veo.co/signin-redirect/'

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
})

export interface VeoAccessToken {
  accessToken: string
  // Ablauf laut Veo, mit einer Minute Sicherheitsabstand.
  expiresAt: Date
}

/** base64url ohne Auffuellung (RFC 7636). */
function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Tauscht ein Session-Cookie gegen ein Zugriffstoken; ein abgelaufenes Cookie ergibt auth_expired. */
export async function exchangeSessionCookieForToken(sessionCookie: string, options: VeoHttpOptions = {}): Promise<VeoAccessToken> {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const authorizeUrl = new URL(`${AUTH_BASE}/auth`)
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email phone address profile',
    prompt: 'none',
    state: base64url(randomBytes(16)),
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()

  const authorize = await veoRequest(authorizeUrl, { headers: { cookie: sessionCookie } }, options)
  const location = authorize.headers.get('location')
  const code = location ? new URL(location, REDIRECT_URI).searchParams.get('code') : null
  // Ohne Code (z. B. error=login_required) erneuert sich die Sitzung nicht mehr.
  if (!code) throw new VeoError('auth_expired', 'Veo silent re-authentication failed', authorize.status)

  const token = await veoRequest(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', redirect_uri: REDIRECT_URI, code, code_verifier: verifier, client_id: CLIENT_ID }),
  }, options)
  if (token.status === 400 || token.status === 401) throw new VeoError('auth_expired', `Veo token exchange rejected: ${token.status}`, token.status)
  if (!token.ok) throw new VeoError('upstream_error', `Veo token exchange failed: ${token.status}`, token.status)
  const parsed = TokenResponseSchema.safeParse(await token.json().catch(() => null))
  if (!parsed.success) throw new VeoError('upstream_changed', 'Unexpected Veo token response shape')
  return {
    accessToken: parsed.data.access_token,
    expiresAt: new Date(Date.now() + Math.max(0, parsed.data.expires_in - 60) * 1000),
  }
}
