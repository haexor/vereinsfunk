import { describe, expect, it } from 'vitest'
import { addDays, approvalDurationSecondsSamples, computeCountMetrics, computeCountMetricsSeries, computeFunnel, computeTrend, dayWindow, leadTimeSecondsSamples, median, rangeWindow } from './index.js'

describe('metrics (Paket 016)', () => {
  describe('dayWindow', () => {
    it('resolves midnight-to-midnight in the club timezone, not UTC', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      // CEST ist im August UTC+2 -- lokale Mitternacht liegt zwei Stunden vor UTC-Mitternacht.
      expect(window).toEqual({ startUtc: '2026-08-09T22:00:00.000Z', endUtc: '2026-08-10T22:00:00.000Z' })
    })

    it('accounts for the CET-to-CEST spring-forward transition -- the day has only 23 hours', () => {
      const window = dayWindow('2026-03-29', 'Europe/Berlin')
      expect(window).toEqual({ startUtc: '2026-03-28T23:00:00.000Z', endUtc: '2026-03-29T22:00:00.000Z' })
      const hours = (new Date(window.endUtc).getTime() - new Date(window.startUtc).getTime()) / 3_600_000
      expect(hours).toBe(23)
    })
  })

  describe('addDays', () => {
    it('rolls over into the next month', () => {
      expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    })

    it('rolls over into the next year', () => {
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    })
  })

  describe('rangeWindow', () => {
    it('spans from the start of the first day to the start of the (exclusive) end day', () => {
      expect(rangeWindow('2026-08-01', '2026-08-08', 'Europe/Berlin')).toEqual({
        startUtc: '2026-07-31T22:00:00.000Z',
        endUtc: '2026-08-07T22:00:00.000Z',
      })
    })
  })

  describe('median', () => {
    it('averages the two middle values for an even count', () => {
      expect(median([10, 30, 20, 40])).toBe(25)
    })

    it('returns the middle value for an odd count', () => {
      expect(median([5, 1, 3])).toBe(3)
    })

    it('returns null for an empty sample', () => {
      expect(median([])).toBeNull()
    })
  })

  describe('computeTrend', () => {
    it('returns null when there is no previous value (incomplete previous period)', () => {
      expect(computeTrend(10, null)).toBeNull()
    })

    it('returns null when the previous value is zero -- a percentage cannot be expressed', () => {
      expect(computeTrend(10, 0)).toBeNull()
    })

    it('computes a positive relative change', () => {
      expect(computeTrend(120, 100)).toBeCloseTo(0.2)
    })

    it('computes a negative relative change', () => {
      expect(computeTrend(80, 100)).toBeCloseTo(-0.2)
    })
  })

  describe('computeCountMetrics', () => {
    const window = dayWindow('2026-08-10', 'Europe/Berlin')
    const outsideWindow = '2026-08-01T10:00:00.000Z'
    const insideWindow = '2026-08-10T10:00:00.000Z'

    it('counts posts created in the window and ignores posts created outside it', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [{ id: 'p1', createdAt: insideWindow }, { id: 'p2', createdAt: outsideWindow }],
        publishedTransitions: [], approvalDecisions: [], publications: [], workflowRuns: [], postVersions: [],
      })
      expect(result.postsCreated).toBe(1)
    })

    it('counts a post as published only on the day of its FIRST published transition, not on a later re-publish', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [],
        publishedTransitions: [
          { postId: 'p1', occurredAt: insideWindow },
          { postId: 'p1', occurredAt: '2026-08-11T10:00:00.000Z' }, // erneut veroeffentlicht -- zaehlt nicht nochmal
        ],
        approvalDecisions: [], publications: [], workflowRuns: [], postVersions: [],
      })
      expect(result.postsPublished).toBe(1)
    })

    it('counts a single post published on two channels as one post but two publications', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [],
        publishedTransitions: [{ postId: 'p1', occurredAt: insideWindow }],
        approvalDecisions: [],
        publications: [
          { status: 'published', updatedAt: insideWindow },
          { status: 'published', updatedAt: insideWindow },
        ],
        workflowRuns: [], postVersions: [],
      })
      expect(result.postsPublished).toBe(1)
      expect(result.publicationsPublished).toBe(2)
    })

    it('counts approval decisions by type within the window', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [], publishedTransitions: [],
        approvalDecisions: [
          { decision: 'approved', createdAt: insideWindow },
          { decision: 'approved', createdAt: insideWindow },
          { decision: 'changes_requested', createdAt: insideWindow },
          { decision: 'rejected', createdAt: outsideWindow },
        ],
        publications: [], workflowRuns: [], postVersions: [],
      })
      expect(result.approvalsGranted).toBe(2)
      expect(result.approvalsChangesRequested).toBe(1)
      expect(result.approvalsRejected).toBe(0)
    })

    it('sums revisions (max version_number) only for posts published within the window, as sum+count not a pre-averaged mean', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [],
        publishedTransitions: [{ postId: 'p1', occurredAt: insideWindow }, { postId: 'p2', occurredAt: outsideWindow }],
        approvalDecisions: [], publications: [], workflowRuns: [],
        postVersions: [
          { postId: 'p1', versionNumber: 1 }, { postId: 'p1', versionNumber: 2 }, { postId: 'p1', versionNumber: 3 },
          { postId: 'p2', versionNumber: 1 }, { postId: 'p2', versionNumber: 5 },
        ],
      })
      // p2 wurde ausserhalb des Fensters veroeffentlicht und darf die Summe nicht beeinflussen.
      expect(result.revisionsSum).toBe(3)
      expect(result.revisionsCount).toBe(1)
    })

    it('counts workflow runs and failures within the window', () => {
      const result = computeCountMetrics({
        window,
        postsCreated: [], publishedTransitions: [], approvalDecisions: [], publications: [], postVersions: [],
        workflowRuns: [
          { technicalStatus: 'succeeded', updatedAt: insideWindow },
          { technicalStatus: 'failed', updatedAt: insideWindow },
          { technicalStatus: 'failed', updatedAt: outsideWindow },
        ],
      })
      expect(result.workflowRuns).toBe(2)
      expect(result.workflowFailures).toBe(1)
    })
  })

  // Ersetzt den bisherigen "einmal je Bucket computeCountMetrics() aufrufen"-Ansatz im API-Handler
  // (CodeRabbit-Fund zu PR #28: quadratisch bei vielen Buckets). Wichtigster Test: Aequivalenz zu
  // computeCountMetrics() pro Fenster einzeln aufgerufen -- die Bucket-Variante darf kein anderes
  // Ergebnis liefern, nur schneller rechnen.
  describe('computeCountMetricsSeries', () => {
    const windows = [dayWindow('2026-08-08', 'Europe/Berlin'), dayWindow('2026-08-09', 'Europe/Berlin'), dayWindow('2026-08-10', 'Europe/Berlin')]
    const input = {
      postsCreated: [
        { id: 'p1', createdAt: '2026-08-07T10:00:00.000Z' }, // vor dem ersten Fenster
        { id: 'p2', createdAt: '2026-08-08T10:00:00.000Z' },
        { id: 'p3', createdAt: '2026-08-09T10:00:00.000Z' },
        { id: 'p4', createdAt: '2026-08-09T12:00:00.000Z' },
        { id: 'p5', createdAt: '2026-08-11T10:00:00.000Z' }, // nach dem letzten Fenster
      ],
      publishedTransitions: [
        { postId: 'p2', occurredAt: '2026-08-08T11:00:00.000Z' },
        { postId: 'p2', occurredAt: '2026-08-10T11:00:00.000Z' }, // erneut veroeffentlicht -- zaehlt nicht nochmal
        { postId: 'p3', occurredAt: '2026-08-10T09:00:00.000Z' },
      ],
      approvalDecisions: [
        { decision: 'approved' as const, createdAt: '2026-08-08T09:00:00.000Z' },
        { decision: 'changes_requested' as const, createdAt: '2026-08-09T09:00:00.000Z' },
        { decision: 'rejected' as const, createdAt: '2026-08-10T09:00:00.000Z' },
        { decision: 'approved' as const, createdAt: '2026-08-07T09:00:00.000Z' },
      ],
      publications: [
        { status: 'published', updatedAt: '2026-08-08T10:00:00.000Z' },
        { status: 'published', updatedAt: '2026-08-08T10:30:00.000Z' },
        { status: 'failed', updatedAt: '2026-08-09T10:00:00.000Z' },
      ],
      workflowRuns: [
        { technicalStatus: 'succeeded', updatedAt: '2026-08-08T08:00:00.000Z' },
        { technicalStatus: 'failed', updatedAt: '2026-08-09T08:00:00.000Z' },
        { technicalStatus: 'failed', updatedAt: '2026-08-11T08:00:00.000Z' },
      ],
      postVersions: [
        { postId: 'p2', versionNumber: 1 }, { postId: 'p2', versionNumber: 2 },
        { postId: 'p3', versionNumber: 1 },
      ],
    }

    it('matches computeCountMetrics() called once per window', () => {
      const series = computeCountMetricsSeries(windows, input)
      const expected = windows.map((window) => computeCountMetrics({ window, ...input }))
      expect(series).toEqual(expected)
    })

    it('assigns each bucket its own counts, ignoring events outside the whole range', () => {
      const series = computeCountMetricsSeries(windows, input)
      expect(series.map((metrics) => metrics.postsCreated)).toEqual([1, 2, 0])
      expect(series.map((metrics) => metrics.postsPublished)).toEqual([1, 0, 1])
      expect(series.map((metrics) => metrics.revisionsSum)).toEqual([2, 0, 1])
    })

    it('returns an empty array for an empty window list', () => {
      expect(computeCountMetricsSeries([], input)).toEqual([])
    })

    it('throws when windows are not ascending and contiguous', () => {
      const gappy = [dayWindow('2026-08-08', 'Europe/Berlin'), dayWindow('2026-08-10', 'Europe/Berlin')]
      expect(() => computeCountMetricsSeries(gappy, input)).toThrow(/ascending and contiguous/)
    })
  })

  describe('leadTimeSecondsSamples', () => {
    it('computes the duration from post creation to the first published transition', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      const samples = leadTimeSecondsSamples(
        window,
        [{ id: 'p1', createdAt: '2026-08-09T10:00:00.000Z' }],
        [{ postId: 'p1', occurredAt: '2026-08-10T10:00:00.000Z' }],
      )
      expect(samples).toEqual([86_400])
    })

    it('ignores a post whose first published transition falls outside the window', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      const samples = leadTimeSecondsSamples(
        window,
        [{ id: 'p1', createdAt: '2026-08-01T10:00:00.000Z' }],
        [{ postId: 'p1', occurredAt: '2026-08-01T11:00:00.000Z' }],
      )
      expect(samples).toEqual([])
    })
  })

  describe('approvalDurationSecondsSamples', () => {
    it('pairs an awaiting_approval transition with the next resolution of the same post', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      const samples = approvalDurationSecondsSamples(window, [
        { postId: 'p1', toStatus: 'awaiting_approval', occurredAt: '2026-08-10T09:00:00.000Z' },
        { postId: 'p1', toStatus: 'approved', occurredAt: '2026-08-10T11:00:00.000Z' },
      ])
      expect(samples).toEqual([7_200])
    })

    it('opens a new pair after changes_requested -- a re-submitted post is measured again, not conflated with the first round', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      const samples = approvalDurationSecondsSamples(window, [
        { postId: 'p1', toStatus: 'awaiting_approval', occurredAt: '2026-08-09T09:00:00.000Z' },
        { postId: 'p1', toStatus: 'changes_requested', occurredAt: '2026-08-09T10:00:00.000Z' },
        { postId: 'p1', toStatus: 'awaiting_approval', occurredAt: '2026-08-10T09:00:00.000Z' },
        { postId: 'p1', toStatus: 'approved', occurredAt: '2026-08-10T10:00:00.000Z' },
      ])
      // nur das zweite Paar faellt in das Fenster vom 10.8.
      expect(samples).toEqual([3_600])
    })
  })

  describe('computeFunnel', () => {
    it('counts each stage once per post, at its first transition within the window', () => {
      const window = dayWindow('2026-08-10', 'Europe/Berlin')
      const posts = [{ id: 'p1', createdAt: '2026-08-10T08:00:00.000Z' }, { id: 'p2', createdAt: '2026-08-10T09:00:00.000Z' }]
      const transitions = [
        { postId: 'p1', toStatus: 'awaiting_approval', occurredAt: '2026-08-10T09:00:00.000Z' },
        { postId: 'p1', toStatus: 'approved', occurredAt: '2026-08-10T10:00:00.000Z' },
        { postId: 'p1', toStatus: 'scheduled', occurredAt: '2026-08-10T10:30:00.000Z' },
        { postId: 'p1', toStatus: 'published', occurredAt: '2026-08-10T11:00:00.000Z' },
      ]
      expect(computeFunnel(window, posts, transitions)).toEqual([
        { stage: 'draft', count: 2 },
        { stage: 'approval_requested', count: 1 },
        { stage: 'approved', count: 1 },
        { stage: 'scheduled', count: 1 },
        { stage: 'published', count: 1 },
      ])
    })
  })
})
