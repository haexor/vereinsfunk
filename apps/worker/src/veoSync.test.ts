import { createSecretBox } from '@vereinsfunk/secrets'
import type { VeoMatch } from '@vereinsfunk/veo-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerboardVeoSyncProgress } from '@vereinsfunk/contracts'
import { failureMailText, needsAnalysis, VeoSyncExecutor, type VeoAnalysisCandidate, type VeoMatchWrite, type VeoSyncFinish, type VeoSyncRepository } from './veoSync.js'

const veo = vi.hoisted(() => ({
  exchangeSessionCookieForToken: vi.fn(),
  listMatches: vi.fn(),
  fetchTeamStats: vi.fn(),
  fetchPlayerStats: vi.fn(),
}))
vi.mock('@vereinsfunk/veo-client', async (importOriginal) => ({ ...(await importOriginal<object>()), ...veo }))
const analysisSync = vi.hoisted(() => ({ buildVeoAnalysis: vi.fn() }))
vi.mock('./veoAnalysisSync.js', () => analysisSync)
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
function fakeRepository(options: { runStatus?: string; notify?: boolean; refreshRequestedAt?: string; candidates?: Record<string, VeoAnalysisCandidate>; analysisResult?: 'written' | 'unknown_match' } = {}) {
  const sealed = box.seal(COOKIE, `integration-source:${SOURCE_ID}`)
  const applied: VeoMatchWrite[] = []
  const finished: VeoSyncFinish[] = []
  const analyses: string[] = []
  const cleared: string[] = []
  const progress: PlayerboardVeoSyncProgress[] = []
  const repository: VeoSyncRepository = {
    loadRun: async () => ({ sourceId: SOURCE_ID, status: options.runStatus ?? 'running' }),
    loadSource: async () => ({
      teamId: TEAM_ID, teamName: 'U13', veoClubSlug: 'club', veoTeamSlug: 'u13', secret: { ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion },
      analysisRefreshRequestedAt: options.refreshRequestedAt ?? null,
    }),
    applyMatch: async (_runId, write) => { applied.push(write); return 'updated' },
    finish: async (_runId, outcome) => { finished.push(outcome); return { teamId: TEAM_ID, notify: options.notify ?? false } },
    failureRecipients: async () => ({ emails: ['coach@example.local'], unresolved: 0 }),
    analysisCandidates: async () => new Map(Object.entries(options.candidates ?? {})),
    applyAnalysis: async (_runId, veoMatchId) => { analyses.push(veoMatchId); return options.analysisResult ?? 'written' },
    clearAnalysisRefresh: async (_teamId, requestedAt) => { cleared.push(requestedAt) },
    reportProgress: async (_runId, entry) => { progress.push(entry) },
  }
  return { repository, applied, finished, analyses, cleared, progress }
}

const NOW = new Date('2026-10-21T12:00:00.000Z')
const complete = (kickoffAt: string, hasTracks = true, fetchedAt = kickoffAt): VeoAnalysisCandidate => ({ analysisStatus: 'complete', kickoffAt, fetchedAt, hasTracks })

