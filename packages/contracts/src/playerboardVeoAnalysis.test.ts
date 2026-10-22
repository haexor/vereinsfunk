import { describe, expect, it } from 'vitest'
import {
  PlayerboardVeoAnalysisWriteSchema,
  PlayerboardVeoMatchAnalysisSchema,
  PlayerboardVeoMatchTracksSchema,
  PlayerboardVeoPlayerHeatmapsQuerySchema,
  PlayerboardVeoPlayerSeasonMatchSchema,
  PlayerboardVeoSeasonMatchSchema,
  PlayerboardVeoSeasonQuerySchema,
  PlayerboardVeoTeamViewsSchema,
} from './playerboardVeoAnalysis.js'

const bytes = (...values: number[]) => btoa(String.fromCharCode(...values))

const valid = {
  veoMatchSlug: 'c1-vs-gegner',
  status: 'complete',
  analyticsVersion: '2',
  periods: [{ number: 1, startS: 605, endS: 2573, ownSide: 'left', confirmed: false }],
  availability: { events: { status: 'available' }, report: { status: 'unavailable', reason: 'not_provided' } },
  passPossession: [{
    periodNumber: 1, durationS: 1968,
    own: { possessionSeconds: 483.5, passesCompleted: 101, possessionWon: 67, passStrings: [[3, 10]], passThirds: { defensive: 10, middle: 40, attacking: 51 }, possessionThirds: { defensive: 1449, middle: 5515, attacking: 7524 } },
    opponent: { possessionSeconds: 192.8, passesCompleted: 59, possessionWon: 54, passStrings: [], passThirds: { defensive: 30, middle: 20, attacking: 9 }, possessionThirds: { defensive: 4338, middle: 1410, attacking: 29 } },
  }],
  momentum: [[20, 0.58], [30, null]],
  passingNetwork: [{ periodNumber: 0, nodes: [{ jerseyNumber: 7, x: 0.5, y: 0.4, passesMade: 12, passesReceived: 9 }], edges: [{ fromJersey: 7, toJersey: 9, completedPasses: 4 }] }],
  report: { view: 'advanced' },
  events: [
    { veoEventId: 'e1', teamAssociation: 'own', eventType: 'pass', jerseyNumber: 7, periodNumber: 1, periodTimeMs: 1000, videoTimeMs: 606000, x: 0.4, y: 0.5, endX: 0.6, endY: 0.1, outcome: 1, receiverJerseyNumber: 9, assistJerseyNumber: null },
    { veoEventId: 'e2', teamAssociation: 'opponent', eventType: 'FootballShot', jerseyNumber: null, periodNumber: 1, periodTimeMs: 2000, videoTimeMs: 607000, x: null, y: null, endX: null, endY: null, outcome: null, receiverJerseyNumber: null, assistJerseyNumber: null },
  ],
  heatmaps: [{ jerseyNumber: 7, periodNumber: 0, width: 2, height: 1, cells: bytes(0, 255), averageX: 0.6, averageY: 0.5, secondsPlayed: 3900 }],
  tracks: [{ veoTrackId: 3, side: 'left', goalkeeper: false, jerseyNumber: 7, startS: 605, samples: bytes(0, 1, 0, 2) }],
}

describe('PlayerboardVeoAnalysisWriteSchema', () => {
  it('accepts a complete analysis package and one without tracks', () => {
    expect(PlayerboardVeoAnalysisWriteSchema.parse(valid).events).toHaveLength(2)
    expect(PlayerboardVeoAnalysisWriteSchema.parse({ ...valid, tracks: null }).tracks).toBeNull()
  })

  it('rejects locations outside the pitch or with only one coordinate', () => {
    const [pass] = valid.events
    expect(PlayerboardVeoAnalysisWriteSchema.safeParse({ ...valid, events: [{ ...pass, x: 1.04 }] }).success).toBe(false)
    expect(PlayerboardVeoAnalysisWriteSchema.safeParse({ ...valid, events: [{ ...pass, y: null }] }).success).toBe(false)
    expect(PlayerboardVeoAnalysisWriteSchema.safeParse({ ...valid, events: [{ ...pass, periodNumber: 0 }] }).success).toBe(false)
  })

  it('rejects unknown parts and reasons in the availability', () => {
    expect(PlayerboardVeoAnalysisWriteSchema.safeParse({ ...valid, availability: { video: { status: 'available' } } }).success).toBe(false)
    expect(PlayerboardVeoAnalysisWriteSchema.safeParse({ ...valid, availability: { events: { status: 'unavailable', reason: 'not_paid' } } }).success).toBe(false)
  })

  it('rejects heatmap cells that do not fit the size and samples that are not x/y pairs', () => {
    const [heatmap] = valid.heatmaps
    const [track] = valid.tracks
    expect(PlayerboardVeoAnalysisWriteSchema.safeParse({ ...valid, heatmaps: [{ ...heatmap, width: 3 }] }).success).toBe(false)
    expect(PlayerboardVeoAnalysisWriteSchema.safeParse({ ...valid, heatmaps: [{ ...heatmap, cells: '%%%' }] }).success).toBe(false)
    expect(PlayerboardVeoAnalysisWriteSchema.safeParse({ ...valid, tracks: [{ ...track, samples: bytes(1, 2, 3) }] }).success).toBe(false)
  })

  it('rejects extra fields so nothing unchecked reaches the database', () => {
    expect(PlayerboardVeoAnalysisWriteSchema.safeParse({ ...valid, players: [] }).success).toBe(false)
  })
})

