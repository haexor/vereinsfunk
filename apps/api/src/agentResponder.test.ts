// Follow-up zu PR #162: kein Test rief POST /v1/agent/conversations/:id/messages bisher ohne
// options.agentResponder-Override auf. resolveConfiguredAgentResponder() in app.ts (DB-Fehler,
// fehlende/inaktive Zeile, kaputte Secret-Zeile -> Fallback auf deploymentAgentResponder) war damit
// nur durch manuelles Testen abgesichert.
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSecretBox } from '@vereinsfunk/secrets'
import type * as AgentModule from './agent.js'
import type { SupabaseClientFactory } from './app.js'
import { ciphertextToBytea } from './secretBox.js'
import { chain, ORGANIZATION_ID, signAccessToken, startApp, USER_ID } from './testSupport.js'

const capturedProviderOptions: { apiKey: string; model: string; baseUrl?: string }[] = []

// OpenAiResponsesAgentResponder.respond() geht ueber createGuardedFetch() gegen die echte
// Basis-URL -- ein echter Netzwerk-/DNS-Aufruf ist in einem Unit-Test nicht sinnvoll nachstellbar
// (createGuardedFetch blockt localhost/private Ziele ohnehin). Der Test doubled deshalb nur die
// Provider-Klasse, um Konstruktor-Argumente und die Antwort abzugreifen; LocalAgentResponder bleibt
// echt, damit die Deployment-Fallback-Faelle das reale Verhalten pruefen.
vi.mock('./agent.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentModule>()
  return {
    ...actual,
    OpenAiResponsesAgentResponder: class {
      constructor(options: { apiKey: string; model: string; baseUrl?: string }) {
        capturedProviderOptions.push(options)
      }
      async respond() {
        return { content: 'Antwort vom konfigurierten Provider.', providerConfigured: true }
      }
    },
  }
})

const CONVERSATION_ID = '10000000-4000-4000-8000-000000000001'
const PROVIDER_ID = '10000000-5000-4000-8000-000000000001'
const TEST_SECRET_BOX = createSecretBox({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1')

function conversationRow(): Record<string, unknown> {
  return {
    id: CONVERSATION_ID,
    organization_id: ORGANIZATION_ID,
    department_id: null,
    team_id: null,
    created_by: USER_ID,
    title: null,
    last_activity_at: '2026-08-24T10:00:00+00:00',
    archived_at: null,
    retention_expires_at: '2027-08-24T10:00:00+00:00',
    created_at: '2026-08-24T10:00:00+00:00',
    updated_at: '2026-08-24T10:00:00+00:00',
  }
}

function messageRow(role: 'user' | 'assistant', content: string): Record<string, unknown> {
  return {
    id: role === 'user' ? '10000000-6000-4000-8000-000000000001' : '10000000-6000-4000-8000-000000000002',
    organization_id: ORGANIZATION_ID,
    conversation_id: CONVERSATION_ID,
    role,
    content,
    created_at: '2026-08-24T10:05:00+00:00',
  }
}

// Deckt sowohl loadConversation/loadMessages als auch das (in diesem Szenario immer leere)
// loadWorkspace ab -- posts/club_events/approval_stages/composition_sessions/publications leer zu
// lassen vermeidet die jeweiligen Folgeabfragen (post_versions, approval_requests,
// generation_candidates, publication_attempts).
function userClientForMessagesRoute(): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'agent_conversations') return chain({ data: conversationRow(), error: null })
      if (table === 'agent_messages') return chain({ data: [], error: null })
      if (table === 'posts' || table === 'club_events' || table === 'approval_stages' || table === 'composition_sessions' || table === 'publications') {
        return chain({ data: [], error: null })
      }
      throw new Error(`unexpected table in agent messages test (user client): ${table}`)
    },
  } as unknown as SupabaseClient
}

