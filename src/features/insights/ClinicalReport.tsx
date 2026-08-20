import { useMemo, useState } from 'react'
import { useApp } from '@/app/store'
import { addDays, fullLabel, monthDayLabel } from '@/domain/date'
import type { PhaseIndex } from '@/domain/cycle'
import { buildPhaseIndex, computeCycleStats, sortCycles } from '@/domain/cycle'
import {
  buildInsights,
  computeOverview,
  entriesInRange,
  groupByPhase,
  groupBySleep,
  tagFrequency,
} from '@/domain/insights'
import { isMixedState, sleepLabel } from '@/domain/models'
import { MEDICAL_DISCLAIMER } from '@/features/legal/content'
import { Icon } from '@/ui/Icon'
import { Sheet } from '@/ui/components'

const PERIOD_OPTIONS = [
  { days: 30, label: '최근 1개월' },
  { days: 90, label: '최근 3개월' },
  { days: 180, label: '최근 6개월' },
] as const

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row-between" style={{ padding: '5px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--text-2)' }}>{label}</span>
      <strong style={{ fontWeight: 600 }}>{value}</strong>
    </div>
  )
}

/**
 * 진료용 요약 시트.
 *
 * v3의 백로그에 "구현 방향만 논의됨"으로 남아 있던 항목입니다. 진료실에서
 * "지난 3개월 어떠셨어요"에 한 장으로 답하기 위한 출력물이며, 브라우저 인쇄로
 * PDF 저장할 수 있습니다.
 */
