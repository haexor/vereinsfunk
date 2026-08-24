import { TextWorkshopDraftRowSchema, type TextWorkshopDraftPayload } from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function saveTextWorkshopDraft(
  service: SupabaseClient,
  input: {
    id: string
    organizationId: string
    departmentId: string
    teamId: string | null
    actorUserId: string
    payload: TextWorkshopDraftPayload
  },
) {
  const saved = await service.from('text_workshop_drafts').upsert({
    id: input.id,
    organization_id: input.organizationId,
    department_id: input.departmentId,
    team_id: input.teamId,
    payload: input.payload,
    created_by: input.actorUserId,
  }, { onConflict: 'id' }).select('id, organization_id, department_id, team_id, post_id, payload, created_at, updated_at').single()
  if (saved.error) throw saved.error
  return TextWorkshopDraftRowSchema.parse(saved.data)
}
