import { z } from 'zod'

const optionalSecret = z.string().min(1).optional()

export const ApiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  HATCHET_CLIENT_TOKEN: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  PUBLISHING_PROVIDER: z.enum(['fake', 'mixpost']).default('fake'),
  MIXPOST_BASE_URL: z.url().optional(),
  MIXPOST_TOKEN: optionalSecret,
})

export type ApiEnvironment = z.infer<typeof ApiEnvironmentSchema>

export function parseApiEnvironment(source: NodeJS.ProcessEnv = process.env): ApiEnvironment {
  return ApiEnvironmentSchema.parse(source)
}
