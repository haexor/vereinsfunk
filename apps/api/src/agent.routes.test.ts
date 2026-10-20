import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CreateAgentActionProposalSchema, type CreateAgentActionProposal } from '@vereinsfunk/contracts'
import { hashAgentProposalInput } from '@vereinsfunk/domain'
import type { AgentResponder } from './agent.js'
import type { SupabaseClientFactory } from './app.js'
import { DEPARTMENT_ID, MEMBERSHIP_ID, ORGANIZATION_ID, USER_ID, chain, grantingRoleProvider, membershipRowsStub, moduleStatusProviderWith, organizationManagerRoleProvider, signAccessToken, startApp } from './testSupport.js'

const CONVERSATION_ID = '10000000-4000-4000-8000-000000000001'
const WORKSPACE_TABLES = ['posts', 'club_events', 'approval_stages', 'composition_sessions', 'publications']

function conversationRow(departmentId: string | null = null): Record<string, unknown> {
  return {
    id: CONVERSATION_ID, organization_id: ORGANIZATION_ID, department_id: departmentId, team_id: null, created_by: USER_ID, title: null,
    last_activity_at: '2026-08-24T10:00:00+00:00', archived_at: null, retention_expires_at: '2027-08-24T10:00:00+00:00',
    created_at: '2026-08-24T10:00:00+00:00', updated_at: '2026-08-24T10:00:00+00:00',
  }
}

function messageRow(index: number, role: 'user' | 'assistant', content: string): Record<string, unknown> {
  return {
    id: `10000000-6000-4000-8000-${String(index).padStart(12, '0')}`, organization_id: ORGANIZATION_ID, conversation_id: CONVERSATION_ID,
    role, content, created_at: new Date(Date.UTC(2026, 7, 24, 10, 0, 0, index)).toISOString(),
  }
}

// append_agent_conversation_messages() gibt genau die uebergebenen Inhalte zurueck; der Responder
// des Tests entscheidet die Antwort.
function messagesServiceClient(captured: { proposals: unknown[] } = { proposals: [] }): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'audit_events') return { insert: async () => ({ error: null }) }
      if (table === 'agent_action_proposals') return { insert: (row: unknown) => { captured.proposals.push(row); throw new Error('proposal must not be created') } }
      throw new Error(`unexpected table in agent messages service fake: ${table}`)
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'append_agent_conversation_messages') throw new Error(`unexpected rpc in agent messages test: ${name}`)
      return {
        data: [{
          user_message: messageRow(1_000, 'user', String(args.user_message_content)),
          assistant_message: messageRow(1_001, 'assistant', String(args.assistant_message_content)),
          last_activity_at: '2026-08-24T11:00:00+00:00',
        }],
        error: null,
      }
    },
  } as unknown as SupabaseClient
}

const PERMISSION_FALLBACK_ANSWER = 'Dafür fehlen dir im aktuellen Bereich die nötigen Berechtigungen. Es wurde keine Aktion vorbereitet.'

// Eine Unterhaltung ohne Verlauf und mit leerem Arbeitsplatz; der Responder liefert den Vorschlag.
function conversationClients(departmentId: string | null, captured: { proposals: unknown[] }): SupabaseClientFactory {
  return {
    forUser: () => ({
      from: (table: string) => {
        if (table === 'agent_conversations') return chain({ data: conversationRow(departmentId), error: null })
        if (table === 'agent_messages') return chain({ data: [], error: null })
        if (WORKSPACE_TABLES.includes(table)) return chain({ data: [], error: null })
        throw new Error(`unexpected table in agent messages test: ${table}`)
      },
    }) as unknown as SupabaseClient,
    forService: () => messagesServiceClient(captured),
  }
}

function proposingResponder(proposal: CreateAgentActionProposal): AgentResponder {
  return { async respond() { return { content: 'Ich habe eine Aktion vorbereitet.', proposal, providerConfigured: true } } }
}

