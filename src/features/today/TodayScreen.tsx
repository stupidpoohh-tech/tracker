import { useCallback, useMemo, useState } from 'react'
import { useApp } from '@/app/store'
import { usePatterns } from '@/app/usePatterns'
import type { DateKey } from '@/domain/date'
import { addDays, diffDays } from '@/domain/date'
import { computeOverview, entriesInRange } from '@/domain/insights'
import {
  ENERGY_LABELS,
  MOOD_LABELS,
  SCALE_VALUES,
  emptyEntry,
  energyLabel,
  moodLabel,
  sleepLabel,
  type Entry,
  type Scale,
} from '@/domain/models'
import {
  CHANGE_LABELS,
  STATUS_LABELS,
  describeObservationTrend,
  type Pattern,
} from '@/domain/patterns'
import type { Observation } from '@/domain/models'
import { Icon } from '@/ui/Icon'
import { Spinner } from '@/ui/components'
import { PatternEvidence } from '@/features/patterns/PatternPieces'

/** 홈에서 요약 비교에 쓰는 기간. */
const SUMMARY_DAYS = 30

/**
 * 관찰 카드에 쓸 한 문장.
 *
 * 관찰을 시작한 시점의 값이 있으면 그때와 견줍니다. 관찰의 요점이 '지금 어떤가'가
 * 아니라 '지켜본 뒤로 어떻게 됐는가'이기 때문입니다.
 *
 * 패턴을 못 찾은 경우에 이유를 지어내지 않습니다. 태그를 완전히 삭제하면 그
 * 태그로 만들던 패턴은 영영 계산되지 않는데, 이때 '기록이 모이지 않았습니다'라고
 * 하면 사실과 다릅니다.
 */
function observationBody(pattern: Pattern | null, observation: Observation): string {
  if (!pattern) return '지금은 이 관계를 계산할 수 없습니다.'

  const trend = describeObservationTrend(pattern, observation.baseline)
  if (trend) return trend

  if (pattern.status === 'insufficient') {
    return `판단하려면 약 ${pattern.needed}일의 기록이 더 필요합니다.`
  }
  if (pattern.status === 'none') return '지금까지는 뚜렷한 차이가 나타나지 않았습니다.'
  return pattern.summary
}

