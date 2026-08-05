import nodemailer from 'nodemailer'
import type { ApiEnvironment } from '@vereinsfunk/config'

export interface EmailMessage {
  to: string
  subject: string
  text: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}

// Lokaler Stack hat keinen vom Host erreichbaren SMTP-Port (Inbucket oeffnet nur die Web-UI,
// siehe Paket 010 Risiken) -- der Fake-Sender protokolliert stattdessen, analog zu
// PUBLISHING_PROVIDER='fake'.
export class FakeEmailSender implements EmailSender {
  constructor(private readonly log: (message: EmailMessage) => void) {}

  async send(message: EmailMessage): Promise<void> {
    this.log(message)
  }
}

export class SmtpEmailSender implements EmailSender {
  private readonly transport: nodemailer.Transporter
  private readonly from: string

  constructor(environment: ApiEnvironment) {
    if (!environment.SMTP_HOST || !environment.SMTP_USER || !environment.SMTP_PASSWORD || !environment.SMTP_FROM) {
      throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM are required when EMAIL_PROVIDER=smtp')
    }
    this.from = environment.SMTP_FROM
    this.transport = nodemailer.createTransport({
      host: environment.SMTP_HOST,
      port: environment.SMTP_PORT,
      auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD },
    })
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text })
  }
}

export function createEmailSender(environment: ApiEnvironment, log: (message: EmailMessage) => void): EmailSender {
  if (environment.EMAIL_PROVIDER === 'smtp') return new SmtpEmailSender(environment)
  return new FakeEmailSender(log)
}
