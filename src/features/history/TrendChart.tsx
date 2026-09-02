import { useMemo } from 'react'
import type { DateKey } from '@/domain/date'
import { datesInRange, shortLabel } from '@/domain/date'
import type { PhaseIndex } from '@/domain/cycle'
import { PHASE_LABELS } from '@/domain/cycle'
import { isMixedState, type EntryMap, type TrackedModules } from '@/domain/models'

/** 데이터 간격이 이 이상이면 추세선을 잇지 않습니다. */
const MAX_GAP_DAYS = 14

/*
 * 높이를 이전(210px)보다 28% 줄였습니다. 기록이 적을 때 큰 빈 그래프가
 * 화면의 절반을 차지하면 데이터보다 컴포넌트가 먼저 보입니다.
 */
const CHART_HEIGHT = 150
const AXIS_GUTTER = 18
const DATA_TOP = 10
const DATA_BOTTOM = 112
const SLEEP_ROW_Y = 130
const LABEL_Y = CHART_HEIGHT + 14

interface Point {
  x: number
  y: number
  index: number
}

function segmentedPath(points: readonly Point[]): string {
  if (points.length < 2) return ''
  const segments: Point[][] = []
  let current: Point[] = [points[0] as Point]
  for (let i = 1; i < points.length; i++) {
    const point = points[i] as Point
    const previous = points[i - 1] as Point
    if (point.index - previous.index > MAX_GAP_DAYS) {
      if (current.length >= 2) segments.push(current)
      current = [point]
    } else {
      current.push(point)
    }
  }
  if (current.length >= 2) segments.push(current)
  return segments
    .map((seg) => seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' '))
    .join(' ')
}

export const SLEEP_COLOR: Record<string, string> = {
  little: 'var(--sleep-short)',
  good: 'var(--sleep-ok)',
  too_much: 'var(--sleep-long)',
}

export const PHASE_COLOR: Record<string, string> = {
  period: 'var(--phase-period)',
  premenstrual: 'var(--phase-premenstrual)',
  ovulation: 'var(--phase-ovulation)',
}

export interface ChartLayers {
  sleep: boolean
  cycle: boolean
}

/**
 * 기분·에너지 추세.
 *
 * 두 계열은 같은 Y축을 공유하고 형태로 구분합니다(기분 ●, 에너지 ◆).
 * 수치별로 색을 바꾸지 않습니다 — 높낮이가 이미 값을 표현합니다.
 * 색만으로 구분하면 색각 이상이 있는 사용자가 두 계열을 구별하지 못하므로
 * 형태 구분을 함께 둡니다.
 *
 * 데이터 색은 브랜드 세이지와 분리했습니다. 검증기(dataviz)로 명도·채도·
 * 색각 분리·대비를 확인한 값만 씁니다.
 */
