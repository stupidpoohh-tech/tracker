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
import {
  ChartLegend,
  ChartSecondaryKey,
  SLEEP_COLOR,
  TrendChart,
  type ChartLayers,
} from './TrendChart'

/** 처음에 보여줄 기록 수. 나머지는 '더보기'로 펼칩니다. */
const RECENT_PREVIEW = 6

/** `8.04 – 9.02` — 헤더에서 기간을 한 줄로 압축해 보여줍니다. */
function compactRange(start: DateKey, end: DateKey): string {
  const short = (key: DateKey): string => `${Number(key.slice(5, 7))}.${key.slice(8, 10)}`
  return `${short(start)} – ${short(end)}`
}

function Kpi({
  value,
  unit,
  label,
  brand,
}: {
  value: string
  unit?: string
  label: string
  brand?: boolean
}) {
  return (
    <div className="kpi-item">
      <div className={`kpi-value${brand ? ' is-brand' : ''}`}>
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  )
}

function DayDetail({ entry, phaseLabel }: { entry: Entry; phaseLabel: string | null }) {
  const { tagIndex } = useApp()
  const rows: { label: string; value: string }[] = []
  if (entry.mood) rows.push({ label: '기분', value: `${entry.mood} · ${moodLabel(entry.mood)}` })
  if (entry.energy)
    rows.push({ label: '에너지', value: `${entry.energy} · ${energyLabel(entry.energy)}` })
  if (entry.sleep) {
    const hours = entry.sleepHours != null ? ` · ${entry.sleepHours}시간` : ''
    rows.push({ label: '수면', value: `${sleepLabel(entry.sleep)}${hours}` })
  }
  if (phaseLabel) rows.push({ label: '주기', value: phaseLabel })

  const tags = resolveEntryTagIds(entry, tagIndex).map((id) => tagIndex.byId.get(id)?.name ?? id)

  return (
    <div className="stack-sm">
      {rows.map((row) => (
        <div key={row.label} className="row-between" style={{ fontSize: 13 }}>
          <span style={{ color: 'var(--text-3)' }}>{row.label}</span>
          <span style={{ color: 'var(--text)' }}>{row.value}</span>
        </div>
      ))}
      {isMixedState(entry) && (
        <div className="row" style={{ gap: 6, color: 'var(--warning)', fontSize: 12.5 }}>
          <Icon name="alert" size={13} />
          혼재 상태 — 기분·에너지 차이 {Math.abs((entry.mood ?? 0) - (entry.energy ?? 0))}
        </div>
      )}
      {tags.length > 0 && (
        <div className="row wrap" style={{ gap: 4, marginTop: 2 }}>
          {tags.map((name) => (
            <span key={name} className="tag">
              {name}
            </span>
          ))}
        </div>
      )}
      {entry.memo && (
        <p
          style={{
            fontSize: 13.5,
            color: 'var(--text-2)',
            lineHeight: 1.75,
            whiteSpace: 'pre-wrap',
            marginTop: 2,
          }}
        >
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
  const [layers, setLayers] = useState<ChartLayers>({ sleep: true, cycle: true })

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

  const topTags = useMemo(() => tagFrequency(rangeEntries, tagIndex, 6), [rangeEntries, tagIndex])

  const recent = useMemo(
    () => [...rangeEntries].sort((a, b) => b.date.localeCompare(a.date)),
    [rangeEntries],
  )
  const visibleRecent = expanded ? recent.slice(0, 60) : recent.slice(0, RECENT_PREVIEW)
  const hasMixed = useMemo(() => rangeEntries.some(isMixedState), [rangeEntries])

  const changePreset = (next: RangePreset): void => {
    setPreset(next)
    setOffset(0)
    setSelected(null)
  }

  const toggleLayer = (key: keyof ChartLayers): void =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="page">
      {/* ① 현재 상태 ───────────────────────────────────────────────────── */}
      <header className="page-header">
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <h1 className="page-title">대시보드</h1>
          {syncing && <Spinner size={13} />}
          {offline && (
            <span className="row" style={{ gap: 3, color: 'var(--text-3)', fontSize: 11 }}>
              <Icon name="cloudOff" size={12} /> 오프라인
            </span>
          )}
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onEdit(today)}>
          <Icon name="plus" size={15} strokeWidth={2} /> 기록
        </button>
      </header>

      {/* 기간 — 텍스트 탭 + 한 줄 메타 */}
      <div className="tabs scroll-x" role="group" aria-label="표시 구간">
        {RANGE_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="tab"
            aria-pressed={preset === item.id}
            onClick={() => changePreset(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="range-bar">
        {preset !== 'custom' && (
          <button
            type="button"
            className="range-step"
            aria-label="이전 구간"
            disabled={!canGoBack(preset, range, earliestData)}
            onClick={() => setOffset((o) => o + 1)}
          >
            <Icon name="chevronLeft" size={15} />
          </button>
        )}
        <span className="range-label">
          {compactRange(range.start, range.end)}
          <span style={{ color: 'var(--text-3)' }}> · {range.days}일</span>
        </span>
        {preset !== 'custom' && (
          <button
            type="button"
            className="range-step"
            aria-label="다음 구간"
            disabled={!canGoForward(preset, offset)}
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
          >
            <Icon name="chevronRight" size={15} />
          </button>
        )}
      </div>

      {preset === 'custom' && (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <input
            className="input"
            type="date"
            value={custom.start}
            max={today}
            onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value || c.start }))}
            aria-label="시작일"
            style={{ minHeight: 38, fontSize: 13 }}
          />
          <span className="meta">~</span>
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

      {/* KPI — 카드 없이 얇은 세로선으로만 구분 */}
      <div className="kpi-row">
        <Kpi value={String(overview.loggedDays)} unit={`/${overview.totalDays}일`} label="기록" brand />
        {modules.mood && (
          <Kpi
            value={overview.moodAvg != null ? overview.moodAvg.toFixed(1) : '—'}
            label="평균 기분"
          />
        )}
        {modules.energy && (
          <Kpi
            value={overview.energyAvg != null ? overview.energyAvg.toFixed(1) : '—'}
            label="평균 에너지"
          />
        )}
        <Kpi value={String(overview.currentStreak)} unit="일" label="연속 기록" />
      </div>

      {cycleStatus && cycleStatus.cycleDay != null && (
        <p className="meta" style={{ marginTop: -8, marginBottom: 20 }}>
          주기 {cycleStatus.cycleDay}일차
          {cycleStatus.phase ? ` · ${PHASE_LABELS[cycleStatus.phase]}` : ''} ·{' '}
          {cycleStatus.daysOverdue != null
            ? `예상일 ${cycleStatus.daysOverdue}일 지남`
            : `다음 예상일까지 ${cycleStatus.daysUntilNextPeriod}일`}
        </p>
      )}

      {/* ② 변화 추이 ───────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <div className="row-between" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <ChartLegend modules={modules} />
          <div className="row" style={{ gap: 4, flexShrink: 0 }}>
            {modules.sleep && (
              <button
                type="button"
                className="layer-toggle"
                aria-pressed={layers.sleep}
                onClick={() => toggleLayer('sleep')}
              >
                수면
              </button>
            )}
            {modules.cycle && (
              <button
                type="button"
                className="layer-toggle"
                aria-pressed={layers.cycle}
                onClick={() => toggleLayer('cycle')}
              >
                주기
              </button>
            )}
          </div>
        </div>

        <TrendChart
          start={range.start}
          end={range.end}
          entries={entries}
          phaseIndex={phaseIndex}
          modules={modules}
          layers={layers}
          today={today}
          selectedDate={selected}
          onSelect={setSelected}
        />

        <ChartSecondaryKey modules={modules} layers={layers} hasMixed={hasMixed} />
      </section>

      {selected && entries[selected] && (
        <section className="panel-muted" style={{ marginBottom: 28 }}>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <div>
              <span className="section-title">{fullLabel(selected)}</span>
              <span className="meta" style={{ marginLeft: 6 }}>
                {relativeLabel(selected, today)}
              </span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(selected)}>
              수정
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

      {topTags.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div className="section-head">
            <h2 className="section-title">자주 기록한 태그</h2>
          </div>
          <div className="stack-sm">
            {topTags.map((tag) => {
              const max = topTags[0]?.count ?? 1
              return (
                <div key={tag.tagId} className="row" style={{ gap: 10 }}>
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--text-2)',
                      width: 104,
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
                    style={{ height: 3, background: 'var(--grid)', borderRadius: 2 }}
                  >
                    <span
                      style={{
                        display: 'block',
                        width: `${(tag.count / max) * 100}%`,
                        height: '100%',
                        background: 'var(--text-3)',
                        borderRadius: 2,
                      }}
                    />
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-3)',
                      width: 18,
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

      {/* ③ 최근 기록 ───────────────────────────────────────────────────── */}
      <section>
        <div className="section-head">
          <h2 className="section-title">이 기간 기록</h2>
          {recent.length > RECENT_PREVIEW && (
            <button type="button" className="section-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '접기' : '더보기'}
              <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
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
              const tags = resolveEntryTagIds(entry, tagIndex).map(
                (id) => tagIndex.byId.get(id)?.name ?? id,
              )
              const summary = entry.memo || tags.join(' · ')
              return (
                <button
                  key={entry.date}
                  type="button"
                  className="record-row"
                  onClick={() => setSelected(selected === entry.date ? null : entry.date)}
                >
                  <span className="record-date">{entry.date.slice(5).replace('-', '/')}</span>
                  <span className="record-main">
                    {entry.mood != null && (
                      <span className="record-score">기분 {entry.mood}</span>
                    )}
                    {entry.sleep && (
                      <span
                        aria-label={sleepLabel(entry.sleep)}
                        title={sleepLabel(entry.sleep)}
                        style={{
                          width: 10,
                          height: 3,
                          borderRadius: 2,
                          flexShrink: 0,
                          background: SLEEP_COLOR[entry.sleep] ?? 'var(--grid)',
                        }}
                      />
                    )}
                    {summary && <span className="record-summary">{summary}</span>}
                  </span>
                  <span className="record-chevron">
                    <Icon name="chevronRight" size={15} />
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
