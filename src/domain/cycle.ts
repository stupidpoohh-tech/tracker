/**
 * 생리주기 도메인.
 *
 * v3는 주기 정보가 두 곳(`entries[date].cycle`, `meta/periods`)에 나뉘어 있었고
 * 서로 동기화되지 않았으며, 배란기를 "다음 생리 시작 -14일"로만 계산해서
 * 미래 예측이 원천적으로 불가능했습니다.
 *
 * 여기서는 **생리 시작/종료 이벤트만이 유일한 원본**입니다. 생리전·배란기는
 * 전부 파생 계산이고, 과거 기록에서 얻은 평균 주기로 미래까지 투영합니다.
 */

import type { DateKey } from './date'
import { addDays, clampKey, diffDays, maxKey, minKey, todayKey } from './date'
import type { CycleRecord } from './models'

export type CyclePhase = 'period' | 'premenstrual' | 'ovulation'

export const PHASE_LABELS: Record<CyclePhase, string> = {
  period: '생리',
  premenstrual: '생리전',
  ovulation: '배란기',
}

export const PHASE_ORDER: readonly CyclePhase[] = ['period', 'premenstrual', 'ovulation']

export interface PhaseInfo {
  phase: CyclePhase
  /** 기록된 생리 이벤트가 아니라 평균 주기에서 예측한 구간입니다. */
  predicted: boolean
}

/** 생리 시작 며칠 전부터 '생리전'으로 볼지. */
export const PREMENSTRUAL_DAYS = 5
/** 배란일 = 다음 생리 시작 - 황체기 길이. */
export const LUTEAL_PHASE_LENGTH = 14
/** 배란일 앞뒤로 며칠을 배란기로 볼지. */
export const OVULATION_WINDOW = 1

export const DEFAULT_CYCLE_LENGTH = 28
export const DEFAULT_PERIOD_LENGTH = 5

/** 통계에 쓸 최근 주기 개수. 오래된 주기는 현재 상태를 잘 설명하지 못합니다. */
const STATS_WINDOW = 12
/** 이 범위를 벗어난 간격은 기록 누락·중복으로 보고 통계에서 제외합니다. */
const MIN_PLAUSIBLE_CYCLE = 15
const MAX_PLAUSIBLE_CYCLE = 60
/** 예측을 몇 주기까지 앞으로 밀어낼지. 무한 루프 방지용 상한입니다. */
const MAX_PREDICTED_CYCLES = 36

export type Regularity = 'regular' | 'irregular' | 'unknown'

export interface CycleStats {
  cycleCount: number
  /** 통계에 실제로 반영된 간격 개수 */
  sampleCount: number
  averageCycleLength: number
  medianCycleLength: number
  minCycleLength: number | null
  maxCycleLength: number | null
  averagePeriodLength: number
  regularity: Regularity
  /** 최근 주기 길이의 표준편차(일). 값이 클수록 불규칙합니다. */
  variability: number
  /** 평균값이 실제 기록이 아니라 기본값에서 왔는지 */
  usesDefaults: boolean
}

export function sortCycles(cycles: readonly CycleRecord[]): CycleRecord[] {
  return [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate))
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  if (s.length % 2 === 1) return s[mid] as number
  return ((s[mid - 1] as number) + (s[mid] as number)) / 2
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}

export function computeCycleStats(cycles: readonly CycleRecord[]): CycleStats {
  const sorted = sortCycles(cycles)

  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const gap = diffDays(sorted[i - 1]!.startDate, sorted[i]!.startDate)
    if (gap >= MIN_PLAUSIBLE_CYCLE && gap <= MAX_PLAUSIBLE_CYCLE) gaps.push(gap)
  }
  const window = gaps.slice(-STATS_WINDOW)

  const periodLengths: number[] = []
  for (const c of sorted) {
    if (!c.endDate) continue
    const len = diffDays(c.startDate, c.endDate) + 1
    if (len >= 1 && len <= 14) periodLengths.push(len)
  }
  const periodWindow = periodLengths.slice(-STATS_WINDOW)

  const hasCycleData = window.length >= 2
  const variability = stdev(window)

  return {
    cycleCount: sorted.length,
    sampleCount: window.length,
    averageCycleLength: hasCycleData ? Math.round(mean(window)) : DEFAULT_CYCLE_LENGTH,
    medianCycleLength: hasCycleData ? Math.round(median(window)) : DEFAULT_CYCLE_LENGTH,
    minCycleLength: window.length > 0 ? Math.min(...window) : null,
    maxCycleLength: window.length > 0 ? Math.max(...window) : null,
    averagePeriodLength:
      periodWindow.length > 0 ? Math.max(1, Math.round(mean(periodWindow))) : DEFAULT_PERIOD_LENGTH,
    regularity: !hasCycleData ? 'unknown' : variability <= 4 ? 'regular' : 'irregular',
    variability: Number(variability.toFixed(1)),
    usesDefaults: !hasCycleData,
  }
}

