import { useMemo } from 'react'
import type { DateKey } from '@/domain/date'
import { datesInRange, shortLabel } from '@/domain/date'
import type { PhaseIndex } from '@/domain/cycle'
import { PHASE_LABELS } from '@/domain/cycle'
import { isMixedState, type EntryMap, type TrackedModules } from '@/domain/models'

/** 데이터 간격이 이 이상이면 추세선을 잇지 않습니다. */
const MAX_GAP_DAYS = 14
const CHART_HEIGHT = 158
const DATA_TOP = 8
const DATA_BOTTOM = CHART_HEIGHT * 0.76
const SLEEP_ROW_Y = CHART_HEIGHT * 0.9

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

const SLEEP_COLOR: Record<string, string> = {
  little: 'var(--sleep-little)',
  good: 'var(--sleep-good)',
  too_much: 'var(--sleep-much)',
}

const PHASE_COLOR: Record<string, string> = {
  period: 'var(--phase-period)',
  premenstrual: 'var(--phase-premenstrual)',
  ovulation: 'var(--phase-ovulation)',
}

/**
 * 기분·에너지 추세 + 수면 + 주기 단계 음영.
 *
 * v3의 표현 규칙은 유지했습니다: 기분과 에너지가 같은 Y축을 공유하고, 형태로
 * 구분하며(기분 ●, 에너지 ◆), 각각 단색입니다. 수치별로 색을 바꾸지 않습니다.
 * 추가된 것은 예측 구간을 빗금으로 구분하는 표시입니다.
 */
