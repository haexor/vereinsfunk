import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { withWorkerOnlyRpcGate } from './supabase.js'

function fakeClient() {
  return { rpc: vi.fn().mockReturnValue('rpc-result'), from: vi.fn().mockReturnValue('query-builder') } as unknown as SupabaseClient
}

describe('withWorkerOnlyRpcGate', () => {
  it('blocks the worker-only outbox and run lifecycle RPCs', () => {
    const inner = fakeClient()
    const gated = withWorkerOnlyRpcGate(inner)
    for (const name of ['claim_workflow_outbox', 'acknowledge_workflow_outbox', 'release_workflow_outbox', 'begin_workflow_run', 'finish_workflow_run']) {
      expect(() => gated.rpc(name as never)).toThrow(/worker-only RPC/)
    }
    expect(inner.rpc).not.toHaveBeenCalled()
  })

  it('passes other RPC calls through unchanged', () => {
    const inner = fakeClient()
    const gated = withWorkerOnlyRpcGate(inner)
    expect(gated.rpc('accept_text_generation_candidate' as never, { p_candidate_id: '1' } as never)).toBe('rpc-result')
    expect(inner.rpc).toHaveBeenCalledWith('accept_text_generation_candidate', { p_candidate_id: '1' })
  })

  it('forwards other client methods unchanged', () => {
    const inner = fakeClient()
    const gated = withWorkerOnlyRpcGate(inner)
    expect(gated.from('posts')).toBe('query-builder')
  })
})
