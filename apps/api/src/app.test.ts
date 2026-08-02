import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

const apps: Awaited<ReturnType<typeof buildApp>>[] = []
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())))

describe('api', () => {
  it('exposes a schema-valid health endpoint', async () => {
    const app = await buildApp({ logger: false })
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok', service: 'api' })
  })

  it('rejects malformed submissions', async () => {
    const app = await buildApp({ logger: false })
    apps.push(app)
    const response = await app.inject({ method: 'POST', url: '/v1/submissions', payload: {} })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })
  })
})
