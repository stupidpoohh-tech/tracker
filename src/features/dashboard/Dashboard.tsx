import { useMemo, useState } from 'react'
import { useApp } from '@/app/store'
import type { DateKey } from '@/domain/date'
import { fullLabel, relativeLabel } from '@/domain/date'
import type { PhaseIndex } from '@/domain/cycle'
import { PHASE_LABELS, buildPhaseIndex, computeCycleStats, getCycleStatus } from '@/domain/cycle'
import { computeOverview, entriesInRange, tagFrequency } from '@/domain/insights'
import {
  energyLabel,
  isMixedState,
  moodLabel,
  resolveEntryTagIds,
  sleepLabel,
  type Entry,
} from '@/domain/models'
import { Icon, type IconName } from '@/ui/Icon'
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

/** 처음에 보여줄 기록 수. 나머지는 '더보기'로 펼칩니다. */
const RECENT_PREVIEW = 6

function StatTile({
  icon,
  value,
  suffix,
  label,
  highlight,
}: {
  icon: IconName
  value: string
  suffix?: string
  label: string
  highlight?: boolean
}) {
  return (
    <div className="stat-tile">
      <span className="stat-icon">
        <Icon name={icon} size={18} />
      </span>
      <div className="stat-value">
        <span className={highlight ? 'accent' : undefined}>{value}</span>
        {suffix && <span className="stat-suffix">{suffix}</span>}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function DayDetail({ entry, phaseLabel }: { entry: Entry; phaseLabel: string | null }) {
  const { tagIndex } = useApp()
  const fields: { label: string; value: string; color: string }[] = []
  if (entry.mood)
    fields.push({ label: '기분', value: `${entry.mood} · ${moodLabel(entry.mood)}`, color: 'var(--mood)' })
  if (entry.energy)
    fields.push({
      label: '에너지',
      value: `${entry.energy} · ${energyLabel(entry.energy)}`,
      color: 'var(--energy)',
    })
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
              style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '7px 11px' }}
            >
              <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{field.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: field.color }}>{field.value}</div>
            </div>
          ))}
        </div>
      )}
      {isMixedState(entry) && (
        <div className="row" style={{ gap: 6, color: 'var(--mixed)', fontSize: 12.5, fontWeight: 600 }}>
          <Icon name="alert" size={14} />
          혼재 상태 — 기분·에너지 차이 {Math.abs((entry.mood ?? 0) - (entry.energy ?? 0))}
        </div>
      )}
      {tags.length > 0 && (
        <div className="row wrap" style={{ gap: 5 }}>
          {tags.map((name) => (
            <span
              key={name}
              className="badge"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            >
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
  const [expanded, setExpanded] = useState(false)

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
    () =>
      Object.values(entries)
        .filter((e) => e.ovulationMark)
        .map((e) => e.date),
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
    () => [...rangeEntries].sort((a, b) => b.date.localeCompare(a.date)),
    [rangeEntries],
  )
  const visibleRecent = expanded ? recent.slice(0, 60) : recent.slice(0, RECENT_PREVIEW)

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
          <button
            type="button"
            className="period-button"
            onClick={() => changePreset(preset === 'custom' ? '30' : 'custom')}
            aria-label="기간 직접 설정"
          >
            {range.label}
            <Icon name="chevronDown" size={15} />
          </button>
        </div>
        <button type="button" className="btn btn-tint btn-sm" onClick={() => onEdit(today)}>
          <Icon name="plus" size={16} strokeWidth={2.2} /> 오늘 기록
        </button>
      </header>

      {/* 구간 선택 — 시안의 세그먼트 컨트롤 */}
      <div className="segmented" role="group" aria-label="표시 구간">
        {RANGE_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="segmented-item"
            aria-pressed={preset === item.id}
            onClick={() => changePreset(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="card card-tight row" style={{ gap: 8, marginTop: 10 }}>
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
        <div className="row" style={{ justifyContent: 'center', gap: 14, margin: '12px 0 4px' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="이전 구간"
            disabled={!canGoBack(preset, range, earliestData)}
            onClick={() => setOffset((o) => o + 1)}
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <span style={{ fontSize: 13, color: 'var(--text-2)', minWidth: 74, textAlign: 'center' }}>
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

      {/* 요약 타일 */}
      <div className="stat-grid" style={{ margin: '12px 0 14px' }}>
        <StatTile
          icon="calendar"
          value={String(overview.loggedDays)}
          suffix={`/${overview.totalDays}`}
          label="기록한 날"
          highlight
        />
        {modules.mood && (
          <StatTile
            icon="leaf"
            value={overview.moodAvg != null ? overview.moodAvg.toFixed(1) : '—'}
            label="평균 기분"
          />
        )}
        {modules.energy && (
          <StatTile
            icon="zap"
            value={overview.energyAvg != null ? overview.energyAvg.toFixed(1) : '—'}
            label="평균 에너지"
          />
        )}
        <StatTile icon="sun" value={`${overview.currentStreak}일`} label="연속 기록" />
      </div>

      {/* 주기 상태 */}
      {cycleStatus && cycleStatus.cycleDay != null && (
        <div className="card card-tight row" style={{ marginBottom: 14, gap: 11 }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'var(--rose-soft)',
              color: 'var(--phase-period)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon name="droplet" size={17} />
          </span>
          <span className="grow">
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>
              주기 {cycleStatus.cycleDay}일차
              {cycleStatus.phase ? ` · ${PHASE_LABELS[cycleStatus.phase]}` : ''}
            </span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginTop: 1 }}>
              {cycleStatus.daysOverdue != null
                ? `예상일보다 ${cycleStatus.daysOverdue}일 지났습니다`
                : `다음 예상일까지 ${cycleStatus.daysUntilNextPeriod}일`}
              {cycleStatus.stats.usesDefaults
                ? ' · 28일 기본값'
                : ` · 평균 ${cycleStatus.stats.averageCycleLength}일`}
            </span>
          </span>
        </div>
      )}

      {/* 차트 */}
      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
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
              <span style={{ fontSize: 14.5, fontWeight: 700 }}>{fullLabel(selected)}</span>
              <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 6 }}>
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
          <div className="section-head">
            <h2>이 기간 태그</h2>
          </div>
          <div className="card stack-sm">
            {topTags.map((tag) => {
              const max = topTags[0]?.count ?? 1
              return (
                <div key={tag.tagId} className="row" style={{ gap: 10 }}>
                  <span
                    style={{
                      fontSize: 12.5,
                      color: 'var(--text-2)',
                      width: 112,
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
                    style={{
                      height: 10,
                      background: 'var(--surface-2)',
                      borderRadius: 999,
                      overflow: 'hidden',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        width: `${(tag.count / max) * 100}%`,
                        height: '100%',
                        background: 'var(--accent-bright)',
                        borderRadius: 999,
                      }}
                    />
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-3)',
                      width: 20,
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {tag.count}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* 기록 목록 */}
      <section>
        <div className="section-head">
          <h2>이 기간 기록</h2>
          {recent.length > RECENT_PREVIEW && (
            <button type="button" className="section-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '접기' : '더보기'}
              <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
            </button>
          )}
        </div>

        {recent.length === 0 ? (
          <p className="empty">
            이 구간에는 기록이 없습니다.
            <br />
            오늘 기록부터 시작해보세요.
          </p>
        ) : (
          <div className="record-list">
            {visibleRecent.map((entry) => {
              const tags = resolveEntryTagIds(entry, tagIndex)
              const firstTag = tags[0] ? tagIndex.byId.get(tags[0])?.name : null
              const summary = entry.memo || (firstTag ? tags.map((id) => tagIndex.byId.get(id)?.name ?? id).join(' ') : '')
              return (
                <button
                  key={entry.date}
                  type="button"
                  className="record-row"
                  onClick={() => setSelected(selected === entry.date ? null : entry.date)}
                >
                  <span className="record-date">{entry.date.slice(5).replace('-', '/')}</span>
                  <span className="record-body">
                    {entry.mood && (
                      <span
                        className="badge"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        기분 {entry.mood}
                      </span>
                    )}
                    {entry.energy && (
                      <span
                        className="badge"
                        style={{ background: 'var(--teal-soft)', color: 'var(--teal)' }}
                      >
                        에너지 {entry.energy}
                      </span>
                    )}
                    {entry.sleep && (
                      <span
                        className="badge"
                        style={{
                          background:
                            entry.sleep === 'little'
                              ? 'var(--rose-soft)'
                              : entry.sleep === 'good'
                                ? 'var(--success-soft)'
                                : 'var(--surface-2)',
                          color:
                            entry.sleep === 'little'
                              ? 'var(--rose)'
                              : entry.sleep === 'good'
                                ? 'var(--success)'
                                : 'var(--text-2)',
                        }}
                      >
                        {sleepLabel(entry.sleep)}
                      </span>
                    )}
                    {isMixedState(entry) && (
                      <span
                        className="badge"
                        style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}
                      >
                        혼재
                      </span>
                    )}
                    {summary && <span className="record-memo">{summary}</span>}
                  </span>
                  <span className="record-chevron">
                    <Icon name="chevronRight" size={16} />
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
