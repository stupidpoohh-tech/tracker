import { describe, expect, it } from 'vitest'
import {
  buildPhaseIndex,
  computeCycleStats,
  findCycleContaining,
  getCycleStatus,
  mergeOverlappingCycles,
  predictUpcomingStarts,
} from './cycle'
import type { CycleRecord } from './models'

function cycle(id: string, startDate: string, endDate: string | null = null): CycleRecord {
  return { id, startDate, endDate }
}

/** v3 constants.js의 실제 기록 형태를 본뜬 표본입니다. */
const SAMPLE: CycleRecord[] = [
  cycle('c1', '2025-01-11', '2025-01-15'),
  cycle('c2', '2025-02-05', '2025-02-09'),
  cycle('c3', '2025-03-04', '2025-03-07'),
  cycle('c4', '2025-04-04', '2025-04-06'),
  cycle('c5', '2025-05-01', '2025-05-04'),
  cycle('c6', '2025-05-31', '2025-06-03'),
]

describe('computeCycleStats', () => {
  it('기록이 없으면 기본값을 쓰고 그 사실을 알립니다', () => {
    const stats = computeCycleStats([])
    expect(stats.usesDefaults).toBe(true)
    expect(stats.averageCycleLength).toBe(28)
    expect(stats.regularity).toBe('unknown')
    expect(stats.cycleCount).toBe(0)
  })

  it('주기가 하나뿐이면 간격을 계산할 수 없습니다', () => {
    const stats = computeCycleStats([cycle('c1', '2025-01-11', '2025-01-15')])
    expect(stats.usesDefaults).toBe(true)
    expect(stats.sampleCount).toBe(0)
    expect(stats.averagePeriodLength).toBe(5)
  })

  it('평균 주기와 평균 생리 길이를 계산합니다', () => {
    const stats = computeCycleStats(SAMPLE)
    // 간격: 25, 27, 31, 27, 30 → 평균 28
    expect(stats.sampleCount).toBe(5)
    expect(stats.averageCycleLength).toBe(28)
    expect(stats.minCycleLength).toBe(25)
    expect(stats.maxCycleLength).toBe(31)
    // 생리 길이: 5,5,4,3,4,4 → 평균 4.17 → 4
    expect(stats.averagePeriodLength).toBe(4)
    expect(stats.usesDefaults).toBe(false)
  })

  it('비현실적인 간격은 통계에서 제외합니다', () => {
    const stats = computeCycleStats([
      cycle('a', '2025-01-01'),
      cycle('b', '2025-01-03'), // 2일 간격 = 중복 입력으로 간주
      cycle('c', '2025-01-29'),
    ])
    // 2일 간격은 버리고 26일만 남으므로 표본이 1개 → 기본값 사용
    expect(stats.sampleCount).toBe(1)
    expect(stats.usesDefaults).toBe(true)
  })

  it('규칙성을 편차로 판단합니다', () => {
    const regular = computeCycleStats([
      cycle('a', '2025-01-01'),
      cycle('b', '2025-01-29'),
      cycle('c', '2025-02-26'),
      cycle('d', '2025-03-26'),
    ])
    expect(regular.regularity).toBe('regular')

    const irregular = computeCycleStats([
      cycle('a', '2025-01-01'),
      cycle('b', '2025-01-20'),
      cycle('c', '2025-03-01'),
      cycle('d', '2025-03-20'),
      cycle('e', '2025-05-05'),
    ])
    expect(irregular.regularity).toBe('irregular')
  })
})

describe('predictUpcomingStarts', () => {
  it('기록이 없으면 예측하지 않습니다', () => {
    expect(predictUpcomingStarts([], computeCycleStats([]), '2026-12-31')).toEqual([])
  })

  it('마지막 기록에서 평균 주기만큼 앞으로 밀어냅니다', () => {
    const stats = computeCycleStats(SAMPLE)
    const next = predictUpcomingStarts(SAMPLE, stats, '2025-08-01')
    // 마지막 시작 2025-05-31 + 28 = 06-28, + 28 = 07-26
    expect(next).toEqual(['2025-06-28', '2025-07-26'])
  })
})

