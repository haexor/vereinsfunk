import { WorkflowPayloadSchema, type WorkflowPayload } from '@vereinsfunk/contracts'
import { createIdempotencyKey } from '@vereinsfunk/domain'

export const concurrency = {
  llm: { global: 20, organization: 4, department: 2 },
  image: { global: 12, organization: 3, department: 1 },
  video: { global: 4, organization: 1, department: 1 },
  publishing: { global: 20, organization: 4, department: 2 },
} as const

export interface WorkflowContext {
  loadSubmission(id: string): Promise<{ status: string } | null>
  updateSubmission(id: string, status: 'generating' | 'failed'): Promise<void>
  enqueueDraft(input: WorkflowPayload & { idempotencyKey: string }): Promise<void>
}

export async function processSubmission(raw: unknown, context: WorkflowContext): Promise<void> {
  const payload = WorkflowPayloadSchema.parse(raw)
  const submission = await context.loadSubmission(payload.submissionId)
  if (!submission) throw new NonRetryableWorkflowError('submission_not_found')
  if (submission.status !== 'queued') return

  await context.updateSubmission(payload.submissionId, 'generating')
  await context.enqueueDraft({
    ...payload,
    idempotencyKey: createIdempotencyKey(
      'draft',
      payload.submissionId,
      payload.sourceRevision,
    ),
  })
}

export class NonRetryableWorkflowError extends Error {
  readonly retryable = false
}

export function fairnessKey(payload: Pick<WorkflowPayload, 'organizationId' | 'departmentId'>) {
  return `${payload.organizationId}:${payload.departmentId}`
}
