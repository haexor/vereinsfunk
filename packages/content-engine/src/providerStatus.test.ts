import { describe, expect, it } from 'vitest'
import { classifyProviderStatus } from './providerStatus.js'

describe('classifyProviderStatus', () => {
  it.each([
    [429, 'provider_rate_limit', true],
    [500, 'provider_server', true],
    [503, 'provider_server', true],
    [401, 'provider_configuration', false],
    [403, 'provider_configuration', false],
    [404, 'provider_configuration', false],
    [400, 'provider_schema', false],
    [422, 'provider_schema', false],
  ])('maps %i to %s (retryable: %s)', (status, errorClass, retryable) => {
    expect(classifyProviderStatus(status)).toEqual({ errorClass, retryable })
  })
})