describe('PlayerboardVeoMatchAnalysisSchema', () => {
  const analysis = {
    fixtureId: '57000000-1000-4000-8000-000000000001', kickoffAt: '2026-09-23T14:54:40+00:00', opponentName: 'Gegner', isHome: true,
    ownScore: 7, opponentScore: 5, veoUrl: 'https://app.veo.co/matches/c1-vs-gegner/', analysisStatus: 'complete', analyticsVersion: '2',
    periods: valid.periods, availability: valid.availability,
    teamStats: [{ teamAssociation: 'own', statType: 'football_goal_total', category: 'attacking', value: 7, periodValues: [{ period: 1, value: 3 }] }],
    players: [{ jerseyNumber: 7, playerId: null, personId: null, name: null, matchedManually: false, stats: [] }],
    events: valid.events.map(({ veoEventId, ...event }) => ({ ...event, id: veoEventId, playerId: null })),
    heatmaps: valid.heatmaps.map((heatmap) => ({ jerseyNumber: heatmap.jerseyNumber, periodNumber: heatmap.periodNumber, width: heatmap.width, height: heatmap.height, cells: heatmap.cells, averageX: heatmap.averageX, averageY: heatmap.averageY })),
    passPossession: valid.passPossession, momentum: valid.momentum, passingNetwork: valid.passingNetwork,
    hasReport: true, hasTracking: false,
  }

  it('accepts what the read function returns, also before any analysis was fetched', () => {
    expect(PlayerboardVeoMatchAnalysisSchema.parse(analysis).events).toHaveLength(2)
    expect(PlayerboardVeoMatchAnalysisSchema.parse({
      ...analysis, veoUrl: null, analysisStatus: 'none', analyticsVersion: null, periods: [], availability: {},
      events: [], heatmaps: [], passPossession: null, momentum: null, passingNetwork: null, hasReport: false,
    }).analyticsVersion).toBeNull()
  })

  it('rejects an event location outside the pitch', () => {
    const [event] = analysis.events
    expect(PlayerboardVeoMatchAnalysisSchema.safeParse({ ...analysis, events: [{ ...event, y: -0.1 }] }).success).toBe(false)
  })

  it('accepts tracks only as x/y pairs at one sample per second', () => {
    const tracks = { sampleHz: 1, periods: valid.periods, tracks: valid.tracks }
    expect(PlayerboardVeoMatchTracksSchema.parse(tracks).tracks).toHaveLength(1)
    expect(PlayerboardVeoMatchTracksSchema.safeParse({ ...tracks, sampleHz: 2.5 }).success).toBe(false)
  })
})