/**
 * 다음 생리 시작일들을 예측합니다.
 * 기록이 없으면 빈 배열입니다 — 근거 없는 예측은 내지 않습니다.
 */
export function predictUpcomingStarts(
  cycles: readonly CycleRecord[],
  stats: CycleStats,
  until: DateKey,
): DateKey[] {
  const sorted = sortCycles(cycles)
  const last = sorted[sorted.length - 1]
  if (!last) return []

  const out: DateKey[] = []
  let cursor = addDays(last.startDate, stats.averageCycleLength)
  for (let i = 0; i < MAX_PREDICTED_CYCLES && cursor <= until; i++) {
    out.push(cursor)
    cursor = addDays(cursor, stats.averageCycleLength)
  }
  return out
}

export interface PhaseIndexOptions {
  stats?: CycleStats
  /** 사용자가 직접 표시한 배란일. 파생 계산보다 우선합니다. */
  ovulationMarks?: readonly DateKey[]
  /** 미래 구간을 예측으로 채울지. 기본 true. */
  predict?: boolean
  today?: DateKey
}

export type PhaseIndex = Map<DateKey, PhaseInfo>

function writeSpan(
  index: PhaseIndex,
  from: DateKey,
  to: DateKey,
  rangeStart: DateKey,
  rangeEnd: DateKey,
  info: PhaseInfo,
): void {
  const start = maxKey(from, rangeStart)
  const end = minKey(to, rangeEnd)
  const span = diffDays(start, end)
  if (span < 0) return
  for (let i = 0; i <= span; i++) index.set(addDays(start, i), info)
}

/**
 * 지정 구간의 날짜별 주기 단계를 한 번에 계산합니다.
 *
 * v3는 날짜마다 전체 주기 배열을 훑어 O(날짜수 × 주기수)였습니다.
 * 여기서는 구간을 한 번만 칠하므로 O(날짜수 + 주기수)입니다.
 *
 * 우선순위: 생리 > 사용자 표시 배란일 > 생리전 > 파생 배란기
 */
export function buildPhaseIndex(
  cycles: readonly CycleRecord[],
  rangeStart: DateKey,
  rangeEnd: DateKey,
  options: PhaseIndexOptions = {},
): PhaseIndex {
  const index: PhaseIndex = new Map()
  if (diffDays(rangeStart, rangeEnd) < 0) return index

  const sorted = sortCycles(cycles)
  const stats = options.stats ?? computeCycleStats(sorted)
  const today = options.today ?? todayKey()
  const predict = options.predict !== false

  const predictedStarts = predict ? predictUpcomingStarts(sorted, stats, addDays(rangeEnd, PREMENSTRUAL_DAYS)) : []

  type Start = { date: DateKey; predicted: boolean }
  const starts: Start[] = [
    ...sorted.map((c) => ({ date: c.startDate, predicted: false })),
    ...predictedStarts.map((d) => ({ date: d, predicted: true })),
  ]

  // 1) 파생 배란기: 연속한 두 생리 시작 사이에서 계산합니다.
  for (let i = 0; i + 1 < starts.length; i++) {
    const next = starts[i + 1]!
    const ovDay = addDays(next.date, -LUTEAL_PHASE_LENGTH)
    writeSpan(
      index,
      addDays(ovDay, -OVULATION_WINDOW),
      addDays(ovDay, OVULATION_WINDOW),
      rangeStart,
      rangeEnd,
      { phase: 'ovulation', predicted: next.predicted },
    )
  }
  // 마지막 기록 이후 구간도 평균 주기로 배란기를 잡습니다.
  const lastStart = starts[starts.length - 1]
  if (predict && lastStart) {
    const projected = addDays(lastStart.date, stats.averageCycleLength)
    const ovDay = addDays(projected, -LUTEAL_PHASE_LENGTH)
    writeSpan(
      index,
      addDays(ovDay, -OVULATION_WINDOW),
      addDays(ovDay, OVULATION_WINDOW),
      rangeStart,
      rangeEnd,
      { phase: 'ovulation', predicted: true },
    )
  }

  // 2) 생리전
  for (const s of starts) {
    writeSpan(index, addDays(s.date, -PREMENSTRUAL_DAYS), addDays(s.date, -1), rangeStart, rangeEnd, {
      phase: 'premenstrual',
      predicted: s.predicted,
    })
  }

  // 3) 사용자가 직접 표시한 배란일
  for (const mark of options.ovulationMarks ?? []) {
    writeSpan(index, mark, mark, rangeStart, rangeEnd, { phase: 'ovulation', predicted: false })
  }

  // 4) 생리 (최우선)
  for (const c of sorted) {
    const end = c.endDate ?? minKey(today, addDays(c.startDate, stats.averagePeriodLength - 1))
    writeSpan(index, c.startDate, maxKey(end, c.startDate), rangeStart, rangeEnd, {
      phase: 'period',
      predicted: false,
    })
  }
  for (const s of predictedStarts) {
    writeSpan(index, s, addDays(s, stats.averagePeriodLength - 1), rangeStart, rangeEnd, {
      phase: 'period',
      predicted: true,
    })
  }

  return index
}

