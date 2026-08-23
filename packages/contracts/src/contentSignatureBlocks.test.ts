import { describe, expect, it } from 'vitest'
import { CreateContentSignatureBlockRequestSchema, UpdateContentSignatureBlockRequestSchema } from './contentSignatureBlocks.js'
import { department, org } from './testFixtures.js'

const baseFields = { name: 'Standard-CTA', body: 'Mehr auf unserer Website: https://verein.example' }

describe('content signature block contracts (Paket B, PR 0)', () => {
  it('accepts a minimal organization-wide block', () => {
    expect(CreateContentSignatureBlockRequestSchema.safeParse({ ...baseFields, organizationId: org }).success).toBe(true)
  })

  it('accepts a department-scoped block', () => {
    expect(CreateContentSignatureBlockRequestSchema.safeParse({ ...baseFields, organizationId: org, departmentId: department }).success).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(CreateContentSignatureBlockRequestSchema.safeParse({ ...baseFields, organizationId: org, name: '' }).success).toBe(false)
  })

  it('rejects a name over 80 characters', () => {
    expect(CreateContentSignatureBlockRequestSchema.safeParse({ ...baseFields, organizationId: org, name: 'x'.repeat(81) }).success).toBe(false)
  })

  it('rejects an empty body', () => {
    expect(CreateContentSignatureBlockRequestSchema.safeParse({ ...baseFields, organizationId: org, body: '' }).success).toBe(false)
  })

  it('rejects a body over 1000 characters', () => {
    expect(CreateContentSignatureBlockRequestSchema.safeParse({ ...baseFields, organizationId: org, body: 'x'.repeat(1001) }).success).toBe(false)
  })

  it('accepts a body at exactly 1000 characters', () => {
    expect(CreateContentSignatureBlockRequestSchema.safeParse({ ...baseFields, organizationId: org, body: 'x'.repeat(1000) }).success).toBe(true)
  })

  it('accepts an update without isActive', () => {
    expect(UpdateContentSignatureBlockRequestSchema.safeParse(baseFields).success).toBe(true)
  })

  it('accepts an update with isActive', () => {
    expect(UpdateContentSignatureBlockRequestSchema.safeParse({ ...baseFields, isActive: false }).success).toBe(true)
  })
})
