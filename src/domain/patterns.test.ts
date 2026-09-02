import { describe, expect, it } from 'vitest'
import { addDays } from './date'
import { buildPhaseIndex } from './cycle'
import { buildTagIndex, type CycleRecord, type Entry, type Scale, type SleepQuality, type Tag, type TagCategory } from './models'
import {
  DEFAULT_WINDOW_DAYS,
  MIN_TOTAL,
  STABLE_TOTAL,
  assessReadiness,
  buildPatterns,
  headlinePattern,
  sectionPatterns,
  visiblePatterns,
} from './patterns'

const TODAY = '2026-09-02'

const categories: TagCategory[] = [{ id: 'cat', name: '정서', order: 0 }]
const tags: Tag[] = [
  { id: 't-head', name: '두통', categoryId: 'cat', order: 0, archived: false },
  { id: 't-calm', name: '평온', categoryId: 'cat', order: 1, archived: false },
]
const tagIndex = buildTagIndex(categories, tags)
const emptyPhases = buildPhaseIndex([], '2000-01-01', '2030-01-01', { predict: false })

function entry(date: string, patch: Partial<Entry> = {}): Entry {
  return { date, tagIds: [], memo: '', ...patch }
}

/** endOffset일 전부터 count일치를 만듭니다(0 = 오늘). */
function days(count: number, endOffset: number, make: (i: number) => Partial<Entry>): Entry[] {
  return Array.from({ length: count }, (_, i) =>
    entry(addDays(TODAY, -(endOffset + count - 1 - i)), make(i)),
  )
}

function toMap(entries: Entry[]): Record<string, Entry> {
  return Object.fromEntries(entries.map((e) => [e.date, e]))
}

function run(entries: Entry[], phaseIndex = emptyPhases) {
  return buildPatterns({ entries: toMap(entries), phaseIndex, tagIndex, today: TODAY })
}