export interface CycleStatus {
  /** 현재 주기 며칠째인지 (생리 시작일 = 1일차). 기록이 없으면 null. */
  cycleDay: number | null
  phase: CyclePhase | null
  phasePredicted: boolean
  nextPeriodStart: DateKey | null
  daysUntilNextPeriod: number | null
  /** 예상일을 이만큼 지났는지 (양수면 늦어지는 중) */
  daysOverdue: number | null
  ongoing: CycleRecord | null
  stats: CycleStats
}

export function getCycleStatus(
  cycles: readonly CycleRecord[],
  today: DateKey = todayKey(),
): CycleStatus {
  const sorted = sortCycles(cycles)
  const stats = computeCycleStats(sorted)

  const last = [...sorted].reverse().find((c) => c.startDate <= today) ?? null
  if (!last) {
    return {
      cycleDay: null,
      phase: null,
      phasePredicted: false,
      nextPeriodStart: null,
      daysUntilNextPeriod: null,
      daysOverdue: null,
      ongoing: null,
      stats,
    }
  }

  const cycleDay = diffDays(last.startDate, today) + 1
  const nextPeriodStart = addDays(last.startDate, stats.averageCycleLength)
  const daysUntilNextPeriod = diffDays(today, nextPeriodStart)

  const index = buildPhaseIndex(sorted, today, today, { stats, today })
  const info = index.get(today) ?? null

  const ongoing = last.endDate === null && diffDays(last.startDate, today) <= 14 ? last : null

  return {
    cycleDay,
    phase: info?.phase ?? null,
    phasePredicted: info?.predicted ?? false,
    nextPeriodStart,
    daysUntilNextPeriod,
    daysOverdue: daysUntilNextPeriod < 0 ? -daysUntilNextPeriod : null,
    ongoing,
    stats,
  }
}

/** 서로 겹치거나 잇닿은 생리 기간을 병합합니다. 마이그레이션·가져오기에 사용합니다. */
export function mergeOverlappingCycles(cycles: readonly CycleRecord[]): CycleRecord[] {
  const sorted = sortCycles(cycles)
  const out: CycleRecord[] = []
  for (const c of sorted) {
    const prev = out[out.length - 1]
    const prevEnd = prev?.endDate ?? prev?.startDate ?? null
    if (prev && prevEnd && diffDays(prevEnd, c.startDate) <= 1) {
      const cEnd = c.endDate ?? c.startDate
      prev.endDate = maxKey(prevEnd, cEnd)
      continue
    }
    out.push({ ...c })
  }
  return out
}

/** 생리 기간에 포함되는 날짜인지. */
export function isPeriodDay(cycles: readonly CycleRecord[], date: DateKey, today: DateKey = todayKey()): boolean {
  const stats = computeCycleStats(cycles)
  return sortCycles(cycles).some((c) => {
    const end = c.endDate ?? minKey(today, addDays(c.startDate, stats.averagePeriodLength - 1))
    return date >= c.startDate && date <= maxKey(end, c.startDate)
  })
}

/** 특정 날짜를 포함하는 생리 기록을 찾습니다. */
export function findCycleContaining(
  cycles: readonly CycleRecord[],
  date: DateKey,
): CycleRecord | null {
  return (
    sortCycles(cycles).find((c) => date >= c.startDate && date <= (c.endDate ?? c.startDate)) ?? null
  )
}

export function clampToToday(date: DateKey, today: DateKey = todayKey()): DateKey {
  return clampKey(date, '1970-01-01', today)
}
