import { describe, expect, it } from 'vitest'
import { PlayerboardVeoAnalysisWriteSchema } from './playerboardVeoAnalysis.js'

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
