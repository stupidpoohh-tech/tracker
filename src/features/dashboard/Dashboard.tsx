import { useMemo, useState } from 'react'
import { useApp } from '@/app/store'
import type { DateKey } from '@/domain/date'
import { fullLabel, relativeLabel } from '@/domain/date'
import type { PhaseIndex } from '@/domain/cycle'
import { PHASE_LABELS, buildPhaseIndex, computeCycleStats, getCycleStatus } from '@/domain/cycle'
import {
  computeOverview,
  entriesInRange,
  tagFrequency,
} from '@/domain/insights'
import {
  energyLabel,
  isMixedState,
  moodLabel,
  resolveEntryTagIds,
  sleepLabel,
  type Entry,
} from '@/domain/models'
import { Icon } from '@/ui/Icon'
import { Spinner } from '@/ui/components'
import {
  RANGE_PRESETS,
  canGoBack,
  canGoForward,
  defaultCustomRange,
  resolveRange,
  type RangePreset,
} from './range'
import { ChartLegend, TrendChart } from './TrendChart'

function StatTile({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div
      className="card card-tight"
      style={{ textAlign: 'center', background: `var(--${tone}-soft)`, borderColor: 'transparent' }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: `var(--${tone})`, lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function DayDetail({ entry, phaseLabel }: { entry: Entry; phaseLabel: string | null }) {
  const { tagIndex } = useApp()
  const fields: { label: string; value: string; color: string }[] = []
  if (entry.mood) fields.push({ label: '기분', value: `${entry.mood} · ${moodLabel(entry.mood)}`, color: 'var(--mood)' })
  if (entry.energy)
    fields.push({ label: '에너지', value: `${entry.energy} · ${energyLabel(entry.energy)}`, color: 'var(--energy)' })
  if (entry.sleep) {
    const hours = entry.sleepHours != null ? ` · ${entry.sleepHours}시간` : ''
    fields.push({ label: '수면', value: `${sleepLabel(entry.sleep)}${hours}`, color: 'var(--text)' })
  }
  if (phaseLabel) fields.push({ label: '주기', value: phaseLabel, color: 'var(--phase-period)' })

  const tags = resolveEntryTagIds(entry, tagIndex).map((id) => tagIndex.byId.get(id)?.name ?? id)

  return (
    <div className="stack-sm">
      {fields.length > 0 && (
        <div className="row wrap" style={{ gap: 8 }}>
          {fields.map((field) => (
            <div
              key={field.label}
              style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '6px 10px' }}
            >
              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{field.label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: field.color }}>{field.value}</div>
            </div>
          ))}
        </div>
      )}
      {isMixedState(entry) && (
        <div className="row" style={{ gap: 6, color: 'var(--mixed)', fontSize: 12, fontWeight: 600 }}>
          <Icon name="alert" size={14} />
          혼재 상태 — 기분·에너지 차이 {Math.abs((entry.mood ?? 0) - (entry.energy ?? 0))}
        </div>
      )}
      {tags.length > 0 && (
        <div className="row wrap" style={{ gap: 5 }}>
          {tags.map((name) => (
            <span key={name} className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
              {name}
            </span>
          ))}
        </div>
      )}
      {entry.memo && (
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {entry.memo}
        </p>
      )}
    </div>
  )
}

