/**
 * 인사이트 엔진.
 *
 * 기분·에너지·수면·주기·태그가 한 곳에 모여 있을 때만 나올 수 있는 관계를
 * 계산합니다. 전부 개인 데이터 범위이므로 클라이언트에서 계산합니다.
 *
 * 원칙 두 가지:
 * 1. 표본이 부족하면 카드를 만들지 않습니다. 3일치로 "패턴"을 말하지 않습니다.
 * 2. 상관을 인과로 쓰지 않습니다. 문구는 관찰·가능성 수준으로 유지합니다.
 */

import type { DateKey } from './date'
import { datesInRange, diffDays, weekdayLabel } from './date'
import type { CyclePhase, PhaseIndex } from './cycle'
import { PHASE_LABELS } from './cycle'
import type { Entry, SleepQuality, TagIndex } from './models'
import { SLEEP_OPTIONS, isMixedState, resolveEntryTagIds, sleepLabel } from './models'

/** 한 그룹이 이 개수 미만이면 비교하지 않습니다. */
export const MIN_GROUP_SIZE = 5
/** 전체 기록이 이 개수 미만이면 인사이트를 내지 않습니다. */
export const MIN_TOTAL_ENTRIES = 14
/** 1~5 척도에서 이 정도 차이는 나야 언급할 가치가 있습니다. */
const MIN_EFFECT = 0.5
const STRONG_EFFECT = 1.0
/** 태그 배수는 이 정도는 되어야 신호로 봅니다. */
const MIN_TAG_LIFT = 1.6
const MIN_TAG_OCCURRENCES = 4

export type InsightStrength = 'strong' | 'moderate'

export interface InsightCard {
  id: string
  /** 카드 분류. UI에서 아이콘·색을 고를 때 씁니다. */
  kind: 'sleep' | 'cycle' | 'tag' | 'mixed' | 'weekday' | 'correlation'
  title: string
  body: string
  strength: InsightStrength
  /** 정렬용 효과 크기(절댓값). */
  magnitude: number
  sampleSize: number
}

export interface GroupSummary {
  key: string
  label: string
  count: number
  moodAvg: number | null
  energyAvg: number | null
  mixedRate: number
}

export interface InsightInput {
  entries: readonly Entry[]
  phaseIndex: PhaseIndex
  tagIndex: TagIndex
  rangeStart: DateKey
  rangeEnd: DateKey
}

// ─── 기초 집계 ────────────────────────────────────────────────────────────────

function avg(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function summarize(key: string, label: string, entries: readonly Entry[]): GroupSummary {
  const moods = entries.map((e) => e.mood).filter((v): v is NonNullable<typeof v> => v != null)
  const energies = entries.map((e) => e.energy).filter((v): v is NonNullable<typeof v> => v != null)
  const mixedCandidates = entries.filter((e) => e.mood != null && e.energy != null)
  return {
    key,
    label,
    count: entries.length,
    moodAvg: avg(moods),
    energyAvg: avg(energies),
    mixedRate:
      mixedCandidates.length === 0
        ? 0
        : mixedCandidates.filter(isMixedState).length / mixedCandidates.length,
  }
}

export interface OverviewStats {
  totalDays: number
  loggedDays: number
  coverage: number
  moodAvg: number | null
  energyAvg: number | null
  mixedDays: number
  mixedRate: number
  currentStreak: number
  longestStreak: number
  sleepCounts: Record<SleepQuality, number>
  sleepHoursAvg: number | null
}

export function computeOverview(
  entries: readonly Entry[],
  rangeStart: DateKey,
  rangeEnd: DateKey,
  today: DateKey,
): OverviewStats {
  const totalDays = Math.max(0, diffDays(rangeStart, rangeEnd) + 1)
  const base = summarize('all', '전체', entries)
  const mixedDays = entries.filter(isMixedState).length

  const sleepCounts: Record<SleepQuality, number> = { little: 0, good: 0, too_much: 0 }
  for (const e of entries) if (e.sleep) sleepCounts[e.sleep] += 1

  const logged = new Set(entries.map((e) => e.date))

  // 현재 연속 기록일: 오늘(또는 어제)부터 거꾸로 셉니다.
  let currentStreak = 0
  let cursor = logged.has(today) ? today : ''
  if (!cursor) {
    const yesterdayLogged = entries.some((e) => diffDays(e.date, today) === 1)
    cursor = yesterdayLogged ? entries.find((e) => diffDays(e.date, today) === 1)!.date : ''
  }
  if (cursor) {
    const all = [...logged].sort()
    const idx = all.lastIndexOf(cursor)
    currentStreak = 1
    for (let i = idx; i > 0; i--) {
      if (diffDays(all[i - 1]!, all[i]!) === 1) currentStreak += 1
      else break
    }
  }

  let longestStreak = 0
  let run = 0
  const sortedDates = [...logged].sort()
  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0 || diffDays(sortedDates[i - 1]!, sortedDates[i]!) !== 1) run = 1
    else run += 1
    if (run > longestStreak) longestStreak = run
  }

  const sleepHours = entries.map((e) => e.sleepHours).filter((v): v is number => v != null)

  return {
    totalDays,
    loggedDays: entries.length,
    coverage: totalDays === 0 ? 0 : entries.length / totalDays,
    moodAvg: base.moodAvg,
    energyAvg: base.energyAvg,
    mixedDays,
    mixedRate: base.mixedRate,
    currentStreak,
    longestStreak,
    sleepCounts,
    sleepHoursAvg: avg(sleepHours),
  }
}

