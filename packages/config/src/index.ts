import { z } from 'zod'

const emptyStringToUndefined = (value: unknown) => (value === '' ? undefined : value)
const optionalSecret = z.preprocess(emptyStringToUndefined, z.string().min(1).optional())
const optionalUrl = z.preprocess(emptyStringToUndefined, z.url().optional())
const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, 'must start with postgres:// or postgresql://')
const optionalPostgresUrl = z.preprocess(emptyStringToUndefined, postgresUrl.optional())
const hostPort = z.string()
  .regex(/^[a-zA-Z0-9.-]+:\d{1,5}$/, 'must be a host:port pair')
  .refine((value) => Number(value.slice(value.lastIndexOf(':') + 1)) <= 65_535, 'must use a valid port')

const ApiEnvironmentBaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4201),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  // Optionaler HS256-Override (apps/api/src/auth.ts): ohne diesen Wert verifiziert die API per
  // JWKS gegen SUPABASE_URL, was seit Supabases Umstellung auf asymmetrische Signing Keys
  // (1. Mai 2025) der richtige Standardfall ist -- nicht als production-required listen, sonst
  // wird der falsche, algorithmus-inkompatible Pfad erzwungen.
  SUPABASE_JWT_SECRET: optionalSecret,
  // Plan 036: direkte Postgres-Verbindung (nicht die PostgREST-URL oben) fuer den
  // Migrations-Boot-Hook (packages/db-migrate). Anders als jede andere Verbindung in diesem
  // Projekt kein PostgREST/Auth-Admin-Zugriff, sondern eine volle Postgres-Rolle mit DDL-Rechten.
  DATABASE_URL: optionalPostgresUrl,
  HATCHET_CLIENT_TOKEN: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  // 'mixpost' widersprach der getroffenen Architekturentscheidung (plans/README.md: Mixpost wird im
  // MVP nicht betrieben, Meta wird direkt angebunden) und wurde in Paket 012 durch 'meta' ersetzt.
  // Paket 045: kommagetrennte Menge statt eines einzelnen Werts -- Meta/Twitter/LinkedIn koennen
  // gleichzeitig echt sein ("meta,twitter,linkedin"), jeder Provider bleibt unabhaengig davon fake,
  // solange sein Name nicht in der Menge steht. Keine Ruecksicht auf den alten Einzelwert noetig
  // (Betreiberentscheidung: keine Rueckwaertskompatibilitaet).
  PUBLISHING_PROVIDER: z.preprocess(
    (value) => (typeof value === 'string' ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : value),
    z.array(z.enum(['fake', 'meta', 'twitter', 'linkedin'])).default(['fake']),
  ),
  META_APP_ID: optionalSecret,
  META_APP_SECRET: optionalSecret,
  META_GRAPH_VERSION: z.string().default('v21.0'),
  META_OAUTH_REDIRECT_URL: optionalUrl,
  TWITTER_CLIENT_ID: optionalSecret,
  TWITTER_CLIENT_SECRET: optionalSecret,
  TWITTER_OAUTH_REDIRECT_URL: optionalUrl,
  LINKEDIN_CLIENT_ID: optionalSecret,
  LINKEDIN_CLIENT_SECRET: optionalSecret,
  LINKEDIN_OAUTH_REDIRECT_URL: optionalUrl,
  // Paket 022: bootstrappt genau einen Default-Plattform-Admin beim Serverstart, wenn
  // gesetzt. Unset ist ein gueltiger Zustand (noch kein Bootstrap gewuenscht).
  PLATFORM_ADMIN_DEFAULT_EMAIL: optionalSecret,
  // packages/secrets' SecretBox: JSON-Map { "<version>": "<base64 32 bytes>" }. Geparst und
  // validiert in apps/api, nicht hier -- packages/config liest nur die Rohwerte.
  SECRET_BOX_KEYS: optionalSecret,
  SECRET_BOX_CURRENT_KEY_VERSION: optionalSecret,
  // SMTP fuer fachliche Mails wie Einwilligungsanfragen. Account-Einladungen laufen dagegen ueber
  // Supabase Auth und verwenden damit dessen zentral hinterlegten Mail-Provider (z. B. Brevo).
  EMAIL_PROVIDER: z.enum(['fake', 'smtp']).default('fake'),
  SMTP_HOST: optionalSecret,
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_USER: optionalSecret,
  SMTP_PASSWORD: optionalSecret,
  SMTP_FROM: optionalSecret,
  // Basis-URL des Nuxt-Frontends fuer Links in versendeten E-Mails und Auth-Redirects.
  WEB_BASE_URL: optionalUrl,
  // Paket 025: von aussen (Meta) erreichbare Basis-URL der Fastify-API selbst, fuer die
  // kurzlebige Medien-Grant-URL (GET /v1/media-grants/:token). WEB_BASE_URL zeigt auf das
  // Nuxt-Frontend und ist dafuer die falsche Adresse.
  API_PUBLIC_BASE_URL: optionalUrl,
  // Paket 015: Pfeffer fuer den Hash von IP-Adresse/User-Agent bei einer digitalen
  // Einwilligungsantwort -- ohne Pfeffer ist eine IPv4-Adresse trivial rueckrechenbar (2^32
  // moegliche Werte). Eigenes Feld statt SECRET_BOX_KEYS zweckzuentfremden: das ist eine
  // JSON-Map fuer verschluesselte Secrets, kein Klartext-Pfeffer.
  CONSENT_RESPONSE_HASH_PEPPER: optionalSecret,
})