describe('표본이 부족하면 패턴이라고 말하지 않습니다', () => {
  it('기록이 거의 없으면 판단 가능한 패턴이 없습니다', () => {
    const entries = days(6, 0, (i) => ({
      mood: ((i % 5) + 1) as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    expect(visiblePatterns(run(entries))).toHaveLength(0)
  })

  it('한쪽 그룹이 5일 미만이면 데이터 부족으로 둡니다', () => {
    const entries = [
      ...days(20, 4, () => ({ mood: 5 as Scale, sleep: 'good' as SleepQuality })),
      ...days(4, 0, () => ({ mood: 1 as Scale, sleep: 'little' as SleepQuality })),
    ]
    const sleepMood = run(entries).find((p) => p.id === 'sleep-mood')
    expect(sleepMood?.status).toBe('insufficient')
    expect(sleepMood?.needed).toBeGreaterThan(0)
  })

  it('데이터 부족이면 몇 건이 더 필요한지 알려줍니다', () => {
    const entries = days(10, 0, (i) => ({
      mood: 3 as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    const sleepMood = run(entries).find((p) => p.id === 'sleep-mood')
    expect(sleepMood?.status).toBe('insufficient')
    expect(sleepMood?.needed).toBe(MIN_TOTAL - 10)
  })
})

describe('상태 판정', () => {
  it('차이는 크지만 표본이 적으면 신호에 머무릅니다', () => {
    const entries = [
      ...days(10, 8, () => ({ mood: 4 as Scale, sleep: 'good' as SleepQuality })),
      ...days(8, 0, () => ({ mood: 2 as Scale, sleep: 'little' as SleepQuality })),
    ]
    const sleepMood = run(entries).find((p) => p.id === 'sleep-mood')
    expect(sleepMood?.status).toBe('signal')
    expect(sleepMood?.needed).toBeGreaterThan(0)
  })

  it('표본과 차이가 모두 충분하면 반복되는 패턴입니다', () => {
    const entries = [
      ...days(24, 24, () => ({ mood: 4 as Scale, sleep: 'good' as SleepQuality })),
      ...days(24, 0, () => ({ mood: 2 as Scale, sleep: 'little' as SleepQuality })),
    ]
    const sleepMood = run(entries).find((p) => p.id === 'sleep-mood')
    expect(sleepMood?.status).toBe('stable')
    expect(sleepMood?.needed).toBeNull()
    expect(sleepMood?.title).toContain('잘 잠')
  })

  it('충분히 봤는데 차이가 없으면 관계 없음이라고 말합니다', () => {
    const entries = days(50, 0, (i) => ({
      mood: 3 as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    const sleepMood = run(entries).find((p) => p.id === 'sleep-mood')
    expect(sleepMood?.status).toBe('none')
    expect(sleepMood?.title).toContain('뚜렷한 차이가 없습니다')
    // '없음'은 발견으로 보여주지 않습니다.
    expect(visiblePatterns(run(entries)).some((p) => p.id === 'sleep-mood')).toBe(false)
  })
})

describe('변화 감지 — 직전 같은 길이의 창과 비교합니다', () => {
  /** 최근 창에만 신호가 있고 이전 창은 평평한 데이터. */
  function emergingData(): Entry[] {
    const previous = days(DEFAULT_WINDOW_DAYS, DEFAULT_WINDOW_DAYS, (i) => ({
      mood: 3 as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    const recent = days(DEFAULT_WINDOW_DAYS, 0, (i) => ({
      mood: (i % 2 === 0 ? 5 : 1) as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    return [...previous, ...recent]
  }

  it('이전 기간에 없던 관계는 새로 발견됨입니다', () => {
    const sleepMood = run(emergingData()).find((p) => p.id === 'sleep-mood')
    expect(sleepMood?.status).toBe('stable')
    expect(sleepMood?.change).toBe('new')
  })

  it('이전에도 지금도 같은 세기면 계속 보이는 중입니다', () => {
    const entries = days(DEFAULT_WINDOW_DAYS * 2, 0, (i) => ({
      mood: (i % 2 === 0 ? 5 : 1) as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    expect(run(entries).find((p) => p.id === 'sleep-mood')?.change).toBe('steady')
  })

  it('이전에 보이던 관계가 사라지면 최근에는 보이지 않음입니다', () => {
    const previous = days(DEFAULT_WINDOW_DAYS, DEFAULT_WINDOW_DAYS, (i) => ({
      mood: (i % 2 === 0 ? 5 : 1) as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    const recent = days(DEFAULT_WINDOW_DAYS, 0, (i) => ({
      mood: 3 as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    expect(run([...previous, ...recent]).find((p) => p.id === 'sleep-mood')?.change).toBe('faded')
  })

  it('과거 창이 아예 없는 신규 사용자에게는 새로 발견됨으로 보여줍니다', () => {
    // 최근 창에만 데이터가 있고 이전 창은 비어 있습니다.
    // 이 사용자에게는 실제로 처음 보는 관계이므로 '새로 발견됨'이 맞습니다.
    const entries = days(30, 0, (i) => ({
      mood: (i % 2 === 0 ? 5 : 1) as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    const sleepMood = run(entries).find((p) => p.id === 'sleep-mood')
    // 30일은 반복되는 패턴이라 부르기엔 아직 부족합니다.
    expect(sleepMood?.status).toBe('signal')
    expect(sleepMood?.change).toBe('new')
  })

  it('이전 창에 그 관계를 볼 데이터가 없었다면 변화를 단정하지 않습니다', () => {
    // 이전 창에는 기록이 있지만 수면을 남기지 않아 비교가 불가능합니다.
    const previous = days(DEFAULT_WINDOW_DAYS, DEFAULT_WINDOW_DAYS, () => ({ mood: 3 as Scale }))
    const recent = days(DEFAULT_WINDOW_DAYS, 0, (i) => ({
      mood: (i % 2 === 0 ? 5 : 1) as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    expect(run([...previous, ...recent]).find((p) => p.id === 'sleep-mood')?.change).toBe('unknown')
  })
})

describe('주기 × 태그 — 기저 비율과 비교합니다', () => {
  const cycles: CycleRecord[] = [
    { id: 'c1', startDate: addDays(TODAY, -56), endDate: addDays(TODAY, -52) },
    { id: 'c2', startDate: addDays(TODAY, -28), endDate: addDays(TODAY, -24) },
  ]
  const phaseIndex = buildPhaseIndex(cycles, addDays(TODAY, -120), TODAY, {
    predict: false,
    today: TODAY,
  })

  it('생리전 구간에 몰린 태그를 찾아냅니다', () => {
    const entries = days(60, 0, (i) => {
      const date = addDays(TODAY, -(59 - i))
      const phase = phaseIndex.get(date)?.phase
      return { mood: 3 as Scale, tagIds: phase === 'premenstrual' ? ['t-head'] : [] }
    })
    const found = run(entries, phaseIndex).find((p) => p.id.startsWith('phase-tag:premenstrual:t-head'))
    expect(found).toBeDefined()
    // 기저 비율(그 외 기간)과 함께 보여줍니다.
    expect(found!.groups).toHaveLength(2)
    expect(found!.groups[1]?.label).toBe('그 외 기간')
    expect(found!.summary).not.toMatch(/배입니다/)
  })

  it('전 기간에 고르게 나오는 태그는 신호로 잡지 않습니다', () => {
    const entries = days(60, 0, () => ({ mood: 3 as Scale, tagIds: ['t-calm'] }))
    const found = run(entries, phaseIndex).filter((p) => p.id.includes('t-calm') && p.kind === 'phase-tag')
    expect(found.every((p) => p.status === 'none' || p.status === 'insufficient')).toBe(true)
  })
})

describe('섹션 분류 — 한 패턴은 한 곳에만', () => {
  it('관찰 중으로 지정한 패턴은 다른 섹션에 나오지 않습니다', () => {
    const entries = [
      ...days(24, 24, () => ({ mood: 4 as Scale, sleep: 'good' as SleepQuality })),
      ...days(24, 0, () => ({ mood: 2 as Scale, sleep: 'little' as SleepQuality })),
    ]
    const patterns = run(entries)
    const sections = sectionPatterns(patterns, new Set(['sleep-mood']))

    expect(sections.observed.map((p) => p.id)).toContain('sleep-mood')
    const others = [
      ...sections.discovered,
      ...sections.stable,
      ...sections.changing,
      ...sections.needsData,
      ...sections.noRelation,
    ]
    expect(others.some((p) => p.id === 'sleep-mood')).toBe(false)
  })

  it('모든 패턴이 정확히 한 섹션에 들어갑니다', () => {
    const entries = days(50, 0, (i) => ({
      mood: ((i % 5) + 1) as Scale,
      energy: ((i % 5) + 1) as Scale,
      sleep: (i % 3 === 0 ? 'good' : 'little') as SleepQuality,
      tagIds: i % 4 === 0 ? ['t-head'] : [],
    }))
    const patterns = run(entries)
    const s = sectionPatterns(patterns, new Set())
    const total =
      s.discovered.length +
      s.observed.length +
      s.stable.length +
      s.changing.length +
      s.needsData.length +
      s.noRelation.length
    expect(total).toBe(patterns.length)
  })
})

describe('headlinePattern', () => {
  it('보여줄 발견이 없으면 null입니다', () => {
    expect(headlinePattern(run(days(5, 0, () => ({ mood: 3 as Scale }))))).toBeNull()
  })

  it('새로 발견된 것을 먼저 내세웁니다', () => {
    const previous = days(DEFAULT_WINDOW_DAYS, DEFAULT_WINDOW_DAYS, (i) => ({
      mood: 3 as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    const recent = days(DEFAULT_WINDOW_DAYS, 0, (i) => ({
      mood: (i % 2 === 0 ? 5 : 1) as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    const headline = headlinePattern(run([...previous, ...recent]))
    expect(headline?.change).toBe('new')
  })
})

describe('assessReadiness — 가짜 진행률을 만들지 않습니다', () => {
  it('단계별 문구와 남은 일수를 냅니다', () => {
    expect(assessReadiness(0).stage).toBe('empty')
    expect(assessReadiness(3).stage).toBe('starting')
    expect(assessReadiness(10).stage).toBe('early')
    expect(assessReadiness(10).needed).toBe(MIN_TOTAL - 10)
    expect(assessReadiness(20).stage).toBe('accumulating')
    expect(assessReadiness(20).needed).toBe(STABLE_TOTAL - 20)
    expect(assessReadiness(60).stage).toBe('sufficient')
    expect(assessReadiness(60).needed).toBeNull()
  })
})

describe('표현 규칙', () => {
  it('어떤 패턴 문구도 인과로 단정하지 않습니다', () => {
    const entries = days(60, 0, (i) => ({
      mood: (i % 2 === 0 ? 5 : 1) as Scale,
      energy: (i % 2 === 0 ? 4 : 2) as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
      tagIds: i % 3 === 0 ? ['t-head'] : [],
    }))
    for (const pattern of run(entries)) {
      const text = `${pattern.title} ${pattern.summary}`
      // 인과를 단정하는 표현만 걸러냅니다.
      // '원인을 말하지는 않습니다' 같은 고지 문구는 오히려 있어야 합니다.
      expect(text).not.toMatch(/때문에|탓에|(으로|로) 인해|원인이|원인입니다|영향을 (주|미치)/)
    }
  })

  it('패턴 id는 결정적이라 같은 데이터면 같은 id가 나옵니다', () => {
    const entries = days(40, 0, (i) => ({
      mood: ((i % 5) + 1) as Scale,
      sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    }))
    expect(run(entries).map((p) => p.id)).toEqual(run(entries).map((p) => p.id))
  })
})

describe('조사 — 사용자 이름을 문장에 끼워도 어색해지지 않습니다', () => {
  const particleTags: Tag[] = [
    { id: 't-head', name: '두통', categoryId: 'cat', order: 0, archived: false },
    { id: 't-rest', name: '휴가', categoryId: 'cat', order: 1, archived: false },
  ]
  const particleIndex = buildTagIndex(categories, particleTags)

  const entries = days(60, 0, (i) => ({
    mood: (i % 2 === 0 ? 5 : 1) as Scale,
    energy: (i % 2 === 0 ? 4 : 2) as Scale,
    sleep: (i % 2 === 0 ? 'good' : 'little') as SleepQuality,
    tagIds: i % 3 === 0 ? ['t-head'] : i % 3 === 1 ? ['t-rest'] : [],
  }))

  const text = buildPatterns({
    entries: toMap(entries),
    phaseIndex: emptyPhases,
    tagIndex: particleIndex,
    today: TODAY,
  })
    .flatMap((p) => [p.title, p.summary, ...p.groups.map((g) => g.label)])
    .join('\n')

  it('받침 없는 이름에 받침용 조사를 붙이지 않습니다', () => {
    for (const wrong of ['에너지이', '에너지은', '에너지을', '에너지과', "'휴가'이", "'휴가'은", "'휴가'을", "'휴가'과"]) {
      expect(text).not.toContain(wrong)
    }
  })

  it('받침 있는 이름에 받침 없는 조사를 붙이지 않습니다', () => {
    for (const wrong of ["'두통'가", "'두통'는", "'두통'를", "'두통'와"]) {
      expect(text).not.toContain(wrong)
    }
  })

  it('실제로 조사가 붙은 문장이 만들어집니다', () => {
    expect(text).toMatch(/에너지가|'휴가'가|'휴가'를|'휴가'와/)
    expect(text).toMatch(/'두통'이|'두통'을|'두통'은|'두통'과/)
  })
})

describe('전체를 한 덩어리로 보는 지표는 그룹 크기로 막지 않습니다', () => {
  it('기분·에너지 상관은 기록이 쌓이면 결론에 도달합니다', () => {
    const entries = days(50, 0, (i) => ({
      mood: ((i % 5) + 1) as Scale,
      energy: ((i % 5) + 1) as Scale,
    }))
    const moodEnergy = run(entries).find((p) => p.id === 'mood-energy')
    expect(moodEnergy?.status).toBe('stable')
    expect(moodEnergy?.needed).toBeNull()
  })

  it('혼재 상태가 한 번도 없으면 부족이 아니라 드물다고 말합니다', () => {
    const entries = days(50, 0, () => ({ mood: 3 as Scale, energy: 3 as Scale }))
    const mixed = run(entries).find((p) => p.id === 'mixed-state')
    expect(mixed?.status).toBe('none')
    expect(mixed?.title).not.toContain('0%')
  })

  it('그럼에도 전체 표본이 부족하면 상관을 계산하지 않습니다', () => {
    const entries = days(8, 0, (i) => ({
      mood: ((i % 5) + 1) as Scale,
      energy: ((i % 5) + 1) as Scale,
    }))
    // 계수 자체를 내지 않으므로 패턴이 아예 만들어지지 않습니다.
    expect(run(entries).find((p) => p.id === 'mood-energy')).toBeUndefined()
  })
})