function ScaleRow({
  label,
  value,
  labels,
  onPick,
}: {
  label: string
  value: Scale | undefined
  labels: readonly string[]
  onPick: (next: Scale | undefined) => void
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div className="row-between" style={{ marginBottom: 7 }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{label}</span>
        <span className="meta">{value ? labels[value - 1] : ''}</span>
      </div>
      <div className="quick-scale" role="radiogroup" aria-label={label}>
        {SCALE_VALUES.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            aria-label={`${label} ${v} — ${labels[v - 1]}`}
            className="quick-dot"
            onClick={() => onPick(value === v ? undefined : v)}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * 10초 기록.
 *
 * 기록은 이 서비스의 목적이 아니라 패턴을 발견하기 위한 입력 수단입니다.
 * 그래서 홈에서 화면을 지배하지 않게 두고, 누르면 곧바로 저장합니다.
 */
function QuickLog({ onOpenFull }: { onOpenFull: (date: DateKey) => void }) {
  const { entries, today, actions } = useApp()
  const existing = entries[today]
  const [saving, setSaving] = useState(false)

  const patch = useCallback(
    async (next: Partial<Entry>) => {
      setSaving(true)
      try {
        const base = existing ?? emptyEntry(today)
        await actions.saveEntry({ ...base, ...next, date: today })
      } finally {
        setSaving(false)
      }
    },
    [existing, today, actions],
  )

  const complete = existing != null && (existing.mood != null || existing.energy != null)

  if (complete) {
    const bits: string[] = []
    if (existing.mood) bits.push(`기분 ${existing.mood}`)
    if (existing.energy) bits.push(`에너지 ${existing.energy}`)
    if (existing.sleep) bits.push(sleepLabel(existing.sleep))
    return (
      <div className="quick-done">
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="row" style={{ gap: 6, fontSize: 14, fontWeight: 500 }}>
            <Icon name="check" size={15} strokeWidth={2.2} />
            오늘 기록 완료
          </span>
          <span
            style={{
              display: 'block',
              fontSize: 12.5,
              color: 'var(--text-2)',
              marginTop: 3,
            }}
          >
            {bits.join(' · ')}
          </span>
        </span>
        <button type="button" className="btn btn-sm" onClick={() => onOpenFull(today)}>
          수정
        </button>
      </div>
    )
  }

  return (
    <section className="quick-log">
      <div className="row-between">
        <h2 className="section-title">오늘은 어땠나요?</h2>
        {saving && <Spinner size={13} />}
      </div>
      <ScaleRow
        label="기분"
        value={existing?.mood}
        labels={MOOD_LABELS}
        onPick={(mood) => void patch({ mood })}
      />
      <ScaleRow
        label="에너지"
        value={existing?.energy}
        labels={ENERGY_LABELS}
        onPick={(energy) => void patch({ energy })}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 12, paddingLeft: 0 }}
        onClick={() => onOpenFull(today)}
      >
        수면 · 관찰 항목 · 메모 더하기
        <Icon name="chevronRight" size={14} />
      </button>
    </section>
  )
}

/** 홈의 주인공. 통계가 아니라 발견입니다. */
function Discovery({
  pattern,
  onOpen,
}: {
  pattern: Pattern
  onOpen: (id: string) => void
}) {
  const eyebrow =
    pattern.change === 'new'
      ? '새로 발견했어요'
      : pattern.change === 'strengthened'
        ? '더 뚜렷해지고 있어요'
        : pattern.status === 'stable'
          ? '계속 보이고 있어요'
          : '신호가 보여요'

  return (
    <section className="discovery">
      <p className="discovery-eyebrow">
        <Icon name="sparkles" size={14} />
        {eyebrow}
      </p>
      <h2 className="discovery-title">{pattern.title}</h2>
      <p className="discovery-body">{pattern.summary}</p>
      <div style={{ marginTop: 16 }}>
        <PatternEvidence pattern={pattern} />
      </div>
      <button
        type="button"
        className="btn btn-sm"
        style={{ marginTop: 16 }}
        onClick={() => onOpen(pattern.id)}
      >
        자세히 보기
        <Icon name="chevronRight" size={14} />
      </button>
    </section>
  )
}

export function TodayScreen({
  onOpenLog,
  onOpenPattern,
  onGoPatterns,
}: {
  onOpenLog: (date: DateKey) => void
  onOpenPattern: (id: string) => void
  onGoPatterns: () => void
}) {
  const { entries, observations, today, syncing, offline, actions } = useApp()
  const view = usePatterns()

  const summary = useMemo(() => {
    const start = addDays(today, -(SUMMARY_DAYS - 1))
    const previousEnd = addDays(start, -1)
    const previousStart = addDays(previousEnd, -(SUMMARY_DAYS - 1))
    const current = computeOverview(entriesInRange(entries, start, today), start, today, today)
    const previous = computeOverview(
      entriesInRange(entries, previousStart, previousEnd),
      previousStart,
      previousEnd,
      today,
    )
    return { current, previous }
  }, [entries, today])

  const delta = (now: number | null, before: number | null): string | null => {
    if (now == null || before == null) return null
    const diff = now - before
    if (Math.abs(diff) < 0.1) return '지난 30일과 비슷합니다'
    return `지난 30일보다 ${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)}`
  }

  const observedCards = observations.map((observation) => ({
    observation,
    pattern: view.byId.get(observation.patternId) ?? null,
    days: diffDays(observation.startedOn, today) + 1,
  }))

  return (
    <div className="page">
      <header className="page-header">
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <h1 className="page-title">오늘</h1>
          {syncing && <Spinner size={13} />}
          {offline && (
            <span className="row" style={{ gap: 3, color: 'var(--text-3)', fontSize: 11 }}>
              <Icon name="cloudOff" size={12} /> 오프라인
            </span>
          )}
        </div>
      </header>

      <QuickLog onOpenFull={onOpenLog} />

      {/* 가장 중요한 발견 */}
      {view.headline ? (
        <Discovery pattern={view.headline} onOpen={onOpenPattern} />
      ) : (
        <section className="discovery">
          <p className="discovery-eyebrow">
            <Icon name="sparkles" size={14} />
            {view.readiness.headline}
          </p>
          <p className="discovery-body" style={{ marginTop: 2 }}>
            {view.readiness.detail}
          </p>
          {view.readiness.needed != null && view.readiness.stage !== 'empty' && (
            <p className="meta" style={{ marginTop: 10 }}>
              최근 {view.window.days}일 중 {view.readiness.loggedDays}일을 기록했습니다.
            </p>
          )}
        </section>
      )}

      {/* 관찰 중 */}
      {observedCards.length > 0 && (
        <section style={{ paddingTop: 24 }}>
          <div className="section-head">
            <h2 className="section-title">관찰 중</h2>
            <button type="button" className="section-more" onClick={onGoPatterns}>
              전체 패턴
              <Icon name="chevronRight" size={13} />
            </button>
          </div>
          <div>
            {observedCards.map(({ observation, pattern, days }) => (
              <div key={observation.id} className="observation">
                <div className="row-between" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <p className="observation-title">{observation.label}</p>
                    <p className="observation-body">
                      {`${days}일째 관찰 중입니다. ${observationBody(pattern, observation)}`}
                    </p>
                  </div>
                  {pattern && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`${observation.label} 자세히 보기`}
                      onClick={() => onOpenPattern(pattern.id)}
                    >
                      <Icon name="chevronRight" size={15} />
                    </button>
                  )}
                </div>
                <div className="row" style={{ gap: 7, marginTop: 8 }}>
                  <span className="pattern-flag">
                    {pattern ? STATUS_LABELS[pattern.status] : '데이터가 더 필요함'}
                  </span>
                  {pattern && pattern.change !== 'steady' && CHANGE_LABELS[pattern.change] && (
                    <span className="pattern-flag">{CHANGE_LABELS[pattern.change]}</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginLeft: 'auto', fontSize: 12 }}
                    onClick={() => void actions.stopObserving(observation.id)}
                  >
                    관찰 그만두기
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 작은 상태 요약 — 숫자는 보조입니다 */}
      <section style={{ paddingTop: 26 }}>
        <p className="section-label">최근 {SUMMARY_DAYS}일</p>
        <div className="kpi-row" style={{ paddingTop: 4 }}>
          <div className="kpi-item">
            <div className="kpi-value">
              {summary.current.moodAvg != null ? summary.current.moodAvg.toFixed(1) : '—'}
            </div>
            <div className="kpi-label">
              기분
              {delta(summary.current.moodAvg, summary.previous.moodAvg) && (
                <span style={{ display: 'block' }}>
                  {delta(summary.current.moodAvg, summary.previous.moodAvg)}
                </span>
              )}
            </div>
          </div>
          <div className="kpi-item">
            <div className="kpi-value">
              {summary.current.energyAvg != null ? summary.current.energyAvg.toFixed(1) : '—'}
            </div>
            <div className="kpi-label">
              에너지
              {delta(summary.current.energyAvg, summary.previous.energyAvg) && (
                <span style={{ display: 'block' }}>
                  {delta(summary.current.energyAvg, summary.previous.energyAvg)}
                </span>
              )}
            </div>
          </div>
          <div className="kpi-item">
            <div className="kpi-value">
              {summary.current.loggedDays}
              <span className="kpi-unit">/{SUMMARY_DAYS}일</span>
            </div>
            <div className="kpi-label">
              기록
              {/* 이 숫자는 30일치이고 충분도는 패턴 계산 창(60일) 기준입니다.
                  범위가 다르므로 문구에 기준을 함께 적습니다. */}
              <span style={{ display: 'block' }}>
                {view.readiness.stage === 'sufficient'
                  ? `최근 ${view.window.days}일 기준 충분합니다`
                  : view.readiness.needed != null
                    ? `패턴까지 약 ${view.readiness.needed}일 더`
                    : ''}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 오늘 기록 상세로 가는 길 */}
      {entries[today] && (
        <p className="meta" style={{ paddingTop: 18 }}>
          오늘은 {moodLabel(entries[today]?.mood ?? (3 as Scale))}
          {entries[today]?.energy ? ` · 에너지 ${energyLabel(entries[today]!.energy as Scale)}` : ''}
          으로 기록되어 있습니다.
        </p>
      )}
    </div>
  )
}
