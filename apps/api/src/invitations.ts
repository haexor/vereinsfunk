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

// Gemeinsame Grundlage fuer invitationUrls() (Vereinsmitglieder) und platformAdminInvitationUrls()
// (Plattform-Admins) in den beiden Routendateien -- beide unterscheiden sich nur im Annahme-Pfad.
export function invitationCallbackUrls(webBaseUrl: string, acceptPath: string): { accept: string; setPassword: string } {
  const passwordSetup = new URL('/passwort-neu', webBaseUrl)
  passwordSetup.searchParams.set('redirect', acceptPath)
  return {
    accept: authCallbackUrl(webBaseUrl, acceptPath),
    setPassword: authCallbackUrl(webBaseUrl, `${passwordSetup.pathname}${passwordSetup.search}`),
  }
}

export function isExistingAccountError(error: { code?: string | null | undefined; message?: string | undefined } | null): boolean {
  // GoTrue liefert fuer bereits bestaetigte Accounts aktuell `email_exists`; die
  // Nachrichtenpruefung ist Rueckwaertskompatibilitaet fuer aeltere GoTrue-Versionen.
  return error?.code === 'email_exists' || /already (?:been )?registered/i.test(error?.message ?? '')
}

// Ohne Zeitlimit haengt der Fastify-Request auf einem unresponsiven Supabase-Auth-Endpunkt fest --
// der Rest der Route faengt zwar jeden Fehler ab (emailDelivered: false statt 500), aber ein
// haengender Promise wird davon nie erreicht. Race statt AbortSignal, da supabase-js keinen
// Signal-Parameter je Aufruf annimmt (nur global bei Client-Erstellung, was jeden anderen
// Service-Client-Aufruf mittraeben wuerde).
const SUPABASE_AUTH_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.()
    }),
  ])
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
  const invite = await withTimeout(
    service.auth.admin.inviteUserByEmail(email, { redirectTo: urls.setPassword }),
    SUPABASE_AUTH_TIMEOUT_MS,
    'inviteUserByEmail',
  )
  if (!invite.error) return
  if (!isExistingAccountError(invite.error)) throw invite.error

  const magicLink = await withTimeout(
    service.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: urls.accept },
    }),
    SUPABASE_AUTH_TIMEOUT_MS,
    'signInWithOtp',
  )
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