export function TrendChart({
  start,
  end,
  entries,
  phaseIndex,
  modules,
  today,
  selectedDate,
  onSelect,
}: {
  start: DateKey
  end: DateKey
  entries: EntryMap
  phaseIndex: PhaseIndex
  modules: TrackedModules
  today: DateKey
  selectedDate: DateKey | null
  onSelect: (date: DateKey | null) => void
}) {
  const dates = useMemo(() => datesInRange(start, end), [start, end])

  const dense = dates.length > 120
  const slotWidth = dense ? 4 : 10
  const gap = dense ? 2 : 4
  const step = slotWidth + gap
  const dotRadius = dense ? 2.4 : 4.4
  const diamond = dense ? 3 : 5
  const mixedRadius = dense ? 5 : 7.4
  const chartWidth = Math.max(dates.length * step, 280)

  const valueY = (value: number): number =>
    DATA_BOTTOM - ((value - 1) / 4) * (DATA_BOTTOM - DATA_TOP)

  const { moodPath, energyPath, summary } = useMemo(() => {
    const moodPoints: Point[] = []
    const energyPoints: Point[] = []
    let logged = 0
    dates.forEach((date, index) => {
      const entry = entries[date]
      if (!entry) return
      logged += 1
      const cx = index * step + slotWidth / 2
      if (entry.mood) moodPoints.push({ x: cx, y: valueY(entry.mood), index })
      if (entry.energy) energyPoints.push({ x: cx, y: valueY(entry.energy), index })
    })
    return {
      moodPath: modules.mood ? segmentedPath(moodPoints) : '',
      energyPath: modules.energy ? segmentedPath(energyPoints) : '',
      summary: `${shortLabel(start)}부터 ${shortLabel(end)}까지 ${dates.length}일 중 ${logged}일 기록됨`,
    }
  }, [dates, entries, step, slotWidth, modules.mood, modules.energy, start, end])

  const labelEvery = Math.max(1, Math.floor(dates.length / 8))

  if (dates.length === 0) {
    return <p className="empty">표시할 구간이 없습니다.</p>
  }

  return (
    <div className="scroll-x" style={{ paddingBottom: 4 }}>
      <svg
        width={chartWidth}
        height={CHART_HEIGHT + 24}
        role="img"
        aria-label={summary}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <pattern id="predicted-hatch" width="4" height="4" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="1.6" />
          </pattern>
        </defs>

        {/* 주기 단계 음영 */}
        {dates.map((date, index) => {
          const info = phaseIndex.get(date)
          if (!info) return null
          const cx = index * step + slotWidth / 2
          const color = PHASE_COLOR[info.phase] ?? 'var(--grid)'
          return (
            <g key={`phase-${date}`} color={color}>
              <rect
                x={cx - slotWidth / 2 - 1}
                y={0}
                width={slotWidth + 2}
                height={CHART_HEIGHT}
                fill={color}
                opacity={info.predicted ? 0.07 : 0.16}
                rx={1}
              />
              {info.predicted && (
                <rect
                  x={cx - slotWidth / 2 - 1}
                  y={0}
                  width={slotWidth + 2}
                  height={CHART_HEIGHT}
                  fill="url(#predicted-hatch)"
                  opacity={0.16}
                />
              )}
            </g>
          )
        })}

        {/* 기준선 (3점) */}
        <line
          x1={0}
          x2={chartWidth}
          y1={valueY(3)}
          y2={valueY(3)}
          stroke="var(--grid)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <text x={2} y={valueY(3) - 4} fontSize="8" fill="var(--text-3)">
          3
        </text>

        {moodPath && (
          <path d={moodPath} fill="none" stroke="var(--mood)" strokeWidth={dense ? 0.9 : 1.4} opacity={0.45} />
        )}
        {energyPath && (
          <path
            d={energyPath}
            fill="none"
            stroke="var(--energy)"
            strokeWidth={dense ? 0.9 : 1.4}
            opacity={0.45}
            strokeDasharray="3 2"
          />
        )}

        {dates.map((date, index) => {
          const entry = entries[date]
          const cx = index * step + slotWidth / 2
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
                  y={CHART_HEIGHT + 18}
                  textAnchor="middle"
                  fontSize={dense ? 6 : 8}
                  fill="var(--text-3)"
                >
                  {shortLabel(date)}
                </text>
              )}
              <rect
                x={cx - step / 2}
                y={0}
                width={step}
                height={CHART_HEIGHT}
                fill={selected ? 'var(--accent-soft)' : 'transparent'}
                rx={3}
              />
              {date === today && (
                <line
                  x1={cx}
                  x2={cx}
                  y1={0}
                  y2={CHART_HEIGHT}
                  stroke="var(--accent)"
                  strokeWidth={1}
                  strokeOpacity={0.35}
                  strokeDasharray="2 3"
                />
              )}
              {mixed && entry?.mood && (
                <circle
                  cx={cx}
                  cy={valueY(entry.mood)}
                  r={mixedRadius}
                  fill="none"
                  stroke="var(--mixed)"
                  strokeWidth={1.5}
                  opacity={0.8}
                />
              )}
              {modules.mood && entry?.mood && (
                <circle
                  cx={cx}
                  cy={valueY(entry.mood)}
                  r={dotRadius}
                  fill="var(--mood)"
                  stroke="var(--bg)"
                  strokeWidth={dense ? 0.8 : 1.4}
                />
              )}
              {modules.energy && entry?.energy && (
                <polygon
                  points={`${cx},${valueY(entry.energy) - diamond} ${cx + diamond},${valueY(entry.energy)} ${cx},${valueY(entry.energy) + diamond} ${cx - diamond},${valueY(entry.energy)}`}
                  fill="var(--energy)"
                  stroke="var(--bg)"
                  strokeWidth={dense ? 0.7 : 1.2}
                />
              )}
              {modules.sleep && entry?.sleep && (
                <rect
                  x={cx - (dense ? 2.5 : 4.5)}
                  y={SLEEP_ROW_Y - 3}
                  width={dense ? 5 : 9}
                  height={dense ? 5 : 7}
                  rx={2}
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

export function ChartLegend({ modules, showCycle }: { modules: TrackedModules; showCycle: boolean }) {
  const item = (color: string, label: string, shape: 'dot' | 'diamond' | 'bar' | 'ring') => (
    <span key={label} className="row" style={{ gap: 4 }}>
      <span
        aria-hidden
        style={{
          width: shape === 'bar' ? 12 : 9,
          height: shape === 'bar' ? 6 : 9,
          borderRadius: shape === 'diamond' ? 2 : shape === 'bar' ? 2 : '50%',
          background: shape === 'ring' ? 'transparent' : color,
          border: shape === 'ring' ? `1.5px solid ${color}` : 'none',
          transform: shape === 'diamond' ? 'rotate(45deg)' : 'none',
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{label}</span>
    </span>
  )

  return (
    <div className="stack-sm" style={{ gap: 5 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        {modules.mood && item('var(--mood)', '기분', 'dot')}
        {modules.energy && item('var(--energy)', '에너지', 'diamond')}
        {modules.mood && modules.energy && item('var(--mixed)', '혼재', 'ring')}
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>1(낮음) → 5(높음)</span>
      </div>
      {modules.sleep && (
        <div className="row wrap" style={{ gap: 10 }}>
          {item('var(--sleep-little)', '적게 잠', 'bar')}
          {item('var(--sleep-good)', '잘 잠', 'bar')}
          {item('var(--sleep-much)', '많이 잠', 'bar')}
        </div>
      )}
      {showCycle && (
        <div className="row wrap" style={{ gap: 10 }}>
          {(Object.keys(PHASE_LABELS) as (keyof typeof PHASE_LABELS)[]).map((phase) => (
            <span key={phase} className="row" style={{ gap: 4 }}>
              <span
                aria-hidden
                style={{
                  width: 14,
                  height: 8,
                  borderRadius: 2,
                  background: PHASE_COLOR[phase],
                  opacity: 0.35,
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{PHASE_LABELS[phase]}</span>
            </span>
          ))}
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>빗금 = 예측</span>
        </div>
      )}
    </div>
  )
}
