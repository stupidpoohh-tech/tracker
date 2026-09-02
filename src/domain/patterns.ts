/**
 * 패턴 도메인.
 *
 * 이 서비스의 중심은 기록이 아니라 **패턴**입니다. 기록은 패턴을 발견하기 위한
 * 입력 수단입니다. 그래서 패턴은 화면에 출력되는 결과물이 아니라 안정적인
 * 정체성(id)과 상태(status)를 가진 1급 객체입니다.
 *
 * 저장하지 않고 파생합니다
 * -----------------------
 * '새로 발견됨'과 '변화한 패턴'을 알려면 과거와 비교해야 합니다. 스냅샷을
 * DB에 쌓는 대신 **최근 창과 직전 창을 각각 계산해 비교**합니다. 쓰기가 없고,
 * 마이그레이션이 없고, 무엇보다 정직합니다 — "이전 기간에는 보이지 않던
 * 관계"라는 진술이 데이터에서 직접 나옵니다.
 *
 * 과장하지 않습니다
 * -----------------
 * 모든 계산 결과를 '패턴'이라고 부르지 않습니다. 표본이 부족하면 부족하다고,
 * 차이가 없으면 없다고 말합니다. 상관을 인과로 쓰지 않습니다.
 */

import type { DateKey } from './date'
import { addDays, diffDays, weekdayLabel } from './date'
import type { CyclePhase, PhaseIndex } from './cycle'
import { PHASE_LABELS } from './cycle'
import type { Entry, SleepQuality, TagIndex } from './models'
import { SLEEP_OPTIONS, isMixedState, resolveEntryTagIds, sleepLabel } from './models'
import {
  groupBySleep,
  groupByPhase,
  groupByWeekday,
  pearson,
  stdev,
  type GroupSummary,
} from './insights'
import {
  correlationInterval,
  excludesZero,
  meanDiffInterval,
  proportionInterval,
  rateDiffInterval,
  zFor,
  type Interval,
} from './uncertainty'
import { objectParticle, subjectParticle, topicParticle, withParticle } from './korean'

// ─── 판정 기준 ────────────────────────────────────────────────────────────────

/** 한 그룹이 이 개수 미만이면 비교 자체를 하지 않습니다. */
export const MIN_GROUP = 5
/** 이 개수 미만이면 어떤 관계도 판단하지 않습니다. */
export const MIN_TOTAL = 14
/** '반복되는 패턴'이라고 부르려면 이만큼은 쌓여야 합니다. */
export const STABLE_GROUP = 12
export const STABLE_TOTAL = 35

/** 1~5 척도에서 이 정도 차이는 나야 언급할 가치가 있습니다. */
const MIN_SCALE_DELTA = 0.5
/** 비율 비교(태그 등)에서의 최소 차이. */
const MIN_RATE_DELTA = 0.18
/** 상관계수의 최소 절댓값. */
const MIN_CORRELATION = 0.4
/** 태그가 이 횟수 미만으로 나타나면 신호로 보지 않습니다. */
const MIN_TAG_OCCURRENCES = 4
/**
 * 효과 크기가 '언급 최소선' 한 칸만큼 달라지면 변화로 봅니다.
 *
 * 정규화된 strength로 비교하지 않습니다. strength는 큰 값일수록 완만해지도록
 * 눌러 담은 값이라, 같은 0.08 차이가 구간에 따라 0.2점이 되기도 0.5점이 되기도
 * 합니다. 변화 판정은 지표 고유 단위로 하는 편이 해석 가능합니다.
 */
const CHANGE_STEP = 1

/** 화면에 보여줄 구간의 신뢰수준. */
export const CONFIDENCE = 0.95

/**
 * '반복되는 패턴'이라고 부를 때 쓰는 유의수준.
 *
 * 한 번에 스무 개 안팎의 관계를 계산하고 그중 가장 강한 것을 화면에 올립니다.
 * 스무 개를 동시에 보면 우연히 큰 차이가 하나쯤 나오는 것이 오히려 정상입니다.
 * 그래서 확정적인 표현을 쓰는 'stable'에만 살펴본 관계 수로 나눈 유의수준
 * (본페로니 보정)을 요구합니다. 'signal'은 원래 잠정적인 표현이므로 효과
 * 크기와 표본만 봅니다.
 */
const FAMILY_ALPHA = 0.05

/** 기본 분석 창. 직전 같은 길이의 창과 비교합니다. */
export const DEFAULT_WINDOW_DAYS = 60

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export type PatternKind =
  | 'sleep-mood'
  | 'sleep-energy'
  | 'phase-mood'
  | 'phase-energy'
  | 'phase-tag'
  | 'tag-mood'
  | 'weekday-mood'
  | 'mood-energy'
  | 'mixed-state'

/**
 * 패턴의 현재 상태.
 *
 * 'none'은 실패가 아닙니다. 충분히 봤는데 차이가 없다는 것도 하나의 답입니다.
 */
export type PatternStatus =
  /** 아직 판단하기에 기록이 부족합니다. */
  | 'insufficient'
  /** 초기 경향이 보이지만 데이터가 충분하지 않습니다. */
  | 'signal'
  /** 여러 번 반복되어 비교적 안정적인 관계입니다. */
  | 'stable'
  /** 충분한 데이터가 있지만 의미 있는 차이가 없습니다. */
  | 'none'

export const STATUS_LABELS: Record<PatternStatus, string> = {
  insufficient: '데이터가 더 필요함',
  signal: '신호가 보임',
  stable: '반복되는 패턴',
  none: '뚜렷한 관계 없음',
}

/** 직전 같은 길이의 기간과 비교했을 때의 변화. */
export type PatternChange =
  /** 이전 기간에는 보이지 않던 관계입니다. */
  | 'new'
  | 'strengthened'
  | 'weakened'
  /** 이전에는 보였으나 최근에는 나타나지 않습니다. */
  | 'faded'
  | 'steady'
  /** 비교할 만큼의 과거 데이터가 없습니다. */
  | 'unknown'

