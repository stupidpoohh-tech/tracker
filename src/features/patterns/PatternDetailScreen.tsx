import { useMemo, useState } from 'react'
import { useApp } from '@/app/store'
import { usePatterns } from '@/app/usePatterns'
import { addDays } from '@/domain/date'
import type { PhaseIndex } from '@/domain/cycle'
import { buildPhaseIndex, computeCycleStats } from '@/domain/cycle'
import {
  CHANGE_LABELS,
  STATUS_LABELS,
  baselineOf,
  describeObservationTrend,
  examinedNote,
  formatDelta,
  formatInterval,
} from '@/domain/patterns'
import { Icon } from '@/ui/Icon'
import { Spinner } from '@/ui/components'
import { ChartLegend, TrendChart } from '@/features/history/TrendChart'
import { CorrelationNotice, PatternEvidence } from './PatternPieces'

/** 상세에서 보여줄 추이 구간. 패턴 계산 창과 같게 둡니다. */
function useDetailPhaseIndex(start: string, end: string): PhaseIndex {
  const { cycles, profile, entries, today } = useApp()
  const enabled = profile?.modules.cycle ?? false
  const ovulationMarks = useMemo(
    () =>
      Object.values(entries)
        .filter((e) => e.ovulationMark)
        .map((e) => e.date),
    [entries],
  )
  return useMemo<PhaseIndex>(() => {
    if (!enabled) return new Map<string, never>()
    return buildPhaseIndex(cycles, start, end, {
      stats: computeCycleStats(cycles),
      ovulationMarks,
      today,
    })
  }, [cycles, start, end, ovulationMarks, today, enabled])
}

