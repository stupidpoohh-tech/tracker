/**
 * 불확실성 계산.
 *
 * 화면에 "3.0점 차이"라고만 쓰면 그 숫자가 12일치에서 나왔는지 120일치에서
 * 나왔는지 알 수 없습니다. 같은 3.0점이라도 앞의 것은 다음 달에 1.2점이 될 수
 * 있고 뒤의 것은 거의 그대로입니다. 점추정만 보여주는 것은 실제보다 확실해
 * 보이게 만듭니다.
 *
 * 정규근사를 씁니다. 표본이 작을 때 t분포보다 구간이 조금 좁게 나오지만,
 * 애초에 표본이 작으면 `patterns.ts`가 '데이터 부족'으로 걸러내므로 이 근사가
 * 쓰이는 구간에서는 차이가 크지 않습니다.
 */

export interface Interval {
  low: number
  high: number
}

/**
 * 표준정규분포의 분위수(역 CDF). Acklam 근사입니다.
 *
 * 다중비교 보정 때문에 신뢰수준이 고정이 아닙니다. 관계를 20개 살펴보면
 * 95%가 아니라 99.75% 지점의 z가 필요하므로 표에서 꺼내 쓸 수 없습니다.
 */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) return Number.NaN

  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924]
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857]
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878]
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742]

  const low = 0.02425
  const high = 1 - low

  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      ((((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q + (c[3] as number)) * q + (c[4] as number)) * q + (c[5] as number)) /
      ((((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) * q + 1))
    )
  }
  if (p > high) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(
      ((((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q + (c[3] as number)) * q + (c[4] as number)) * q + (c[5] as number)) /
      ((((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) * q + 1))
    )
  }
  const q = p - 0.5
  const r = q * q
  return (
    (((((((a[0] as number) * r + (a[1] as number)) * r + (a[2] as number)) * r + (a[3] as number)) * r + (a[4] as number)) * r + (a[5] as number)) * q) /
    ((((((b[0] as number) * r + (b[1] as number)) * r + (b[2] as number)) * r + (b[3] as number)) * r + (b[4] as number)) * r + 1)
  )
}

/** 양측 신뢰수준(0.95 등)에 해당하는 z. */
export function zFor(confidence: number): number {
  return normalQuantile(1 - (1 - confidence) / 2)
}

export interface SampleStats {
  mean: number
  sd: number | null
  n: number
}

/** 두 평균의 차이(a - b)에 대한 구간. Welch 방식이라 분산이 달라도 됩니다. */
export function meanDiffInterval(a: SampleStats, b: SampleStats, z: number): Interval | null {
  if (a.sd == null || b.sd == null || a.n < 2 || b.n < 2) return null
  const se = Math.sqrt((a.sd * a.sd) / a.n + (b.sd * b.sd) / b.n)
  if (!Number.isFinite(se)) return null
  const diff = a.mean - b.mean
  return { low: diff - z * se, high: diff + z * se }
}

/** 두 비율의 차이(a - b)에 대한 구간. */
export function rateDiffInterval(
  a: { rate: number; n: number },
  b: { rate: number; n: number },
  z: number,
): Interval | null {
  if (a.n < 1 || b.n < 1) return null
  const se = Math.sqrt((a.rate * (1 - a.rate)) / a.n + (b.rate * (1 - b.rate)) / b.n)
  if (!Number.isFinite(se)) return null
  const diff = a.rate - b.rate
  return { low: diff - z * se, high: diff + z * se }
}

/**
 * 한 비율에 대한 구간. Wilson 방식입니다.
 *
 * 단순한 정규근사는 비율이 0이나 1에 가까우면 구간이 0 밖으로 나가거나 폭이
 * 0이 됩니다. "한 번도 없었다"를 다루는 화면이므로 그 경우가 실제로 나옵니다.
 */
export function proportionInterval(rate: number, n: number, z: number): Interval | null {
  if (n < 1) return null
  const denom = 1 + (z * z) / n
  const center = (rate + (z * z) / (2 * n)) / denom
  const spread = (z * Math.sqrt((rate * (1 - rate)) / n + (z * z) / (4 * n * n))) / denom
  return { low: Math.max(0, center - spread), high: Math.min(1, center + spread) }
}

/**
 * 상관계수에 대한 구간. Fisher z 변환을 거칩니다.
 *
 * |r| = 1이면 변환이 발산하므로 아주 살짝 안쪽으로 당겨서 계산합니다. 완전상관은
 * 실제 기록에서 거의 나오지 않지만, 나왔을 때 "구간을 낼 수 없음"으로 처리하면
 * 가장 강한 증거가 가장 약하게 취급됩니다.
 */
export function correlationInterval(r: number, n: number, z: number): Interval | null {
  if (n < 4) return null
  const clamped = Math.max(-0.9999, Math.min(0.9999, r))
  const fisher = 0.5 * Math.log((1 + clamped) / (1 - clamped))
  const se = 1 / Math.sqrt(n - 3)
  const back = (v: number): number => (Math.exp(2 * v) - 1) / (Math.exp(2 * v) + 1)
  return { low: back(fisher - z * se), high: back(fisher + z * se) }
}

/** 구간이 0을 사이에 두지 않는지. 방향을 말할 수 있는지의 판정입니다. */
export function excludesZero(interval: Interval | null): boolean {
  if (!interval) return false
  return (interval.low > 0 && interval.high > 0) || (interval.low < 0 && interval.high < 0)
}
