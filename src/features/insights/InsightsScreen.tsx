import { useMemo, useState } from 'react'
import { useApp } from '@/app/store'
import { addDays } from '@/domain/date'
import type { PhaseIndex } from '@/domain/cycle'
import { PHASE_LABELS, buildPhaseIndex, computeCycleStats } from '@/domain/cycle'
import {
  MIN_TOTAL_ENTRIES,
  buildInsights,
  computeOverview,
  entriesInRange,
  groupByPhase,
  groupBySleep,
  type GroupSummary,
  type InsightCard,
} from '@/domain/insights'
import { Icon, type IconName } from '@/ui/Icon'
import { ClinicalReport } from './ClinicalReport'

const WINDOW_OPTIONS = [
  { days: 30, label: '30일' },
  { days: 90, label: '3개월' },
  { days: 180, label: '6개월' },
  { days: 365, label: '1년' },
] as const

const KIND_ICON: Record<InsightCard['kind'], IconName> = {
  sleep: 'moon',
  cycle: 'droplet',
  tag: 'tag',
  mixed: 'alert',
  weekday: 'calendar',
  correlation: 'chart',
}

function GroupTable({ title, groups, note }: { title: string; groups: GroupSummary[]; note?: string }) {
  const usable = groups.filter((g) => g.count > 0)
  if (usable.length === 0) return null
  return (
    <section className="card stack-sm">
      <h3 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h3>
      <div className="stack-sm">
        {usable.map((group) => (
          <div key={group.key} className="row" style={{ gap: 10 }}>
            <span style={{ fontSize: 12.5, width: 72, flexShrink: 0, color: 'var(--text-2)' }}>
              {group.label}
            </span>
            <span className="grow row" style={{ gap: 8 }}>
              {group.moodAvg != null && (
                <span style={{ fontSize: 12.5, color: 'var(--mood)' }}>
                  기분 {group.moodAvg.toFixed(1)}
                </span>
              )}
              {group.energyAvg != null && (
                <span style={{ fontSize: 12.5, color: 'var(--energy)' }}>
                  에너지 {group.energyAvg.toFixed(1)}
                </span>
              )}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{group.count}일</span>
          </div>
        ))}
      </div>
      {note && <p className="hint">{note}</p>}
    </section>
  )
}

/**
 * 인사이트 화면.
 *
 * v3의 분석은 태그 빈도 막대 하나였습니다. 기분·에너지·수면·주기·태그가 한
 * 곳에 있을 때만 나오는 관계를 보여주는 것이 이 앱의 실질적 가치라고 봅니다.
 */
export function InsightsScreen() {
  const { entries, tagIndex, cycles, profile, today } = useApp()
  const [windowDays, setWindowDays] = useState<number>(90)
  const [showReport, setShowReport] = useState(false)

  const modules = profile?.modules ?? { mood: true, energy: true, sleep: true, cycle: false }

  const rangeStart = addDays(today, -(windowDays - 1))
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
            stats: computeCycleStats(cycles),
            ovulationMarks,
            today,
            predict: false,
          })
        : new Map<string, never>(),
    [cycles, rangeStart, today, ovulationMarks, modules.cycle],
  )

  const cards = useMemo(
    () => buildInsights({ entries: rangeEntries, phaseIndex, tagIndex, rangeStart, rangeEnd: today }),
    [rangeEntries, phaseIndex, tagIndex, rangeStart, today],
  )

  const overview = useMemo(
    () => computeOverview(rangeEntries, rangeStart, today, today),
    [rangeEntries, rangeStart, today],
  )

  const sleepGroups = useMemo(() => groupBySleep(rangeEntries), [rangeEntries])
  const phaseGroups = useMemo(
    () => (modules.cycle ? groupByPhase(rangeEntries, phaseIndex) : []),
    [rangeEntries, phaseIndex, modules.cycle],
  )

  const enough = rangeEntries.length >= MIN_TOTAL_ENTRIES

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">인사이트</h1>
          <p className="page-subtitle">
            최근 {windowDays}일 중 {overview.loggedDays}일 기록
          </p>
        </div>
        <button type="button" className="btn btn-tint btn-sm" onClick={() => setShowReport(true)}>
          <Icon name="print" size={15} /> 진료 리포트
        </button>
      </header>

      <div className="segmented" role="group" aria-label="분석 기간" style={{ marginBottom: 16 }}>
        {WINDOW_OPTIONS.map((option) => (
          <button
            key={option.days}
            type="button"
            className="segmented-item"
            aria-pressed={windowDays === option.days}
            onClick={() => setWindowDays(option.days)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!enough && (
        <div className="notice notice-info" style={{ marginBottom: 16 }}>
          기록이 {MIN_TOTAL_ENTRIES}일 이상 모이면 패턴을 계산합니다. 지금은 {rangeEntries.length}일
          입니다. 며칠 더 기록해주세요.
        </div>
      )}

      {enough && cards.length === 0 && (
        <div className="notice notice-info" style={{ marginBottom: 16 }}>
          이 기간에는 눈에 띄는 차이가 없습니다. 우연으로 보기 어려운 차이가 나타날 때만 카드를
          만듭니다.
        </div>
      )}

      {cards.length > 0 && (
        <div className="stack" style={{ marginBottom: 20 }}>
          {cards.map((card) => (
            <article
              key={card.id}
              className="card"
              style={{
                borderLeft: `3px solid ${card.strength === 'strong' ? 'var(--accent)' : 'var(--border-strong)'}`,
              }}
            >
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <span style={{ color: 'var(--accent-bright)' }}>
                  <Icon name={KIND_ICON[card.kind]} size={16} />
                </span>
                <h2 style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.45, letterSpacing: '-0.02em' }}>
                  {card.title}
                </h2>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{card.body}</p>
              <p className="hint" style={{ marginTop: 6 }}>
                표본 {card.sampleSize}일
                {card.strength === 'strong' ? ' · 차이가 뚜렷합니다' : ' · 참고 수준입니다'}
              </p>
            </article>
          ))}
        </div>
      )}

      <div className="stack" style={{ marginBottom: 20 }}>
        {modules.sleep && (
          <GroupTable
            title="수면 상태별 평균"
            groups={sleepGroups}
            note="5일 미만인 그룹은 비교에 쓰지 않습니다."
          />
        )}
        {modules.cycle && phaseGroups.length > 0 && (
          <GroupTable
            title="주기 단계별 평균"
            groups={phaseGroups}
            note={`단계는 기록된 생리 시작·종료일에서 파생 계산합니다 (${Object.values(PHASE_LABELS).join('·')}).`}
          />
        )}
      </div>

      <div className="notice notice-info">
        여기 표시되는 것은 기록 사이의 관계일 뿐 원인이 아닙니다. 진단이나 치료 판단의 근거로 쓰지
        마시고, 의료진과의 대화 재료로만 사용해주세요.
      </div>

      {showReport && <ClinicalReport onClose={() => setShowReport(false)} />}
    </div>
  )
}
