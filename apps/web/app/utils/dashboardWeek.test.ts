import { describe, expect, it } from 'vitest'
import { buildDashboardWeek } from './dashboardWeek'

describe('buildDashboardWeek', () => {
  it('spans Monday to Sunday of the current week in the club timezone', () => {
    // Sonntag 23:30 UTC ist in Berlin bereits Montag: die Woche beginnt dann an diesem Montag.
    const days = buildDashboardWeek('Europe/Berlin', [], new Date('2026-10-18T23:30:00Z'))

    expect(days.map((day) => day.key)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ])
    expect(days.map((day) => day.label)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])
    expect(days.filter((day) => day.isToday).map((day) => day.key)).toEqual(['2026-10-19'])
  })

  it('places scheduled posts on their local day and skips unscheduled or other weeks', () => {
    const days = buildDashboardWeek('Europe/Berlin', [
      { id: 'late-evening', scheduled_for: '2026-10-20T22:30:00Z' },
      { id: 'unscheduled', scheduled_for: null },
      { id: 'next-week', scheduled_for: '2026-10-27T10:00:00Z' },
    ], new Date('2026-10-20T08:00:00Z'))

    expect(days.find((day) => day.key === '2026-10-21')?.posts).toEqual([{ id: 'late-evening' }])
    expect(days.flatMap((day) => day.posts)).toHaveLength(1)
  })
})