export function Dashboard({ onEdit }: { onEdit: (date: DateKey) => void }) {
  const { entries, tagIndex, cycles, profile, today, syncing, offline } = useApp()

  const [preset, setPreset] = useState<RangePreset>('30')
  const [offset, setOffset] = useState(0)
  const [custom, setCustom] = useState(() => defaultCustomRange(today))
  const [selected, setSelected] = useState<DateKey | null>(null)

  const modules = profile?.modules ?? { mood: true, energy: true, sleep: true, cycle: false }

  const range = useMemo(
    () => resolveRange(preset, offset, today, custom),
    [preset, offset, today, custom],
  )

  const earliestData = useMemo(() => {
    const keys = Object.keys(entries).sort()
    return keys[0] ?? null
  }, [entries])

  const rangeEntries = useMemo(
    () => entriesInRange(entries, range.start, range.end),
    [entries, range.start, range.end],
  )

  const ovulationMarks = useMemo(
    () => Object.values(entries).filter((e) => e.ovulationMark).map((e) => e.date),
    [entries],
  )

  const phaseIndex = useMemo<PhaseIndex>(
    () =>
      modules.cycle
        ? buildPhaseIndex(cycles, range.start, range.end, {
            stats: computeCycleStats(cycles),
            ovulationMarks,
            today,
          })
        : new Map<string, never>(),
    [cycles, range.start, range.end, ovulationMarks, today, modules.cycle],
  )

  const overview = useMemo(
    () => computeOverview(rangeEntries, range.start, range.end, today),
    [rangeEntries, range.start, range.end, today],
  )

  const cycleStatus = useMemo(
    () => (modules.cycle ? getCycleStatus(cycles, today) : null),
    [cycles, today, modules.cycle],
  )

  const topTags = useMemo(() => tagFrequency(rangeEntries, tagIndex, 8), [rangeEntries, tagIndex])

  const recent = useMemo(
    () => [...rangeEntries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20),
    [rangeEntries],
  )

  const changePreset = (next: RangePreset): void => {
    setPreset(next)
    setOffset(0)
    setSelected(null)
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <h1 className="page-title">대시보드</h1>
            {syncing && <Spinner size={14} />}
            {offline && (
              <span className="row" style={{ gap: 4, color: 'var(--text-3)', fontSize: 11 }}>
                <Icon name="cloudOff" size={13} /> 오프라인
              </span>
            )}
          </div>
          <p className="page-subtitle">{range.label}</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onEdit(today)}>
          <Icon name="plus" size={15} /> 오늘 기록
        </button>
      </header>

      {/* 구간 선택 */}
      <div className="scroll-x" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 6, paddingBottom: 2 }}>
          {RANGE_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="chip"
              aria-pressed={preset === item.id}
              onClick={() => changePreset(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {preset === 'custom' && (
        <div className="card card-tight row" style={{ gap: 8, marginBottom: 10 }}>
          <input
            className="input"
            type="date"
            value={custom.start}
            max={today}
            onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value || c.start }))}
            aria-label="시작일"
            style={{ minHeight: 38, fontSize: 13 }}
          />
          <span className="hint">~</span>
          <input
            className="input"
            type="date"
            value={custom.end}
            max={today}
            min={custom.start}
            onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value || c.end }))}
            aria-label="종료일"
            style={{ minHeight: 38, fontSize: 13 }}
          />
        </div>
      )}

      {preset !== 'custom' && (
        <div className="row" style={{ justifyContent: 'center', gap: 14, marginBottom: 10 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="이전 구간"
            disabled={!canGoBack(preset, range, earliestData)}
            onClick={() => setOffset((o) => o + 1)}
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-2)', minWidth: 72, textAlign: 'center' }}>
            {offset === 0 ? '현재' : preset === 'year' ? range.label : `${offset}구간 전`}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="다음 구간"
            disabled={!canGoForward(preset, offset)}
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      )}

      {/* 요약 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))',
          gap: 8,
          marginBottom: 14,
        }}
      >
        <StatTile
          value={`${overview.loggedDays}/${overview.totalDays}`}
          label="기록한 날"
          tone="accent"
        />
        {modules.mood && (
          <StatTile
            value={overview.moodAvg != null ? overview.moodAvg.toFixed(1) : '—'}
            label="평균 기분"
            tone="accent"
          />
        )}
        {modules.energy && (
          <StatTile
            value={overview.energyAvg != null ? overview.energyAvg.toFixed(1) : '—'}
            label="평균 에너지"
            tone="teal"
          />
        )}
        <StatTile value={`${overview.currentStreak}일`} label="연속 기록" tone="amber" />
      </div>

      {/* 주기 상태 */}
      {cycleStatus && cycleStatus.cycleDay != null && (
        <div className="card card-tight row-between" style={{ marginBottom: 14, gap: 10 }}>
          <span className="row" style={{ gap: 8 }}>
            <span style={{ color: 'var(--phase-period)' }}>
              <Icon name="droplet" size={17} />
            </span>
            <span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                주기 {cycleStatus.cycleDay}일차
                {cycleStatus.phase ? ` · ${PHASE_LABELS[cycleStatus.phase]}` : ''}
              </span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)' }}>
                {cycleStatus.daysOverdue != null
                  ? `예상일보다 ${cycleStatus.daysOverdue}일 지났습니다`
                  : `다음 예상일까지 ${cycleStatus.daysUntilNextPeriod}일`}
                {cycleStatus.stats.usesDefaults ? ' (28일 기본값)' : ` · 평균 ${cycleStatus.stats.averageCycleLength}일`}
              </span>
            </span>
          </span>
        </div>
      )}

      {/* 차트 */}
      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 10 }}>
          <ChartLegend modules={modules} showCycle={modules.cycle} />
        </div>
        <TrendChart
          start={range.start}
          end={range.end}
          entries={entries}
          phaseIndex={phaseIndex}
          modules={modules}
          today={today}
          selectedDate={selected}
          onSelect={setSelected}
        />
      </section>

      {selected && entries[selected] && (
        <section className="card" style={{ marginBottom: 16, animation: 'fade-in 0.2s var(--ease)' }}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{fullLabel(selected)}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginLeft: 6 }}>
                {relativeLabel(selected, today)}
              </span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(selected)}>
              <Icon name="pencil" size={14} /> 수정
            </button>
          </div>
          <DayDetail
            entry={entries[selected] as Entry}
            phaseLabel={
              phaseIndex.get(selected)
                ? `${PHASE_LABELS[phaseIndex.get(selected)!.phase]}${phaseIndex.get(selected)!.predicted ? ' (예측)' : ''}`
                : null
            }
          />
        </section>
      )}

      {/* 태그 빈도 */}
      {topTags.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <p className="section-label">이 기간 태그 빈도</p>
          <div className="card stack-sm">
            {topTags.map((tag) => {
              const max = topTags[0]?.count ?? 1
              return (
                <div key={tag.tagId} className="row" style={{ gap: 8 }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-2)',
                      width: 118,
                      flexShrink: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={tag.name}
                  >
                    {tag.name}
                  </span>
                  <span
                    className="grow"
                    style={{ height: 12, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}
                  >
                    <span
                      style={{
                        display: 'block',
                        width: `${(tag.count / max) * 100}%`,
                        height: '100%',
                        background: 'var(--accent)',
                        opacity: 0.65,
                        borderRadius: 4,
                      }}
                    />
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-3)', width: 22, textAlign: 'right' }}>
                    {tag.count}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* 최근 기록 */}
      <section>
        <p className="section-label">이 기간 기록</p>
        {recent.length === 0 ? (
          <p className="empty">
            이 구간에는 기록이 없습니다.
            <br />
            오늘 기록부터 시작해보세요.
          </p>
        ) : (
          <div className="card" style={{ padding: '0 14px' }}>
            {recent.map((entry, index) => {
              const phase = phaseIndex.get(entry.date)
              const tags = resolveEntryTagIds(entry, tagIndex)
              return (
                <button
                  key={entry.date}
                  type="button"
                  onClick={() => setSelected(selected === entry.date ? null : entry.date)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    padding: '11px 0',
                    borderTop: index === 0 ? 'none' : '1px solid var(--border)',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ width: 46, flexShrink: 0, paddingTop: 1 }}>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)' }}>
                      {entry.date.slice(5).replace('-', '/')}
                    </span>
                    {entry.date === today && (
                      <span style={{ display: 'block', fontSize: 9.5, color: 'var(--accent)', fontWeight: 700 }}>
                        오늘
                      </span>
                    )}
                    {phase && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 9,
                          color: `var(--phase-${phase.phase === 'premenstrual' ? 'premenstrual' : phase.phase})`,
                          fontWeight: 600,
                        }}
                      >
                        {PHASE_LABELS[phase.phase]}
                      </span>
                    )}
                  </span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row wrap" style={{ gap: 5 }}>
                      {entry.mood && (
                        <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--mood)' }}>
                          기분 {entry.mood}
                        </span>
                      )}
                      {entry.energy && (
                        <span className="badge" style={{ background: 'var(--teal-soft)', color: 'var(--energy)' }}>
                          에너지 {entry.energy}
                        </span>
                      )}
                      {isMixedState(entry) && (
                        <span className="badge" style={{ background: 'var(--amber-soft)', color: 'var(--mixed)' }}>
                          혼재
                        </span>
                      )}
                      {entry.sleep && (
                        <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                          {sleepLabel(entry.sleep)}
                        </span>
                      )}
                      {tags.slice(0, 3).map((id) => (
                        <span
                          key={id}
                          className="badge"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                        >
                          {tagIndex.byId.get(id)?.name ?? id}
                        </span>
                      ))}
                      {tags.length > 3 && (
                        <span className="badge" style={{ color: 'var(--text-3)' }}>+{tags.length - 3}</span>
                      )}
                    </span>
                    {entry.memo && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11.5,
                          color: 'var(--text-3)',
                          marginTop: 4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {entry.memo}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
