import { z } from 'zod'

const emptyStringToUndefined = (value: unknown) => (value === '' ? undefined : value)
const optionalSecret = z.preprocess(emptyStringToUndefined, z.string().min(1).optional())
const optionalUrl = z.preprocess(emptyStringToUndefined, z.url().optional())

const ApiEnvironmentBaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4201),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  SUPABASE_JWT_SECRET: optionalSecret,
  HATCHET_CLIENT_TOKEN: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  // 'mixpost' widersprach der getroffenen Architekturentscheidung (plans/README.md: Mixpost wird im
  // MVP nicht betrieben, Meta wird direkt angebunden) und wurde in Paket 012 durch 'meta' ersetzt.
  PUBLISHING_PROVIDER: z.enum(['fake', 'meta']).default('fake'),
  META_APP_ID: optionalSecret,
  META_APP_SECRET: optionalSecret,
  META_GRAPH_VERSION: z.string().default('v21.0'),
  META_OAUTH_REDIRECT_URL: optionalUrl,
  // Paket 022: bootstrappt genau einen Default-Plattform-Admin beim Serverstart, wenn
  // gesetzt. Unset ist ein gueltiger Zustand (noch kein Bootstrap gewuenscht).
  PLATFORM_ADMIN_DEFAULT_EMAIL: optionalSecret,
  // packages/secrets' SecretBox: JSON-Map { "<version>": "<base64 32 bytes>" }. Geparst und
  // validiert in apps/api, nicht hier -- packages/config liest nur die Rohwerte.
  SECRET_BOX_KEYS: optionalSecret,
  SECRET_BOX_CURRENT_KEY_VERSION: optionalSecret,
  // Paket 010: Einladungsversand per SMTP. 'fake' (Standard) protokolliert nur -- passend zum
  // lokalen Stack, dessen Inbucket-Container keinen vom Host erreichbaren SMTP-Port oeffnet.
  EMAIL_PROVIDER: z.enum(['fake', 'smtp']).default('fake'),
  SMTP_HOST: optionalSecret,
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_USER: optionalSecret,
  SMTP_PASSWORD: optionalSecret,
  SMTP_FROM: optionalSecret,
  // Basis-URL des Nuxt-Frontends fuer Links in versendeten E-Mails (Einladungen).
  WEB_BASE_URL: optionalUrl,
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
  // scheitern, statt beim Start klar zu benennen, welche Meta-Variable fehlt.
  if (environment.PUBLISHING_PROVIDER === 'meta') {
    const requiredMetaFields = ['META_APP_ID', 'META_APP_SECRET', 'META_OAUTH_REDIRECT_URL'] as const
    for (const key of requiredMetaFields) {
      if (!environment[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} is required when PUBLISHING_PROVIDER=meta` })
    }
  }

  if (environment.NODE_ENV !== 'production') return
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET', 'WEB_BASE_URL'] as const
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
