import { createSecretBox } from '@vereinsfunk/secrets'
import type { VeoMatch } from '@vereinsfunk/veo-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { failureMailText, VeoSyncExecutor, type VeoMatchWrite, type VeoSyncFinish, type VeoSyncRepository } from './veoSync.js'

const veo = vi.hoisted(() => ({
  exchangeSessionCookieForToken: vi.fn(),
  listMatches: vi.fn(),
  fetchTeamStats: vi.fn(),
  fetchPlayerStats: vi.fn(),
}))
vi.mock('@vereinsfunk/veo-client', async (importOriginal) => ({ ...(await importOriginal<object>()), ...veo }))
const { VeoError } = await import('@vereinsfunk/veo-client')

const RUN_ID = '00000000-0000-4000-8000-000000000001'
const SOURCE_ID = '00000000-0000-4000-8000-000000000002'
const TEAM_ID = '00000000-0000-4000-8000-000000000003'
const box = createSecretBox({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1')
const COOKIE = 'sessionid=very-secret'

const payload = {
  entityId: RUN_ID, organizationId: '00000000-0000-4000-8000-000000000004', departmentId: '00000000-0000-4000-8000-000000000005',
  departmentConcurrencyKey: '00000000-0000-4000-8000-000000000005', correlationId: '00000000-0000-4000-8000-000000000006',
  sourceRevision: 1, purpose: 'default', idempotencyKey: `integration-sync:${RUN_ID}`,
}

/** Ein Veo-Spiel der Liste, analysiert und mit Endstand, sofern nicht anders angegeben. */
function match(id: string, overrides: Partial<VeoMatch> = {}): VeoMatch {
  return {
    veoMatchId: id, veoTeamId: 'veo-team', start: '2026-09-05T10:00:00.000Z', title: 'Testverein vs. Gegner', opponentName: 'Gegner',
    homeOrAway: 'away', hasAnalytics: true, score: { own: 2, opponent: 1 }, ...overrides,
  }
}

/** Datenbank-Fake: ein laufender Lauf, eine Verbindung mit versiegeltem Cookie, Aufzeichnung aller Schreibvorgaenge. */
function fakeRepository(options: { runStatus?: string; notify?: boolean } = {}) {
  const sealed = box.seal(COOKIE, `integration-source:${SOURCE_ID}`)
  const applied: VeoMatchWrite[] = []
  const finished: VeoSyncFinish[] = []
  const repository: VeoSyncRepository = {
    loadRun: async () => ({ sourceId: SOURCE_ID, status: options.runStatus ?? 'running' }),
    loadSource: async () => ({ teamId: TEAM_ID, teamName: 'U13', veoClubSlug: 'club', veoTeamSlug: 'u13', secret: { ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion } }),
    applyMatch: async (_runId, write) => { applied.push(write); return 'updated' },
    finish: async (_runId, outcome) => { finished.push(outcome); return { teamId: TEAM_ID, notify: options.notify ?? false } },
    failureRecipients: async () => ['coach@example.local'],
  }
  return { repository, applied, finished }
}

/** Executor mit Fake-Mailversand und mitgeschriebenem Log. */
function executor(repository: VeoSyncRepository) {
  const mails: { to: string; subject: string; text: string }[] = []
  const logs: unknown[] = []
  const instance = new VeoSyncExecutor({
    repository, secretBox: box, fetch: vi.fn(), webBaseUrl: 'https://app.example.local', retryDelayMs: 0,
    emailSender: { send: async (message) => { mails.push(message) } },
    log: (fields, message) => { logs.push({ fields, message }) },
  })
  return { instance, mails, logs }
}

beforeEach(() => {
  vi.resetAllMocks()
  veo.exchangeSessionCookieForToken.mockResolvedValue({ accessToken: 'token', expiresAt: new Date() })
  veo.fetchTeamStats.mockImplementation(async (_token: string, params: { veoMatchIds: string[] }) => [
    { veoMatchId: params.veoMatchIds[0], teamAssociation: 'own', statType: 'football_goal_total', category: 'attacking', value: 2, periodValues: [] },
  ])
  veo.fetchPlayerStats.mockResolvedValue([{ jerseyNumber: 7, stats: [{ statType: 'sprints_total', category: 'physical', value: 9 }] }])
})

describe('VeoSyncExecutor', () => {
  it('writes every analysed match and skips matches without analysis', async () => {
    veo.listMatches.mockResolvedValue([match('a'), match('b', { hasAnalytics: false, score: null })])
    const { repository, applied, finished } = fakeRepository()
    await executor(repository).instance.execute(payload)

    expect(veo.exchangeSessionCookieForToken).toHaveBeenCalledWith(COOKIE, expect.anything())
    expect(veo.listMatches).toHaveBeenCalledWith('token', { veoClubSlug: 'club', veoTeamSlug: 'u13' }, expect.anything())
    expect(applied).toEqual([{
      veoMatchId: 'a', veoTeamId: 'veo-team', start: '2026-09-05T10:00:00.000Z', opponentName: 'Gegner', isHome: false, ownScore: 2, opponentScore: 1,
      teamStats: [{ teamAssociation: 'own', statType: 'football_goal_total', category: 'attacking', value: 2, periodValues: [] }],
      players: [{ jerseyNumber: 7, stats: [{ statType: 'sprints_total', category: 'physical', value: 9 }] }],
    }])
    expect(finished).toEqual([{ status: 'succeeded', errorClass: null, created: 0, updated: 1, skipped: 1, conflicts: 0 }])
  })

  it('retries a match once when Veo answers with a server error', async () => {
    veo.listMatches.mockResolvedValue([match('a')])
    veo.fetchPlayerStats
      .mockRejectedValueOnce(new VeoError('upstream_error', 'Veo request failed with HTTP 502', 502))
      .mockResolvedValueOnce([])
    const { repository, applied, finished } = fakeRepository()
    const { instance, logs } = executor(repository)
    await instance.execute(payload)

    expect(applied.map((write) => write.veoMatchId)).toEqual(['a'])
    expect(finished[0]).toMatchObject({ status: 'succeeded', updated: 1 })
    expect(logs).toEqual([{ fields: { runId: RUN_ID, status: 502 }, message: 'veo match request retried' }])
  })

  it('leaves a match out completely when its player values fail twice and still writes the others', async () => {
    veo.listMatches.mockResolvedValue([match('a'), match('b')])
    veo.fetchPlayerStats.mockImplementation(async (_token: string, params: { veoMatchId: string }) => {
      if (params.veoMatchId === 'a') throw new VeoError('upstream_error', 'Veo request failed with HTTP 502', 502)
      return []
    })
    const { repository, applied, finished } = fakeRepository()
    await executor(repository).instance.execute(payload)

    expect(veo.fetchTeamStats).toHaveBeenCalledTimes(3)
    expect(applied.map((write) => write.veoMatchId)).toEqual(['b'])
    expect(finished).toEqual([{ status: 'failed', errorClass: 'upstream_error', created: 0, updated: 1, skipped: 1, conflicts: 0 }])
  })

  it('ends the run on an expired session and notifies the coach without leaking the cookie', async () => {
    veo.exchangeSessionCookieForToken.mockRejectedValue(new VeoError('auth_expired', 'Veo session no longer renews'))
    const { repository, applied, finished } = fakeRepository({ notify: true })
    const { instance, mails, logs } = executor(repository)
    await instance.execute(payload)

    expect(applied).toEqual([])
    expect(finished[0]).toMatchObject({ status: 'failed', errorClass: 'auth_expired' })
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ to: 'coach@example.local', subject: 'Veo-Abgleich für U13 schlägt fehl' })
    expect(mails[0]!.text).toContain('Bitte verbinde Veo im PlayerBoard neu')
    expect(mails[0]!.text).toContain('https://app.example.local/playerboard/veo')
    expect(JSON.stringify({ mails, logs })).not.toContain('very-secret')
  })

  it('stops after the first match when Veo changes its response shape', async () => {
    veo.listMatches.mockResolvedValue([match('a'), match('b')])
    veo.fetchTeamStats.mockRejectedValue(new VeoError('upstream_changed', 'unexpected shape'))
    const { repository, finished } = fakeRepository()
    await executor(repository).instance.execute(payload)

    expect(veo.fetchTeamStats).toHaveBeenCalledTimes(1)
    expect(finished[0]).toMatchObject({ status: 'failed', errorClass: 'upstream_changed' })
  })

  it('does nothing for a run that is no longer running', async () => {
    const { repository, finished } = fakeRepository({ runStatus: 'cancelled' })
    await executor(repository).instance.execute(payload)
    expect(veo.exchangeSessionCookieForToken).not.toHaveBeenCalled()
    expect(finished).toEqual([])
  })

  it('fails the run when the stored session cannot be opened', async () => {
    const { repository, finished } = fakeRepository()
    repository.loadSource = async () => ({ teamId: TEAM_ID, teamName: 'U13', veoClubSlug: 'club', veoTeamSlug: 'u13', secret: { ciphertext: Buffer.from('broken'), keyVersion: 'v1' } })
    await executor(repository).instance.execute(payload)
    expect(finished[0]).toMatchObject({ status: 'failed', errorClass: 'secret_unreadable' })
  })
})

describe('failureMailText', () => {
  it('tells the coach that nothing is to do when Veo is down', () => {
    expect(failureMailText('U13', 'upstream_error', undefined).text).toContain('versucht es automatisch erneut')
    expect(failureMailText('U13', 'upstream_error', undefined).text).not.toContain('http')
  })
})
