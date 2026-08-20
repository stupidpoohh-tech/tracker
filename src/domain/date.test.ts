import { describe, expect, it, afterEach } from 'vitest'
import {
  addDays,
  addMonths,
  datesInRange,
  diffDays,
  endOfMonth,
  fullLabel,
  isDateKey,
  relativeLabel,
  shortLabel,
  startOfMonth,
  toDateKey,
  todayKey,
  weekdayLabel,
} from './date'

const originalTz = process.env.TZ

function withTimeZone(tz: string, fn: () => void): void {
  process.env.TZ = tz
  try {
    fn()
  } finally {
    process.env.TZ = originalTz
  }
}

afterEach(() => {
  process.env.TZ = originalTz
})

describe('날짜 산술은 시간대와 무관합니다', () => {
  // v3 회귀 테스트: helpers.js가 toISOString()을 써서 KST에서 하루씩 밀렸습니다.
  const zones = ['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'Pacific/Kiritimati']

  it('addDays(key, 0)은 항상 같은 날짜입니다', () => {
    for (const tz of zones) {
      withTimeZone(tz, () => {
        expect(addDays('2026-08-20', 0)).toBe('2026-08-20')
      })
    }
  })

  it('addDays가 어느 시간대에서나 동일한 결과를 냅니다', () => {
    for (const tz of zones) {
      withTimeZone(tz, () => {
        expect(addDays('2026-08-20', -5)).toBe('2026-08-15')
        expect(addDays('2026-08-20', 5)).toBe('2026-08-25')
        expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
        expect(addDays('2024-02-28', 1)).toBe('2024-02-29') // 윤년
        expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
        expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
      })
    }
  })

  it('datesInRange가 양끝을 포함하고 밀리지 않습니다', () => {
    for (const tz of zones) {
      withTimeZone(tz, () => {
        expect(datesInRange('2026-08-18', '2026-08-20')).toEqual([
          '2026-08-18',
          '2026-08-19',
          '2026-08-20',
        ])
      })
    }
  })

  it('서머타임 전환 구간에서도 하루씩 진행합니다', () => {
    withTimeZone('America/Los_Angeles', () => {
      // 2026-03-08은 미국 서부 서머타임 시작일입니다.
      expect(datesInRange('2026-03-07', '2026-03-09')).toEqual([
        '2026-03-07',
        '2026-03-08',
        '2026-03-09',
      ])
      expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    })
  })

  it('end < start면 빈 배열입니다', () => {
    expect(datesInRange('2026-08-20', '2026-08-19')).toEqual([])
  })

  it('365일 범위 길이가 정확합니다', () => {
    expect(datesInRange('2025-01-01', '2025-12-31')).toHaveLength(365)
    expect(datesInRange('2024-01-01', '2024-12-31')).toHaveLength(366)
  })
})

describe('diffDays', () => {
  it('b가 나중이면 양수입니다', () => {
    expect(diffDays('2026-08-18', '2026-08-20')).toBe(2)
    expect(diffDays('2026-08-20', '2026-08-18')).toBe(-2)
    expect(diffDays('2026-08-20', '2026-08-20')).toBe(0)
  })

  it('연 경계를 넘어도 맞습니다', () => {
    expect(diffDays('2025-12-30', '2026-01-02')).toBe(3)
  })

  it('addDays와 왕복합니다', () => {
    for (let n = -400; n <= 400; n += 37) {
      expect(diffDays('2025-06-15', addDays('2025-06-15', n))).toBe(n)
    }
  })
})

describe('todayKey / toDateKey', () => {
  it('로컬 달력 날짜를 씁니다', () => {
    withTimeZone('Asia/Seoul', () => {
      // 2026-08-20T00:30+09:00 = 2026-08-19T15:30Z. 로컬로는 20일입니다.
      const d = new Date('2026-08-19T15:30:00.000Z')
      expect(toDateKey(d)).toBe('2026-08-20')
      expect(todayKey(d)).toBe('2026-08-20')
    })
  })

  it('UTC 기준 시간대에서는 UTC 날짜와 같습니다', () => {
    withTimeZone('UTC', () => {
      expect(toDateKey(new Date('2026-08-19T15:30:00.000Z'))).toBe('2026-08-19')
    })
  })
})

describe('월 단위', () => {
  it('startOfMonth / endOfMonth', () => {
    expect(startOfMonth('2026-08-20')).toBe('2026-08-01')
    expect(endOfMonth('2026-08-20')).toBe('2026-08-31')
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29')
  })

  it('addMonths는 말일을 넘기지 않습니다', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-08-20', 3)).toBe('2026-11-20')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })
})

describe('표시 라벨', () => {
  it('요일을 정확히 계산합니다', () => {
    expect(weekdayLabel('2026-08-20')).toBe('목')
    expect(weekdayLabel('2026-08-23')).toBe('일')
  })

  it('shortLabel / fullLabel', () => {
    expect(shortLabel('2026-08-05')).toBe('8/5')
    expect(fullLabel('2026-08-20')).toBe('2026년 8월 20일 (목)')
    expect(fullLabel('2026-08-20', false)).toBe('2026년 8월 20일')
  })

  it('relativeLabel', () => {
    expect(relativeLabel('2026-08-20', '2026-08-20')).toBe('오늘')
    expect(relativeLabel('2026-08-19', '2026-08-20')).toBe('어제')
    expect(relativeLabel('2026-08-17', '2026-08-20')).toBe('3일 전')
    expect(relativeLabel('2026-08-01', '2026-08-20')).toBe('8월 1일')
  })
})

describe('isDateKey', () => {
  it('유효한 키만 통과시킵니다', () => {
    expect(isDateKey('2026-08-20')).toBe(true)
    expect(isDateKey('2024-02-29')).toBe(true)
    expect(isDateKey('2025-02-29')).toBe(false)
    expect(isDateKey('2026-13-01')).toBe(false)
    expect(isDateKey('2026-8-20')).toBe(false)
    expect(isDateKey('20260820')).toBe(false)
    expect(isDateKey(null)).toBe(false)
    expect(isDateKey(20260820)).toBe(false)
  })
})
