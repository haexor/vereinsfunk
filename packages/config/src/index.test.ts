import { describe, expect, it } from 'vitest'
import { ApiEnvironmentSchema, WorkerEnvironmentSchema } from './index.js'

const requiredProductionEnv = {
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_JWT_SECRET: 'jwt-secret-at-least-32-characters-long',
  WEB_BASE_URL: 'https://example.org',
  CONSENT_RESPONSE_HASH_PEPPER: 'pepper-at-least-32-characters-long',
  DATABASE_URL: 'postgresql://postgres:secret@db.example.supabase.co:5432/postgres',
  PUBLISHING_PROVIDER: '',
  PUBLISHING_MODE: 'live',
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

  // Regression: SUPABASE_JWT_SECRET verifiziert nur HS256 (apps/api/src/auth.ts). Neue
  // Supabase-Projekte signieren seit 1. Mai 2025 standardmaessig asymmetrisch -- ein erzwungener
  // HS256-Pfad wuerde dort jeden echten Token ablehnen. Produktion muss ohne diesen Wert booten
  // koennen, damit die JWKS-Verifikation greift.
  it('accepts a production environment without SUPABASE_JWT_SECRET', () => {
    const withoutJwtSecret = { ...requiredProductionEnv, SUPABASE_JWT_SECRET: undefined, EMAIL_PROVIDER: 'smtp', ...requiredSmtpEnv }
    expect(ApiEnvironmentSchema.safeParse(withoutJwtSecret).success).toBe(true)
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

  // Regression: ohne Pfeffer haesht apps/api/src/app.ts die IP-Adresse mit dem im Quellcode
  // stehenden Fallback 'local-dev-pepper' -- ein bekannter Pfeffer macht den Hash trivial
  // rueckrechenbar (2^32 IPv4-Adressen). Gefunden im Code-Review zu Paket 015.
  it('rejects a production environment missing CONSENT_RESPONSE_HASH_PEPPER', () => {
    const withoutPepper = { ...requiredProductionEnv, CONSENT_RESPONSE_HASH_PEPPER: undefined }
    expect(ApiEnvironmentSchema.safeParse(withoutPepper).success).toBe(false)
  })

  // Plan 036: ohne diesen Wert kann der Migrations-Boot-Hook (packages/db-migrate) in Produktion
  // nicht laufen -- ein fehlender Wert soll den Start klar mit einer field-scoped-Meldung
  // verweigern, nicht erst beim ersten Aufruf des Boot-Hooks mit einer unklaren Exception scheitern.
  it('rejects a production environment missing DATABASE_URL', () => {
    const withoutDatabaseUrl = { ...requiredProductionEnv, DATABASE_URL: undefined, EMAIL_PROVIDER: 'smtp', ...requiredSmtpEnv }
    expect(ApiEnvironmentSchema.safeParse(withoutDatabaseUrl).success).toBe(false)
  })

  it('rejects a malformed DATABASE_URL', () => {
    const malformedDatabaseUrl = { ...requiredProductionEnv, DATABASE_URL: 'not-a-postgres-url', EMAIL_PROVIDER: 'smtp', ...requiredSmtpEnv }
    expect(ApiEnvironmentSchema.safeParse(malformedDatabaseUrl).success).toBe(false)
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

  // Paket 025: ohne diese URL kann Meta nie auf GET /v1/media-grants/:token zugreifen -- derselbe
  // field-scoped-statt-generic-crash-Grundsatz wie bei den anderen META_*-Pflichtfeldern.
  it('rejects PUBLISHING_PROVIDER=meta missing API_PUBLIC_BASE_URL', () => {
    expect(
      ApiEnvironmentSchema.safeParse({
        NODE_ENV: 'development',
        PUBLISHING_PROVIDER: 'meta', PUBLISHING_MODE: 'live',
        META_APP_ID: 'app-id',
        META_APP_SECRET: 'app-secret',
        META_OAUTH_REDIRECT_URL: 'https://example.org/oauth/callback',
      }).success,
    ).toBe(false)
  })

  it('accepts PUBLISHING_PROVIDER=meta with all required fields', () => {
    expect(
      ApiEnvironmentSchema.safeParse({
        NODE_ENV: 'development',
        PUBLISHING_PROVIDER: 'meta', PUBLISHING_MODE: 'live',
        META_APP_ID: 'app-id',
        META_APP_SECRET: 'app-secret',
        META_OAUTH_REDIRECT_URL: 'https://example.org/oauth/callback',
        API_PUBLIC_BASE_URL: 'https://api.example.org',
      }).success,
    ).toBe(true)
  })

  it('uses an explicit fake mode with all supported providers when unset', () => {
    const parsed = ApiEnvironmentSchema.parse({ NODE_ENV: 'development' })
    expect(parsed.PUBLISHING_MODE).toBe('fake')
    expect(parsed.PUBLISHING_PROVIDER).toEqual(['meta', 'twitter', 'linkedin'])
  })

  it('parses a comma-separated PUBLISHING_PROVIDER into a set of active providers', () => {
    const parsed = ApiEnvironmentSchema.parse({
      NODE_ENV: 'development',
      PUBLISHING_PROVIDER: 'meta,twitter,linkedin', PUBLISHING_MODE: 'fake',
      META_APP_ID: 'app-id', META_APP_SECRET: 'app-secret', META_OAUTH_REDIRECT_URL: 'https://example.org/oauth/callback/meta',
      TWITTER_CLIENT_ID: 'client-id', TWITTER_CLIENT_SECRET: 'client-secret', TWITTER_OAUTH_REDIRECT_URL: 'https://example.org/oauth/callback/twitter',
      LINKEDIN_CLIENT_ID: 'client-id', LINKEDIN_CLIENT_SECRET: 'client-secret', LINKEDIN_OAUTH_REDIRECT_URL: 'https://example.org/oauth/callback/linkedin',
      API_PUBLIC_BASE_URL: 'https://api.example.org',
    })
    expect(parsed.PUBLISHING_PROVIDER).toEqual(['meta', 'twitter', 'linkedin'])
  })

  it('rejects an unknown PUBLISHING_PROVIDER entry', () => {
    expect(ApiEnvironmentSchema.safeParse({ NODE_ENV: 'development', PUBLISHING_PROVIDER: 'mixpost' }).success).toBe(false)
  })

  it('rejects fake as a provider because the adapter mode is configured separately', () => {
    expect(ApiEnvironmentSchema.safeParse({ NODE_ENV: 'development', PUBLISHING_PROVIDER: 'fake' }).success).toBe(false)
  })

  it('rejects Twitter and LinkedIn in live mode until their real adapters exist', () => {
    expect(ApiEnvironmentSchema.safeParse({ NODE_ENV: 'development', PUBLISHING_MODE: 'live', PUBLISHING_PROVIDER: 'twitter' }).success).toBe(false)
    expect(ApiEnvironmentSchema.safeParse({ NODE_ENV: 'development', PUBLISHING_MODE: 'live', PUBLISHING_PROVIDER: 'linkedin' }).success).toBe(false)
  })

  it('rejects fake publishing in production', () => {
    expect(ApiEnvironmentSchema.safeParse({ ...requiredProductionEnv, PUBLISHING_MODE: 'fake', EMAIL_PROVIDER: 'smtp', ...requiredSmtpEnv }).success).toBe(false)
  })

  it('accepts disabled publishing in production without provider credentials', () => {
    expect(
      ApiEnvironmentSchema.safeParse({
        ...requiredProductionEnv,
        PUBLISHING_MODE: 'disabled',
        EMAIL_PROVIDER: 'smtp',
        ...requiredSmtpEnv,
      }).success,
    ).toBe(true)
  })

  it.each([
    ['twitter', 'TWITTER_CLIENT_ID'],
    ['twitter', 'TWITTER_CLIENT_SECRET'],
    ['twitter', 'TWITTER_OAUTH_REDIRECT_URL'],
    ['linkedin', 'LINKEDIN_CLIENT_ID'],
    ['linkedin', 'LINKEDIN_CLIENT_SECRET'],
    ['linkedin', 'LINKEDIN_OAUTH_REDIRECT_URL'],
  ])('rejects PUBLISHING_PROVIDER=%s missing %s', (provider, missingField) => {
    const fields: Record<string, string> = {
      TWITTER_CLIENT_ID: 'client-id', TWITTER_CLIENT_SECRET: 'client-secret', TWITTER_OAUTH_REDIRECT_URL: 'https://example.org/oauth/callback/twitter',
      LINKEDIN_CLIENT_ID: 'client-id', LINKEDIN_CLIENT_SECRET: 'client-secret', LINKEDIN_OAUTH_REDIRECT_URL: 'https://example.org/oauth/callback/linkedin',
    }
    delete fields[missingField]
    expect(
      ApiEnvironmentSchema.safeParse({ NODE_ENV: 'development', PUBLISHING_MODE: 'live', PUBLISHING_PROVIDER: provider, API_PUBLIC_BASE_URL: 'https://api.example.org', ...fields }).success,
    ).toBe(false)
  })

  it('accepts fake Twitter and LinkedIn without live credentials', () => {
    expect(ApiEnvironmentSchema.safeParse({ NODE_ENV: 'development', PUBLISHING_PROVIDER: 'twitter,linkedin', PUBLISHING_MODE: 'fake' }).success).toBe(true)
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

describe('WorkerEnvironmentSchema', () => {
  const requiredWorkerEnvironment = {
    SUPABASE_URL: 'https://supabase.example.org',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    DATABASE_URL: 'postgresql://postgres:secret@db.example.supabase.co:5432/postgres',
    HATCHET_CLIENT_TOKEN: 'hatchet-token',
    HATCHET_CLIENT_HOST_PORT: 'hatchet.example.org:7077',
    HATCHET_TLS: 'true',
    HATCHET_WORKER_SLOTS: '8',
    SECRET_BOX_KEYS: JSON.stringify({ v1: Buffer.alloc(32).toString('base64') }),
    SECRET_BOX_CURRENT_KEY_VERSION: 'v1',
  }

  it('parses a complete worker configuration once into typed values', () => {
    expect(WorkerEnvironmentSchema.parse(requiredWorkerEnvironment)).toMatchObject({ HATCHET_TLS: true, HATCHET_WORKER_SLOTS: 8 })
  })

  it.each([
    ['HATCHET_TLS', 'ture'],
    ['HATCHET_WORKER_SLOTS', '0'],
    ['HATCHET_WORKER_SLOTS', '1.5'],
    ['HATCHET_CLIENT_HOST_PORT', 'not-a-host-port'],
    ['HATCHET_CLIENT_HOST_PORT', 'hatchet.example.org:65536'],
    ['SUPABASE_URL', 'not-a-url'],
    ['HATCHET_CLIENT_TOKEN', ''],
    ['SUPABASE_SERVICE_ROLE_KEY', ''],
    ['DATABASE_URL', ''],
    ['DATABASE_URL', 'not-a-postgres-url'],
  ])('rejects an invalid worker %s value', (key, value) => {
    expect(WorkerEnvironmentSchema.safeParse({ ...requiredWorkerEnvironment, [key]: value }).success).toBe(false)
  })
})
