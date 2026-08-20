import { describe, expect, it } from 'vitest'
import { addDays } from './date'
import { buildPhaseIndex } from './cycle'
import type { CycleRecord, Entry, Scale, SleepQuality, Tag, TagCategory } from './models'
import { buildTagIndex } from './models'
import {
  buildInsights,
  computeOverview,
  computeTagLifts,
  entriesInRange,
  groupBySleep,
  pearson,
  tagFrequency,
} from './insights'

const categories: TagCategory[] = [{ id: 'cat-emotion', name: '정서', order: 0 }]
const tags: Tag[] = [
  { id: 't-irritable', name: '짜증', categoryId: 'cat-emotion', order: 0, archived: false },
  { id: 't-happy', name: '행복/만족', categoryId: 'cat-emotion', order: 1, archived: false },
]
const tagIndex = buildTagIndex(categories, tags)

function entry(date: string, patch: Partial<Entry> = {}): Entry {
  return { date, tagIds: [], memo: '', ...patch }
}

/** start부터 n일치 기록을 만듭니다. */
function series(start: string, n: number, make: (i: number, date: string) => Partial<Entry>): Entry[] {
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(start, i)
    return entry(date, make(i, date))
  })
}

const emptyPhaseIndex = buildPhaseIndex([], '2025-01-01', '2025-12-31', { predict: false })