// ─── 그룹별 요약 ──────────────────────────────────────────────────────────────

export function groupBySleep(entries: readonly Entry[]): GroupSummary[] {
  return SLEEP_OPTIONS.map((opt) =>
    summarize(opt.id, opt.label, entries.filter((e) => e.sleep === opt.id)),
  )
}

export function groupByPhase(entries: readonly Entry[], phaseIndex: PhaseIndex): GroupSummary[] {
  const buckets = new Map<string, Entry[]>()
  for (const e of entries) {
    const phase = phaseIndex.get(e.date)?.phase ?? 'none'
    const list = buckets.get(phase) ?? []
    list.push(e)
    buckets.set(phase, list)
  }
  const labelOf = (key: string): string =>
    key === 'none' ? '그 외' : PHASE_LABELS[key as CyclePhase]
  return [...buckets.entries()].map(([key, list]) => summarize(key, labelOf(key), list))
}

export function groupByWeekday(entries: readonly Entry[]): GroupSummary[] {
  const buckets = new Map<number, Entry[]>()
  for (const e of entries) {
    const wd = new Date(Date.UTC(+e.date.slice(0, 4), +e.date.slice(5, 7) - 1, +e.date.slice(8, 10)))
      .getUTCDay()
    const list = buckets.get(wd) ?? []
    list.push(e)
    buckets.set(wd, list)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([wd, list]) => summarize(String(wd), `${weekdayLabel(datesForWeekday(wd))}요일`, list))
}

/** weekdayLabel은 날짜 키를 받으므로, 요일 인덱스에 대응하는 기준 날짜를 씁니다. */
function datesForWeekday(wd: number): DateKey {
  // 1970-01-04는 일요일입니다.
  const day = 4 + wd
  return `1970-01-${String(day).padStart(2, '0')}`
}

// ─── 태그 빈도·배수 ───────────────────────────────────────────────────────────

export interface TagCount {
  tagId: string
  name: string
  count: number
}

