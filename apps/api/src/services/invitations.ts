import { CreateInvitationRequestSchema, InvitationSchema, type CreateInvitationRequest, type Invitation } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapInvitationRow } from '../apiMappers.js'
import { generateInvitationToken, invitationCallbackUrls, sendInvitationThroughSupabaseAuth } from '../invitations.js'

export class InvitationCreationError extends Error {
  constructor(readonly code: 'already_a_member' | 'invitation_already_open' | 'resend_limit_reached' | 'resend_rate_limited' | 'invite_not_allowed' | 'invalid_request') {
    super(code)
  }
}

function mapCreateInvitationError(error: { code?: string | null; message?: string | null }): never {
  const message = error.message ?? ''
  if (message.includes('invitation_already_open')) throw new InvitationCreationError('invitation_already_open')
  if (message.includes('resend_limit_reached')) throw new InvitationCreationError('resend_limit_reached')
  if (message.includes('resent at most once per hour')) throw new InvitationCreationError('resend_rate_limited')
  if (message.includes('insufficient_permission')) throw new InvitationCreationError('invite_not_allowed')
  if (error.code === '23514' || error.code === '23503') throw new InvitationCreationError('invalid_request')
  throw error
}

/**
 * Gemeinsamer Write-Use-Case für die Einladungsroute und bestätigte Agent-Proposals. Die
 * aufrufende Route bindet den Scope vorher serverseitig und prüft die Rolle des Akteurs.
 */
export async function createInvitation(
  client: SupabaseClient,
  service: SupabaseClient,
  input: CreateInvitationRequest,
  webBaseUrl: string,
): Promise<{ invitation: Invitation; emailDelivered: boolean; emailError?: unknown }> {
  const invitation = CreateInvitationRequestSchema.parse(input)
  const alreadyMember = await client.rpc('email_has_membership', {
    target_organization_id: invitation.organizationId,
    target_department_id: invitation.departmentId ?? null,
    target_team_id: invitation.teamId ?? null,
    target_email: invitation.email,
  })
  if (alreadyMember.error) throw alreadyMember.error
  if (alreadyMember.data) throw new InvitationCreationError('already_a_member')

  const { rawToken, tokenHash } = generateInvitationToken()
  const created = await client.rpc('create_invitation', {
    target_organization_id: invitation.organizationId,
    target_department_id: invitation.departmentId ?? null,
    target_team_id: invitation.teamId ?? null,
    target_email: invitation.email,
    target_role: invitation.role,
    target_token_hash: tokenHash,
  })
  if (created.error) mapCreateInvitationError(created.error)

  let emailDelivered = true
  let emailError: unknown
  try {
    const acceptPath = `/einladung?token=${encodeURIComponent(rawToken)}`
    await sendInvitationThroughSupabaseAuth(service, invitation.email, invitationCallbackUrls(webBaseUrl, acceptPath))
  } catch (error) {
    emailDelivered = false
    emailError = error
  }
  return {
    invitation: InvitationSchema.parse(mapInvitationRow(created.data as Record<string, unknown>)),
    emailDelivered,
    emailError,
  }
}
