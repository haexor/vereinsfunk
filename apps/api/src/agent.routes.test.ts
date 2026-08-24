import { describe, expect, it } from 'vitest'
import { startApp } from './testSupport.js'

describe('agent routes', () => {
  it('requires an authenticated session before exposing a workspace or conversation', async () => {
    const app = await startApp()
    const [workspace, conversation] = await Promise.all([
      app.inject({ method: 'GET', url: '/v1/agent/workspace?organizationId=10000000-1000-4000-8000-000000000001' }),
      app.inject({ method: 'POST', url: '/v1/agent/conversations', payload: { organizationId: '10000000-1000-4000-8000-000000000001' } }),
    ])
    expect(workspace.statusCode).toBe(401)
    expect(conversation.statusCode).toBe(401)
  })
})
