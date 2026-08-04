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
  PUBLISHING_PROVIDER: z.enum(['fake', 'mixpost']).default('fake'),
  MIXPOST_BASE_URL: optionalUrl,
  MIXPOST_TOKEN: optionalSecret,
})

// In production the API cannot start without a real database and token-verification secret.
export const ApiEnvironmentSchema = ApiEnvironmentBaseSchema.superRefine((environment, context) => {
  if (environment.NODE_ENV !== 'production') return
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET'] as const
  for (const key of required) {
    if (!environment[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` })
  }
})

export type ApiEnvironment = z.infer<typeof ApiEnvironmentSchema>

export function parseApiEnvironment(source: NodeJS.ProcessEnv = process.env): ApiEnvironment {
  return ApiEnvironmentSchema.parse(source)
}