function serviceClientForMessagesRoute(
  settingResult: { data: unknown; error: unknown },
  providerResult: { data: unknown; error: unknown } = { data: null, error: null },
): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'platform_settings') return chain(settingResult)
      if (table === 'llm_provider_configurations') return chain(providerResult)
      if (table === 'audit_events') return { insert: async () => ({ error: null }) }
      throw new Error(`unexpected table in agent messages test (service client): ${table}`)
    },
    // Spiegelt append_agent_conversation_messages(): speichert (hier: gibt einfach zurueck) genau
    // die uebergebenen Inhalte, statt eine feste Antwort vorzugeben -- der Responder entscheidet den
    // tatsaechlichen Antworttext.
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'append_agent_conversation_messages') throw new Error(`unexpected rpc in test: ${name}`)
      return {
        data: [{
          user_message: messageRow('user', String(args.user_message_content)),
          assistant_message: messageRow('assistant', String(args.assistant_message_content)),
          last_activity_at: '2026-08-24T10:05:00+00:00',
        }],
        error: null,
      }
    },
  } as unknown as SupabaseClient
}

async function postMessage(clients: SupabaseClientFactory, content: string) {
  const app = await startApp({ supabaseClients: clients })
  return app.inject({
    method: 'POST',
    url: `/v1/agent/conversations/${CONVERSATION_ID}/messages`,
    headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    payload: { content },
  })
}

// Kein Schluesselwort, das LocalAgentResponder erkennt -- landet immer im generischen Zweig, siehe
// apps/api/src/agent.ts.
const UNMATCHED_QUESTION = 'Wie ist das Wetter heute?'
const DEPLOYMENT_FALLBACK_ANSWER = 'Ich kann dir Beiträge, offene Freigaben und kommende Termine im aktuellen Arbeitsbereich zeigen. Schreib zum Beispiel: „Welche Freigaben sind offen?“'

describe('POST /v1/agent/conversations/:id/messages without an agentResponder override', () => {
  it('falls back to the deployment responder when no provider is configured', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClientForMessagesRoute(),
      forService: () => serviceClientForMessagesRoute({ data: null, error: null }),
    }
    const response = await postMessage(clients, UNMATCHED_QUESTION)
    expect(response.statusCode).toBe(201)
    expect(response.json().messages.at(-1)).toMatchObject({ content: DEPLOYMENT_FALLBACK_ANSWER })
  })

  it('falls back to the deployment responder when the configured provider row is gone or inactive', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClientForMessagesRoute(),
      forService: () => serviceClientForMessagesRoute(
        { data: { value: PROVIDER_ID }, error: null },
        { data: null, error: null },
      ),
    }
    const response = await postMessage(clients, UNMATCHED_QUESTION)
    expect(response.statusCode).toBe(201)
    expect(response.json().messages.at(-1)).toMatchObject({ content: DEPLOYMENT_FALLBACK_ANSWER })
  })

  it('falls back to the deployment responder when reading platform_settings throws', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => userClientForMessagesRoute(),
      forService: () => serviceClientForMessagesRoute({ data: null, error: { message: 'platform_settings unavailable' } }),
    }
    const response = await postMessage(clients, UNMATCHED_QUESTION)
    expect(response.statusCode).toBe(201)
    expect(response.json().messages.at(-1)).toMatchObject({ content: DEPLOYMENT_FALLBACK_ANSWER })
  })

  it('calls the configured provider with the row values, not the deployment env values', async () => {
    capturedProviderOptions.length = 0
    const sealed = TEST_SECRET_BOX.seal('sk-configured-secret', PROVIDER_ID)
    const providerRow = {
      id: PROVIDER_ID,
      protocol: 'openai',
      task_kind: 'text_generation',
      base_url: 'https://configured-provider.example.com/v1',
      model: 'configured-model',
      llm_provider_secrets: { api_key_ciphertext: ciphertextToBytea(sealed.ciphertext), key_version: sealed.keyVersion },
    }
    const clients: SupabaseClientFactory = {
      forUser: () => userClientForMessagesRoute(),
      forService: () => serviceClientForMessagesRoute(
        { data: { value: PROVIDER_ID }, error: null },
        { data: providerRow, error: null },
      ),
    }
    const response = await postMessage(clients, UNMATCHED_QUESTION)
    expect(response.statusCode).toBe(201)
    expect(response.json().messages.at(-1)).toMatchObject({ content: 'Antwort vom konfigurierten Provider.' })
    expect(capturedProviderOptions).toEqual([
      { apiKey: 'sk-configured-secret', model: 'configured-model', baseUrl: 'https://configured-provider.example.com/v1' },
    ])
  })
})
