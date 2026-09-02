import { describe, expect, it } from 'vitest'
import { canGoBack, canGoForward, defaultCustomRange, resolveRange } from './range'

const TODAY = '2026-08-20'

describe('resolveRange', () => {
  // v3 회귀 테스트: KST에서 offset 0인데도 끝이 어제가 되어 오늘 기록이
  // 7·30·90일 차트에 나타나지 않았습니다.
  it('현재 구간의 끝은 오늘입니다', () => {
    for (const preset of ['7', '30', '90'] as const) {
      expect(resolveRange(preset, 0, TODAY, { start: TODAY, end: TODAY }).end).toBe(TODAY)
    }
  })

  it('7일 구간은 오늘 포함 7일입니다', () => {
    const range = resolveRange('7', 0, TODAY, { start: TODAY, end: TODAY })
    expect(range.start).toBe('2026-08-14')
    expect(range.end).toBe('2026-08-20')
    expect(range.days).toBe(7)
  })

  it('30일 구간', () => {
    const range = resolveRange('30', 0, TODAY, { start: TODAY, end: TODAY })
    expect(range.start).toBe('2026-07-22')
    expect(range.end).toBe('2026-08-20')
  })

  it('offset은 구간 단위로 뒤로 갑니다', () => {
    const range = resolveRange('7', 1, TODAY, { start: TODAY, end: TODAY })
    expect(range.end).toBe('2026-08-13')
    expect(range.start).toBe('2026-08-07')
  })

  it('연도별 구간은 올해면 오늘까지만 보여줍니다', () => {
    const range = resolveRange('year', 0, TODAY, { start: TODAY, end: TODAY })
    expect(range.start).toBe('2026-01-01')
    expect(range.end).toBe(TODAY)
    expect(range.label).toBe('2026년')
  })

  it('지난 연도는 연말까지입니다', () => {
    const range = resolveRange('year', 1, TODAY, { start: TODAY, end: TODAY })
    expect(range.start).toBe('2025-01-01')
    expect(range.end).toBe('2025-12-31')
    expect(range.days).toBe(365)
  })

  it('사용자 지정 구간의 순서가 뒤바뀌면 바로잡습니다', () => {
    const range = resolveRange('custom', 0, TODAY, { start: '2026-08-20', end: '2026-08-01' })
    expect(range.start).toBe('2026-08-01')
    expect(range.end).toBe('2026-08-20')
    expect(range.days).toBe(20)
  })
})

describe('defaultCustomRange', () => {
  it('이번 달, 오늘까지입니다', () => {
    expect(defaultCustomRange(TODAY)).toEqual({ start: '2026-08-01', end: '2026-08-20' })
  })

  it('지난 달이면 말일까지입니다', () => {
    expect(defaultCustomRange('2026-02-28')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })
})

describe('구간 이동 가능 여부', () => {
  it('가장 오래된 기록보다 앞이면 더 갈 수 없습니다', () => {
    const range = resolveRange('7', 0, TODAY, { start: TODAY, end: TODAY })
    expect(canGoBack('7', range, '2026-01-01')).toBe(true)
    expect(canGoBack('7', range, '2026-08-18')).toBe(false)
    expect(canGoBack('7', range, null)).toBe(false)
    expect(canGoBack('custom', range, '2020-01-01')).toBe(false)
  })

  it('현재 구간에서는 앞으로 갈 수 없습니다', () => {
    expect(canGoForward('7', 0)).toBe(false)
    expect(canGoForward('7', 1)).toBe(true)
    expect(canGoForward('custom', 3)).toBe(false)
  })
})
