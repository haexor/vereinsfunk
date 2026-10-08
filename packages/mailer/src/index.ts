import nodemailer from 'nodemailer'

// Fachliche Mails (Einwilligungsanfragen aus der API, ab Paket 053 Veo-Hinweise aus dem Worker)
// ueber denselben SMTP-Server. Account-Einladungen laufen weiter ueber Supabase Auth.

export interface EmailMessage {
  to: string
  subject: string
  text: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}

// Der Ausschnitt der API- bzw. Worker-Umgebung, den der Versand braucht.
export interface MailSettings {
  EMAIL_PROVIDER: 'fake' | 'smtp'
  SMTP_HOST?: string | undefined
  SMTP_PORT: number
  SMTP_USER?: string | undefined
  SMTP_PASSWORD?: string | undefined
  SMTP_FROM?: string | undefined
}

// Lokaler Stack hat keinen vom Host erreichbaren SMTP-Port (Inbucket oeffnet nur die Web-UI,
// siehe Paket 010 Risiken) -- der Fake-Sender protokolliert stattdessen, analog zu
// PUBLISHING_PROVIDER='fake'.
export class FakeEmailSender implements EmailSender {
  constructor(private readonly log: (message: EmailMessage) => void) {}

  /** Protokolliert die Nachricht, statt sie zu versenden. */
  async send(message: EmailMessage): Promise<void> {
    this.log(message)
  }
}

export class SmtpEmailSender implements EmailSender {
  private readonly transport: nodemailer.Transporter
  private readonly from: string

  constructor(settings: MailSettings) {
    if (!settings.SMTP_HOST || !settings.SMTP_USER || !settings.SMTP_PASSWORD || !settings.SMTP_FROM) {
      throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM are required when EMAIL_PROVIDER=smtp')
    }
    this.from = settings.SMTP_FROM
    this.transport = nodemailer.createTransport({
      host: settings.SMTP_HOST,
      port: settings.SMTP_PORT,
      // Port 465 ist implizites TLS; nodemailers secure-Standard (false) wuerde dort einen
      // Klartext-Handshake versuchen und niemals eine Verbindung aufbauen. 587 bleibt bei
      // secure: false und wird ueber STARTTLS hochgehandelt.
      secure: settings.SMTP_PORT === 465,
      auth: { user: settings.SMTP_USER, pass: settings.SMTP_PASSWORD },
      // Ohne Timeout kann ein haengender SMTP-Relay den Request-Thread unbegrenzt blockieren
      // (beim Stabilitaets-Review dieses Pakets gefunden).
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    })
  }

  /** Versendet die Nachricht als reine Textmail. */
  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text })
  }
}

/** Waehlt SMTP oder den protokollierenden Fake anhand von EMAIL_PROVIDER. */
export function createEmailSender(settings: MailSettings, log: (message: EmailMessage) => void): EmailSender {
  if (settings.EMAIL_PROVIDER === 'smtp') return new SmtpEmailSender(settings)
  return new FakeEmailSender(log)
}
