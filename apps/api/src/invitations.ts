import { randomBytes, createHash } from 'node:crypto'
import type { EmailMessage } from './email.js'

export function generateInvitationToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('hex')
  return { rawToken, tokenHash: hashInvitationToken(rawToken) }
}

// Muss exakt authz.accept_invitation()'s "encode(digest(raw_token, 'sha256'), 'hex')" matchen.
export function hashInvitationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

export function buildInvitationEmail(options: {
  to: string
  organizationName: string
  scopeName: string
  acceptUrl: string
}): EmailMessage {
  return {
    to: options.to,
    subject: `Einladung zu ${options.organizationName}`,
    text: `Ihr wurdet zu ${options.scopeName} bei ${options.organizationName} eingeladen.\n\nEinladung annehmen: ${options.acceptUrl}\n\nDer Link ist 14 Tage gueltig.`,
  }
}
