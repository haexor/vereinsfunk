// Der Versand liegt seit Paket 053 in packages/mailer, weil auch der Worker Mails verschickt.
export { createEmailSender, FakeEmailSender, SmtpEmailSender, type EmailMessage, type EmailSender } from '@vereinsfunk/mailer'
