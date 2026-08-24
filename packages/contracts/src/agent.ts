import { z } from 'zod'
import { UuidSchema } from './content.js'

// Der Agent kennt immer einen expliziten Verein. Abteilung und Mannschaft schraenken den
// Arbeitsbereich weiter ein; eine Mannschaft ohne Abteilung waere kein pruefbarer Scope.
export const AgentScopeSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable().optional(),
  teamId: UuidSchema.nullable().optional(),
}).superRefine((scope, context) => {
  if (scope.teamId && !scope.departmentId) {
    context.addIssue({ code: 'custom', message: 'teamId requires departmentId' })
  }
})

export const CreateAgentConversationSchema = AgentScopeSchema

export const AgentConversationSchema = AgentScopeSchema.extend({
  id: UuidSchema,
  createdBy: UuidSchema,
  title: z.string().trim().min(1).max(160).nullable(),
  lastActivityAt: z.iso.datetime({ offset: true }),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  retentionExpiresAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const AgentMessageRoleSchema = z.enum(['user', 'assistant'])
export const AgentMessageSchema = z.object({
  id: UuidSchema,
  conversationId: UuidSchema,
  organizationId: UuidSchema,
  role: AgentMessageRoleSchema,
  content: z.string().trim().min(1).max(8_000),
  createdAt: z.iso.datetime({ offset: true }),
})

export const CreateAgentMessageSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
})

export const AgentPostSummarySchema = z.object({
  id: UuidSchema,
  departmentId: UuidSchema,
  title: z.string().trim().max(200),
  status: z.string().trim().min(1).max(80),
  scheduledFor: z.iso.datetime({ offset: true }).nullable(),
  currentVersionId: UuidSchema.nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const AgentEventSummarySchema = z.object({
  id: UuidSchema,
  departmentId: UuidSchema.nullable(),
  title: z.string().trim().min(1).max(200),
  startsAt: z.iso.datetime({ offset: true }),
  status: z.string().trim().min(1).max(80),
})

export const AgentApprovalSummarySchema = z.object({
  stageId: UuidSchema,
  postId: UuidSchema,
  postVersionId: UuidSchema,
  departmentId: UuidSchema,
  title: z.string().trim().max(200),
  label: z.string().trim().min(1).max(200),
  deadlineAt: z.iso.datetime({ offset: true }).nullable(),
  isOverdue: z.boolean(),
})

export const AgentWorkspaceSchema = AgentScopeSchema.extend({
  posts: z.array(AgentPostSummarySchema).max(20),
  events: z.array(AgentEventSummarySchema).max(20),
  pendingApprovals: z.array(AgentApprovalSummarySchema).max(20),
})

export const AgentConversationDetailSchema = z.object({
  conversation: AgentConversationSchema,
  messages: z.array(AgentMessageSchema).max(100),
})

export type AgentScope = z.infer<typeof AgentScopeSchema>
export type AgentConversation = z.infer<typeof AgentConversationSchema>
export type AgentMessage = z.infer<typeof AgentMessageSchema>
export type AgentMessageRole = z.infer<typeof AgentMessageRoleSchema>
export type AgentPostSummary = z.infer<typeof AgentPostSummarySchema>
export type AgentEventSummary = z.infer<typeof AgentEventSummarySchema>
export type AgentApprovalSummary = z.infer<typeof AgentApprovalSummarySchema>
export type AgentWorkspace = z.infer<typeof AgentWorkspaceSchema>
export type AgentConversationDetail = z.infer<typeof AgentConversationDetailSchema>
