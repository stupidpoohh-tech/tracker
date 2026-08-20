import { describe, expect, it } from 'vitest'
import { groupConsecutive, planMigration, type LegacyEntryDoc, type MigrationInput } from './migration'

function idFactory(): MigrationInput['newId'] {
  const counters: Record<string, number> = { tag: 0, category: 0, cycle: 0 }
  return (kind) => `${kind}-${++counters[kind]!}`
}

function run(partial: Partial<MigrationInput>) {
  return planMigration({
    entries: {},
    periods: null,
    localTags: null,
    newId: idFactory(),
    ...partial,
  })
}

/** v3 문서 형태 그대로 — null 값 포함. */
const legacy: Record<string, LegacyEntryDoc> = {
  '2025-01-11': { mood: 2, energy: null, sleep: 'little', cycle: 'period', tags: ['짜증', '두통'], memo: '힘든 날' },
  '2025-01-12': { mood: null, energy: 3, sleep: null, cycle: 'period', tags: [], memo: '' },
  '2025-01-20': { mood: 4, energy: 4, sleep: 'good', cycle: 'ovulation', tags: ['행복/만족'], memo: '' },
  '2025-01-25': { mood: 3, energy: 3, sleep: 'too_much', cycle: 'none', tags: ['짜증'], memo: '생리 전' },
}

const localTags = {
  정서: ['짜증', '행복/만족'],
  신체: ['두통'],
}

describe('태그 이름 → 안정적 ID', () => {
  it('localStorage 태그 트리를 카테고리·태그 문서로 옮깁니다', () => {
    const plan = run({ entries: legacy, localTags })
    expect(plan.categories.map((c) => c.name)).toEqual(['정서', '신체'])
    expect(plan.tags.map((t) => t.name)).toEqual(['짜증', '행복/만족', '두통'])
    expect(plan.tags[0]).toMatchObject({ id: 'tag-1', categoryId: 'category-1', archived: false })
  })

  it('기록의 태그 이름을 ID로 바꿉니다', () => {
    const plan = run({ entries: legacy, localTags })
    const jan11 = plan.entries.find((e) => e.date === '2025-01-11')!
    expect(jan11.tagIds).toEqual(['tag-1', 'tag-3']) // 짜증, 두통
  })

  it('원본 태그 이름을 legacyTags로 보존합니다', () => {
    const plan = run({ entries: legacy, localTags })
    const jan11 = plan.entries.find((e) => e.date === '2025-01-11')!
    expect(jan11.legacyTags).toEqual(['짜증', '두통'])
  })

  it('목록에 없고 기록에만 있는 태그를 복구합니다', () => {
    const plan = run({
      entries: { '2025-01-01': { tags: ['사라진태그'], memo: '' } },
      localTags,
    })
    const recovered = plan.tags.find((t) => t.name === '사라진태그')
    expect(recovered).toBeDefined()
    expect(plan.categories.find((c) => c.id === recovered!.categoryId)?.name).toBe('복구된 태그')
    expect(plan.stats.recoveredTagCount).toBe(1)
  })

  it('이미 마이그레이션된 태그는 다시 만들지 않습니다 (멱등)', () => {
    const existingTags = [
      { id: 'tag-existing', name: '짜증', categoryId: 'cat-existing', order: 0, archived: false },
    ]
    const existingCategories = [{ id: 'cat-existing', name: '정서', order: 0 }]
    const plan = run({ entries: legacy, localTags, existingTags, existingCategories })
    expect(plan.tags.filter((t) => t.name === '짜증')).toHaveLength(1)
    expect(plan.tags.find((t) => t.name === '짜증')?.id).toBe('tag-existing')
    expect(plan.categories.filter((c) => c.name === '정서')).toHaveLength(1)
  })

  it('이미 tagIds가 있으면 그대로 둡니다', () => {
    const plan = run({
      entries: { '2025-01-01': { tagIds: ['already-there'], tags: ['짜증'], memo: '' } },
      localTags,
    })
    expect(plan.entries[0]?.tagIds).toEqual(['already-there'])
  })
})

describe('null 정리', () => {
  it('null 값을 필드 자체 생략으로 바꿉니다', () => {
    const plan = run({ entries: legacy, localTags })
    const jan11 = plan.entries.find((e) => e.date === '2025-01-11')!
    expect(jan11.mood).toBe(2)
    expect('energy' in jan11).toBe(false)
    const jan12 = plan.entries.find((e) => e.date === '2025-01-12')!
    expect('mood' in jan12).toBe(false)
    expect('sleep' in jan12).toBe(false)
  })

  it('범위를 벗어난 척도 값은 버립니다', () => {
    const plan = run({ entries: { '2025-01-01': { mood: 9, energy: 0, memo: '' } } })
    expect('mood' in plan.entries[0]!).toBe(false)
    expect('energy' in plan.entries[0]!).toBe(false)
  })

  it('알 수 없는 sleep 값은 버립니다', () => {
    const plan = run({ entries: { '2025-01-01': { sleep: 'unknown', memo: '' } } })
    expect('sleep' in plan.entries[0]!).toBe(false)
  })

  it('날짜 키가 아닌 문서는 건너뛰고 집계합니다', () => {
    const plan = run({ entries: { 'not-a-date': { mood: 3 }, '2025-01-01': { mood: 3 } } })
    expect(plan.entries).toHaveLength(1)
    expect(plan.stats.droppedEntries).toBe(1)
  })

  it('date 필드를 추가합니다 (범위 질의용)', () => {
    const plan = run({ entries: legacy, localTags })
    expect(plan.entries.every((e) => typeof e.date === 'string')).toBe(true)
    expect(plan.entries.map((e) => e.date)).toEqual([
      '2025-01-11',
      '2025-01-12',
      '2025-01-20',
      '2025-01-25',
    ])
  })
})

