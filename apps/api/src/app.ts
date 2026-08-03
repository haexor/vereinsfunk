import cors from '@fastify/cors'
import { parseApiEnvironment } from '@vereinsfunk/config'
import { FakeContentGenerator } from '@vereinsfunk/content-engine'
import {
  CreateSubmissionSchema,
  HealthSchema,
  SubmissionAcceptedSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { createIdempotencyKey, evaluateMediaGate } from '@vereinsfunk/domain'
import { FakeOrchestrator, type Orchestrator } from '@vereinsfunk/orchestration'
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export interface BuildAppOptions {
  logger?: boolean
  orchestrator?: Orchestrator
  uploads?: MediaUploadService
}

export interface MediaUploadService {
  create(input: { organizationId: string; departmentId: string; assetId: string; filename: string; mimeType: string; byteSize: number }): Promise<{ uploadUrl: string; objectPath: string; expiresAt: string }>
  complete(input: { assetId: string; sha256: string }): Promise<{ accepted: true }>
}

class LocalUploadService implements MediaUploadService {
  async create(input: { organizationId: string; departmentId: string; assetId: string; filename: string; mimeType: string; byteSize: number }) { return { uploadUrl: `https://storage.invalid/upload/${input.assetId}`, objectPath: `organizations/${input.organizationId}/departments/${input.departmentId}/assets/${input.assetId}/${input.filename}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() } }
  async complete(): Promise<{ accepted: true }> { return { accepted: true } }
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const environment = parseApiEnvironment()
  const fastifyOptions: FastifyServerOptions = {
    logController: new LogController({ disableRequestLogging: environment.NODE_ENV === 'test' }),
    requestIdHeader: 'x-correlation-id',
    genReqId: () => randomUUID(),
    logger:
      options.logger === false
        ? false
        : {
            level: environment.LOG_LEVEL,
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie', '*.access_token', '*.media'],
              censor: '[REDACTED]',
            },
          },
  }
  const app = Fastify(fastifyOptions)
  const orchestrator = options.orchestrator ?? new FakeOrchestrator()
  const uploads = options.uploads ?? new LocalUploadService()

  await app.register(cors, {
    origin: environment.NODE_ENV === 'production' ? false : ['http://localhost:4200'],
  })

  app.get('/health', async () =>
    HealthSchema.parse({
      status: 'ok',
      service: 'api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    }),
  )

  const requireAuth = (request: FastifyRequest, reply: FastifyReply) => {
    if (environment.NODE_ENV === 'production' && !request.headers.authorization) {
      reply.code(401).send({ error: 'unauthorized' })
      return false
    }
    return true
  }

  app.post('/v1/submissions', async (request, reply) => {
    if (!requireAuth(request, reply)) return
    const input = CreateSubmissionSchema.parse(request.body)
    const submissionId = randomUUID()
    const correlationId = request.id
    const generated = await new FakeContentGenerator().generate(input)
    const accepted = SubmissionAcceptedSchema.parse({
      submissionId,
      correlationId,
      status: generated.missingFacts.length > 0 ? 'facts_required' : 'queued',
      idempotencyKey: createIdempotencyKey('submission', submissionId, input.sourceRevision),
    })
    if (accepted.status === 'queued') await orchestrator.trigger('process-submission', {
      submissionId, entityId: submissionId, organizationId: input.organizationId, departmentId: input.departmentId,
      correlationId, sourceRevision: input.sourceRevision, idempotencyKey: accepted.idempotencyKey,
    })

    request.log.info(
      {
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        submissionId,
        correlationId,
        missingFactsCount: generated.missingFacts.length,
      },
      'submission accepted by local fake adapter',
    )

    return reply.code(202).send({ ...accepted, preview: generated })
  })

  const UploadInitiateSchema = z.object({ organizationId: UuidSchema, departmentId: UuidSchema, filename: z.string().min(1).max(120).regex(/^[^/\\]+$/), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']), byteSize: z.int().positive().max(100 * 1024 * 1024) })
  app.post('/v1/media/uploads', async (request, reply) => {
    if (!requireAuth(request, reply)) return
    const input = UploadInitiateSchema.parse(request.body); const assetId = randomUUID()
    const upload = await uploads.create({ ...input, assetId })
    return reply.code(201).send({ assetId, ...upload })
  })
  app.post('/v1/media/:assetId/complete', async (request, reply) => {
    if (!requireAuth(request, reply)) return
    const params = z.object({ assetId: UuidSchema }).parse(request.params); const body = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).parse(request.body)
    return reply.code(202).send(await uploads.complete({ ...params, ...body }))
  })
  app.post('/v1/media/gate', async (request, reply) => {
    if (!requireAuth(request, reply)) return
    const input = z.object({ scanStatus: z.enum(['pending', 'clean', 'failed']), facesConfirmedComplete: z.boolean(), hasOriginalSelected: z.boolean(), derivativeCurrent: z.boolean(), minorReviewConfirmed: z.boolean(), faces: z.array(z.object({ subjectKind: z.enum(['adult', 'minor', 'unknown']), decision: z.enum(['pending', 'consented', 'obscure', 'exclude']), consentValid: z.boolean().optional() })) }).parse(request.body)
    return evaluateMediaGate(input)
  })

  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ err: error, correlationId: request.id }, 'request rejected')
    const isValidation = error instanceof Error && error.name === 'ZodError'
    return reply.code(isValidation ? 400 : 500).send({
      error: isValidation ? 'invalid_request' : 'internal_error',
      correlationId: request.id,
    })
  })

  return app
}
