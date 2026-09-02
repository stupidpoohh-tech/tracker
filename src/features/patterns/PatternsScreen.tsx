import { useApp } from '@/app/store'
import { usePatterns } from '@/app/usePatterns'
import { STATUS_LABELS, type Pattern } from '@/domain/patterns'
import { Icon } from '@/ui/Icon'
import { PatternFlag } from './PatternPieces'

function PatternRow({ pattern, onOpen }: { pattern: Pattern; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="pattern-row" onClick={() => onOpen(pattern.id)}>
      <span className="pattern-row-body">
        <span className="pattern-row-title">{pattern.title}</span>
        <span className="pattern-row-meta">
          <PatternFlag pattern={pattern} />
          <span className="pattern-meta">
            {STATUS_LABELS[pattern.status]} · {pattern.sampleSize}일 기준
            {pattern.needed != null ? ` · 약 ${pattern.needed}일 더 필요` : ''}
          </span>
        </span>
      </span>
      <span className="record-chevron" style={{ marginTop: 2 }}>
        <Icon name="chevronRight" size={15} />
      </span>
    </button>
  )
}

function Section({
  title,
  description,
  patterns,
  onOpen,
}: {
  title: string
  description?: string
  patterns: Pattern[]
  onOpen: (id: string) => void
}) {
  if (patterns.length === 0) return null
  return (
    <section style={{ paddingTop: 26 }}>
      <div className="section-head" style={{ marginBottom: description ? 6 : 12 }}>
        <h2 className="section-title">{title}</h2>
        <span className="meta">{patterns.length}</span>
      </div>
      {description && (
        <p className="hint" style={{ marginBottom: 10 }}>
          {description}
        </p>
      )}
      <div>
        {patterns.map((pattern) => (
          <PatternRow key={pattern.id} pattern={pattern} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

/**
 * 나의 패턴.
 *
 * "이 서비스가 나에 대해 무엇을 알아냈는가"를 보는 화면입니다. 그래서
 * 통계표가 아니라 상태별로 묶은 문장 목록입니다.
 */
export function PatternsScreen({ onOpenPattern }: { onOpenPattern: (id: string) => void }) {
  const { observations } = useApp()
  const view = usePatterns()
  const { sections, readiness } = view

  const nothingYet =
    sections.discovered.length === 0 &&
    sections.observed.length === 0 &&
    sections.stable.length === 0 &&
    sections.changing.length === 0

  return (
    <div className="page">
      <header className="page-header" style={{ paddingBottom: 10 }}>
        <h1 className="page-title">나의 패턴</h1>
      </header>
      <p className="hint" style={{ marginBottom: 4 }}>
        최근 기록에서 발견한 반복되는 관계를 모아 보여드립니다.
      </p>

      {nothingYet && (
        <section className="discovery" style={{ marginTop: 20 }}>
          <p className="discovery-eyebrow">
            <Icon name="sparkles" size={14} />
            {readiness.headline}
          </p>
          <p className="discovery-body" style={{ marginTop: 2 }}>
            {readiness.detail}
          </p>
          {readiness.stage !== 'empty' && (
            <p className="meta" style={{ marginTop: 10 }}>
              최근 {view.window.days}일 중 {readiness.loggedDays}일을 기록했습니다.
            </p>
          )}
        </section>
      )}

      <Section
        title="새로 발견됨"
        description="이전 기간에는 보이지 않던 관계입니다."
        patterns={sections.discovered}
        onOpen={onOpenPattern}
      />
      <Section
        title="계속 관찰 중"
        description={
          observations.length > 0 ? '직접 지켜보기로 하신 관계입니다.' : undefined
        }
        patterns={sections.observed}
        onOpen={onOpenPattern}
      />
      <Section
        title="비교적 꾸준한 패턴"
        patterns={sections.stable}
        onOpen={onOpenPattern}
      />
      <Section
        title="변화하고 있음"
        description="이전 기간과 견주어 세기가 달라졌습니다."
        patterns={sections.changing}
        onOpen={onOpenPattern}
      />
      <Section
        title="데이터가 더 필요한 항목"
        description="판단하기에는 아직 기록이 부족합니다."
        patterns={sections.needsData}
        onOpen={onOpenPattern}
      />
      <Section
        title="현재 뚜렷한 관계 없음"
        description="충분히 살펴봤지만 의미 있는 차이가 나타나지 않았습니다. 이것도 하나의 답입니다."
        patterns={sections.noRelation}
        onOpen={onOpenPattern}
      />
    </div>
  )
}
