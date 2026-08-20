/**
 * 날짜 유틸리티.
 *
 * 이 앱의 모든 날짜 키는 `YYYY-MM-DD` 형식의 **로컬 달력 날짜**입니다.
 * 절대 `Date.prototype.toISOString()`으로 키를 만들지 마세요. UTC+9(KST)에서는
 * 로컬 자정이 전날 15:00Z이므로 하루가 밀립니다. (구버전의 실제 버그였습니다.)
 *
 * 날짜 산술은 전부 `Date.UTC` 기반으로 수행합니다. 로컬 자정을 거치지 않으므로
 * 시간대·서머타임과 무관하게 항상 동일한 결과를 냅니다.
 */

export type DateKey = string

const MS_PER_DAY = 86_400_000
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false
  const [y, m, d] = splitKey(value)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

function splitKey(key: DateKey): [number, number, number] {
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10))]
}

function format(y: number, m: number, d: number): DateKey {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 로컬 달력 기준 날짜 키. `Date`의 로컬 게터만 사용합니다. */
export function toDateKey(date: Date): DateKey {
  return format(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

/** 오늘(사용자 로컬 시간대 기준). */
export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now)
}

/** 날짜 키를 UTC 자정 시각으로 변환합니다. 표시·요일 계산 용도로만 쓰세요. */
export function toUtcDate(key: DateKey): Date {
  const [y, m, d] = splitKey(key)
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDays(key: DateKey, days: number): DateKey {
  const next = new Date(toUtcDate(key).getTime() + days * MS_PER_DAY)
  return format(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
}

export function addMonths(key: DateKey, months: number): DateKey {
  const [y, m, d] = splitKey(key)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  return format(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(d, lastDay))
}

/** b - a (일 단위). b가 나중이면 양수입니다. */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / MS_PER_DAY)
}

export function minKey(a: DateKey, b: DateKey): DateKey {
  return a <= b ? a : b
}

export function maxKey(a: DateKey, b: DateKey): DateKey {
  return a >= b ? a : b
}

export function clampKey(key: DateKey, lo: DateKey, hi: DateKey): DateKey {
  return minKey(maxKey(key, lo), hi)
}

/** start~end(양끝 포함) 날짜 키 배열. end < start면 빈 배열입니다. */
export function datesInRange(start: DateKey, end: DateKey): DateKey[] {
  const span = diffDays(start, end)
  if (span < 0) return []
  const out: DateKey[] = new Array(span + 1)
  for (let i = 0; i <= span; i++) out[i] = addDays(start, i)
  return out
}

export function startOfMonth(key: DateKey): DateKey {
  const [y, m] = splitKey(key)
  return format(y, m, 1)
}

export function endOfMonth(key: DateKey): DateKey {
  const [y, m] = splitKey(key)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return format(y, m, last)
}

export function monthKey(key: DateKey): string {
  return key.slice(0, 7)
}

/** 0=일요일 … 6=토요일 */
export function weekdayIndex(key: DateKey): number {
  return toUtcDate(key).getUTCDay()
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const

export function weekdayLabel(key: DateKey): string {
  return WEEKDAY_LABELS[weekdayIndex(key)] ?? ''
}

/** "8/20" */
export function shortLabel(key: DateKey): string {
  const [, m, d] = splitKey(key)
  return `${m}/${d}`
}

/** "2026년 8월 20일 (목)" */
export function fullLabel(key: DateKey, withWeekday = true): string {
  const [y, m, d] = splitKey(key)
  const base = `${y}년 ${m}월 ${d}일`
  return withWeekday ? `${base} (${weekdayLabel(key)})` : base
}

/** "8월 20일" */
export function monthDayLabel(key: DateKey): string {
  const [, m, d] = splitKey(key)
  return `${m}월 ${d}일`
}

/** "오늘" / "어제" / "3일 전" / "8월 20일" */
export function relativeLabel(key: DateKey, today: DateKey = todayKey()): string {
  const delta = diffDays(key, today)
  if (delta === 0) return '오늘'
  if (delta === 1) return '어제'
  if (delta === 2) return '그저께'
  if (delta > 0 && delta < 7) return `${delta}일 전`
  if (delta === -1) return '내일'
  if (delta < 0 && delta > -7) return `${-delta}일 후`
  return monthDayLabel(key)
}