/** Executor mit Fake-Mailversand und mitgeschriebenem Log. */
function executor(repository: VeoSyncRepository, options: { analysisBudgetMs?: number; progressIntervalMs?: number } = {}) {
  const mails: { to: string; subject: string; text: string }[] = []
  const logs: unknown[] = []
  const instance = new VeoSyncExecutor({
    repository, secretBox: box, fetch: vi.fn(), webBaseUrl: 'https://app.example.local', retryDelayMs: 0, trackingPauseMs: 0, now: () => NOW, ...options,
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
  analysisSync.buildVeoAnalysis.mockResolvedValue({ status: 'complete', events: [], heatmaps: [], tracks: [] })
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

  it('fetches the analysis of new, pending and recent matches but not of old complete ones', async () => {
    veo.listMatches.mockResolvedValue([match('new'), match('pending'), match('recent'), match('old')])
    const { repository, analyses } = fakeRepository({ candidates: {
      pending: { analysisStatus: 'pending', kickoffAt: '2026-01-01T10:00:00.000Z', fetchedAt: '2026-01-01T12:00:00.000Z', hasTracks: false },
      recent: complete('2026-10-10T10:00:00.000Z'),
      old: complete('2026-09-01T10:00:00.000Z'),
    } })
    await executor(repository).instance.execute(payload)
    expect(analyses).toEqual(['new', 'pending', 'recent'])
  })

  it('asks for tracks only when none are stored yet and passes the player values along', async () => {
    veo.listMatches.mockResolvedValue([match('new'), match('recent')])
    const { repository } = fakeRepository({ candidates: { recent: complete('2026-10-10T10:00:00.000Z', true) } })
    await executor(repository).instance.execute(payload)
    expect(analysisSync.buildVeoAnalysis.mock.calls.map(([request]) => [request.veoMatchId, request.fetchTracks])).toEqual([['new', true], ['recent', false]])
    expect(analysisSync.buildVeoAnalysis.mock.calls[0]?.[0].players).toEqual([{ jerseyNumber: 7, stats: [{ statType: 'sprints_total', category: 'physical', value: 9 }] }])
  })

  it('refreshes every analysis on request and clears exactly the request it saw', async () => {
    veo.listMatches.mockResolvedValue([match('old')])
    const { repository, analyses, cleared } = fakeRepository({ refreshRequestedAt: '2026-10-21T08:00:00.000Z', candidates: { old: complete('2026-09-01T10:00:00.000Z') } })
    await executor(repository).instance.execute(payload)
    expect(analyses).toEqual(['old'])
    expect(cleared).toEqual(['2026-10-21T08:00:00.000Z'])
  })

  it('resumes a refresh with the matches whose package is older than the request', async () => {
    veo.listMatches.mockResolvedValue([match('done'), match('open')])
    const { repository, analyses } = fakeRepository({ refreshRequestedAt: '2026-10-21T08:00:00.000Z', candidates: {
      done: complete('2026-09-01T10:00:00.000Z', true, '2026-10-21T09:00:00.000Z'),
      open: complete('2026-09-01T10:00:00.000Z', true, '2026-09-02T10:00:00.000Z'),
    } })
    await executor(repository).instance.execute(payload)
    expect(analyses).toEqual(['open'])
  })

  it('defers packages beyond the time budget without failing and keeps the refresh request', async () => {
    veo.listMatches.mockResolvedValue([match('a'), match('b')])
    const { repository, applied, analyses, finished, cleared } = fakeRepository({ refreshRequestedAt: '2026-10-21T08:00:00.000Z' })
    const { instance, logs } = executor(repository, { analysisBudgetMs: 0 })
    await instance.execute(payload)
    expect(applied.map((write) => write.veoMatchId)).toEqual(['a', 'b'])
    expect(analyses).toEqual([])
    expect(finished[0]).toMatchObject({ status: 'succeeded' })
    expect(cleared).toEqual([])
    expect(logs).toContainEqual({ fields: { runId: RUN_ID, deferred: 2 }, message: 'veo analysis deferred to the next run' })
  })

  it('reports the progress per match, per step and per window of the tracks', async () => {
    veo.listMatches.mockResolvedValue([match('a', { opponentName: 'SV Nord' }), match('b', { hasAnalytics: false, score: null }), match('c', { opponentName: 'FC Süd' })])
    analysisSync.buildVeoAnalysis.mockImplementation(async (_request, deps: { onTracks: (done: number, total: number) => Promise<void> }) => {
      await deps.onTracks(0, 2)
      await deps.onTracks(1, 2)
      return { status: 'complete', events: [], heatmaps: [], tracks: [] }
    })
    const { repository, progress } = fakeRepository({ candidates: { c: complete('2026-09-01T10:00:00.000Z') } })
    await executor(repository, { progressIntervalMs: 0 }).instance.execute(payload)
    const base = { matchesTotal: 2, analysesDeferred: 0, updatedAt: NOW.toISOString() }
    expect(progress).toEqual([
      { ...base, matchesDone: 0, analysesDone: 0, current: null },
      { ...base, matchesDone: 0, analysesDone: 0, current: { opponentName: 'SV Nord', step: 'values' } },
      { ...base, matchesDone: 0, analysesDone: 0, current: { opponentName: 'SV Nord', step: 'analysis' } },
      { ...base, matchesDone: 0, analysesDone: 0, current: { opponentName: 'SV Nord', step: 'tracks', tracksDone: 0, tracksTotal: 2 } },
      { ...base, matchesDone: 0, analysesDone: 0, current: { opponentName: 'SV Nord', step: 'tracks', tracksDone: 1, tracksTotal: 2 } },
      { ...base, matchesDone: 1, analysesDone: 1, current: null },
      { ...base, matchesDone: 1, analysesDone: 1, current: { opponentName: 'FC Süd', step: 'values' } },
      { ...base, matchesDone: 2, analysesDone: 1, current: null },
    ])
  })

  it('throttles progress within a match but writes every change of match, counts deferred analyses and survives a failed write', async () => {
    veo.listMatches.mockResolvedValue([match('a'), match('b')])
    const { repository, progress } = fakeRepository()
    const writes: PlayerboardVeoSyncProgress[] = []
    repository.reportProgress = async (_runId, entry) => {
      writes.push(entry)
      if (writes.length === 1) throw new Error('database down')
      progress.push(entry)
    }
    const { instance, logs } = executor(repository, { analysisBudgetMs: 0 })
    await instance.execute(payload)
    expect(progress.map((entry) => [entry.matchesDone, entry.analysesDeferred, entry.current?.step ?? null])).toEqual([[1, 1, null], [2, 2, null]])
    expect(logs).toContainEqual({ fields: { runId: RUN_ID, errorName: 'Error' }, message: 'veo sync progress not written' })
  })

  it('clears the match in progress when Veo ends the run', async () => {
    veo.listMatches.mockResolvedValue([match('a')])
    veo.fetchTeamStats.mockRejectedValue(new VeoError('auth_expired', 'session expired', 401))
    const { repository, progress } = fakeRepository()
    await executor(repository).instance.execute(payload)
    expect(progress.at(-1)).toMatchObject({ matchesDone: 0, current: null })
  })

  it('keeps the match values when its analysis fails, fails the run and keeps a refresh request', async () => {
    veo.listMatches.mockResolvedValue([match('a')])
    analysisSync.buildVeoAnalysis.mockRejectedValue(new VeoError('upstream_error', 'Veo request failed with HTTP 502', 502))
    const { repository, applied, analyses, finished, cleared } = fakeRepository({ refreshRequestedAt: '2026-10-21T08:00:00.000Z' })
    const { instance, logs } = executor(repository)
    await instance.execute(payload)
    expect(applied.map((write) => write.veoMatchId)).toEqual(['a'])
    expect(analyses).toEqual([])
    expect(finished[0]).toMatchObject({ status: 'failed', errorClass: 'upstream_error', updated: 1 })
    expect(cleared).toEqual([])
    expect(logs).toContainEqual({ fields: { runId: RUN_ID, errorClass: 'upstream_error', status: 502, errorName: 'VeoError' }, message: 'veo analysis skipped' })
  })

  it('does not clear a refresh when the database did not write the analysis', async () => {
    veo.listMatches.mockResolvedValue([match('a')])
    const { repository, finished, cleared } = fakeRepository({ refreshRequestedAt: '2026-10-21T08:00:00.000Z', analysisResult: 'unknown_match' })
    const { instance, logs } = executor(repository)
    await instance.execute(payload)
    expect(finished[0]).toMatchObject({ status: 'failed', errorClass: 'analysis_not_written' })
    expect(cleared).toEqual([])
    expect(logs).toContainEqual({ fields: { runId: RUN_ID, errorClass: 'analysis_not_written' }, message: 'veo analysis was not written' })
  })

  it('ends the run when the analysis meets a changed Veo response', async () => {
    veo.listMatches.mockResolvedValue([match('a'), match('b')])
    analysisSync.buildVeoAnalysis.mockRejectedValue(new VeoError('upstream_changed', 'unexpected shape'))
    const { repository, applied, finished } = fakeRepository()
    await executor(repository).instance.execute(payload)
    expect(applied.map((write) => write.veoMatchId)).toEqual(['a'])
    expect(finished[0]).toMatchObject({ status: 'failed', errorClass: 'upstream_changed' })
  })

  it('logs only counts of the written analysis', async () => {
    veo.listMatches.mockResolvedValue([match('a')])
    analysisSync.buildVeoAnalysis.mockResolvedValue({ status: 'complete', events: [{ veoEventId: 'e' }], heatmaps: [], tracks: null })
    const { repository } = fakeRepository()
    const { instance, logs } = executor(repository)
    await instance.execute(payload)
    expect(logs).toContainEqual({ fields: { runId: RUN_ID, status: 'complete', events: 1, heatmaps: 0, tracks: null }, message: 'veo analysis written' })
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
    expect(logs.filter((entry) => (entry as { message: string }).message === 'veo match request retried')).toEqual([{ fields: { runId: RUN_ID, status: 502 }, message: 'veo match request retried' }])
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

  // failure_notified_at ist nach finish() schon gesetzt: ein Wurf hier liesse Hatchet wiederholen,
  // der Retry endet aber am beendeten Lauf -- der Hinweis waere fuer alle Trainer verloren.
  it('still mails the resolvable coaches and does not throw when a recipient lookup fails', async () => {
    veo.exchangeSessionCookieForToken.mockRejectedValue(new VeoError('auth_expired', 'Veo session no longer renews'))
    const { repository } = fakeRepository({ notify: true })
    repository.failureRecipients = async () => ({ emails: ['coach@example.local'], unresolved: 1 })
    const { instance, mails, logs } = executor(repository)
    await expect(instance.execute(payload)).resolves.toBeUndefined()
    expect(mails.map((mail) => mail.to)).toEqual(['coach@example.local'])
    expect(logs).toContainEqual({ fields: { runId: RUN_ID, unresolved: 1 }, message: 'veo failure notification recipients unresolved' })

    repository.failureRecipients = async () => { throw new Error('auth admin unavailable') }
    await expect(executor(repository).instance.execute(payload)).resolves.toBeUndefined()
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
    repository.loadSource = async () => ({ teamId: TEAM_ID, teamName: 'U13', veoClubSlug: 'club', veoTeamSlug: 'u13', secret: { ciphertext: Buffer.from('broken'), keyVersion: 'v1' }, analysisRefreshRequestedAt: null })
    await executor(repository).instance.execute(payload)
    expect(finished[0]).toMatchObject({ status: 'failed', errorClass: 'secret_unreadable' })
  })
})

describe('needsAnalysis', () => {
  it('uses the 14 day window after kickoff for complete analyses', () => {
    expect(needsAnalysis(complete('2026-10-07T12:00:00.000Z'), '', NOW, null)).toBe(true)
    expect(needsAnalysis(complete('2026-10-07T11:59:00.000Z'), '', NOW, null)).toBe(false)
    expect(needsAnalysis({ analysisStatus: 'unavailable', kickoffAt: '2026-01-01T00:00:00.000Z', fetchedAt: '2026-01-02T00:00:00.000Z', hasTracks: false }, '', NOW, null)).toBe(false)
    expect(needsAnalysis(undefined, '2026-01-01T00:00:00.000Z', NOW, null)).toBe(true)
  })

  it('refreshes only packages older than the request', () => {
    expect(needsAnalysis(complete('2026-01-01T00:00:00.000Z', true, '2026-01-02T00:00:00.000Z'), '', NOW, '2026-10-21T08:00:00.000Z')).toBe(true)
    expect(needsAnalysis(complete('2026-01-01T00:00:00.000Z', true, '2026-10-21T09:00:00.000Z'), '', NOW, '2026-10-21T08:00:00.000Z')).toBe(false)
  })
})

describe('failureMailText', () => {
  it('tells the coach that nothing is to do when Veo is down', () => {
    expect(failureMailText('U13', 'upstream_error', undefined).text).toContain('versucht es automatisch erneut')
    expect(failureMailText('U13', 'upstream_error', undefined).text).not.toContain('http')
  })
})