async function postMessage(options: Parameters<typeof startApp>[0], content = 'Wie geht es weiter?') {
  const app = await startApp(options)
  return app.inject({
    method: 'POST',
    url: `/v1/agent/conversations/${CONVERSATION_ID}/messages`,
    headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    payload: { content },
  })
}

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

  it('keeps the workspace available when the optional text-candidate query fails', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
          if (table === 'department_memberships' || table === 'team_memberships') return membershipRowsStub([])
          if (table === 'posts' || table === 'club_events' || table === 'approval_stages' || table === 'publications') return chain({ data: [], error: null })
          if (table === 'composition_sessions') return chain({ data: null, error: { message: 'relation is temporarily unavailable' } })
          throw new Error(`unexpected table in agent workspace test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => ({}) as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/agent/workspace?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ organizationId: ORGANIZATION_ID, readyTextCandidates: [], duePublications: [], publicationActivities: [] })
  })

  it('lists the organization-scope conversation history without a department set', async () => {
    // Regression fuer einen frueheren Bug: department_id/team_id wurden mit .eq(col, null) statt
    // .is(col, null) gefiltert -- PostgREST versucht dann, den literalen String "null" in den
    // uuid-Spaltentyp zu casten und liefert einen Fehler, statt IS NULL zu pruefen. Der
    // Organisations-Scope (kein departmentId, kein teamId -- der Standardfall aus toAgentScopeRequest
    // im Frontend) traf das auf jedem Aufruf.
    const conversationRow = {
      id: '10000000-4000-4000-8000-000000000001',
      organization_id: ORGANIZATION_ID,
      department_id: null,
      team_id: null,
      created_by: USER_ID,
      title: null,
      last_activity_at: new Date().toISOString(),
      archived_at: null,
      retention_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
          if (table === 'department_memberships' || table === 'team_memberships') return membershipRowsStub([])
          if (table === 'agent_conversations') return chain({ data: [conversationRow], error: null })
          throw new Error(`unexpected table in agent conversations test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => ({}) as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/agent/conversations?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject([{ id: conversationRow.id, organizationId: ORGANIZATION_ID, departmentId: null, teamId: null }])
  })

  it('keeps the chat available with an empty workspace when a core summary query fails', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
          if (table === 'department_memberships' || table === 'team_memberships') return membershipRowsStub([])
          if (table === 'posts') return chain({ data: null, error: { message: 'relation is temporarily unavailable' } })
          if (table === 'club_events' || table === 'approval_stages' || table === 'composition_sessions' || table === 'publications') return chain({ data: [], error: null })
          throw new Error(`unexpected table in agent workspace test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => ({}) as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/agent/workspace?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      organizationId: ORGANIZATION_ID,
      posts: [], events: [], pendingApprovals: [], readyTextCandidates: [], duePublications: [], publicationActivities: [],
    })
  })

  it('answers with the newest message window once a conversation outgrows it', async () => {
    // 100 gespeicherte Nachrichten plus das neue Paar: frueher lud die Route die 100 aeltesten
    // (Modell sah nie den aktuellen Stand) und die Antwort mit 102 Nachrichten scheiterte am Schema.
    const history = Array.from({ length: 100 }, (_, index) => messageRow(index, index % 2 === 0 ? 'user' : 'assistant', `Nachricht ${index}`))
    const orderCalls: unknown[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table === 'agent_conversations') return chain({ data: conversationRow(), error: null })
          if (table === 'agent_messages') {
            const builder = chain({ data: [...history].reverse(), error: null })
            builder.order = (...args: unknown[]) => { orderCalls.push(args); return builder }
            return builder
          }
          if (table === 'agent_message_media_references') return chain({ data: [], error: null })
          if (WORKSPACE_TABLES.includes(table)) return chain({ data: [], error: null })
          throw new Error(`unexpected table in agent messages test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => messagesServiceClient(),
    }
    const seen: string[][] = []
    const agentResponder: AgentResponder = {
      async respond(input) {
        seen.push(input.messages.map((message) => message.content))
        return { content: 'Antwort', providerConfigured: false }
      },
    }
    const response = await postMessage({ supabaseClients: clients, agentResponder }, 'Neue Frage')
    expect(response.statusCode).toBe(201)
    expect(orderCalls).toEqual([['created_at', { ascending: false }]])
    const messages = response.json().messages as { content: string }[]
    expect(messages).toHaveLength(100)
    expect(messages[0]!.content).toBe('Nachricht 2')
    expect(messages.slice(-3).map((message) => message.content)).toEqual(['Nachricht 99', 'Neue Frage', 'Antwort'])
    expect(seen[0]!.slice(-2)).toEqual(['Nachricht 99', 'Neue Frage'])
  })

  it('keeps a club-level post without a department in the workspace', async () => {
    // Seit Migration 2026082504 darf posts.department_id null sein. Frueher verwarf das Schema die
    // gesamte Uebersicht und der Assistent antwortete mit einem leeren Arbeitsplatz.
    const postRow = { id: '10000000-8000-4000-8000-000000000001', department_id: null, status: 'draft', current_version_id: null, scheduled_for: null, updated_at: '2026-08-24T10:00:00+00:00' }
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
          if (table === 'department_memberships' || table === 'team_memberships') return membershipRowsStub([])
          if (table === 'posts') return chain({ data: [postRow], error: null })
          if (WORKSPACE_TABLES.includes(table)) return chain({ data: [], error: null })
          throw new Error(`unexpected table in agent workspace test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => ({}) as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/agent/workspace?organizationId=${ORGANIZATION_ID}`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().posts).toEqual([expect.objectContaining({ id: postRow.id, departmentId: null })])
  })

  it('filters due publications and pending approvals by department before the limit', async () => {
    // publications und approval_stages tragen keine Abteilung. Frueher kamen die 20 neuesten Zeilen
    // des ganzen Vereins zurueck und wurden erst danach gefiltert -- eine Abteilungsunterhaltung
    // verlor so ihre eigenen Eintraege, sobald andere Abteilungen die 20 Plaetze belegten.
    const filters: Record<string, unknown[][]> = {}
    const publicationResults: unknown[][] = [[{
      id: '10000000-9000-4000-8000-000000000001', platform: 'instagram', status: 'queued', scheduled_for: null,
      post_versions: { id: '10000000-9100-4000-8000-000000000001', title: 'Spielbericht', posts: { department_id: DEPARTMENT_ID, team_id: null } },
    }], []]
    const stageRow = {
      id: '10000000-9200-4000-8000-000000000001', label: 'Vorstand', deadline_at: null,
      approval_requests: { post_id: '10000000-9300-4000-8000-000000000001', post_version_id: '10000000-9100-4000-8000-000000000002', post_versions: { title: 'Saisonstart' }, posts: { department_id: DEPARTMENT_ID, team_id: null } },
    }
    const recording = (table: string, data: unknown) => {
      const builder = chain({ data, error: null })
      builder.eq = (...args: unknown[]) => { (filters[table] ??= []).push(args); return builder }
      return builder
    }
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table === 'organization_memberships') return membershipRowsStub([{ id: MEMBERSHIP_ID }])
          if (table === 'department_memberships' || table === 'team_memberships') return membershipRowsStub([])
          if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
          if (table === 'publications') return recording(table, publicationResults.shift())
          if (table === 'approval_stages') return recording(table, [stageRow])
          if (WORKSPACE_TABLES.includes(table)) return chain({ data: [], error: null })
          throw new Error(`unexpected table in agent workspace test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => ({}) as SupabaseClient,
    }
    const app = await startApp({ supabaseClients: clients })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/agent/workspace?organizationId=${ORGANIZATION_ID}&departmentId=${DEPARTMENT_ID}`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
    expect(response.statusCode).toBe(200)
    expect(filters.publications?.filter(([column]) => column === 'post_versions.posts.department_id')).toEqual([
      ['post_versions.posts.department_id', DEPARTMENT_ID], ['post_versions.posts.department_id', DEPARTMENT_ID],
    ])
    expect(filters.approval_stages).toContainEqual(['approval_requests.posts.department_id', DEPARTMENT_ID])
    expect(response.json()).toMatchObject({
      duePublications: [{ id: '10000000-9000-4000-8000-000000000001', postVersionId: '10000000-9100-4000-8000-000000000001', departmentId: DEPARTMENT_ID, title: 'Spielbericht' }],
      pendingApprovals: [{ stageId: stageRow.id, postId: stageRow.approval_requests.post_id, departmentId: DEPARTMENT_ID, title: 'Saisonstart' }],
    })
  })

  it('answers instead of failing when the model picks a role the scope cannot assign', async () => {
    // Das Tool bietet jede Rolle an; 'editor' ist auf Vereinsebene nicht vergebbar. Frueher warf
    // CreateInvitationRequestSchema.parse nach dem bezahlten Modellaufruf einen 400, und die
    // Nachricht des Nutzers ging verloren.
    const captured = { proposals: [] as unknown[] }
    const response = await postMessage({
      supabaseClients: conversationClients(null, captured),
      roleProvider: organizationManagerRoleProvider,
      agentResponder: proposingResponder({ toolName: 'create_invitation', input: { email: 'neu@example.org', role: 'editor' } }),
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().messages.at(-1)).toMatchObject({ role: 'assistant', content: PERMISSION_FALLBACK_ANSWER })
    expect(captured.proposals).toEqual([])
  })

  it('does not propose an action whose module is switched off in the scope', async () => {
    // Der Chat pruefte frueher nur die Rolle und legte einen Vorschlag an, der erst beim Bestaetigen
    // an module_disabled scheiterte.
    const captured = { proposals: [] as unknown[] }
    const proposal = CreateAgentActionProposalSchema.parse({
      toolName: 'save_content_brief',
      input: { communicationGoal: 'inform', sourceMaterial: { facts: { ergebnis: '3:1' }, observations: [], quotes: [] }, targetPlatforms: ['instagram'] },
    })
    const response = await postMessage({
      supabaseClients: conversationClients(DEPARTMENT_ID, captured),
      roleProvider: grantingRoleProvider,
      moduleStatusProvider: moduleStatusProviderWith(['playerboard']),
      agentResponder: proposingResponder(proposal),
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().messages.at(-1)).toMatchObject({ role: 'assistant', content: PERMISSION_FALLBACK_ANSWER })
    expect(captured.proposals).toEqual([])
  })
})

