import { describe, expect, it } from 'vitest'
import { concurrency } from './workflows.js'

describe('worker workflow registration', () => {
  it('keeps future resource limits explicit while no durable product handler is registered', () => {
    expect(concurrency.llm).toEqual({ global: 20, organization: 4, department: 2 })
  })
})
