import { describe, expect, it } from 'vitest'
import {
  correlationInterval,
  excludesZero,
  meanDiffInterval,
  normalQuantile,
  proportionInterval,
  rateDiffInterval,
  zFor,
} from './uncertainty'

describe('normalQuantile', () => {
  it('알려진 분위수를 재현합니다', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 4)
    expect(normalQuantile(0.995)).toBeCloseTo(2.575829, 4)
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6)
  })

  it('꼬리 쪽에서도 대칭입니다', () => {
    expect(normalQuantile(0.001)).toBeCloseTo(-normalQuantile(0.999), 4)
  })

  it('범위를 벗어나면 NaN입니다', () => {
    expect(Number.isNaN(normalQuantile(0))).toBe(true)
    expect(Number.isNaN(normalQuantile(1))).toBe(true)
  })
})

describe('zFor', () => {
  it('95%는 1.96입니다', () => {
    expect(zFor(0.95)).toBeCloseTo(1.96, 2)
  })

  it('다중비교 보정으로 신뢰수준이 올라가면 z도 커집니다', () => {
    expect(zFor(1 - 0.05 / 20)).toBeGreaterThan(zFor(0.95))
  })
})

describe('meanDiffInterval', () => {
  it('차이를 가운데 두고 대칭입니다', () => {
    const interval = meanDiffInterval({ mean: 4, sd: 1, n: 25 }, { mean: 3, sd: 1, n: 25 }, 1.96)
    expect(interval).not.toBeNull()
    expect((interval as { low: number; high: number }).low).toBeCloseTo(1 - 1.96 * Math.sqrt(2 / 25), 6)
    expect((interval as { low: number; high: number }).high).toBeCloseTo(1 + 1.96 * Math.sqrt(2 / 25), 6)
  })

  it('표본이 커지면 구간이 좁아집니다', () => {
    const small = meanDiffInterval({ mean: 4, sd: 1, n: 10 }, { mean: 3, sd: 1, n: 10 }, 1.96)
    const large = meanDiffInterval({ mean: 4, sd: 1, n: 200 }, { mean: 3, sd: 1, n: 200 }, 1.96)
    const width = (i: { low: number; high: number } | null) => (i ? i.high - i.low : Number.NaN)
    expect(width(large)).toBeLessThan(width(small))
  })

  it('표준편차를 낼 수 없으면 구간도 없습니다', () => {
    expect(meanDiffInterval({ mean: 4, sd: null, n: 5 }, { mean: 3, sd: 1, n: 5 }, 1.96)).toBeNull()
    expect(meanDiffInterval({ mean: 4, sd: 1, n: 1 }, { mean: 3, sd: 1, n: 5 }, 1.96)).toBeNull()
  })
})

describe('rateDiffInterval', () => {
  it('비율 차이를 가운데 둡니다', () => {
    const interval = rateDiffInterval({ rate: 0.6, n: 40 }, { rate: 0.2, n: 40 }, 1.96)
    expect(interval).not.toBeNull()
    const mid = ((interval as { low: number; high: number }).low + (interval as { low: number; high: number }).high) / 2
    expect(mid).toBeCloseTo(0.4, 6)
  })
})

describe('proportionInterval', () => {
  it('0%여도 구간이 무너지지 않습니다', () => {
    const interval = proportionInterval(0, 30, 1.96)
    expect(interval).not.toBeNull()
    expect((interval as { low: number; high: number }).low).toBe(0)
    expect((interval as { low: number; high: number }).high).toBeGreaterThan(0)
  })

  it('0~1 밖으로 나가지 않습니다', () => {
    const interval = proportionInterval(1, 8, 1.96) as { low: number; high: number }
    expect(interval.low).toBeGreaterThanOrEqual(0)
    expect(interval.high).toBeLessThanOrEqual(1)
  })
})

describe('correlationInterval', () => {
  it('상관계수를 감싸는 구간을 냅니다', () => {
    const interval = correlationInterval(0.6, 50, 1.96) as { low: number; high: number }
    expect(interval.low).toBeLessThan(0.6)
    expect(interval.high).toBeGreaterThan(0.6)
    expect(interval.high).toBeLessThanOrEqual(1)
  })

  it('표본이 너무 적으면 내지 않습니다', () => {
    expect(correlationInterval(0.5, 3, 1.96)).toBeNull()
  })

  it('완전상관도 좁은 구간으로 다룹니다 — 가장 강한 증거를 버리지 않습니다', () => {
    const interval = correlationInterval(1, 50, 1.96) as { low: number; high: number }
    expect(interval.low).toBeGreaterThan(0.99)
    expect(interval.high).toBeLessThanOrEqual(1)
  })
})

describe('excludesZero', () => {
  it('0을 사이에 두면 방향을 말하지 않습니다', () => {
    expect(excludesZero({ low: -0.2, high: 0.8 })).toBe(false)
    expect(excludesZero({ low: 0.2, high: 0.8 })).toBe(true)
    expect(excludesZero({ low: -0.8, high: -0.2 })).toBe(true)
    expect(excludesZero(null)).toBe(false)
  })
})