export function tagFrequency(
  entries: readonly Entry[],
  tagIndex: TagIndex,
  limit = 10,
): TagCount[] {
  const freq = new Map<string, number>()
  for (const e of entries) {
    for (const id of resolveEntryTagIds(e, tagIndex)) {
      freq.set(id, (freq.get(id) ?? 0) + 1)
    }
  }
  return [...freq.entries()]
    .map(([tagId, count]) => ({ tagId, count, name: tagIndex.byId.get(tagId)?.name ?? tagId }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export interface TagLift {
  tagId: string
  name: string
  phase: CyclePhase
  inPhaseRate: number
  outPhaseRate: number
  /** 순위를 매기기 위한 배수. 표시에는 쓰지 않습니다 — 아래 주석 참고. */
  lift: number
  inPhaseCount: number
  phaseDays: number
  outPhaseCount: number
  outPhaseDays: number
}

/** 특정 주기 단계에서 유독 자주 나오는 태그를 찾습니다. */
export function computeTagLifts(
  entries: readonly Entry[],
  phaseIndex: PhaseIndex,
  tagIndex: TagIndex,
): TagLift[] {
  const byPhase = new Map<CyclePhase, Entry[]>()
  const rest: Entry[] = []
  for (const e of entries) {
    const phase = phaseIndex.get(e.date)?.phase
    if (!phase) {
      rest.push(e)
      continue
    }
    const list = byPhase.get(phase) ?? []
    list.push(e)
    byPhase.set(phase, list)
  }

  const out: TagLift[] = []
  for (const [phase, inPhase] of byPhase) {
    if (inPhase.length < MIN_GROUP_SIZE) continue
    const outPhase = entries.filter((e) => phaseIndex.get(e.date)?.phase !== phase)
    if (outPhase.length < MIN_GROUP_SIZE) continue

    const countIn = new Map<string, number>()
    for (const e of inPhase) for (const id of resolveEntryTagIds(e, tagIndex)) countIn.set(id, (countIn.get(id) ?? 0) + 1)
    const countOut = new Map<string, number>()
    for (const e of outPhase) for (const id of resolveEntryTagIds(e, tagIndex)) countOut.set(id, (countOut.get(id) ?? 0) + 1)

    for (const [tagId, inCount] of countIn) {
      if (inCount < MIN_TAG_OCCURRENCES) continue
      const outCount = countOut.get(tagId) ?? 0
      const inRate = inCount / inPhase.length
      /*
       * 순위용 배수에는 0으로 나누는 것을 막기 위해 라플라스 보정을 씁니다.
       * 다만 이 값을 그대로 문구에 쓰면 안 됩니다. 그 외 기간에 한 번도
       * 없었던 태그는 보정 상수 때문에 '97배' 같은 숫자가 나오는데, 이는
       * 관계의 크기가 아니라 계산 방식의 부산물입니다. 카드에는 실제 빈도를
       * 백분율로 적습니다.
       */
      const smoothedOutRate = (outCount + 0.5) / (outPhase.length + 1)
      const lift = inRate / smoothedOutRate
      if (lift < MIN_TAG_LIFT) continue
      out.push({
        tagId,
        name: tagIndex.byId.get(tagId)?.name ?? tagId,
        phase,
        inPhaseRate: inRate,
        outPhaseRate: outCount / outPhase.length,
        lift,
        inPhaseCount: inCount,
        phaseDays: inPhase.length,
        outPhaseCount: outCount,
        outPhaseDays: outPhase.length,
      })
    }
  }
  return out.sort((a, b) => b.lift - a.lift)
}

// ─── 상관 ─────────────────────────────────────────────────────────────────────

export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length)
  if (n < MIN_TOTAL_ENTRIES) return null
  const mx = avg(xs.slice(0, n))
  const my = avg(ys.slice(0, n))
  if (mx == null || my == null) return null
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const a = (xs[i] as number) - mx
    const b = (ys[i] as number) - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  if (dx === 0 || dy === 0) return null
  return num / Math.sqrt(dx * dy)
}

// ─── 카드 생성 ────────────────────────────────────────────────────────────────

function strengthOf(effect: number): InsightStrength | null {
  const abs = Math.abs(effect)
  if (abs >= STRONG_EFFECT) return 'strong'
  if (abs >= MIN_EFFECT) return 'moderate'
  return null
}

function compareGroups(
  groups: readonly GroupSummary[],
  metric: 'moodAvg' | 'energyAvg',
): { high: GroupSummary; low: GroupSummary; effect: number } | null {
  const usable = groups.filter((g) => g.count >= MIN_GROUP_SIZE && g[metric] != null)
  if (usable.length < 2) return null
  const sorted = [...usable].sort((a, b) => (b[metric] as number) - (a[metric] as number))
  const high = sorted[0]!
  const low = sorted[sorted.length - 1]!
  return { high, low, effect: (high[metric] as number) - (low[metric] as number) }
}

export function buildInsights(input: InsightInput): InsightCard[] {
  const { entries, phaseIndex, tagIndex } = input
  if (entries.length < MIN_TOTAL_ENTRIES) return []

  const cards: InsightCard[] = []

  // 1) 수면 × 기분/에너지
  const sleepGroups = groupBySleep(entries)
  for (const metric of ['moodAvg', 'energyAvg'] as const) {
    const cmp = compareGroups(sleepGroups, metric)
    if (!cmp) continue
    const strength = strengthOf(cmp.effect)
    if (!strength) continue
    const metricLabel = metric === 'moodAvg' ? '기분' : '에너지'
    cards.push({
      id: `sleep-${metric}`,
      kind: 'sleep',
      title: `${sleepLabel(cmp.high.key as SleepQuality)} 날의 ${metricLabel}이 더 높습니다`,
      body:
        `${cmp.high.label} ${round1(cmp.high[metric] as number)}점(${cmp.high.count}일) vs ` +
        `${cmp.low.label} ${round1(cmp.low[metric] as number)}점(${cmp.low.count}일). ` +
        `평균 ${round1(cmp.effect)}점 차이입니다.`,
      strength,
      magnitude: Math.abs(cmp.effect),
      sampleSize: cmp.high.count + cmp.low.count,
    })
  }

  // 2) 주기 단계 × 기분/에너지
  const phaseGroups = groupByPhase(entries, phaseIndex)
  if (phaseGroups.filter((g) => g.key !== 'none').length > 0) {
    for (const metric of ['moodAvg', 'energyAvg'] as const) {
      const cmp = compareGroups(phaseGroups, metric)
      if (!cmp || cmp.low.key === cmp.high.key) continue
      const strength = strengthOf(cmp.effect)
      if (!strength) continue
      const metricLabel = metric === 'moodAvg' ? '기분' : '에너지'
      cards.push({
        id: `phase-${metric}`,
        kind: 'cycle',
        title: `${cmp.low.label} 구간의 ${metricLabel}이 가장 낮습니다`,
        body:
          `${cmp.low.label} ${round1(cmp.low[metric] as number)}점(${cmp.low.count}일), ` +
          `${cmp.high.label} ${round1(cmp.high[metric] as number)}점(${cmp.high.count}일). ` +
          `평균 ${round1(cmp.effect)}점 차이입니다.`,
        strength,
        magnitude: Math.abs(cmp.effect),
        sampleSize: cmp.high.count + cmp.low.count,
      })
    }
  }

  // 3) 주기 단계별 태그 빈도
  for (const lift of computeTagLifts(entries, phaseIndex, tagIndex).slice(0, 3)) {
    const phaseLabel = PHASE_LABELS[lift.phase]
    const inPercent = Math.round(lift.inPhaseRate * 100)
    const outPercent = Math.round(lift.outPhaseRate * 100)
    const onlyInPhase = lift.outPhaseCount === 0
    cards.push({
      id: `taglift-${lift.phase}-${lift.tagId}`,
      kind: 'tag',
      title: onlyInPhase
        ? `'${lift.name}'은 ${phaseLabel} 구간에서만 나타났습니다`
        : `${phaseLabel} 구간에 '${lift.name}'이 몰립니다`,
      body: onlyInPhase
        ? `${phaseLabel} ${lift.phaseDays}일 중 ${lift.inPhaseCount}일(${inPercent}%)에 기록되었고, ` +
          `그 외 ${lift.outPhaseDays}일 동안은 한 번도 없었습니다.`
        : `${phaseLabel} ${lift.phaseDays}일 중 ${lift.inPhaseCount}일(${inPercent}%)에 나타났습니다. ` +
          `그 외 ${lift.outPhaseDays}일 중에는 ${lift.outPhaseCount}일(${outPercent}%)이었습니다.`,
      strength: lift.lift >= 2.5 ? 'strong' : 'moderate',
      magnitude: lift.lift,
      sampleSize: lift.phaseDays,
    })
  }

  // 4) 혼재 상태
  const mixedCandidates = entries.filter((e) => e.mood != null && e.energy != null)
  if (mixedCandidates.length >= MIN_TOTAL_ENTRIES) {
    const mixedRate = mixedCandidates.filter(isMixedState).length / mixedCandidates.length
    if (mixedRate >= 0.15) {
      const mixedEntries = mixedCandidates.filter(isMixedState)
      const phaseCounts = new Map<string, number>()
      for (const e of mixedEntries) {
        const p = phaseIndex.get(e.date)?.phase ?? 'none'
        phaseCounts.set(p, (phaseCounts.get(p) ?? 0) + 1)
      }
      const top = [...phaseCounts.entries()].sort((a, b) => b[1] - a[1])[0]
      const phaseNote =
        top && top[0] !== 'none' && top[1] / mixedEntries.length >= 0.4
          ? ` 이 중 ${Math.round((top[1] / mixedEntries.length) * 100)}%가 ${PHASE_LABELS[top[0] as CyclePhase]} 구간에 있었습니다.`
          : ''
      cards.push({
        id: 'mixed-rate',
        kind: 'mixed',
        title: `기분과 에너지가 어긋난 날이 ${Math.round(mixedRate * 100)}%입니다`,
        body:
          `기분·에너지를 모두 기록한 ${mixedCandidates.length}일 중 ${mixedEntries.length}일에서 ` +
          `두 값의 차이가 2 이상이었습니다.${phaseNote}`,
        strength: mixedRate >= 0.3 ? 'strong' : 'moderate',
        magnitude: mixedRate * 5,
        sampleSize: mixedCandidates.length,
      })
    }
  }

  // 5) 요일
  const weekdayCmp = compareGroups(groupByWeekday(entries), 'moodAvg')
  if (weekdayCmp) {
    const strength = strengthOf(weekdayCmp.effect)
    if (strength) {
      cards.push({
        id: 'weekday-mood',
        kind: 'weekday',
        title: `${weekdayCmp.low.label}의 기분이 가장 낮습니다`,
        body:
          `${weekdayCmp.low.label} ${round1(weekdayCmp.low.moodAvg as number)}점(${weekdayCmp.low.count}일), ` +
          `${weekdayCmp.high.label} ${round1(weekdayCmp.high.moodAvg as number)}점(${weekdayCmp.high.count}일).`,
        strength,
        magnitude: Math.abs(weekdayCmp.effect),
        sampleSize: weekdayCmp.high.count + weekdayCmp.low.count,
      })
    }
  }

  // 6) 기분-에너지 상관
  const paired = entries.filter((e) => e.mood != null && e.energy != null)
  const r = pearson(
    paired.map((e) => e.mood as number),
    paired.map((e) => e.energy as number),
  )
  if (r != null && Math.abs(r) >= 0.4) {
    cards.push({
      id: 'mood-energy-corr',
      kind: 'correlation',
      title:
        r > 0
          ? '기분과 에너지가 대체로 함께 움직입니다'
          : '기분과 에너지가 반대로 움직이는 경향이 있습니다',
      body: `${paired.length}일 기준 상관계수 ${r.toFixed(2)}입니다. 관계의 방향만 보여줄 뿐 원인을 말하지는 않습니다.`,
      strength: Math.abs(r) >= 0.7 ? 'strong' : 'moderate',
      magnitude: Math.abs(r) * 3,
      sampleSize: paired.length,
    })
  }

  const rank: Record<InsightStrength, number> = { strong: 0, moderate: 1 }
  return cards.sort((a, b) => rank[a.strength] - rank[b.strength] || b.magnitude - a.magnitude)
}

/** 기록이 있는 날짜만 골라 정렬해 돌려줍니다. */
export function entriesInRange(
  entryMap: Readonly<Record<DateKey, Entry>>,
  rangeStart: DateKey,
  rangeEnd: DateKey,
): Entry[] {
  return datesInRange(rangeStart, rangeEnd)
    .map((d) => entryMap[d])
    .filter((e): e is Entry => e != null)
}
