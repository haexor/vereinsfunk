import type { SecretBox } from '@vereinsfunk/secrets'
import { z } from 'zod'

// Paket 053: Zwischen Anmeldung und Auswahl der Veo-Mannschaft traegt der Browser das frische
// Session-Cookie als versiegelten Token (wie playerboard linkToken.ts, hier mit SecretBox). Das
// AAD bindet ihn an Mannschaft und Person; die erlaubten Veo-Mannschaften stehen mit darin, damit
// der Link-Aufruf nur eine bei der Anmeldung gesehene Mannschaft annimmt.

const LINK_TOKEN_TTL_MS = 15 * 60_000

const VeoTeamChoiceSchema = z.object({
  clubSlug: z.string().min(1), clubName: z.string().min(1), teamSlug: z.string().min(1), teamName: z.string().min(1),
})
const LinkTokenPayloadSchema = z.object({
  teamId: z.string(), userId: z.string(), cookie: z.string().min(1), expiresAt: z.number(),
  teams: z.array(VeoTeamChoiceSchema),
})

export type VeoTeamChoice = z.infer<typeof VeoTeamChoiceSchema>
export type VeoLinkTokenPayload = z.infer<typeof LinkTokenPayloadSchema>

/** AAD des Tokens: nur fuer genau diese Mannschaft und Person zu oeffnen. */
function linkTokenAad(teamId: string, userId: string): string {
  return `playerboard-veo-link:${teamId}:${userId}`
}

/** Versiegelt Cookie und Auswahl als `<Schluesselversion>.<base64url>`; 15 Minuten gueltig. */
export function sealVeoLinkToken(
  box: SecretBox,
  payload: Omit<VeoLinkTokenPayload, 'expiresAt'>,
  now: number = Date.now(),
): string {
  const { ciphertext, keyVersion } = box.seal(JSON.stringify({ ...payload, expiresAt: now + LINK_TOKEN_TTL_MS }), linkTokenAad(payload.teamId, payload.userId))
  return `${keyVersion}.${ciphertext.toString('base64url')}`
}

/** Oeffnet einen Token fuer Mannschaft und Person; null bei fremdem, manipuliertem oder abgelaufenem Token. */
export function openVeoLinkToken(
  box: SecretBox,
  token: string,
  expected: { teamId: string; userId: string },
  now: number = Date.now(),
): VeoLinkTokenPayload | null {
  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null
  let payload: VeoLinkTokenPayload
  try {
    const plaintext = box.open(Buffer.from(token.slice(separator + 1), 'base64url'), token.slice(0, separator), linkTokenAad(expected.teamId, expected.userId))
    payload = LinkTokenPayloadSchema.parse(JSON.parse(plaintext))
  } catch {
    return null
  }
  if (payload.teamId !== expected.teamId || payload.userId !== expected.userId || payload.expiresAt <= now) return null
  return payload
}