describe('표본이 부족하면 인사이트를 내지 않습니다', () => {
  it('기록이 14일 미만이면 빈 배열입니다', () => {
    const entries = series('2025-01-01', 10, (i) => ({
      mood: ((i % 5) + 1) as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    expect(buildInsights({ entries, phaseIndex: emptyPhaseIndex, tagIndex, rangeStart: '2025-01-01', rangeEnd: '2025-01-10' })).toEqual([])
  })

  it('한쪽 그룹이 5개 미만이면 수면 비교를 하지 않습니다', () => {
    // good 18일, little 3일
    const entries = [
      ...series('2025-01-01', 18, () => ({ mood: 5 as Scale, sleep: 'good' as SleepQuality })),
      ...series('2025-01-19', 3, () => ({ mood: 1 as Scale, sleep: 'little' as SleepQuality })),
    ]
    const cards = buildInsights({ entries, phaseIndex: emptyPhaseIndex, tagIndex, rangeStart: '2025-01-01', rangeEnd: '2025-01-21' })
    expect(cards.find((c) => c.kind === 'sleep')).toBeUndefined()
  })
})

describe('수면 × 기분', () => {
  it('차이가 뚜렷하면 카드를 냅니다', () => {
    const entries = [
      ...series('2025-01-01', 10, () => ({ mood: 4 as Scale, energy: 4 as Scale, sleep: 'good' as SleepQuality })),
      ...series('2025-01-11', 10, () => ({ mood: 2 as Scale, energy: 2 as Scale, sleep: 'little' as SleepQuality })),
    ]
    const cards = buildInsights({ entries, phaseIndex: emptyPhaseIndex, tagIndex, rangeStart: '2025-01-01', rangeEnd: '2025-01-20' })
    const sleepCard = cards.find((c) => c.id === 'sleep-moodAvg')
    expect(sleepCard).toBeDefined()
    expect(sleepCard?.strength).toBe('strong')
    expect(sleepCard?.body).toContain('잘 잠 4점')
    expect(sleepCard?.body).toContain('적게 잠 2점')
  })

  it('차이가 0.5점 미만이면 카드를 내지 않습니다', () => {
    const entries = [
      ...series('2025-01-01', 10, () => ({ mood: 3 as Scale, sleep: 'good' as SleepQuality })),
      ...series('2025-01-11', 10, (i) => ({ mood: (i < 3 ? 3 : 3) as Scale, sleep: 'little' as SleepQuality })),
    ]
    const cards = buildInsights({ entries, phaseIndex: emptyPhaseIndex, tagIndex, rangeStart: '2025-01-01', rangeEnd: '2025-01-20' })
    expect(cards.find((c) => c.kind === 'sleep')).toBeUndefined()
  })

  it('groupBySleep은 세 그룹을 모두 돌려줍니다', () => {
    const groups = groupBySleep(series('2025-01-01', 6, () => ({ sleep: 'good' as SleepQuality, mood: 3 as Scale })))
    expect(groups).toHaveLength(3)
    expect(groups.find((g) => g.key === 'good')?.count).toBe(6)
    expect(groups.find((g) => g.key === 'little')?.count).toBe(0)
  })
})

describe('주기 단계 × 태그', () => {
  const cycles: CycleRecord[] = [
    { id: 'c1', startDate: '2025-01-06', endDate: '2025-01-10' },
    { id: 'c2', startDate: '2025-02-03', endDate: '2025-02-07' },
    { id: 'c3', startDate: '2025-03-03', endDate: '2025-03-07' },
  ]
  const phaseIndex = buildPhaseIndex(cycles, '2025-01-01', '2025-03-10', {
    predict: false,
    today: '2025-03-10',
  })

  it('생리전 구간에 몰린 태그를 찾습니다', () => {
    const entries = series('2025-01-01', 69, (_, date) => {
      const phase = phaseIndex.get(date)?.phase
      return {
        mood: 3 as Scale,
        tagIds: phase === 'premenstrual' ? ['t-irritable'] : [],
      }
    })
    const lifts = computeTagLifts(entries, phaseIndex, tagIndex)
    const irritable = lifts.find((l) => l.tagId === 't-irritable' && l.phase === 'premenstrual')
    expect(irritable).toBeDefined()
    expect(irritable!.lift).toBeGreaterThan(2)
    expect(irritable!.inPhaseCount).toBe(15) // 3주기 × 5일
  })

  it('전 구간에 고르게 나오는 태그는 배수가 낮아 걸러집니다', () => {
    const entries = series('2025-01-01', 69, () => ({ mood: 3 as Scale, tagIds: ['t-happy'] }))
    const lifts = computeTagLifts(entries, phaseIndex, tagIndex)
    expect(lifts.find((l) => l.tagId === 't-happy')).toBeUndefined()
  })

  it('출현 횟수가 4회 미만이면 무시합니다', () => {
    const entries = series('2025-01-01', 69, (i) => ({
      mood: 3 as Scale,
      tagIds: i === 5 ? ['t-irritable'] : [],
    }))
    expect(computeTagLifts(entries, phaseIndex, tagIndex)).toEqual([])
  })
})

describe('tagFrequency', () => {
  it('빈도순으로 정렬합니다', () => {
    const entries = [
      ...series('2025-01-01', 5, () => ({ tagIds: ['t-irritable'] })),
      ...series('2025-01-06', 2, () => ({ tagIds: ['t-happy'] })),
    ]
    const freq = tagFrequency(entries, tagIndex)
    expect(freq[0]).toMatchObject({ tagId: 't-irritable', count: 5, name: '짜증' })
    expect(freq[1]).toMatchObject({ tagId: 't-happy', count: 2 })
  })

  it('v3 이름 기반 태그도 해석합니다', () => {
    const entries = [entry('2025-01-01', { legacyTags: ['짜증'] })]
    expect(tagFrequency(entries, tagIndex)[0]).toMatchObject({ tagId: 't-irritable', count: 1 })
  })

  it('tagIds가 있으면 legacyTags는 무시합니다', () => {
    const entries = [entry('2025-01-01', { tagIds: ['t-happy'], legacyTags: ['짜증'] })]
    const freq = tagFrequency(entries, tagIndex)
    expect(freq).toHaveLength(1)
    expect(freq[0]?.tagId).toBe('t-happy')
  })
})

describe('computeOverview', () => {
  it('커버리지와 연속 기록일을 계산합니다', () => {
    const entries = series('2025-01-01', 5, () => ({ mood: 4 as Scale }))
    const overview = computeOverview(entries, '2025-01-01', '2025-01-10', '2025-01-05')
    expect(overview.totalDays).toBe(10)
    expect(overview.loggedDays).toBe(5)
    expect(overview.coverage).toBe(0.5)
    expect(overview.currentStreak).toBe(5)
    expect(overview.longestStreak).toBe(5)
    expect(overview.moodAvg).toBe(4)
  })

  it('오늘 기록이 없어도 어제까지 이어졌으면 연속으로 봅니다', () => {
    const entries = series('2025-01-01', 3, () => ({ mood: 3 as Scale }))
    expect(computeOverview(entries, '2025-01-01', '2025-01-04', '2025-01-04').currentStreak).toBe(3)
  })

  it('연속이 끊기면 현재 연속은 0입니다', () => {
    const entries = series('2025-01-01', 3, () => ({ mood: 3 as Scale }))
    expect(computeOverview(entries, '2025-01-01', '2025-01-10', '2025-01-10').currentStreak).toBe(0)
  })

  it('가장 긴 연속 구간을 찾습니다', () => {
    const entries = [
      ...series('2025-01-01', 2, () => ({ mood: 3 as Scale })),
      ...series('2025-01-05', 4, () => ({ mood: 3 as Scale })),
    ]
    expect(computeOverview(entries, '2025-01-01', '2025-01-10', '2025-01-10').longestStreak).toBe(4)
  })

  it('혼재 상태 비율을 계산합니다', () => {
    const entries = [
      ...series('2025-01-01', 3, () => ({ mood: 5 as Scale, energy: 1 as Scale })),
      ...series('2025-01-04', 1, () => ({ mood: 3 as Scale, energy: 3 as Scale })),
    ]
    const overview = computeOverview(entries, '2025-01-01', '2025-01-04', '2025-01-04')
    expect(overview.mixedDays).toBe(3)
    expect(overview.mixedRate).toBe(0.75)
  })

  it('빈 입력에서 터지지 않습니다', () => {
    const overview = computeOverview([], '2025-01-01', '2025-01-10', '2025-01-10')
    expect(overview.loggedDays).toBe(0)
    expect(overview.coverage).toBe(0)
    expect(overview.moodAvg).toBeNull()
    expect(overview.currentStreak).toBe(0)
  })
})

describe('pearson', () => {
  it('완전 양의 상관은 1입니다', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i)
    expect(pearson(xs, xs)).toBeCloseTo(1, 6)
  })

  it('완전 음의 상관은 -1입니다', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i)
    expect(pearson(xs, xs.map((v) => -v))).toBeCloseTo(-1, 6)
  })

  it('표본이 부족하면 null입니다', () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeNull()
  })

  it('분산이 0이면 null입니다', () => {
    const xs = Array.from({ length: 20 }, () => 3)
    const ys = Array.from({ length: 20 }, (_, i) => i)
    expect(pearson(xs, ys)).toBeNull()
  })
})

describe('entriesInRange', () => {
  it('구간 안의 기록만 날짜순으로 냅니다', () => {
    const map = {
      '2025-01-01': entry('2025-01-01'),
      '2025-01-05': entry('2025-01-05'),
      '2025-02-01': entry('2025-02-01'),
    }
    expect(entriesInRange(map, '2025-01-01', '2025-01-31').map((e) => e.date)).toEqual([
      '2025-01-01',
      '2025-01-05',
    ])
  })
})
