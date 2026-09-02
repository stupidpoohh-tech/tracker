import type { DateKey } from '@/domain/date'
import { addDays, diffDays, endOfMonth, monthDayLabel, startOfMonth } from '@/domain/date'

export type RangePreset = '7' | '30' | '90' | 'year' | 'custom'

export const RANGE_PRESETS: readonly { id: RangePreset; label: string }[] = [
  { id: '7', label: '7일' },
  { id: '30', label: '30일' },
  { id: '90', label: '3개월' },
  { id: 'year', label: '연도별' },
  { id: 'custom', label: '직접 설정' },
]

export interface ResolvedRange {
  start: DateKey
  end: DateKey
  label: string
  days: number
}

export interface CustomRange {
  start: DateKey
  end: DateKey
}

const PRESET_DAYS: Record<string, number> = { '7': 7, '30': 30, '90': 90 }

/**
 * 표시 구간을 계산합니다.
 *
 * v3는 `addDays(today, -offset*rangeDays)`로 끝 날짜를 잡았는데, addDays가
 * KST에서 하루 밀리는 바람에 offset이 0이어도 끝이 '어제'가 되어 **오늘 기록이
 * 차트에 나오지 않았습니다**. 날짜 산술을 고쳤으므로 여기서는 그대로 계산합니다.
 */
export function resolveRange(
  preset: RangePreset,
  offset: number,
  today: DateKey,
  custom: CustomRange,
): ResolvedRange {
  if (preset === 'custom') {
    const start = custom.start <= custom.end ? custom.start : custom.end
    const end = custom.start <= custom.end ? custom.end : custom.start
    return {
      start,
      end,
      label: `${monthDayLabel(start)} ~ ${monthDayLabel(end)}`,
      days: diffDays(start, end) + 1,
    }
  }

  if (preset === 'year') {
    const year = Number(today.slice(0, 4)) - offset
    const start = `${year}-01-01`
    const rawEnd = `${year}-12-31`
    const end = rawEnd > today ? today : rawEnd
    return { start, end, label: `${year}년`, days: diffDays(start, end) + 1 }
  }

  const days = PRESET_DAYS[preset] ?? 7
  const end = addDays(today, -offset * days)
  const start = addDays(end, -(days - 1))
  return {
    start,
    end,
    label: `${monthDayLabel(start)} ~ ${monthDayLabel(end)}`,
    days,
  }
}

/** 기본 사용자 지정 구간: 이번 달. */
export function defaultCustomRange(today: DateKey): CustomRange {
  const end = endOfMonth(today)
  return { start: startOfMonth(today), end: end > today ? today : end }
}

export function canGoBack(
  preset: RangePreset,
  range: ResolvedRange,
  earliestData: DateKey | null,
): boolean {
  if (preset === 'custom') return false
  if (!earliestData) return false
  return range.start > earliestData
}

export function canGoForward(preset: RangePreset, offset: number): boolean {
  return preset !== 'custom' && offset > 0
}