export function ClinicalReport({ onClose }: { onClose: () => void }) {
  const { entries, tagIndex, cycles, profile, today } = useApp()
  const [days, setDays] = useState<number>(90)

  const modules = profile?.modules ?? { mood: true, energy: true, sleep: true, cycle: false }
  const rangeStart = addDays(today, -(days - 1))

  const rangeEntries = useMemo(
    () => entriesInRange(entries, rangeStart, today),
    [entries, rangeStart, today],
  )

  const ovulationMarks = useMemo(
    () => Object.values(entries).filter((e) => e.ovulationMark).map((e) => e.date),
    [entries],
  )

  const phaseIndex = useMemo<PhaseIndex>(
    () =>
      modules.cycle
        ? buildPhaseIndex(cycles, rangeStart, today, {
            ovulationMarks,
            today,
            predict: false,
          })
        : new Map<string, never>(),
    [cycles, rangeStart, today, ovulationMarks, modules.cycle],
  )

  const overview = useMemo(
    () => computeOverview(rangeEntries, rangeStart, today, today),
    [rangeEntries, rangeStart, today],
  )
  const cards = useMemo(
    () => buildInsights({ entries: rangeEntries, phaseIndex, tagIndex, rangeStart, rangeEnd: today }),
    [rangeEntries, phaseIndex, tagIndex, rangeStart, today],
  )
  const topTags = useMemo(() => tagFrequency(rangeEntries, tagIndex, 12), [rangeEntries, tagIndex])
  const sleepGroups = useMemo(() => groupBySleep(rangeEntries), [rangeEntries])
  const phaseGroups = useMemo(
    () => (modules.cycle ? groupByPhase(rangeEntries, phaseIndex) : []),
    [rangeEntries, phaseIndex, modules.cycle],
  )
  const cycleStats = useMemo(() => computeCycleStats(cycles), [cycles])
  const recentCycles = useMemo(
    () => sortCycles(cycles).filter((c) => c.startDate >= rangeStart).reverse(),
    [cycles, rangeStart],
  )

  const lowMoodDays = rangeEntries.filter((e) => (e.mood ?? 5) <= 2).length
  const highMoodDays = rangeEntries.filter((e) => (e.mood ?? 0) >= 4).length
  const mixedDays = rangeEntries.filter(isMixedState).length

  return (
    <Sheet title="진료용 요약" onClose={onClose}>
      <div className="row no-print" style={{ gap: 6, marginBottom: 14 }}>
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.days}
            type="button"
            className="chip"
            aria-pressed={days === option.days}
            onClick={() => setDays(option.days)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div id="clinical-report" className="stack">
        <header style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>기분·에너지·수면 기록 요약</h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3 }}>
            {monthDayLabel(rangeStart)} ~ {monthDayLabel(today)} ({days}일) · 출력일{' '}
            {fullLabel(today, false)}
          </p>
        </header>

        <section className="card">
          <h3 style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>기록 현황</h3>
          <Row label="기록한 날" value={`${overview.loggedDays}일 / ${overview.totalDays}일 (${Math.round(overview.coverage * 100)}%)`} />
          {modules.mood && (
            <>
              <Row label="평균 기분" value={overview.moodAvg != null ? `${overview.moodAvg.toFixed(2)} / 5` : '기록 없음'} />
              <Row label="기분 2점 이하" value={`${lowMoodDays}일`} />
              <Row label="기분 4점 이상" value={`${highMoodDays}일`} />
            </>
          )}
          {modules.energy && (
            <Row label="평균 에너지" value={overview.energyAvg != null ? `${overview.energyAvg.toFixed(2)} / 5` : '기록 없음'} />
          )}
          {modules.mood && modules.energy && (
            <Row
              label="혼재 상태 (기분·에너지 차 2 이상)"
              value={`${mixedDays}일 (${Math.round(overview.mixedRate * 100)}%)`}
            />
          )}
        </section>

        {modules.sleep && (
          <section className="card">
            <h3 style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>수면</h3>
            {(['little', 'good', 'too_much'] as const).map((id) => (
              <Row key={id} label={sleepLabel(id)} value={`${overview.sleepCounts[id]}일`} />
            ))}
            {overview.sleepHoursAvg != null && (
              <Row label="평균 수면 시간" value={`${overview.sleepHoursAvg.toFixed(1)}시간`} />
            )}
            <div style={{ marginTop: 8 }}>
              {sleepGroups
                .filter((g) => g.count > 0)
                .map((g) => (
                  <Row
                    key={g.key}
                    label={`${g.label}인 날의 평균 기분`}
                    value={g.moodAvg != null ? `${g.moodAvg.toFixed(2)} (${g.count}일)` : '—'}
                  />
                ))}
            </div>
          </section>
        )}

        {modules.cycle && (
          <section className="card">
            <h3 style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>생리주기</h3>
            <Row
              label="평균 주기"
              value={cycleStats.usesDefaults ? '기록 부족 (기본값 28일)' : `${cycleStats.averageCycleLength}일`}
            />
            <Row label="평균 생리 기간" value={`${cycleStats.averagePeriodLength}일`} />
            {!cycleStats.usesDefaults && (
              <Row
                label="주기 범위"
                value={`${cycleStats.minCycleLength}~${cycleStats.maxCycleLength}일 (편차 ${cycleStats.variability}일)`}
              />
            )}
            {recentCycles.length > 0 && (
              <Row
                label="이 기간 생리"
                value={recentCycles
                  .map((c) => `${monthDayLabel(c.startDate)}${c.endDate ? `~${monthDayLabel(c.endDate)}` : '~'}`)
                  .join(', ')}
              />
            )}
            {phaseGroups.filter((g) => g.count > 0).length > 0 && (
              <div style={{ marginTop: 8 }}>
                {phaseGroups
                  .filter((g) => g.count > 0)
                  .map((g) => (
                    <Row
                      key={g.key}
                      label={`${g.label} 구간 평균 기분`}
                      value={g.moodAvg != null ? `${g.moodAvg.toFixed(2)} (${g.count}일)` : '—'}
                    />
                  ))}
              </div>
            )}
          </section>
        )}

        {topTags.length > 0 && (
          <section className="card">
            <h3 style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>자주 기록된 증상·상태</h3>
            <div className="row wrap" style={{ gap: 6 }}>
              {topTags.map((tag) => (
                <span
                  key={tag.tagId}
                  className="badge"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                >
                  {tag.name} {tag.count}일
                </span>
              ))}
            </div>
          </section>
        )}

        {cards.length > 0 && (
          <section className="card">
            <h3 style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>관찰된 관계</h3>
            <ul style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cards.slice(0, 6).map((card) => (
                <li key={card.id} style={{ fontSize: 12.5, lineHeight: 1.65, color: 'var(--text-2)' }}>
                  <strong style={{ color: 'var(--text)' }}>{card.title}</strong> — {card.body}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="hint" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          {MEDICAL_DISCLAIMER} 이 요약은 본인이 직접 입력한 기록을 집계한 것으로, 기억에 의존한
          회상보다 정확할 수 있으나 관찰의 누락이 있을 수 있습니다.
        </p>
      </div>

      <div className="row no-print" style={{ gap: 10, marginTop: 18 }}>
        <button type="button" className="btn grow" onClick={onClose}>
          닫기
        </button>
        <button type="button" className="btn btn-primary grow" onClick={() => window.print()}>
          <Icon name="print" size={16} /> 인쇄 / PDF 저장
        </button>
      </div>
    </Sheet>
  )
}