describe('생리주기 단일화', () => {
  it('meta/periods를 생리 기록으로 옮깁니다', () => {
    const plan = run({
      periods: [
        ['2025-01-11', '2025-01-15'],
        ['2025-02-05', '2025-02-09'],
      ],
    })
    expect(plan.cycles).toHaveLength(2)
    expect(plan.cycles[0]).toMatchObject({ startDate: '2025-01-11', endDate: '2025-01-15' })
  })

  it('기록에만 cycle="period"로 남은 날짜도 회수합니다', () => {
    const plan = run({
      entries: {
        '2025-03-01': { cycle: 'period', memo: '' },
        '2025-03-02': { cycle: 'period', memo: '' },
        '2025-03-03': { cycle: 'period', memo: '' },
      },
      periods: null,
    })
    expect(plan.cycles).toHaveLength(1)
    expect(plan.cycles[0]).toMatchObject({ startDate: '2025-03-01', endDate: '2025-03-03' })
  })

  it('periods와 기록이 겹치면 하나로 합칩니다', () => {
    const plan = run({
      entries: {
        '2025-01-15': { cycle: 'period', memo: '' },
        '2025-01-16': { cycle: 'period', memo: '' },
      },
      periods: [['2025-01-11', '2025-01-15']],
    })
    expect(plan.cycles).toHaveLength(1)
    expect(plan.cycles[0]).toMatchObject({ startDate: '2025-01-11', endDate: '2025-01-16' })
  })

  it('cycle="ovulation"을 사용자 표시 배란일로 옮깁니다', () => {
    const plan = run({ entries: legacy, localTags })
    const jan20 = plan.entries.find((e) => e.date === '2025-01-20')!
    expect(jan20.ovulationMark).toBe(true)
    expect(plan.stats.ovulationMarks).toBe(1)
  })

  it('cycle="none"(생리전)은 파생값이므로 기록에 남기지 않되 백업합니다', () => {
    const plan = run({ entries: legacy, localTags })
    const jan25 = plan.entries.find((e) => e.date === '2025-01-25')!
    expect(jan25.ovulationMark).toBeUndefined()
    expect(plan.backup.entryCycles['2025-01-25']).toBe('none')
  })

  it('종료일이 시작일보다 이르면 시작일로 맞춥니다', () => {
    const plan = run({ periods: [['2025-01-11', '2025-01-01']] })
    expect(plan.cycles[0]).toMatchObject({ startDate: '2025-01-11', endDate: '2025-01-11' })
  })

  it('형식이 깨진 periods 항목은 버립니다', () => {
    const plan = run({ periods: [['bad', '2025-01-15'], ['2025-02-05', '2025-02-09']] })
    expect(plan.cycles).toHaveLength(1)
    expect(plan.cycles[0]?.startDate).toBe('2025-02-05')
  })

  it('타인의 기본 생리 데이터를 심지 않습니다', () => {
    // v3는 INITIAL_PERIOD_DATA를 신규 사용자에게 그대로 노출했습니다.
    const plan = run({ entries: {}, periods: null })
    expect(plan.cycles).toEqual([])
  })
})

describe('백업', () => {
  it('v3 원본을 통째로 남깁니다', () => {
    const periods: [string, string][] = [['2025-01-11', '2025-01-15']]
    const plan = run({ entries: legacy, periods, localTags })
    expect(plan.backup.periods).toEqual(periods)
    expect(plan.backup.localTags).toEqual(localTags)
    expect(plan.backup.entryCycles).toEqual({
      '2025-01-11': 'period',
      '2025-01-12': 'period',
      '2025-01-20': 'ovulation',
      '2025-01-25': 'none',
    })
    expect(plan.backup.schemaFrom).toBe(3)
  })
})

describe('groupConsecutive', () => {
  it('연속 날짜를 구간으로 묶습니다', () => {
    expect(groupConsecutive(['2025-01-01', '2025-01-02', '2025-01-05'])).toEqual([
      ['2025-01-01', '2025-01-02'],
      ['2025-01-05', '2025-01-05'],
    ])
  })

  it('순서가 뒤섞여 있어도 정렬 후 묶습니다', () => {
    expect(groupConsecutive(['2025-01-03', '2025-01-01', '2025-01-02'])).toEqual([
      ['2025-01-01', '2025-01-03'],
    ])
  })

  it('중복을 제거합니다', () => {
    expect(groupConsecutive(['2025-01-01', '2025-01-01'])).toEqual([['2025-01-01', '2025-01-01']])
  })

  it('빈 입력은 빈 결과입니다', () => {
    expect(groupConsecutive([])).toEqual([])
  })
})

describe('전체 통계', () => {
  it('마이그레이션 결과를 요약합니다', () => {
    const plan = run({ entries: legacy, periods: [['2025-01-11', '2025-01-15']], localTags })
    expect(plan.stats).toMatchObject({
      entryCount: 4,
      tagCount: 3,
      categoryCount: 2,
      cycleCount: 1,
      recoveredTagCount: 0,
      ovulationMarks: 1,
      droppedEntries: 0,
    })
  })
})