describe('POST /v1/agent/action-proposals/:id/confirm', () => {
  const PROPOSAL_ID = '10000000-a000-4000-8000-000000000001'
  const POST_ID = '10000000-a100-4000-8000-000000000001'
  const VERSION_ID = '10000000-a200-4000-8000-000000000001'
  const CONNECTION_ID = '10000000-a300-4000-8000-000000000001'
  const INVITATION_ROW_ID = '10000000-a400-4000-8000-000000000001'

  async function proposalRow(toolName: string, input: Record<string, unknown>, departmentId: string | null, status = 'pending', targetRefs: unknown[] = []) {
    return {
      id: PROPOSAL_ID, organization_id: ORGANIZATION_ID, conversation_id: CONVERSATION_ID, created_by: USER_ID, tool_name: toolName,
      scope_snapshot: { organizationId: ORGANIZATION_ID, departmentId, teamId: null }, input_snapshot: input, input_hash: await hashAgentProposalInput(input),
      target_refs: targetRefs, status, expires_at: '2099-01-01T00:00:00+00:00', confirmed_at: status === 'confirmed' ? '2026-08-24T10:01:00+00:00' : null,
      created_at: '2026-08-24T10:00:00+00:00', updated_at: '2026-08-24T10:00:00+00:00',
    }
  }

  // Claim, Tool-Lauf, Abschluss und Audit; die fachliche Aktion selbst laeuft ueber die Route.
  function confirmServiceClient(claimed: unknown, completed: unknown, audits: Record<string, unknown>[]): SupabaseClient {
    return {
      auth: { admin: { inviteUserByEmail: async () => ({ data: { user: {} }, error: null }) } },
      rpc: async (name: string) => {
        if (name === 'claim_agent_action_proposal') return { data: claimed, error: null }
        throw new Error(`unexpected rpc in agent confirm test: ${name}`)
      },
      from: (table: string) => {
        if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { audits.push(row); return { error: null } } }
        if (table === 'agent_tool_runs') return { insert: () => chain({ data: { id: '10000000-a500-4000-8000-000000000001' }, error: null }), update: () => chain({ data: null, error: null }) }
        if (table === 'agent_action_proposals') return { update: () => chain({ data: completed, error: null }) }
        throw new Error(`unexpected table in agent confirm service fake: ${table}`)
      },
    } as unknown as SupabaseClient
  }

  async function confirm(options: Parameters<typeof startApp>[0]) {
    const app = await startApp(options)
    return app.inject({
      method: 'POST',
      url: `/v1/agent/action-proposals/${PROPOSAL_ID}/confirm`,
      headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
    })
  }

  const invitationInput = { email: 'neu@example.org', role: 'organization_viewer' }

  function invitationClients(alreadyMember: boolean, pending: unknown, claimed: unknown, completed: unknown, audits: Record<string, unknown>[]): SupabaseClientFactory {
    const invitationRow = {
      id: INVITATION_ROW_ID, organization_id: ORGANIZATION_ID, department_id: null, team_id: null, email: invitationInput.email, role: invitationInput.role,
      invited_by: USER_ID, expires_at: '2026-09-24T10:00:00+00:00', accepted_at: null, revoked_at: null, last_sent_at: '2026-08-24T10:00:00+00:00', send_count: 1, created_at: '2026-08-24T10:00:00+00:00',
    }
    return {
      forUser: () => ({
        rpc: async (name: string) => (name === 'email_has_membership' ? { data: alreadyMember, error: null } : { data: invitationRow, error: null }),
        from: (table: string) => {
          if (table === 'agent_action_proposals') return chain({ data: pending, error: null })
          throw new Error(`unexpected table in agent confirm test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => confirmServiceClient(claimed, completed, audits),
    }
  }

  it('maps an invitation rejection like the invitation route instead of a 500', async () => {
    // Frueher rief der Agent createInvitation selbst auf; InvitationCreationError trug keinen
    // Statuscode und wurde zu einem 500.
    const audits: Record<string, unknown>[] = []
    const response = await confirm({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: invitationClients(true, await proposalRow('create_invitation', invitationInput, null), await proposalRow('create_invitation', invitationInput, null, 'executing'), null, audits),
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'already_a_member' })
  })

  it('records invitation.created under the same correlation id as the confirmation', async () => {
    const audits: Record<string, unknown>[] = []
    const response = await confirm({
      roleProvider: organizationManagerRoleProvider,
      supabaseClients: invitationClients(
        false,
        await proposalRow('create_invitation', invitationInput, null),
        await proposalRow('create_invitation', invitationInput, null, 'executing'),
        await proposalRow('create_invitation', invitationInput, null, 'confirmed', [{ entityType: 'invitations', id: INVITATION_ROW_ID }]),
        audits,
      ),
    })
    expect(response.statusCode).toBe(200)
    const created = audits.find((row) => row.action === 'invitation.created')
    const confirmed = audits.find((row) => row.action === 'agent.action_proposal_confirmed')
    expect(created).toMatchObject({ entity_id: INVITATION_ROW_ID })
    expect(confirmed).toMatchObject({ metadata: expect.objectContaining({ resultId: INVITATION_ROW_ID, emailDelivered: true }) })
    expect(created?.correlation_id).toBe(confirmed?.correlation_id)
  })

  it('honours the publishing kill switch when confirming a scheduled publication', async () => {
    // Die eigene Kopie der Planung im Agenten kannte publishingIsAvailable() nicht.
    const scheduleInput = { postVersionId: VERSION_ID, platform: 'instagram', scheduledFor: null }
    const pending = await proposalRow('schedule_publication', scheduleInput, DEPARTMENT_ID)
    const claimed = await proposalRow('schedule_publication', scheduleInput, DEPARTMENT_ID, 'executing')
    const clients: SupabaseClientFactory = {
      forUser: () => ({
        from: (table: string) => {
          if (table === 'agent_action_proposals') return chain({ data: pending, error: null })
          if (table === 'post_versions') return chain({ data: { id: VERSION_ID, post_id: POST_ID, effective_config_snapshot: null }, error: null })
          if (table === 'posts') return chain({ data: { id: POST_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, status: 'approved', current_version_id: VERSION_ID }, error: null })
          if (table === 'social_connections') return chain({ data: [{ id: CONNECTION_ID, platform: 'instagram', status: 'active', archived_at: null, responsible_profile_id: null }], error: null })
          if (table === 'channel_scopes') return chain({ data: [{ social_connection_id: CONNECTION_ID, scope: 'organization', department_id: null, team_id: null, can_schedule: true }], error: null })
          if (table === 'policy_settings') return chain({ data: null, error: null })
          throw new Error(`unexpected table in agent confirm test: ${table}`)
        },
      }) as unknown as SupabaseClient,
      forService: () => confirmServiceClient(claimed, null, []),
    }
    vi.stubEnv('PUBLISHING_MODE', 'disabled')
    try {
      const response = await confirm({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({ error: 'publishing_disabled' })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
