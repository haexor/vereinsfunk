import pino, { type LoggerOptions } from 'pino'

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie',
  '*.access_token',
  '*.refresh_token',
  '*.service_role_key',
  '*.media',
]

export function createLogger(options: LoggerOptions = {}) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: options.name ?? 'vereinswerk' },
    ...options,
  })
}

export type AppLogger = ReturnType<typeof createLogger>