export function TrendChart({
  start,
  end,
  entries,
  phaseIndex,
  modules,
  layers,
  today,
  selectedDate,
  onSelect,
}: {
  start: DateKey
  end: DateKey
  entries: EntryMap
  phaseIndex: PhaseIndex
  modules: TrackedModules
  layers: ChartLayers
  today: DateKey
  selectedDate: DateKey | null
  onSelect: (date: DateKey | null) => void
}) {
  const dates = useMemo(() => datesInRange(start, end), [start, end])

  const dense = dates.length > 120
  const slotWidth = dense ? 3.5 : 9
  const gap = dense ? 1.6 : 3.5
  const step = slotWidth + gap
  const dotRadius = dense ? 2.2 : 3.6
  const diamond = dense ? 2.6 : 4.2
  const mixedRadius = dense ? 4.6 : 6.6
  const plotWidth = Math.max(dates.length * step, 240)
  const chartWidth = plotWidth + AXIS_GUTTER

  const valueY = (value: number): number =>
    DATA_BOTTOM - ((value - 1) / 4) * (DATA_BOTTOM - DATA_TOP)
  const slotX = (index: number): number => AXIS_GUTTER + index * step + slotWidth / 2

  const showSleep = modules.sleep && layers.sleep
  const showCycle = modules.cycle && layers.cycle

  const { moodPath, energyPath, summary } = useMemo(() => {
    const moodPoints: Point[] = []
    const energyPoints: Point[] = []
    let logged = 0
    dates.forEach((date, index) => {
      const entry = entries[date]
      if (!entry) return
      logged += 1
      const cx = AXIS_GUTTER + index * step + slotWidth / 2
      if (entry.mood) moodPoints.push({ x: cx, y: valueY(entry.mood), index })
      if (entry.energy) energyPoints.push({ x: cx, y: valueY(entry.energy), index })
    })
    return {
      moodPath: modules.mood ? segmentedPath(moodPoints) : '',
      energyPath: modules.energy ? segmentedPath(energyPoints) : '',
      summary: `${shortLabel(start)}부터 ${shortLabel(end)}까지 ${dates.length}일 중 ${logged}일 기록됨`,
    }
     
  }, [dates, entries, step, slotWidth, modules.mood, modules.energy, start, end])

  const labelEvery = Math.max(1, Math.floor(dates.length / 5))

  if (dates.length === 0) {
    return <p className="empty">표시할 구간이 없습니다.</p>
  }

  return (
    <div className="scroll-x">
      <svg
        width={chartWidth}
        height={LABEL_Y + 6}
        role="img"
        aria-label={summary}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* 주기 단계 — 배경 띠. 켜 두어도 눈에 거슬리지 않게 아주 옅게. */}
        {showCycle &&
          dates.map((date, index) => {
            const info = phaseIndex.get(date)
            if (!info) return null
            const cx = slotX(index)
            return (
              <rect
                key={`phase-${date}`}
                x={cx - slotWidth / 2 - 0.8}
                y={DATA_TOP - 6}
                width={slotWidth + 1.6}
                height={DATA_BOTTOM - DATA_TOP + 12}
                fill={PHASE_COLOR[info.phase] ?? 'var(--grid)'}
                opacity={info.predicted ? 0.16 : 0.32}
              />
            )
          })}

        {/* 눈금선 — 아주 옅은 중성 회색. 축 숫자는 1·3·5만. */}
        {[1, 2, 3, 4, 5].map((value) => (
          <g key={`grid-${value}`}>
            <line
              x1={AXIS_GUTTER}
              x2={chartWidth}
              y1={valueY(value)}
              y2={valueY(value)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            {(value === 1 || value === 3 || value === 5) && (
              <text
                x={AXIS_GUTTER - 6}
                y={valueY(value) + 3}
                textAnchor="end"
                fontSize="9.5"
                fill="var(--text-3)"
              >
                {value}
              </text>
            )}
          </g>
        ))}

        {moodPath && (
          <path d={moodPath} fill="none" stroke="var(--series-mood)" strokeWidth={2} opacity={0.32} />
        )}
        {energyPath && (
          <path
            d={energyPath}
            fill="none"
            stroke="var(--series-energy)"
            strokeWidth={2}
            opacity={0.32}
          />
        )}

        {dates.map((date, index) => {
          const entry = entries[date]
          const cx = slotX(index)
          const selected = selectedDate === date
          const hasData = Boolean(entry)
          const mixed = entry ? isMixedState(entry) : false
          const showLabel = index === 0 || index === dates.length - 1 || index % labelEvery === 0

          return (
            <g
              key={date}
              onClick={() => onSelect(hasData ? (selected ? null : date) : null)}
              style={{ cursor: hasData ? 'pointer' : 'default' }}
            >
              {showLabel && (
                <text
                  x={cx}
                  y={LABEL_Y}
                  textAnchor="middle"
                  fontSize={dense ? 8.5 : 9.5}
                  fill="var(--text-3)"
                >
                  {shortLabel(date)}
                </text>
              )}
              <rect
                x={cx - step / 2}
                y={DATA_TOP - 8}
                width={step}
                height={DATA_BOTTOM - DATA_TOP + 16}
                fill={selected ? 'var(--surface-sunken)' : 'transparent'}
                rx={3}
              />
              {date === today && (
                <line
                  x1={cx}
                  x2={cx}
                  y1={DATA_TOP - 8}
                  y2={DATA_BOTTOM + 8}
                  stroke="var(--axis)"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
              )}
              {mixed && entry?.mood && (
                <circle
                  cx={cx}
                  cy={valueY(entry.mood)}
                  r={mixedRadius}
                  fill="none"
                  stroke="var(--warning)"
                  strokeWidth={1.4}
                  opacity={0.85}
                />
              )}
              {modules.mood && entry?.mood && (
                <circle
                  cx={cx}
                  cy={valueY(entry.mood)}
                  r={dotRadius}
                  fill="var(--series-mood)"
                  stroke="var(--bg)"
                  strokeWidth={2}
                />
              )}
              {modules.energy && entry?.energy && (
                <polygon
                  points={`${cx},${valueY(entry.energy) - diamond} ${cx + diamond},${valueY(entry.energy)} ${cx},${valueY(entry.energy) + diamond} ${cx - diamond},${valueY(entry.energy)}`}
                  fill="var(--series-energy)"
                  stroke="var(--bg)"
                  strokeWidth={2}
                />
              )}
              {showSleep && entry?.sleep && (
                <rect
                  x={cx - (dense ? 1.6 : 3.4)}
                  y={SLEEP_ROW_Y}
                  width={dense ? 3.2 : 6.8}
                  height={3}
                  rx={1.5}
                  fill={SLEEP_COLOR[entry.sleep] ?? 'var(--grid)'}
                />
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** 주 범례 — 기분·에너지만. 나머지는 아래 보조 열쇠로 내립니다. */
export function ChartLegend({ modules }: { modules: TrackedModules }) {
  return (
    <div className="legend">
      {modules.mood && (
        <span className="legend-item">
          <span className="legend-mark" style={{ background: 'var(--series-mood)' }} />
          기분
        </span>
      )}
      {modules.energy && (
        <span className="legend-item">
          <span className="legend-mark diamond" style={{ background: 'var(--series-energy)' }} />
          에너지
        </span>
      )}
    </div>
  )
}

/**
 * 보조 열쇠 — 켜져 있는 계층만, 한 줄로.
 * 차트를 보는 순간 설명서를 읽는 느낌이 들지 않게 작고 물러나게 둡니다.
 */
export function ChartSecondaryKey({
  modules,
  layers,
  hasMixed,
}: {
  modules: TrackedModules
  layers: ChartLayers
  hasMixed: boolean
}) {
  const items: { color: string; label: string; shape?: 'bar' | 'ring' }[] = []

  if (modules.sleep && layers.sleep) {
    items.push(
      { color: 'var(--sleep-short)', label: '적게 잠', shape: 'bar' },
      { color: 'var(--sleep-ok)', label: '잘 잠', shape: 'bar' },
      { color: 'var(--sleep-long)', label: '많이 잠', shape: 'bar' },
    )
  }
  if (modules.cycle && layers.cycle) {
    for (const phase of Object.keys(PHASE_LABELS) as (keyof typeof PHASE_LABELS)[]) {
      items.push({ color: PHASE_COLOR[phase] as string, label: PHASE_LABELS[phase], shape: 'bar' })
    }
  }
  if (hasMixed) items.push({ color: 'var(--warning)', label: '혼재', shape: 'ring' })

  if (items.length === 0) return null

  return (
    <div className="legend-secondary">
      {items.map((item) => (
        <span key={item.label} className="legend-item" style={{ fontSize: 11.5, gap: 5 }}>
          <span
            className={`legend-mark${item.shape === 'bar' ? ' bar' : ''}`}
            style={{
              background: item.shape === 'ring' ? 'transparent' : item.color,
              border: item.shape === 'ring' ? `1.4px solid ${item.color}` : 'none',
              width: item.shape === 'ring' ? 8 : undefined,
              height: item.shape === 'ring' ? 8 : undefined,
            }}
          />
          {item.label}
        </span>
      ))}
    </div>
  )
}