export const CHANGE_LABELS: Record<PatternChange, string> = {
  new: '새로 발견됨',
  strengthened: '더 뚜렷해짐',
  weakened: '약해짐',
  faded: '최근에는 보이지 않음',
  steady: '계속 보이는 중',
  unknown: '',
}

export interface PatternVariable {
  key: string
  label: string
}

/** 근거로 보여줄 그룹별 비교. */
export interface PatternGroup {
  key: string
  label: string
  /** 척도 비교면 평균값, 비율 비교면 0~1 비율. */
  value: number
  /** 이 그룹의 표본 수. */
  count: number
}

export type PatternMetric = 'scale' | 'rate' | 'correlation'

export interface Pattern {
  /** 결정적으로 만들어집니다. 같은 관계는 언제 계산해도 같은 id입니다. */
  id: string
  kind: PatternKind
  variables: { a: PatternVariable; b: PatternVariable }
  title: string
  summary: string
  status: PatternStatus
  change: PatternChange
  metric: PatternMetric
  /**
   * 정렬용으로 0~1로 정규화한 효과 크기.
   * 지표별 언급 최소선 대비 배수라, 점수·비율·상관을 한 줄로 세울 수 있습니다.
   */
  strength: number
  /** 지표 고유 단위의 차이. 척도는 점, 비율은 0~1, 상관은 계수. */
  delta: number
  /** delta의 95% 구간. 낼 수 없으면 null입니다. */
  interval: Interval | null
  sampleSize: number
  window: { start: DateKey; end: DateKey; days: number }
  /** 이 패턴이 나온 계산에서 함께 살펴본 관계의 수. 다중비교 맥락입니다. */
  examined: number
  groups: PatternGroup[]
  /** 판단하려면 대략 며칠의 기록이 더 필요한지. 충분하면 null. */
  needed: number | null
  relatedTagIds: string[]
}

// ─── 내부 계산 ────────────────────────────────────────────────────────────────

