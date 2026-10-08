import { describe, expect, it } from 'vitest'
import { createEmailSender, FakeEmailSender, SmtpEmailSender, type EmailMessage } from './index.js'

describe('createEmailSender', () => {
  it('logs instead of sending with the fake provider', async () => {
    const logged: EmailMessage[] = []
    const sender = createEmailSender({ EMAIL_PROVIDER: 'fake', SMTP_PORT: 587 }, (message) => { logged.push(message) })
    expect(sender).toBeInstanceOf(FakeEmailSender)
    await sender.send({ to: 'coach@example.local', subject: 'Betreff', text: 'Text' })
    expect(logged).toEqual([{ to: 'coach@example.local', subject: 'Betreff', text: 'Text' }])
  })

  it('builds an SMTP sender and refuses one without credentials', () => {
    const settings = { EMAIL_PROVIDER: 'smtp' as const, SMTP_PORT: 587, SMTP_HOST: 'smtp.example.org', SMTP_USER: 'user', SMTP_PASSWORD: 'secret', SMTP_FROM: 'verein@example.org' }
    expect(createEmailSender(settings, () => undefined)).toBeInstanceOf(SmtpEmailSender)
    expect(() => createEmailSender({ ...settings, SMTP_PASSWORD: undefined }, () => undefined)).toThrow(/SMTP_PASSWORD/)
  })
})
