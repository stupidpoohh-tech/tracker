import {
  CHANGE_LABELS,
  STATUS_LABELS,
  formatGroupValue,
  type Pattern,
  type PatternStatus,
} from '@/domain/patterns'

const STATUS_TONE: Record<PatternStatus, string> = {
  stable: 'var(--text-2)',
  signal: 'var(--text-2)',
  insufficient: 'var(--text-3)',
  none: 'var(--text-3)',
}

/** 상태와 변화를 한 줄로. 과장하지 않는 것이 이 줄의 역할입니다. */
export function PatternMeta({ pattern }: { pattern: Pattern }) {
  const change = CHANGE_LABELS[pattern.change]
  const parts = [STATUS_LABELS[pattern.status]]
  if (change && pattern.change !== 'steady') parts.push(change)
  parts.push(`${pattern.sampleSize}일 기준`)
  return (
    <span className="pattern-meta" style={{ color: STATUS_TONE[pattern.status] }}>
      {parts.join(' · ')}
    </span>
  )
}

/** 새로 발견됨 같은 상태 표식. 색을 남발하지 않도록 하나만 씁니다. */
export function PatternFlag({ pattern }: { pattern: Pattern }) {
  if (pattern.change === 'new') return <span className="pattern-flag is-new">새로 발견됨</span>
  if (pattern.change === 'strengthened') return <span className="pattern-flag">더 뚜렷해짐</span>
  if (pattern.change === 'weakened') return <span className="pattern-flag">약해짐</span>
  if (pattern.change === 'faded') return <span className="pattern-flag">최근에는 안 보임</span>
  return null
}

/**
 * 근거 막대.
 *
 * 숫자만 던지지 않고 그룹 간 관계를 눈으로 볼 수 있게 합니다. 값의 크기가
 * 곧 길이이므로 색으로 다시 구분하지 않습니다.
 */
export function PatternEvidence({ pattern }: { pattern: Pattern }) {
  const values = pattern.groups.map((g) => Math.abs(g.value))
  const max = Math.max(...values, pattern.metric === 'scale' ? 5 : 1)

  return (
    <div className="evidence">
      {pattern.groups.map((group, index) => (
        <div key={group.key} className="evidence-row">
          <span className="evidence-label" title={group.label}>
            {group.label}
          </span>
          <span className="evidence-track">
            <span
              className={`evidence-fill${index === 0 ? ' is-lead' : ''}`}
              style={{ width: `${Math.max(2, (Math.abs(group.value) / max) * 100)}%` }}
            />
          </span>
          <span className="evidence-value">{formatGroupValue(pattern, group)}</span>
          <span className="evidence-count">{group.count}일</span>
        </div>
      ))}
    </div>
  )
}

/** 상관은 인과가 아니라는 고지. 모든 패턴 상세에 붙습니다. */
export function CorrelationNotice({ examined }: { examined?: string | null }) {
  return (
    <div className="hint" style={{ lineHeight: 1.8 }}>
      <p>
        두 항목이 함께 나타나는 경향을 보여줍니다. 이 데이터만으로 원인과 결과를 판단할 수는
        없습니다. 몸이나 마음의 변화가 계속된다면 의료 전문가와 상담해주세요.
      </p>
      {/* 여러 관계를 동시에 보고 그중 큰 것을 화면에 올린다는 사실 자체가
          해석에 필요한 정보입니다. 숨기면 하나만 검증한 것처럼 읽힙니다. */}
      {examined && (
        <p style={{ marginTop: 10 }}>
          {examined} 여러 관계를 한꺼번에 보면 우연히 큰 차이가 하나쯤 나올 수 있어,
          ‘반복되는 패턴’으로 부를 때는 그 점을 감안해 판정합니다.
        </p>
      )}
    </div>
  )
}
