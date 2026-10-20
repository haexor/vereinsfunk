import { localDateKey } from './memberDates'

export interface DashboardWeekDay {
  key: string
  label: string
  dayNumber: number
  isToday: boolean
  posts: { id: string }[]
}

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

// Die laufende Woche (Montag bis Sonntag) in der Zeitzone des Vereins mit den an jedem Tag
// eingeplanten Beitraegen. Tage sind Kalendertage dieser Zeitzone, nicht der des Browsers.
export function buildDashboardWeek(
  timeZone: string,
  posts: readonly { id: string; scheduled_for: string | null }[],
  now: Date = new Date(),
): DashboardWeekDay[] {
  const todayKey = localDateKey(now, timeZone)
  const monday = new Date(`${todayKey}T00:00:00Z`)
  const weekday = monday.getUTCDay()
  monday.setUTCDate(monday.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday))

  const days: DashboardWeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday)
    day.setUTCDate(day.getUTCDate() + index)
    const key = localDateKey(day, 'UTC')
    return {
      key,
      label: WEEKDAY_LABELS[index] ?? '',
      dayNumber: day.getUTCDate(),
      isToday: key === todayKey,
      posts: [],
    }
  })
  for (const post of posts) {
    if (!post.scheduled_for) continue
    const key = localDateKey(new Date(post.scheduled_for), timeZone)
    days.find((day) => day.key === key)?.posts.push({ id: post.id })
  }
  return days
}
