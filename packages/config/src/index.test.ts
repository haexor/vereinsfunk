import { describe, expect, it } from 'vitest'
import { ApiEnvironmentSchema } from './index.js'

const requiredProductionEnv = {
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_JWT_SECRET: 'jwt-secret-at-least-32-characters-long',
}

describe('ApiEnvironmentSchema', () => {
  it('accepts a valid production environment with EMAIL_PROVIDER=smtp', () => {
    expect(ApiEnvironmentSchema.safeParse({ ...requiredProductionEnv, EMAIL_PROVIDER: 'smtp' }).success).toBe(true)
  })

  // Regression: FakeEmailSender logs the full invitation email, including the raw acceptance
  // token, to stdout -- a production deployment that forgets to set EMAIL_PROVIDER=smtp (the
  // default is 'fake') would silently leak invitation tokens into its logs. Found during Paket
  // 010's adversarial review.
  it('rejects a production environment with EMAIL_PROVIDER left at its fake default', () => {
    expect(ApiEnvironmentSchema.safeParse(requiredProductionEnv).success).toBe(false)
    expect(ApiEnvironmentSchema.safeParse({ ...requiredProductionEnv, EMAIL_PROVIDER: 'fake' }).success).toBe(false)
  })

  it('allows EMAIL_PROVIDER=fake outside production', () => {
    expect(ApiEnvironmentSchema.safeParse({ NODE_ENV: 'development' }).success).toBe(true)
    expect(ApiEnvironmentSchema.safeParse({ NODE_ENV: 'development', EMAIL_PROVIDER: 'fake' }).success).toBe(true)
  })
})
