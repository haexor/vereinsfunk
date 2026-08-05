import { describe, expect, it } from 'vitest'
import { ApiEnvironmentSchema } from './index.js'

const requiredProductionEnv = {
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_JWT_SECRET: 'jwt-secret-at-least-32-characters-long',
  WEB_BASE_URL: 'https://example.org',
}

const requiredSmtpEnv = {
  SMTP_HOST: 'smtp.example.org',
  SMTP_USER: 'smtp-user',
  SMTP_PASSWORD: 'smtp-password',
  SMTP_FROM: 'noreply@example.org',
}

describe('ApiEnvironmentSchema', () => {
  it('accepts a valid production environment with EMAIL_PROVIDER=smtp', () => {
    expect(ApiEnvironmentSchema.safeParse({ ...requiredProductionEnv, EMAIL_PROVIDER: 'smtp', ...requiredSmtpEnv }).success).toBe(true)
  })

  // Regression: FakeEmailSender logs the full invitation email, including the raw acceptance
  // token, to stdout -- a production deployment that forgets to set EMAIL_PROVIDER=smtp (the
  // default is 'fake') would silently leak invitation tokens into its logs. Found during Paket
  // 010's adversarial review.
  it('rejects a production environment with EMAIL_PROVIDER left at its fake default', () => {
    expect(ApiEnvironmentSchema.safeParse(requiredProductionEnv).success).toBe(false)
    expect(ApiEnvironmentSchema.safeParse({ ...requiredProductionEnv, EMAIL_PROVIDER: 'fake' }).success).toBe(false)
  })

  it('rejects a production environment missing WEB_BASE_URL', () => {
    expect(
      ApiEnvironmentSchema.safeParse({
        NODE_ENV: 'production',
        SUPABASE_URL: requiredProductionEnv.SUPABASE_URL,
        SUPABASE_ANON_KEY: requiredProductionEnv.SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: requiredProductionEnv.SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_JWT_SECRET: requiredProductionEnv.SUPABASE_JWT_SECRET,
        EMAIL_PROVIDER: 'smtp',
        ...requiredSmtpEnv,
      }).success,
    ).toBe(false)
  })

  it('allows EMAIL_PROVIDER=fake outside production', () => {
    expect(ApiEnvironmentSchema.safeParse({ NODE_ENV: 'development' }).success).toBe(true)
    expect(ApiEnvironmentSchema.safeParse({ NODE_ENV: 'development', EMAIL_PROVIDER: 'fake' }).success).toBe(true)
  })

  it('rejects EMAIL_PROVIDER=smtp missing SMTP_HOST', () => {
    expect(
      ApiEnvironmentSchema.safeParse({
        NODE_ENV: 'development',
        EMAIL_PROVIDER: 'smtp',
        SMTP_USER: requiredSmtpEnv.SMTP_USER,
        SMTP_PASSWORD: requiredSmtpEnv.SMTP_PASSWORD,
        SMTP_FROM: requiredSmtpEnv.SMTP_FROM,
      }).success,
    ).toBe(false)
  })

  it('rejects EMAIL_PROVIDER=smtp missing SMTP_USER', () => {
    expect(
      ApiEnvironmentSchema.safeParse({
        NODE_ENV: 'development',
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: requiredSmtpEnv.SMTP_HOST,
        SMTP_PASSWORD: requiredSmtpEnv.SMTP_PASSWORD,
        SMTP_FROM: requiredSmtpEnv.SMTP_FROM,
      }).success,
    ).toBe(false)
  })

  it('rejects EMAIL_PROVIDER=smtp missing SMTP_PASSWORD', () => {
    expect(
      ApiEnvironmentSchema.safeParse({
        NODE_ENV: 'development',
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: requiredSmtpEnv.SMTP_HOST,
        SMTP_USER: requiredSmtpEnv.SMTP_USER,
        SMTP_FROM: requiredSmtpEnv.SMTP_FROM,
      }).success,
    ).toBe(false)
  })

  it('rejects EMAIL_PROVIDER=smtp missing SMTP_FROM', () => {
    expect(
      ApiEnvironmentSchema.safeParse({
        NODE_ENV: 'development',
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: requiredSmtpEnv.SMTP_HOST,
        SMTP_USER: requiredSmtpEnv.SMTP_USER,
        SMTP_PASSWORD: requiredSmtpEnv.SMTP_PASSWORD,
      }).success,
    ).toBe(false)
  })
})
