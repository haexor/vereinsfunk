import { z } from 'zod'
import { UuidSchema } from './content.js'

// Paket B, PR 0: frei anlegbare Textbausteine (CTA/Footer/Signatur) -- kein team_id, siehe
// supabase/migrations/2026082302_content_signature_blocks.sql.
const ContentSignatureBlockFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(1000),
})

export const ContentSignatureBlockSchema = ContentSignatureBlockFieldsSchema.extend({
  id: UuidSchema,
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  isActive: z.boolean(),
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const CreateContentSignatureBlockRequestSchema = ContentSignatureBlockFieldsSchema.extend({
  organizationId: UuidSchema,
  departmentId: UuidSchema.optional(),
})

// Scope (organizationId/departmentId) ist unveraendlich -- PATCH /v1/content-signature-blocks/:id
// leitet ihn aus der bestehenden Zeile her, wie PATCH /v1/image-style-presets/:id.
export const UpdateContentSignatureBlockRequestSchema = ContentSignatureBlockFieldsSchema.extend({
  isActive: z.boolean().optional(),
})

export type ContentSignatureBlock = z.infer<typeof ContentSignatureBlockSchema>
export type CreateContentSignatureBlockRequest = z.infer<typeof CreateContentSignatureBlockRequestSchema>
export type UpdateContentSignatureBlockRequest = z.infer<typeof UpdateContentSignatureBlockRequestSchema>