interface Draft {
  id: string
  kind: PatternKind
  variables: { a: PatternVariable; b: PatternVariable }
  metric: PatternMetric
  groups: PatternGroup[]
  delta: number
  strength: number
  sampleSize: number
  usableSample: number
  /** 신뢰수준에 따른 delta의 구간. 보정된 수준으로도 다시 부릅니다. */
  interval: (z: number) => Interval | null
  /**
   * 그룹별 최소 표본을 요구할지.
   *
   * 그룹을 나눠 비교하는 관계에서는 한쪽이 비면 비교 자체가 성립하지 않습니다.
   * 반대로 상관계수나 발생률처럼 전체를 한 덩어리로 보는 지표는 그룹 크기를
   * 따질 대상이 아니어서, 요구하면 아무리 기록해도 '데이터 부족'에 갇힙니다.
   */
  gateGroups: boolean
  relatedTagIds: string[]
  describe: (status: PatternStatus) => { title: string; summary: string }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function percent(value: number): number {
  return Math.round(value * 100)
}

/**
 * 표본과 효과 크기로 상태를 정합니다.
 * 두 축을 분리하는 것이 핵심입니다 — 표본이 적으면 차이가 커도 '신호'일 뿐입니다.
 */
function judge(
  draft: Draft,
  minDelta: number,
  adjustedZ: number,
): { status: PatternStatus; needed: number | null } {
  const groupsUsable = draft.gateGroups
    ? draft.groups.length >= 2 && draft.groups.every((g) => g.count >= MIN_GROUP)
    : true
  const enoughTotal = draft.sampleSize >= MIN_TOTAL

  if (!groupsUsable || !enoughTotal) {
    const byTotal = MIN_TOTAL - draft.sampleSize
    const byGroup = draft.gateGroups
      ? Math.max(0, ...draft.groups.map((g) => MIN_GROUP - g.count))
      : 0
    return { status: 'insufficient', needed: Math.max(1, byTotal, byGroup) }
  }

  if (Math.abs(draft.delta) < minDelta) return { status: 'none', needed: null }

  // 표본이 충분한 데다, 살펴본 관계 수를 감안한 구간이 0을 넘지 않을 때만
  // '반복되는 패턴'이라고 부릅니다. 표본만으로 확정하면 여러 관계를 동시에 본
  // 결과 중 우연히 큰 것을 지목하게 됩니다.
  const solid =
    draft.sampleSize >= STABLE_TOTAL &&
    (!draft.gateGroups || draft.groups.every((g) => g.count >= STABLE_GROUP)) &&
    excludesZero(draft.interval(adjustedZ))
  if (solid) return { status: 'stable', needed: null }

  // 표본이 모자란 것과, 표본은 찼는데 차이가 아직 확실하지 않은 것을 구분합니다.
  // 후자에 "약 1일 더 모으면 됩니다"라고 하면 지키지 못할 약속이 됩니다.
  const byTotal = STABLE_TOTAL - draft.sampleSize
  const byGroup = draft.gateGroups
    ? Math.max(0, ...draft.groups.map((g) => STABLE_GROUP - g.count))
    : 0
  const short = Math.max(byTotal, byGroup)
  return { status: 'signal', needed: short > 0 ? short : null }
}

function minDeltaFor(metric: PatternMetric): number {
  if (metric === 'scale') return MIN_SCALE_DELTA
  if (metric === 'rate') return MIN_RATE_DELTA
  return MIN_CORRELATION
}

/**
 * 서로 다른 지표를 한 줄로 세우기 위한 정규화.
 *
 * 점수·비율·상관계수는 단위가 다르므로 원값끼리 비교할 수 없습니다. 각 지표의
 * **언급 최소선 대비 몇 배인지**(ratio)로 환산한 뒤 0~1로 눌러 담습니다.
 *
 * 이 환산을 하지 않으면 상관계수가 늘 이깁니다. 1~5 척도에서 1.5점 차이는 큰
 * 차이인데 `1.5 / 4 = 0.38`인 반면 상관 0.7은 그대로 0.7이 되기 때문입니다.
 * 그 결과 거의 모든 사용자에게 "기분과 에너지가 함께 움직입니다"라는, 사실이긴
 * 하나 알려주는 바가 적은 관계가 대표 발견으로 올라옵니다.
 *
 * 상한에서 잘라내지 않고 `ratio / (ratio + 2)`로 완만하게 수렴시킵니다. 잘라내면
 * 큰 효과들이 전부 1.0으로 묶여, 무엇이 대표 발견인지를 결국 id 알파벳 순서가
 * 정하게 됩니다.
 */
function normalizeStrength(delta: number, metric: PatternMetric): number {
  const ratio = effectRatio(delta, metric)
  return ratio / (ratio + 2)
}

/** 효과 크기가 그 지표의 언급 최소선의 몇 배인지. */
function effectRatio(delta: number, metric: PatternMetric): number {
  return Math.abs(delta) / minDeltaFor(metric)
}

// ─── 탐지기 ───────────────────────────────────────────────────────────────────

const SCALE_META = {
  mood: { key: 'mood', label: '기분' },
  energy: { key: 'energy', label: '에너지' },
} as const

type ScaleKey = keyof typeof SCALE_META

/** 두 그룹의 평균 차이에 대한 구간. GroupSummary가 표준편차를 갖고 있습니다. */
function scaleDiffInterval(
  high: GroupSummary,
  low: GroupSummary,
  scale: ScaleKey,
  z: number,
): Interval | null {
  const stats = (g: GroupSummary) =>
    scale === 'mood'
      ? { mean: g.moodAvg as number, sd: g.moodSd, n: g.moodCount }
      : { mean: g.energyAvg as number, sd: g.energySd, n: g.energyCount }
  return meanDiffInterval(stats(high), stats(low), z)
}

/** 그룹 중 최고·최저를 뽑아 차이를 냅니다. */
function extremes(groups: readonly GroupSummary[], metric: 'moodAvg' | 'energyAvg') {
  const usable = groups.filter((g) => g.count > 0 && g[metric] != null)
  if (usable.length < 2) return null
  const sorted = [...usable].sort((a, b) => (b[metric] as number) - (a[metric] as number))
  const high = sorted[0] as GroupSummary
  const low = sorted[sorted.length - 1] as GroupSummary
  return { high, low, delta: (high[metric] as number) - (low[metric] as number) }
}

function detectSleepScale(entries: readonly Entry[], scale: ScaleKey): Draft | null {
  const metric = scale === 'mood' ? 'moodAvg' : 'energyAvg'
  const groups = groupBySleep(entries)
  const cmp = extremes(groups, metric)
  if (!cmp) return null

  const usable = groups.filter((g) => g.count > 0 && g[metric] != null)
  const label = SCALE_META[scale].label
  const highLabel = cmp.high.label
  const lowLabel = cmp.low.label

  return {
    id: `sleep-${scale}`,
    kind: scale === 'mood' ? 'sleep-mood' : 'sleep-energy',
    variables: { a: { key: 'sleep', label: '수면' }, b: SCALE_META[scale] },
    metric: 'scale',
    groups: usable.map((g) => ({
      key: g.key,
      label: g.label,
      value: round1(g[metric] as number),
      count: g.count,
    })),
    delta: cmp.delta,
    interval: (z) => scaleDiffInterval(cmp.high, cmp.low, scale, z),
    strength: normalizeStrength(cmp.delta, 'scale'),
    sampleSize: usable.reduce((sum, g) => sum + g.count, 0),
    usableSample: cmp.high.count + cmp.low.count,
    gateGroups: true,
    relatedTagIds: [],
    describe: (status) => ({
      title:
        status === 'none'
          ? `수면과 ${label} 사이에 뚜렷한 차이가 없습니다`
          : `${highLabel} 날에 ${label}${subjectParticle(label)} 더 높게 나타납니다`,
      summary:
        status === 'none'
          ? `수면 상태별 ${label} 평균이 비슷했습니다.`
          : `${highLabel} ${round1(cmp.high[metric] as number)}점(${cmp.high.count}일), ` +
            `${lowLabel} ${round1(cmp.low[metric] as number)}점(${cmp.low.count}일). ` +
            `평균 ${round1(cmp.delta)}점 차이입니다.`,
    }),
  }
}

function detectPhaseScale(
  entries: readonly Entry[],
  phaseIndex: PhaseIndex,
  scale: ScaleKey,
): Draft | null {
  const metric = scale === 'mood' ? 'moodAvg' : 'energyAvg'
  const groups = groupByPhase(entries, phaseIndex)
  if (groups.filter((g) => g.key !== 'none').length === 0) return null
  const cmp = extremes(groups, metric)
  if (!cmp || cmp.high.key === cmp.low.key) return null

  const usable = groups.filter((g) => g.count > 0 && g[metric] != null)
  const label = SCALE_META[scale].label

  return {
    id: `phase-${scale}`,
    kind: scale === 'mood' ? 'phase-mood' : 'phase-energy',
    variables: { a: { key: 'phase', label: '생리주기' }, b: SCALE_META[scale] },
    metric: 'scale',
    groups: usable.map((g) => ({
      key: g.key,
      label: g.label,
      value: round1(g[metric] as number),
      count: g.count,
    })),
    delta: cmp.delta,
    interval: (z) => scaleDiffInterval(cmp.high, cmp.low, scale, z),
    strength: normalizeStrength(cmp.delta, 'scale'),
    sampleSize: usable.reduce((sum, g) => sum + g.count, 0),
    usableSample: cmp.high.count + cmp.low.count,
    gateGroups: true,
    relatedTagIds: [],
    describe: (status) => ({
      title:
        status === 'none'
          ? `주기 단계에 따른 ${label} 차이가 뚜렷하지 않습니다`
          : `${cmp.low.label} 구간에 ${label}${subjectParticle(label)} 가장 낮게 나타납니다`,
      summary:
        status === 'none'
          ? `주기 단계별 ${label} 평균이 비슷했습니다.`
          : `${cmp.low.label} ${round1(cmp.low[metric] as number)}점(${cmp.low.count}일), ` +
            `${cmp.high.label} ${round1(cmp.high[metric] as number)}점(${cmp.high.count}일). ` +
            `평균 ${round1(cmp.delta)}점 차이입니다.`,
    }),
  }
}

/**
 * 주기 단계별 태그 빈도.
 *
 * 단순 빈도가 아니라 **기저 비율과 비교**합니다. 짜증 기록의 69%가 생리 전에
 * 있었다는 사실만으로는 아무것도 알 수 없습니다 — 생리 전 구간이 전체에서
 * 차지하는 비중을 함께 봐야 합니다.
 */
function detectPhaseTags(
  entries: readonly Entry[],
  phaseIndex: PhaseIndex,
  tagIndex: TagIndex,
): Draft[] {
  const byPhase = new Map<CyclePhase, Entry[]>()
  for (const entry of entries) {
    const phase = phaseIndex.get(entry.date)?.phase
    if (!phase) continue
    const list = byPhase.get(phase) ?? []
    list.push(entry)
    byPhase.set(phase, list)
  }

  const drafts: Draft[] = []
  for (const [phase, inPhase] of byPhase) {
    const outPhase = entries.filter((e) => phaseIndex.get(e.date)?.phase !== phase)
    if (inPhase.length === 0 || outPhase.length === 0) continue

    const countIn = new Map<string, number>()
    for (const e of inPhase) {
      for (const id of resolveEntryTagIds(e, tagIndex)) countIn.set(id, (countIn.get(id) ?? 0) + 1)
    }
    const countOut = new Map<string, number>()
    for (const e of outPhase) {
      for (const id of resolveEntryTagIds(e, tagIndex)) countOut.set(id, (countOut.get(id) ?? 0) + 1)
    }

    for (const [tagId, inCount] of countIn) {
      if (inCount < MIN_TAG_OCCURRENCES) continue
      const name = tagIndex.byId.get(tagId)?.name ?? tagId
      const outCount = countOut.get(tagId) ?? 0
      const inRate = inCount / inPhase.length
      const outRate = outCount / outPhase.length
      const delta = inRate - outRate
      if (delta <= 0) continue

      const phaseLabel = PHASE_LABELS[phase]
      drafts.push({
        id: `phase-tag:${phase}:${tagId}`,
        kind: 'phase-tag',
        variables: { a: { key: phase, label: phaseLabel }, b: { key: tagId, label: name } },
        metric: 'rate',
        groups: [
          { key: 'in', label: phaseLabel, value: inRate, count: inPhase.length },
          { key: 'out', label: '그 외 기간', value: outRate, count: outPhase.length },
        ],
        delta,
        interval: (z) =>
          rateDiffInterval(
            { rate: inRate, n: inPhase.length },
            { rate: outRate, n: outPhase.length },
            z,
          ),
        strength: normalizeStrength(delta, 'rate'),
        sampleSize: inPhase.length + outPhase.length,
        usableSample: inPhase.length,
        gateGroups: true,
        relatedTagIds: [tagId],
        describe: (status) => ({
          title:
            status === 'none'
              ? `'${name}'${topicParticle(name)} ${phaseLabel} 구간과 특별한 관계가 없습니다`
              : outCount === 0
                ? `'${name}'${topicParticle(name)} ${phaseLabel} 구간에서만 나타났습니다`
                : `${phaseLabel} 구간에 '${name}'${subjectParticle(name)} 더 자주 나타납니다`,
          summary:
            outCount === 0
              ? `${phaseLabel} ${inPhase.length}일 중 ${inCount}일(${percent(inRate)}%)에 기록되었고, ` +
                `그 외 ${outPhase.length}일 동안은 한 번도 없었습니다.`
              : `${phaseLabel}에는 ${inPhase.length}일 중 ${inCount}일(${percent(inRate)}%), ` +
                `그 외 기간에는 ${outPhase.length}일 중 ${outCount}일(${percent(outRate)}%)이었습니다.`,
        }),
      })
    }
  }
  return drafts
}

/** 특정 태그를 기록한 날과 그렇지 않은 날의 기분 차이. */
function detectTagScale(entries: readonly Entry[], tagIndex: TagIndex): Draft[] {
  const withMood = entries.filter((e) => e.mood != null)
  if (withMood.length < MIN_TOTAL) return []

  const tagged = new Map<string, Entry[]>()
  for (const entry of withMood) {
    for (const id of resolveEntryTagIds(entry, tagIndex)) {
      const list = tagged.get(id) ?? []
      list.push(entry)
      tagged.set(id, list)
    }
  }

  const drafts: Draft[] = []
  for (const [tagId, onDays] of tagged) {
    if (onDays.length < MIN_GROUP) continue
    const onSet = new Set(onDays.map((e) => e.date))
    const offDays = withMood.filter((e) => !onSet.has(e.date))
    if (offDays.length < MIN_GROUP) continue

    const avg = (list: readonly Entry[]): number =>
      list.reduce((sum, e) => sum + (e.mood as number), 0) / list.length
    const onAvg = avg(onDays)
    const offAvg = avg(offDays)
    const delta = onAvg - offAvg
    const onSd = stdev(onDays.map((e) => e.mood as number))
    const offSd = stdev(offDays.map((e) => e.mood as number))
    const name = tagIndex.byId.get(tagId)?.name ?? tagId

    drafts.push({
      id: `tag-mood:${tagId}`,
      kind: 'tag-mood',
      variables: { a: { key: tagId, label: name }, b: SCALE_META.mood },
      metric: 'scale',
      groups: [
        {
          key: 'on',
          label: `'${name}'${objectParticle(name)} 기록한 날`,
          value: round1(onAvg),
          count: onDays.length,
        },
        { key: 'off', label: '그 외', value: round1(offAvg), count: offDays.length },
      ],
      delta,
      interval: (z) =>
        meanDiffInterval(
          { mean: onAvg, sd: onSd, n: onDays.length },
          { mean: offAvg, sd: offSd, n: offDays.length },
          z,
        ),
      strength: normalizeStrength(delta, 'scale'),
      sampleSize: withMood.length,
      usableSample: onDays.length,
      gateGroups: true,
      relatedTagIds: [tagId],
      describe: (status) => ({
        title:
          status === 'none'
            ? `'${name}'${withParticle(name)} 기분 사이에 뚜렷한 차이가 없습니다`
            : delta < 0
              ? `'${name}'${objectParticle(name)} 기록한 날에 기분이 더 낮습니다`
              : `'${name}'${objectParticle(name)} 기록한 날에 기분이 더 높습니다`,
        summary:
          `'${name}'${objectParticle(name)} 기록한 ${onDays.length}일의 기분 평균은 ${round1(onAvg)}점, ` +
          `그 외 ${offDays.length}일은 ${round1(offAvg)}점이었습니다.`,
      }),
    })
  }
  return drafts
}

function detectWeekdayMood(entries: readonly Entry[]): Draft | null {
  const groups = groupByWeekday(entries)
  const cmp = extremes(groups, 'moodAvg')
  if (!cmp) return null
  const usable = groups.filter((g) => g.count > 0 && g.moodAvg != null)

  return {
    id: 'weekday-mood',
    kind: 'weekday-mood',
    variables: { a: { key: 'weekday', label: '요일' }, b: SCALE_META.mood },
    metric: 'scale',
    groups: usable.map((g) => ({
      key: g.key,
      label: g.label,
      value: round1(g.moodAvg as number),
      count: g.count,
    })),
    delta: cmp.delta,
    interval: (z) => scaleDiffInterval(cmp.high, cmp.low, 'mood', z),
    strength: normalizeStrength(cmp.delta, 'scale'),
    sampleSize: usable.reduce((sum, g) => sum + g.count, 0),
    usableSample: cmp.high.count + cmp.low.count,
    gateGroups: true,
    relatedTagIds: [],
    describe: (status) => ({
      title:
        status === 'none'
          ? '요일에 따른 기분 차이가 뚜렷하지 않습니다'
          : `${cmp.low.label}의 기분이 가장 낮게 나타납니다`,
      summary:
        `${cmp.low.label} ${round1(cmp.low.moodAvg as number)}점(${cmp.low.count}일), ` +
        `${cmp.high.label} ${round1(cmp.high.moodAvg as number)}점(${cmp.high.count}일).`,
    }),
  }
}

function detectMoodEnergy(entries: readonly Entry[]): Draft | null {
  const paired = entries.filter((e) => e.mood != null && e.energy != null)
  const r = pearson(
    paired.map((e) => e.mood as number),
    paired.map((e) => e.energy as number),
  )
  if (r == null) return null

  return {
    id: 'mood-energy',
    kind: 'mood-energy',
    variables: { a: SCALE_META.mood, b: SCALE_META.energy },
    metric: 'correlation',
    groups: [{ key: 'all', label: '기분·에너지를 모두 기록한 날', value: r, count: paired.length }],
    delta: r,
    interval: (z) => correlationInterval(r, paired.length, z),
    strength: normalizeStrength(r, 'correlation'),
    sampleSize: paired.length,
    usableSample: paired.length,
    gateGroups: false,
    relatedTagIds: [],
    describe: (status) => ({
      title:
        status === 'none'
          ? '기분과 에너지가 서로 따로 움직입니다'
          : r > 0
            ? '기분과 에너지가 대체로 함께 움직입니다'
            : '기분과 에너지가 반대로 움직이는 경향이 있습니다',
      summary: `${paired.length}일 기준 상관계수 ${r.toFixed(2)}입니다. 관계의 방향만 보여줄 뿐 원인을 말하지는 않습니다.`,
    }),
  }
}

function detectMixedState(entries: readonly Entry[]): Draft | null {
  const candidates = entries.filter((e) => e.mood != null && e.energy != null)
  if (candidates.length === 0) return null
  const mixed = candidates.filter(isMixedState)
  const rate = mixed.length / candidates.length

  return {
    id: 'mixed-state',
    kind: 'mixed-state',
    variables: { a: SCALE_META.mood, b: SCALE_META.energy },
    metric: 'rate',
    groups: [
      { key: 'mixed', label: '기분·에너지가 어긋난 날', value: rate, count: mixed.length },
      {
        key: 'aligned',
        label: '나란히 간 날',
        value: 1 - rate,
        count: candidates.length - mixed.length,
      },
    ],
    // 기저(0)와의 차이가 아니라 발생률 자체를 신호로 봅니다.
    delta: rate,
    interval: (z) => proportionInterval(rate, candidates.length, z),
    strength: normalizeStrength(rate, 'rate'),
    sampleSize: candidates.length,
    usableSample: candidates.length,
    gateGroups: false,
    relatedTagIds: [],
    describe: (status) => ({
      title:
        status === 'insufficient'
          ? '기분과 에너지가 어긋나는 날을 살펴보기에는 기록이 부족합니다'
          : status === 'none'
            ? '기분과 에너지가 어긋난 날은 드뭅니다'
            : `기분과 에너지가 어긋난 날이 ${percent(rate)}%입니다`,
      summary:
        `두 값을 모두 기록한 ${candidates.length}일 중 ${mixed.length}일에서 ` +
        `차이가 2점 이상이었습니다.`,
    }),
  }
}

// ─── 조립 ─────────────────────────────────────────────────────────────────────

function collectDrafts(
  entries: readonly Entry[],
  phaseIndex: PhaseIndex,
  tagIndex: TagIndex,
): Map<string, Draft> {
  const drafts: (Draft | null)[] = [
    detectSleepScale(entries, 'mood'),
    detectSleepScale(entries, 'energy'),
    detectPhaseScale(entries, phaseIndex, 'mood'),
    detectPhaseScale(entries, phaseIndex, 'energy'),
    detectWeekdayMood(entries),
    detectMoodEnergy(entries),
    detectMixedState(entries),
    ...detectPhaseTags(entries, phaseIndex, tagIndex),
    ...detectTagScale(entries, tagIndex),
  ]
  const map = new Map<string, Draft>()
  for (const draft of drafts) if (draft) map.set(draft.id, draft)
  return map
}

function statusOf(draft: Draft, adjustedZ: number): PatternStatus {
  return judge(draft, minDeltaFor(draft.metric), adjustedZ).status
}

/**
 * 최근 창과 직전 창을 비교해 변화를 정합니다.
 *
 * '과거가 아예 없음'과 '과거 창은 있었지만 이 관계를 잴 수 없었음'을 구분합니다.
 * 전자는 이 사용자에게 실제로 처음 보이는 관계이므로 '새로 발견됨'이 맞지만,
 * 후자는 예전에도 있었는지 알 수 없으므로 단정하지 않습니다.
 */
function compareWindows(
  current: Draft,
  currentStatus: PatternStatus,
  previous: Draft | undefined,
  hasPreviousWindow: boolean,
  previousZ: number,
): PatternChange {
  const visible = (s: PatternStatus): boolean => s === 'signal' || s === 'stable'
  if (!visible(currentStatus)) {
    if (previous && visible(statusOf(previous, previousZ))) return 'faded'
    return 'unknown'
  }

  // 비교할 과거 자체가 없는 신규 사용자.
  if (!hasPreviousWindow) return 'new'
  // 과거 창은 있었지만 이 관계를 볼 데이터가 없었습니다.
  if (!previous) return 'unknown'

  const previousStatus = statusOf(previous, previousZ)
  if (previousStatus === 'insufficient') return 'unknown'
  if (previousStatus === 'none') return 'new'

  const diff =
    effectRatio(current.delta, current.metric) - effectRatio(previous.delta, previous.metric)
  if (diff >= CHANGE_STEP) return 'strengthened'
  if (diff <= -CHANGE_STEP) return 'weakened'
  return 'steady'
}

export interface PatternInput {
  /** 전체 기록. 창 분할은 내부에서 합니다. */
  entries: Readonly<Record<DateKey, Entry>>
  phaseIndex: PhaseIndex
  tagIndex: TagIndex
  today: DateKey
  windowDays?: number
}

function slice(
  entries: Readonly<Record<DateKey, Entry>>,
  start: DateKey,
  end: DateKey,
): Entry[] {
  return Object.values(entries)
    .filter((e) => e.date >= start && e.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * 현재 발견된 패턴 전체.
 *
 * 정렬은 상태(반복 > 신호 > 부족 > 없음) → 강도 순입니다. 사용자가 화면에서
 * 먼저 보는 것이 가장 확실한 관계여야 합니다.
 */
export function buildPatterns(input: PatternInput): Pattern[] {
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS
  const recentStart = addDays(input.today, -(windowDays - 1))
  const previousEnd = addDays(recentStart, -1)
  const previousStart = addDays(previousEnd, -(windowDays - 1))

  const recentEntries = slice(input.entries, recentStart, input.today)
  const previousEntries = slice(input.entries, previousStart, previousEnd)

  const current = collectDrafts(recentEntries, input.phaseIndex, input.tagIndex)
  const hasPreviousWindow = previousEntries.length >= MIN_TOTAL
  const previous = hasPreviousWindow
    ? collectDrafts(previousEntries, input.phaseIndex, input.tagIndex)
    : new Map<string, Draft>()

  // 한 번에 살펴본 관계의 수만큼 유의수준을 나눕니다(본페로니). 스무 개를 보고
  // 그중 가장 큰 것을 고르면서 각각을 5% 기준으로 판정하면, 우연을 발견이라고
  // 부르게 됩니다.
  const examined = Math.max(1, current.size)
  const adjustedZ = zFor(1 - FAMILY_ALPHA / examined)
  const shownZ = zFor(CONFIDENCE)
  const previousZ = zFor(1 - FAMILY_ALPHA / Math.max(1, previous.size))

  const patterns: Pattern[] = []
  for (const draft of current.values()) {
    const { status, needed } = judge(draft, minDeltaFor(draft.metric), adjustedZ)
    const { title, summary } = draft.describe(status)
    patterns.push({
      id: draft.id,
      kind: draft.kind,
      variables: draft.variables,
      title,
      summary,
      status,
      change: compareWindows(draft, status, previous.get(draft.id), hasPreviousWindow, previousZ),
      metric: draft.metric,
      strength: draft.strength,
      delta: draft.delta,
      interval: draft.interval(shownZ),
      sampleSize: draft.sampleSize,
      window: { start: recentStart, end: input.today, days: windowDays },
      examined,
      groups: draft.groups,
      needed,
      relatedTagIds: draft.relatedTagIds,
    })
  }

  const rank: Record<PatternStatus, number> = { stable: 0, signal: 1, insufficient: 2, none: 3 }
  return patterns.sort(
    (a, b) => rank[a.status] - rank[b.status] || b.strength - a.strength || a.id.localeCompare(b.id),
  )
}

/** 화면에서 '발견'으로 보여줄 만한 것만. */
export function visiblePatterns(patterns: readonly Pattern[]): Pattern[] {
  return patterns.filter((p) => p.status === 'stable' || p.status === 'signal')
}

/** 홈에 하나만 띄울 가장 중요한 발견. */
export function headlinePattern(patterns: readonly Pattern[]): Pattern | null {
  const visible = visiblePatterns(patterns)
  if (visible.length === 0) return null
  // 새로 발견된 것을 먼저 보여줍니다. 이미 본 것을 다시 띄우면 의미가 없습니다.
  const fresh = visible.filter((p) => p.change === 'new' || p.change === 'strengthened')
  return (fresh[0] ?? visible[0]) as Pattern
}

export interface PatternSections {
  discovered: Pattern[]
  observed: Pattern[]
  stable: Pattern[]
  changing: Pattern[]
  needsData: Pattern[]
  noRelation: Pattern[]
}

/** 패턴 화면의 섹션 분류. 한 패턴은 한 섹션에만 들어갑니다. */
export function sectionPatterns(
  patterns: readonly Pattern[],
  observedIds: ReadonlySet<string>,
): PatternSections {
  const sections: PatternSections = {
    discovered: [],
    observed: [],
    stable: [],
    changing: [],
    needsData: [],
    noRelation: [],
  }
  for (const pattern of patterns) {
    if (observedIds.has(pattern.id)) sections.observed.push(pattern)
    else if (pattern.status === 'insufficient') sections.needsData.push(pattern)
    else if (pattern.status === 'none') sections.noRelation.push(pattern)
    else if (pattern.change === 'new') sections.discovered.push(pattern)
    else if (pattern.change === 'strengthened' || pattern.change === 'weakened')
      sections.changing.push(pattern)
    else sections.stable.push(pattern)
  }
  return sections
}

/**
 * 이 패턴 id가 해당 태그를 재료로 만들어졌는지.
 *
 * 태그를 완전히 삭제하면 그 태그로 만들어진 패턴은 다시 계산되지 않습니다.
 * 그 패턴을 지켜보던 관찰이 남아 있으면 사라진 대상을 관찰 중이라고 표시하게
 * 되므로, 삭제 경로에서 이 판정으로 함께 정리합니다. id 생성 규칙과 한 파일에
 * 두어 규칙이 바뀔 때 같이 바뀌게 합니다.
 */
export function patternUsesTag(patternId: string, tagId: string): boolean {
  if (patternId === `tag-mood:${tagId}`) return true
  return patternId.startsWith('phase-tag:') && patternId.endsWith(`:${tagId}`)
}

// ─── 관찰과의 비교 ────────────────────────────────────────────────────────────

/**
 * 관찰을 시작한 시점의 효과 크기.
 *
 * 관찰은 "이 관계를 계속 지켜보겠다"는 선언인데, 시작 시점을 남기지 않으면
 * 화면은 늘 현재 값만 보여줄 수 있습니다. 그러면 관찰이 즐겨찾기와 다르지
 * 않습니다. 시작 당시의 값을 함께 저장해야 '그 뒤로 어떻게 됐는지'를 말할 수
 * 있습니다.
 */
export interface PatternBaseline {
  delta: number
  metric: PatternMetric
  status: PatternStatus
  sampleSize: number
}

export type ObservationTrend =
  /** 관찰 이후 차이가 커졌습니다. */
  | 'grown'
  /** 관찰 이후 차이가 줄었습니다. */
  | 'shrunk'
  | 'steady'
  /** 시작할 때는 보이지 않던 관계가 지금은 보입니다. */
  | 'appeared'
  /** 시작할 때 보이던 관계가 지금은 나타나지 않습니다. */
  | 'gone'
  /** 비교할 수 없습니다. 단정하지 않습니다. */
  | 'unknown'

export function baselineOf(pattern: Pattern): PatternBaseline {
  return {
    delta: pattern.delta,
    metric: pattern.metric,
    status: pattern.status,
    sampleSize: pattern.sampleSize,
  }
}

/** 지금과 관찰 시작 시점을 견줍니다. 지표가 다르면 비교하지 않습니다. */
export function compareToBaseline(
  pattern: Pattern,
  baseline: PatternBaseline | undefined,
): ObservationTrend {
  if (!baseline || baseline.metric !== pattern.metric) return 'unknown'
  const visible = (s: PatternStatus): boolean => s === 'signal' || s === 'stable'

  if (!visible(pattern.status)) {
    if (visible(baseline.status)) return 'gone'
    if (pattern.status === 'none' && baseline.status === 'none') return 'steady'
    return 'unknown'
  }
  if (!visible(baseline.status)) {
    // 시작 시점에 표본이 부족했다면 그때 관계가 없었는지 알 수 없습니다.
    return baseline.status === 'insufficient' ? 'unknown' : 'appeared'
  }

  const diff =
    effectRatio(pattern.delta, pattern.metric) - effectRatio(baseline.delta, baseline.metric)
  if (diff >= CHANGE_STEP) return 'grown'
  if (diff <= -CHANGE_STEP) return 'shrunk'
  return 'steady'
}

/** 관찰 카드에 쓸 한 문장. 비교할 수 없으면 null을 돌려 기존 문구를 씁니다. */
export function describeObservationTrend(
  pattern: Pattern,
  baseline: PatternBaseline | undefined,
): string | null {
  const trend = compareToBaseline(pattern, baseline)
  if (trend === 'unknown' || !baseline) return null

  const then = formatMetricDelta(baseline.delta, baseline.metric)
  const now = formatMetricDelta(pattern.delta, pattern.metric)

  if (trend === 'appeared') return `관찰을 시작할 때는 뚜렷하지 않던 차이가 지금은 ${now}입니다.`
  if (trend === 'gone') return `관찰을 시작할 때 보이던 ${then} 차이가 지금은 나타나지 않습니다.`
  if (trend === 'grown') return `관찰을 시작할 때 ${then} 차이였고 지금은 ${now}입니다.`
  if (trend === 'shrunk') return `관찰을 시작할 때 ${then} 차이였고 지금은 ${now}로 줄었습니다.`
  return `관찰을 시작할 때와 비슷한 ${now} 차이입니다.`
}

// ─── 데이터 축적 단계 ─────────────────────────────────────────────────────────

export type DataStage = 'empty' | 'starting' | 'early' | 'accumulating' | 'sufficient'

export interface DataReadiness {
  stage: DataStage
  loggedDays: number
  /** 다음 단계까지 대략 며칠이 더 필요한지. 마지막 단계면 null. */
  needed: number | null
  headline: string
  detail: string
}

/**
 * 판단에 쓸 수 있는 기록이 며칠분인지 셉니다.
 *
 * 두 가지를 걸러냅니다.
 * 1. **분석 창 밖의 기록.** 패턴은 최근 창으로만 계산하므로, 전체 기록 수로
 *    충분도를 말하면 "충분합니다"라고 해놓고 모든 패턴이 '데이터 부족'으로
 *    나오는 상태가 됩니다.
 * 2. **값이 없는 문서.** 메모만 남긴 날은 기록이지만 패턴의 재료는 아닙니다.
 */
export function countLoggedDays(
  entries: Readonly<Record<DateKey, Entry>>,
  window?: { start: DateKey; end: DateKey },
): number {
  let count = 0
  for (const entry of Object.values(entries)) {
    if (window && (entry.date < window.start || entry.date > window.end)) continue
    const hasValue =
      entry.mood != null ||
      entry.energy != null ||
      entry.sleep != null ||
      entry.tagIds.length > 0 ||
      (entry.legacyTags?.length ?? 0) > 0
    if (hasValue) count += 1
  }
  return count
}

/**
 * 기록량에 따른 단계.
 *
 * 가짜 인사이트를 만들지 않기 위한 장치입니다. 날짜가 아니라 실제 기록 일수를
 * 기준으로 하고, 정밀한 척하는 퍼센트를 만들지 않습니다.
 */
export function assessReadiness(loggedDays: number): DataReadiness {
  if (loggedDays === 0) {
    return {
      stage: 'empty',
      loggedDays,
      needed: 1,
      headline: '아직 기록이 없습니다',
      detail: '오늘의 기분부터 남겨보세요. 시간이 쌓이면 반복되는 패턴을 찾아드립니다.',
    }
  }
  if (loggedDays < 7) {
    return {
      stage: 'starting',
      loggedDays,
      needed: 7 - loggedDays,
      headline: '기록이 시작됐습니다',
      detail: '패턴을 찾으려면 조금 더 필요합니다. 지금은 쌓는 시기입니다.',
    }
  }
  if (loggedDays < MIN_TOTAL) {
    return {
      stage: 'early',
      loggedDays,
      needed: MIN_TOTAL - loggedDays,
      headline: '조금씩 쌓이고 있습니다',
      detail: `약 ${MIN_TOTAL - loggedDays}일의 기록이 더 모이면 첫 신호를 살펴볼 수 있습니다.`,
    }
  }
  if (loggedDays < STABLE_TOTAL) {
    return {
      stage: 'accumulating',
      loggedDays,
      needed: STABLE_TOTAL - loggedDays,
      headline: '초기 신호를 볼 수 있습니다',
      detail: `약 ${STABLE_TOTAL - loggedDays}일이 더 모이면 반복되는 패턴인지 판단할 수 있습니다.`,
    }
  }
  return {
    stage: 'sufficient',
    loggedDays,
    needed: null,
    headline: '패턴을 판단하기에 충분합니다',
    detail: '기록이 쌓일수록 관계가 더 또렷해집니다.',
  }
}

// ─── 표시 보조 ────────────────────────────────────────────────────────────────

export function sleepOptionLabel(id: SleepQuality): string {
  return sleepLabel(id)
}

export const ALL_SLEEP_KEYS = SLEEP_OPTIONS.map((o) => o.id)

/** 상세 화면에서 쓸 그룹 값 표기. */
export function formatGroupValue(pattern: Pattern, group: PatternGroup): string {
  if (pattern.metric === 'rate') return `${percent(group.value)}%`
  if (pattern.metric === 'correlation') return group.value.toFixed(2)
  return `${group.value.toFixed(1)}점`
}

export function formatMetricDelta(delta: number, metric: PatternMetric): string {
  if (metric === 'rate') return `${percent(Math.abs(delta))}%p`
  if (metric === 'correlation') return Math.abs(delta).toFixed(2)
  return `${Math.abs(delta).toFixed(1)}점`
}

export function formatDelta(pattern: Pattern): string {
  return formatMetricDelta(pattern.delta, pattern.metric)
}

/**
 * 구간 표기.
 *
 * 차이를 크기로 말하므로(형태가 '0.8점 차이'입니다) 차이가 음수인 패턴은 구간도
 * 뒤집어 크기 범위로 보여줍니다. 그렇게 하지 않으면 "차이 0.8점, 구간 −1.2~−0.4점"
 * 처럼 읽는 사람이 부호를 두 번 해석해야 합니다.
 */
export function formatInterval(pattern: Pattern): string | null {
  if (!pattern.interval) return null
  const { low, high } =
    pattern.delta < 0
      ? { low: -pattern.interval.high, high: -pattern.interval.low }
      : pattern.interval

  if (pattern.metric === 'rate') return `${percent(low)}~${percent(high)}%p`
  if (pattern.metric === 'correlation') return `${low.toFixed(2)}~${high.toFixed(2)}`
  return `${low.toFixed(1)}~${high.toFixed(1)}점`
}

/** 다중비교 맥락 한 줄. 하나만 보고 고른 것이 아님을 밝힙니다. */
export function examinedNote(pattern: Pattern): string | null {
  if (pattern.examined < 2) return null
  return `이 기간에 함께 살펴본 관계 ${pattern.examined}개 가운데 하나입니다.`
}

/** 관찰 기간을 사람이 읽는 문장으로. */
export function windowLabel(pattern: Pattern): string {
  return `${pattern.window.days}일`
}

export function daysBetween(from: DateKey, to: DateKey): number {
  return Math.max(0, diffDays(from, to))
}

export function weekdayName(key: DateKey): string {
  return weekdayLabel(key)
}
