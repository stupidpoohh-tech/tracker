import { useMemo } from 'react'
import type { DateKey } from '@/domain/date'
import { datesInRange, shortLabel } from '@/domain/date'
import type { PhaseIndex } from '@/domain/cycle'
import { PHASE_LABELS } from '@/domain/cycle'
import { isMixedState, type EntryMap, type TrackedModules } from '@/domain/models'

/** 데이터 간격이 이 이상이면 추세선을 잇지 않습니다. */
const MAX_GAP_DAYS = 14

const CHART_HEIGHT = 210
/** 왼쪽 눈금 숫자(1~5)가 들어갈 자리. */
const AXIS_GUTTER = 22
const DATA_TOP = 14
const DATA_BOTTOM = CHART_HEIGHT * 0.78
const SLEEP_ROW_Y = CHART_HEIGHT * 0.92
const LABEL_Y = CHART_HEIGHT + 20

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
 * 표현 규칙은 유지합니다: 기분과 에너지가 같은 Y축을 공유하고, 형태로
 * 구분하며(기분 ●, 에너지 ◆) 각각 단색입니다. 수치별로 색을 바꾸지 않습니다.
 * 색만으로 구분하면 색각 이상이 있는 사용자가 두 계열을 구별할 수 없습니다.
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
  const dotRadius = dense ? 2.6 : 4.6
  const diamond = dense ? 3.2 : 5.2
  const mixedRadius = dense ? 5.4 : 8
  const plotWidth = Math.max(dates.length * step, 260)
  const chartWidth = plotWidth + AXIS_GUTTER

  const valueY = (value: number): number =>
    DATA_BOTTOM - ((value - 1) / 4) * (DATA_BOTTOM - DATA_TOP)
  const slotX = (index: number): number => AXIS_GUTTER + index * step + slotWidth / 2

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

  const labelEvery = Math.max(1, Math.floor(dates.length / 6))

  if (dates.length === 0) {
    return <p className="empty">표시할 구간이 없습니다.</p>
  }

  return (
    <div className="scroll-x" style={{ paddingBottom: 2 }}>
      <svg
        width={chartWidth}
        height={LABEL_Y + 8}
        role="img"
        aria-label={summary}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <pattern
            id="predicted-hatch"
            width="4"
            height="4"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="1.6" />
          </pattern>
        </defs>

        {/* 주기 단계 음영 */}
        {dates.map((date, index) => {
          const info = phaseIndex.get(date)
          if (!info) return null
          const cx = slotX(index)
          const color = PHASE_COLOR[info.phase] ?? 'var(--grid)'
          return (
            <g key={`phase-${date}`} color={color}>
              <rect
                x={cx - slotWidth / 2 - 1}
                y={DATA_TOP - 8}
                width={slotWidth + 2}
                height={DATA_BOTTOM - DATA_TOP + 16}
                fill={color}
                opacity={info.predicted ? 0.08 : 0.15}
                rx={2}
              />
              {info.predicted && (
                <rect
                  x={cx - slotWidth / 2 - 1}
                  y={DATA_TOP - 8}
                  width={slotWidth + 2}
                  height={DATA_BOTTOM - DATA_TOP + 16}
                  fill="url(#predicted-hatch)"
                  opacity={0.2}
                />
              )}
            </g>
          )
        })}

        {/* 1~5 눈금선과 축 숫자 */}
        {[1, 2, 3, 4, 5].map((value) => (
          <g key={`grid-${value}`}>
            <line
              x1={AXIS_GUTTER}
              x2={chartWidth}
              y1={valueY(value)}
              y2={valueY(value)}
              stroke="var(--grid)"
              strokeWidth={1}
              strokeDasharray="3 5"
            />
            <text
              x={AXIS_GUTTER - 8}
              y={valueY(value) + 3.5}
              textAnchor="end"
              fontSize="10.5"
              fill="var(--text-3)"
            >
              {value}
            </text>
          </g>
        ))}

        {moodPath && (
          <path
            d={moodPath}
            fill="none"
            stroke="var(--mood)"
            strokeWidth={dense ? 1 : 1.5}
            strokeDasharray="4 3"
            opacity={0.55}
          />
        )}
        {energyPath && (
          <path
            d={energyPath}
            fill="none"
            stroke="var(--energy)"
            strokeWidth={dense ? 1 : 1.5}
            strokeDasharray="4 3"
            opacity={0.55}
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
                  fontSize={dense ? 8.5 : 10}
                  fill="var(--text-3)"
                >
                  {shortLabel(date)}
                </text>
              )}
              <rect
                x={cx - step / 2}
                y={DATA_TOP - 10}
                width={step}
                height={DATA_BOTTOM - DATA_TOP + 20}
                fill={selected ? 'var(--accent-soft)' : 'transparent'}
                rx={4}
              />
              {date === today && (
                <line
                  x1={cx}
                  x2={cx}
                  y1={DATA_TOP - 10}
                  y2={SLEEP_ROW_Y + 4}
                  stroke="var(--accent)"
                  strokeWidth={1}
                  strokeOpacity={0.4}
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
                  strokeWidth={1.6}
                  opacity={0.9}
                />
              )}
              {modules.mood && entry?.mood && (
                <circle
                  cx={cx}
                  cy={valueY(entry.mood)}
                  r={dotRadius}
                  fill="var(--mood)"
                  stroke="var(--surface)"
                  strokeWidth={dense ? 0.8 : 1.5}
                />
              )}
              {modules.energy && entry?.energy && (
                <polygon
                  points={`${cx},${valueY(entry.energy) - diamond} ${cx + diamond},${valueY(entry.energy)} ${cx},${valueY(entry.energy) + diamond} ${cx - diamond},${valueY(entry.energy)}`}
                  fill="var(--energy)"
                  stroke="var(--surface)"
                  strokeWidth={dense ? 0.7 : 1.3}
                />
              )}
              {modules.sleep && entry?.sleep && (
                <rect
                  x={cx - (dense ? 2.5 : 4.5)}
                  y={SLEEP_ROW_Y - 3}
                  width={dense ? 5 : 9}
                  height={dense ? 5 : 7}
                  rx={2.5}
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

function LegendItem({ color, label, shape = 'dot' }: { color: string; label: string; shape?: 'dot' | 'diamond' | 'ring' }) {
  return (
    <span className="legend-item">
      <span
        aria-hidden
        className="legend-dot"
        style={{
          background: shape === 'ring' ? 'transparent' : color,
          border: shape === 'ring' ? `1.6px solid ${color}` : 'none',
          borderRadius: shape === 'diamond' ? '2px' : '50%',
          transform: shape === 'diamond' ? 'rotate(45deg)' : 'none',
        }}
      />
      {label}
    </span>
  )
}

export function ChartLegend({ modules, showCycle }: { modules: TrackedModules; showCycle: boolean }) {
  return (
    <div className="legend">
      <div className="legend-row">
        {modules.mood && <LegendItem color="var(--mood)" label="기분" />}
        {modules.energy && <LegendItem color="var(--energy)" label="에너지" shape="diamond" />}
        {modules.mood && modules.energy && (
          <LegendItem color="var(--mixed)" label="혼재" shape="ring" />
        )}
        <span className="legend-note">1(낮음) → 5(높음)</span>
      </div>
      {modules.sleep && (
        <div className="legend-row">
          <LegendItem color="var(--sleep-little)" label="적게 잠" />
          <LegendItem color="var(--sleep-good)" label="잘 잠" />
          <LegendItem color="var(--sleep-much)" label="많이 잠" />
        </div>
      )}
      {showCycle && (
        <div className="legend-row">
          {(Object.keys(PHASE_LABELS) as (keyof typeof PHASE_LABELS)[]).map((phase) => (
            <LegendItem key={phase} color={PHASE_COLOR[phase] as string} label={PHASE_LABELS[phase]} />
          ))}
          <span className="legend-note">빗금 = 예측</span>
        </div>
      )}
    </div>
  )
}