describe('buildPhaseIndex', () => {
  it('생리 기간을 정확히 칠합니다', () => {
    const index = buildPhaseIndex([cycle('c1', '2025-03-04', '2025-03-07')], '2025-03-01', '2025-03-10', {
      predict: false,
      today: '2025-06-01',
    })
    expect(index.get('2025-03-03')?.phase).toBe('premenstrual')
    expect(index.get('2025-03-04')?.phase).toBe('period')
    expect(index.get('2025-03-07')?.phase).toBe('period')
    expect(index.get('2025-03-08')).toBeUndefined()
  })

  it('생리전은 시작 5일 전부터 하루 전까지입니다', () => {
    const index = buildPhaseIndex([cycle('c1', '2025-03-10', '2025-03-13')], '2025-03-01', '2025-03-13', {
      predict: false,
      today: '2025-06-01',
    })
    expect(index.get('2025-03-04')).toBeUndefined()
    expect(index.get('2025-03-05')?.phase).toBe('premenstrual')
    expect(index.get('2025-03-09')?.phase).toBe('premenstrual')
    expect(index.get('2025-03-10')?.phase).toBe('period')
  })

  it('배란기는 다음 생리 시작 14일 전 ±1일입니다', () => {
    const cycles = [cycle('c1', '2025-03-04', '2025-03-07'), cycle('c2', '2025-04-01', '2025-04-04')]
    const index = buildPhaseIndex(cycles, '2025-03-01', '2025-04-04', {
      predict: false,
      today: '2025-06-01',
    })
    // 04-01 - 14 = 03-18
    expect(index.get('2025-03-16')).toBeUndefined()
    expect(index.get('2025-03-17')?.phase).toBe('ovulation')
    expect(index.get('2025-03-18')?.phase).toBe('ovulation')
    expect(index.get('2025-03-19')?.phase).toBe('ovulation')
    expect(index.get('2025-03-20')).toBeUndefined()
  })

  it('기록된 구간은 predicted=false입니다', () => {
    const index = buildPhaseIndex(SAMPLE, '2025-05-01', '2025-05-04', {
      predict: false,
      today: '2025-06-01',
    })
    expect(index.get('2025-05-02')).toEqual({ phase: 'period', predicted: false })
  })

  it('미래 구간을 평균 주기로 예측합니다 (v3는 불가능했던 부분)', () => {
    const index = buildPhaseIndex(SAMPLE, '2025-06-01', '2025-07-31', {
      today: '2025-06-05',
    })
    // 예측 시작일 2025-06-28
    expect(index.get('2025-06-28')).toEqual({ phase: 'period', predicted: true })
    expect(index.get('2025-06-27')?.phase).toBe('premenstrual')
    expect(index.get('2025-06-27')?.predicted).toBe(true)
  })

  it('예측을 끄면 미래 구간이 비어 있습니다', () => {
    const index = buildPhaseIndex(SAMPLE, '2025-06-10', '2025-07-31', {
      predict: false,
      today: '2025-06-05',
    })
    expect(index.size).toBe(0)
  })

  it('생리가 생리전·배란기보다 우선합니다', () => {
    // 아주 짧은 주기라 배란기 계산 구간이 생리 기간과 겹칩니다.
    const cycles = [cycle('c1', '2025-03-01', '2025-03-06'), cycle('c2', '2025-03-17', '2025-03-20')]
    const index = buildPhaseIndex(cycles, '2025-03-01', '2025-03-20', {
      predict: false,
      today: '2025-06-01',
    })
    // 03-17 - 14 = 03-03 → 생리 기간 안이지만 생리가 이깁니다.
    expect(index.get('2025-03-03')?.phase).toBe('period')
  })

  it('사용자가 표시한 배란일이 파생 계산보다 우선합니다', () => {
    const index = buildPhaseIndex([cycle('c1', '2025-03-20', '2025-03-24')], '2025-03-01', '2025-03-24', {
      predict: false,
      today: '2025-06-01',
      ovulationMarks: ['2025-03-16'],
    })
    // 03-16은 생리전(03-15~03-19) 구간이지만 사용자 표시가 이깁니다.
    expect(index.get('2025-03-16')).toEqual({ phase: 'ovulation', predicted: false })
    expect(index.get('2025-03-17')?.phase).toBe('premenstrual')
  })

  it('진행 중인 생리는 오늘을 넘겨 칠하지 않습니다', () => {
    const index = buildPhaseIndex([cycle('c1', '2025-06-01', null)], '2025-06-01', '2025-06-10', {
      predict: false,
      today: '2025-06-02',
    })
    expect(index.get('2025-06-02')?.phase).toBe('period')
    expect(index.get('2025-06-03')).toBeUndefined()
  })

  it('구간 밖은 계산하지 않습니다 (메모리 상한)', () => {
    const index = buildPhaseIndex(SAMPLE, '2025-03-04', '2025-03-05', {
      predict: false,
      today: '2025-06-01',
    })
    expect([...index.keys()]).toEqual(['2025-03-04', '2025-03-05'])
  })

  it('빈 범위는 빈 결과입니다', () => {
    expect(buildPhaseIndex(SAMPLE, '2025-03-05', '2025-03-04').size).toBe(0)
  })
})

describe('getCycleStatus', () => {
  it('기록이 없으면 전부 null입니다', () => {
    const status = getCycleStatus([], '2025-06-10')
    expect(status.cycleDay).toBeNull()
    expect(status.nextPeriodStart).toBeNull()
  })

  it('현재 주기 일차와 다음 예상일을 계산합니다', () => {
    const status = getCycleStatus(SAMPLE, '2025-06-10')
    // 마지막 시작 2025-05-31 → 6/10은 11일차
    expect(status.cycleDay).toBe(11)
    expect(status.nextPeriodStart).toBe('2025-06-28')
    expect(status.daysUntilNextPeriod).toBe(18)
    expect(status.daysOverdue).toBeNull()
  })

  it('예상일을 넘기면 지연 일수를 냅니다', () => {
    const status = getCycleStatus(SAMPLE, '2025-07-05')
    expect(status.daysOverdue).toBe(7)
  })

  it('생리 중이면 phase가 period입니다', () => {
    const status = getCycleStatus(SAMPLE, '2025-06-02')
    expect(status.phase).toBe('period')
  })
})

describe('mergeOverlappingCycles', () => {
  it('겹치거나 잇닿은 기간을 합칩니다', () => {
    const merged = mergeOverlappingCycles([
      cycle('a', '2025-03-01', '2025-03-04'),
      cycle('b', '2025-03-05', '2025-03-06'),
      cycle('c', '2025-03-20', '2025-03-24'),
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ startDate: '2025-03-01', endDate: '2025-03-06' })
    expect(merged[1]).toMatchObject({ startDate: '2025-03-20', endDate: '2025-03-24' })
  })

  it('떨어진 기간은 그대로 둡니다', () => {
    const merged = mergeOverlappingCycles([
      cycle('a', '2025-03-01', '2025-03-04'),
      cycle('b', '2025-03-06', '2025-03-08'),
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('findCycleContaining', () => {
  it('해당 날짜를 포함하는 기록을 찾습니다', () => {
    expect(findCycleContaining(SAMPLE, '2025-03-05')?.id).toBe('c3')
    expect(findCycleContaining(SAMPLE, '2025-03-15')).toBeNull()
  })
})