export function PatternDetailScreen({
  patternId,
  onBack,
}: {
  patternId: string
  onBack: () => void
}) {
  const { entries, observations, profile, today, actions } = useApp()
  const view = usePatterns()
  const [busy, setBusy] = useState(false)

  const pattern = view.byId.get(patternId) ?? null
  const observation = observations.find((o) => o.patternId === patternId) ?? null

  const start = pattern?.window.start ?? addDays(today, -59)
  const end = pattern?.window.end ?? today
  const phaseIndex = useDetailPhaseIndex(start, end)
  const modules = profile?.modules ?? { mood: true, energy: true, sleep: true, cycle: false }

  if (!pattern) {
    return (
      <div className="page">
        <header className="page-header">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
            <Icon name="chevronLeft" size={16} /> 뒤로
          </button>
        </header>
        <p className="empty">
          이 패턴을 지금은 계산할 수 없습니다.
          <br />
          관련 기록이 줄었거나 기간이 바뀌었을 수 있습니다.
        </p>
      </div>
    )
  }

  const toggleObserve = async (): Promise<void> => {
    setBusy(true)
    try {
      if (observation) await actions.stopObserving(observation.id)
      else
        await actions.observePattern(
          pattern.id,
          `${pattern.variables.a.label} ↔ ${pattern.variables.b.label}`,
          // 지금의 효과 크기를 함께 남깁니다. 이것이 있어야 나중에 '관찰 이후
          // 어떻게 달라졌는지'를 말할 수 있습니다.
          baselineOf(pattern),
        )
    } finally {
      setBusy(false)
    }
  }

  const changeLabel = CHANGE_LABELS[pattern.change]

  return (
    <div className="page">
      <header style={{ paddingTop: 16, paddingBottom: 6 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onBack}
          style={{ paddingLeft: 0 }}
        >
          <Icon name="chevronLeft" size={16} /> 나의 패턴
        </button>
      </header>

      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          lineHeight: 1.45,
          letterSpacing: '-0.03em',
          marginTop: 6,
        }}
      >
        {pattern.title}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.75, marginTop: 10 }}>
        {pattern.summary}
      </p>

      <div className="kpi-row" style={{ paddingTop: 22, paddingBottom: 24 }}>
        <div className="kpi-item">
          <div className="kpi-value" style={{ fontSize: 15, fontWeight: 500 }}>
            {STATUS_LABELS[pattern.status]}
          </div>
          <div className="kpi-label">현재 상태</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-value">
            {pattern.window.days}
            <span className="kpi-unit">일</span>
          </div>
          <div className="kpi-label">관찰 기간</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-value">
            {pattern.sampleSize}
            <span className="kpi-unit">일</span>
          </div>
          <div className="kpi-label">표본</div>
        </div>
      </div>

      {changeLabel && pattern.change !== 'steady' && (
        <p className="notice" style={{ marginBottom: 24 }}>
          {pattern.change === 'new'
            ? '직전 같은 길이의 기간에는 보이지 않던 관계입니다.'
            : pattern.change === 'strengthened'
              ? '직전 같은 길이의 기간보다 차이가 더 뚜렷해졌습니다.'
              : pattern.change === 'weakened'
                ? '직전 같은 길이의 기간보다 차이가 줄었습니다.'
                : pattern.change === 'faded'
                  ? '이전에는 보이던 관계가 최근 기록에서는 나타나지 않습니다.'
                  : '이전 기간에는 이 관계를 볼 만한 기록이 없어 비교하지 못했습니다.'}
        </p>
      )}

      <section style={{ marginBottom: 28 }}>
        <div className="section-head">
          <h2 className="section-title">데이터에서 이렇게 나타났습니다</h2>
        </div>
        <PatternEvidence pattern={pattern} />
        {/* 점추정만 두면 12일치와 120일치가 같은 확신으로 보입니다. */}
        <p className="meta" style={{ marginTop: 12 }}>
          {pattern.metric === 'correlation'
            ? `상관계수 ${pattern.delta.toFixed(2)}`
            : `차이 ${formatDelta(pattern)}`}
          {formatInterval(pattern) && ` · 95% 구간 ${formatInterval(pattern)}`}
        </p>
        {pattern.needed != null ? (
          <p className="hint" style={{ marginTop: 10 }}>
            {pattern.status === 'insufficient'
              ? `판단하려면 약 ${pattern.needed}일의 기록이 더 필요합니다.`
              : `반복되는 패턴인지 확인하려면 약 ${pattern.needed}일이 더 모이면 좋습니다.`}
          </p>
        ) : (
          pattern.status === 'signal' && (
            <p className="hint" style={{ marginTop: 10 }}>
              기록은 충분히 모였지만 차이의 범위가 아직 넓습니다. 더 쌓이면 좁아질 수 있습니다.
            </p>
          )
        )}
      </section>

      <section style={{ marginBottom: 28 }}>
        <div className="section-head">
          <h2 className="section-title">시간에 따라</h2>
          <span className="meta">
            {start.slice(5).replace('-', '.')} – {end.slice(5).replace('-', '.')}
          </span>
        </div>
        <div style={{ marginBottom: 10 }}>
          <ChartLegend modules={modules} />
        </div>
        <TrendChart
          start={start}
          end={end}
          entries={entries}
          phaseIndex={phaseIndex}
          modules={modules}
          layers={{ sleep: true, cycle: modules.cycle }}
          today={today}
          selectedDate={null}
          onSelect={() => {}}
        />
      </section>

      <section style={{ marginBottom: 28 }}>
        <div className="section-head">
          <h2 className="section-title">이 패턴에 대하여</h2>
        </div>
        <CorrelationNotice examined={examinedNote(pattern)} />
      </section>

      <section>
        <button
          type="button"
          className={`btn btn-block ${observation ? '' : 'btn-primary'}`}
          onClick={toggleObserve}
          disabled={busy}
        >
          {busy && <Spinner size={15} />}
          {observation ? '관찰 그만두기' : '이 패턴 계속 관찰하기'}
        </button>
        <p className="hint" style={{ marginTop: 10 }}>
          {observation
            ? `${observation.startedOn}부터 지켜보고 있습니다. ` +
              (describeObservationTrend(pattern, observation.baseline) ??
                '평소처럼 기록하시면 이 관계가 계속 갱신됩니다.')
            : '관찰로 지정하면 홈에 남고, 기록이 쌓이는 대로 이 관계가 갱신됩니다. 따로 하실 일은 없습니다.'}
        </p>
      </section>
    </div>
  )
}
