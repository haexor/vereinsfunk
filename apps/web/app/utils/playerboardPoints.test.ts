import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPointSaveQueue, parsePointInput, pointKey, stepPoint, type PointKey, type PointSaveState } from './playerboardPoints'

describe('stepPoint', () => {
  it('starts an empty cell at zero so the first plus gives one', () => {
    expect(stepPoint(null, 1, 0, 10)).toBe(1)
    expect(stepPoint(null, -1, 0, 10)).toBe(0)
  })

  it('starts at the nearest bound when zero is out of range', () => {
    expect(stepPoint(null, 1, 3, 10)).toBe(4)
    expect(stepPoint(null, -1, -10, -2)).toBe(-3)
  })

  it('stays inside the category range', () => {
    expect(stepPoint(10, 1, 0, 10)).toBe(10)
    expect(stepPoint(0, -1, 0, 10)).toBe(0)
  })
})

describe('parsePointInput', () => {
  it('treats an empty field as delete', () => {
    expect(parsePointInput(' ', 0, 5)).toEqual({ ok: true, value: null })
  })

  it('accepts whole numbers in range only', () => {
    expect(parsePointInput('4', 0, 5)).toEqual({ ok: true, value: 4 })
    expect(parsePointInput('6', 0, 5)).toEqual({ ok: false })
    expect(parsePointInput('2.5', 0, 5)).toEqual({ ok: false })
    expect(parsePointInput('-1', -3, 3)).toEqual({ ok: true, value: -1 })
  })
})

describe('createPointSaveQueue', () => {
  const a = pointKey('player-a', 'category')
  const b = pointKey('player-b', 'category')
  let values: Map<PointKey, number | null>
  let states: PointSaveState[]

  beforeEach(() => {
    vi.useFakeTimers()
    values = new Map([[a, 1], [b, 2]])
    states = []
  })
  afterEach(() => { vi.useRealTimers() })

  /** Erstellt eine Testwarteschlange mit den Zellwerten, Zustandsprotokoll und 500 ms Wartezeit. */
  function queue(save: (entries: { key: PointKey; value: number | null }[]) => Promise<void>) {
    return createPointSaveQueue({ read: (key) => values.get(key) ?? null, save, onState: (state) => states.push(state), delayMs: 500 })
  }

  it('batches changes within the delay into one save', async () => {
    const save = vi.fn(async () => {})
    const subject = queue(save)
    subject.change(a)
    subject.change(b)
    await vi.advanceTimersByTimeAsync(499)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith([{ key: a, value: 1 }, { key: b, value: 2 }])
    expect(states.at(-1)).toBe('saved')
  })

  it('sends changes made during a running save in a follow-up save', async () => {
    let release: () => void = () => {}
    const save = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const subject = queue(save)
    subject.change(a)
    const first = subject.flush()
    values.set(b, 5)
    subject.change(b)
    const second = subject.flush()
    release()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    release()
    await Promise.all([first, second])
    expect(save).toHaveBeenNthCalledWith(2, [{ key: b, value: 5 }])
    expect(subject.hasUnsaved()).toBe(false)
  })

  it('keeps failed cells unsaved and retries them with the next save', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const subject = queue(save)
    subject.change(a)
    await subject.flush()
    expect(states.at(-1)).toBe('error')
    expect(subject.hasUnsaved()).toBe(true)
    subject.change(b)
    await subject.flush()
    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([{ key: a, value: 1 }, { key: b, value: 2 }]))
    expect(states.at(-1)).toBe('saved')
  })
})
