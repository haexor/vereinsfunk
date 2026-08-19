import { randomBytes, createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmailMessage } from './email.js'

export function generateInvitationToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('hex')
  return { rawToken, tokenHash: hashInvitationToken(rawToken) }
}

// Muss exakt authz.accept_invitation()'s "encode(digest(raw_token, 'sha256'), 'hex')" matchen.
export function hashInvitationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

export function authCallbackUrl(webBaseUrl: string, redirect: string): string {
  const callback = new URL('/auth/callback', webBaseUrl)
  callback.searchParams.set('redirect', redirect)
  return callback.toString()
}

export function isExistingAccountError(error: { code?: string | null | undefined; message?: string | undefined } | null): boolean {
  // GoTrue liefert fuer bereits bestaetigte Accounts aktuell `email_exists`; die
  // Nachrichtenpruefung ist Rueckwaertskompatibilitaet fuer aeltere GoTrue-Versionen.
  return error?.code === 'email_exists' || /already (?:been )?registered/i.test(error?.message ?? '')
}

// Supabase Auth ist der eine Mail-Provider fuer Account-Einladungen (Vereinsmitglieder und
// Plattform-Admins gleichermassen). Damit verwendet dieser Pfad dieselbe Brevo-Konfiguration wie
// Registrierung und Passwort-Reset, ohne SMTP-Secrets in der API zu duplizieren. Ein existierendes
// Konto kann nicht erneut per `inviteUserByEmail` eingeladen werden; ein Magic Link beweist dort
// dieselbe E-Mail-Inhaberschaft und leitet zur fachlichen Einladung weiter.
export async function sendInvitationThroughSupabaseAuth(
  service: SupabaseClient,
  email: string,
  urls: { accept: string; setPassword: string },
): Promise<void> {
  const invite = await service.auth.admin.inviteUserByEmail(email, { redirectTo: urls.setPassword })
  if (!invite.error) return
  if (!isExistingAccountError(invite.error)) throw invite.error

  const magicLink = await service.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: urls.accept },
  })
  if (magicLink.error) throw magicLink.error
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