// In production the API cannot start without a real database and token-verification secret.
export const ApiEnvironmentSchema = ApiEnvironmentBaseSchema.superRefine((environment, context) => {
  // SmtpEmailSender's constructor already throws on a missing field, but that surfaces as a
  // generic startup crash instead of a clear, field-scoped config validation error -- checked
  // here regardless of NODE_ENV, since EMAIL_PROVIDER=smtp can be used outside production too.
  if (environment.EMAIL_PROVIDER === 'smtp') {
    const requiredSmtpFields = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const
    for (const key of requiredSmtpFields) {
      if (!environment[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} is required when EMAIL_PROVIDER=smtp` })
    }
  }

  // Dieselbe field-scoped-statt-generic-crash-Begruendung wie bei EMAIL_PROVIDER=smtp: der
  // OAuth-Callback wuerde sonst erst beim ersten Verbindungsversuch mit einer unklaren Exception
  // scheitern, statt beim Start klar zu benennen, welche Provider-Variable fehlt. Ein Block je
  // Provider, weil jeder unabhaengig von den anderen aktiviert sein kann (Paket 045).
  if (environment.PUBLISHING_PROVIDER.includes('meta')) {
    const requiredMetaFields = ['META_APP_ID', 'META_APP_SECRET', 'META_OAUTH_REDIRECT_URL', 'API_PUBLIC_BASE_URL'] as const
    for (const key of requiredMetaFields) {
      if (!environment[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} is required when PUBLISHING_PROVIDER includes meta` })
    }
  }
  if (environment.PUBLISHING_PROVIDER.includes('twitter')) {
    const requiredTwitterFields = ['TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET', 'TWITTER_OAUTH_REDIRECT_URL', 'API_PUBLIC_BASE_URL'] as const
    for (const key of requiredTwitterFields) {
      if (!environment[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} is required when PUBLISHING_PROVIDER includes twitter` })
    }
  }
  if (environment.PUBLISHING_PROVIDER.includes('linkedin')) {
    const requiredLinkedInFields = ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_OAUTH_REDIRECT_URL', 'API_PUBLIC_BASE_URL'] as const
    for (const key of requiredLinkedInFields) {
      if (!environment[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} is required when PUBLISHING_PROVIDER includes linkedin` })
    }
  }

  if (environment.NODE_ENV !== 'production') return
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'WEB_BASE_URL', 'CONSENT_RESPONSE_HASH_PEPPER', 'DATABASE_URL'] as const
  for (const key of required) {
    if (!environment[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` })
  }
  // FakeEmailSender protokolliert die komplette Mail inklusive Einladungslink (mit Rohtoken) --
  // in Produktion waere ein vergessenes EMAIL_PROVIDER=smtp sonst ein stiller Secret-Leak ins
  // Log (beim Geheimnisse-Review dieses Pakets gefunden).
  if (environment.EMAIL_PROVIDER === 'fake') {
    context.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'EMAIL_PROVIDER must not be "fake" in production' })
  }
})

export type ApiEnvironment = z.infer<typeof ApiEnvironmentSchema>

export function parseApiEnvironment(source: NodeJS.ProcessEnv = process.env): ApiEnvironment {
  return ApiEnvironmentSchema.parse(source)
}

/** Validated worker-only configuration. It intentionally requires service credentials in every environment. */
export const WorkerEnvironmentSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Plan 036: siehe DATABASE_URL-Kommentar in ApiEnvironmentBaseSchema oben.
  DATABASE_URL: postgresUrl,
  HATCHET_CLIENT_TOKEN: z.string().min(1),
  HATCHET_CLIENT_API_URL: z.url().default('http://127.0.0.1:8080'),
  HATCHET_CLIENT_HOST_PORT: hostPort.default('localhost:7077'),
  HATCHET_TLS: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  HATCHET_WORKER_SLOTS: z.coerce.number().int().positive().default(8),
  SECRET_BOX_KEYS: z.string().min(1),
  SECRET_BOX_CURRENT_KEY_VERSION: z.string().min(1),
})

export type WorkerEnvironment = z.infer<typeof WorkerEnvironmentSchema>

/** Parses the worker configuration once, before any external client is created. */
export function parseWorkerEnvironment(source: NodeJS.ProcessEnv = process.env): WorkerEnvironment {
  return WorkerEnvironmentSchema.parse(source)
}