describe('Veo Analytics season contracts', () => {
  it('reads comma separated filters from the query and rejects unknown kinds', () => {
    expect(PlayerboardVeoSeasonQuerySchema.parse({ kinds: 'match,cup', last: '10' })).toEqual({ kinds: ['match', 'cup'], last: 10 })
    expect(PlayerboardVeoSeasonQuerySchema.parse({ fixtureIds: '57000000-1000-4000-8000-000000000001' }).fixtureIds).toHaveLength(1)
    expect(PlayerboardVeoSeasonQuerySchema.safeParse({ kinds: 'training' }).success).toBe(false)
    expect(PlayerboardVeoSeasonQuerySchema.safeParse({ last: '0' }).success).toBe(false)
    expect(PlayerboardVeoSeasonQuerySchema.safeParse({ team: 'x' }).success).toBe(false)
  })

  it('accepts a season match with its shots and nothing but shots and goals', () => {
    const match = {
      fixtureId: '57000000-1000-4000-8000-000000000001', kickoffAt: '2026-09-05T10:00:00+00:00', kind: 'match', opponentName: 'Gegner', isHome: true,
      ownScore: 2, opponentScore: 1, veoUrl: null, analysisStatus: 'complete', analyticsVersion: '2', periods: valid.periods, availability: {},
      teamStats: [], passPossession: null,
      shots: [{ id: 's1', teamAssociation: 'own', eventType: 'FootballShot', jerseyNumber: 7, playerId: null, periodNumber: 1, periodTimeMs: 0, videoTimeMs: 0, x: 0.9, y: 0.5, assistJerseyNumber: null }],
    }
    expect(PlayerboardVeoSeasonMatchSchema.parse(match).shots).toHaveLength(1)
    expect(PlayerboardVeoSeasonMatchSchema.safeParse({ ...match, shots: [{ ...match.shots[0], eventType: 'pass' }] }).success).toBe(false)
  })

  it('allows up to four unique key metrics and a radar with exactly six', () => {
    const radar = { metrics: ['goals_scored', 'shots_on_goal', 'shots_to_goal_conversion_rate', 'win_ratio', 'passes_completed', 'possession_percent'], comparingTeamId: null, ownRange: ['2026-09-01', '2026-09-30'], comparingRange: ['2026-08-01', '2026-08-31'] }
    expect(PlayerboardVeoTeamViewsSchema.parse({ keyMetrics: [], radar: null }).keyMetrics).toEqual([])
    expect(PlayerboardVeoTeamViewsSchema.parse({ keyMetrics: ['goals_scored'], radar }).radar?.metrics).toHaveLength(6)
    expect(PlayerboardVeoTeamViewsSchema.safeParse({ keyMetrics: ['goals_scored', 'goals_conceded', 'foul', 'saves', 'duels'], radar: null }).success).toBe(false)
    expect(PlayerboardVeoTeamViewsSchema.safeParse({ keyMetrics: ['goals_scored', 'goals_scored'], radar: null }).success).toBe(false)
    expect(PlayerboardVeoTeamViewsSchema.safeParse({ keyMetrics: [], radar: { ...radar, metrics: radar.metrics.slice(0, 5) } }).success).toBe(false)
    expect(PlayerboardVeoTeamViewsSchema.safeParse({ keyMetrics: [], radar: { ...radar, ownRange: ['2026-09-30', '2026-09-01'] } }).success).toBe(false)
    expect(PlayerboardVeoTeamViewsSchema.safeParse({ keyMetrics: ['expected_goals'], radar: null }).success).toBe(false)
  })
})

describe('Veo Analytics player contracts', () => {
  it('accepts the values of every jersey per match as a map', () => {
    const match = {
      fixtureId: '57000000-1000-4000-8000-000000000001', kickoffAt: '2026-09-05T10:00:00+00:00', opponentName: null, ownScore: null, opponentScore: null, analyticsVersion: null,
      players: [{ jerseyNumber: 7, playerId: null, personId: null, name: null, stats: { football_goal_total: 2, top_speed_kmh: 27.4 } }],
    }
    expect(PlayerboardVeoPlayerSeasonMatchSchema.parse(match).players[0]?.stats.top_speed_kmh).toBe(27.4)
    expect(PlayerboardVeoPlayerSeasonMatchSchema.safeParse({ ...match, players: [{ ...match.players[0], stats: { football_goal_total: '2' } }] }).success).toBe(false)
  })

  it('asks the heatmaps of either a player or a bare jersey with the season filters', () => {
    expect(PlayerboardVeoPlayerHeatmapsQuerySchema.parse({ jerseyNumber: '12', last: '5' })).toEqual({ jerseyNumber: 12, last: 5 })
    expect(PlayerboardVeoPlayerHeatmapsQuerySchema.parse({ playerId: '57000000-1000-4000-8000-000000000001' }).playerId).toBeDefined()
    expect(PlayerboardVeoPlayerHeatmapsQuerySchema.safeParse({}).success).toBe(false)
    expect(PlayerboardVeoPlayerHeatmapsQuerySchema.safeParse({ playerId: '57000000-1000-4000-8000-000000000001', jerseyNumber: '7' }).success).toBe(false)
  })
})
