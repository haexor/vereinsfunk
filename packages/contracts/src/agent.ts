import { z } from 'zod'
import { UuidSchema } from './content.js'
import { ClubEventCategorySchema } from './clubSchedule.js'
import { AssignableRoleSchema } from './structure.js'

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

export const AgentProposalStatusSchema = z.enum(['pending', 'executing', 'confirmed', 'cancelled', 'expired', 'failed'])
export const AgentEventProposalInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
  category: ClubEventCategorySchema.default('other'),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  allDay: z.boolean().default(false),
  locationName: z.string().trim().max(200).nullable().optional(),
  locationAddress: z.string().trim().max(500).nullable().optional(),
  registrationUrl: z.url().nullable().optional(),
}).superRefine((value, context) => {
  if (value.endsAt && new Date(value.endsAt).getTime() < new Date(value.startsAt).getTime()) {
    context.addIssue({ code: 'custom', message: 'endsAt must not be before startsAt' })
  }
})

export const AgentProposalToolNameSchema = z.enum(['create_event', 'create_invitation'])
export const AgentInvitationProposalInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: AssignableRoleSchema,
})
export const CreateAgentActionProposalSchema = z.discriminatedUnion('toolName', [
  z.object({ toolName: z.literal('create_event'), input: AgentEventProposalInputSchema }),
  z.object({ toolName: z.literal('create_invitation'), input: AgentInvitationProposalInputSchema }),
])

export const AgentActionProposalSchema = AgentScopeSchema.extend({
  id: UuidSchema,
  conversationId: UuidSchema,
  createdBy: UuidSchema,
  toolName: AgentProposalToolNameSchema,
  input: z.unknown(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: AgentProposalStatusSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  confirmedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
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
export type AgentProposalStatus = z.infer<typeof AgentProposalStatusSchema>
export type AgentEventProposalInput = z.infer<typeof AgentEventProposalInputSchema>
export type AgentInvitationProposalInput = z.infer<typeof AgentInvitationProposalInputSchema>
export type CreateAgentActionProposal = z.infer<typeof CreateAgentActionProposalSchema>
export type AgentActionProposal = z.infer<typeof AgentActionProposalSchema>
export type AgentPostSummary = z.infer<typeof AgentPostSummarySchema>
export type AgentEventSummary = z.infer<typeof AgentEventSummarySchema>
export type AgentApprovalSummary = z.infer<typeof AgentApprovalSummarySchema>
export type AgentWorkspace = z.infer<typeof AgentWorkspaceSchema>
export type AgentConversationDetail = z.infer<typeof AgentConversationDetailSchema>
