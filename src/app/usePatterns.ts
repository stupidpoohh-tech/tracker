import { useMemo } from 'react'
import { useApp } from './store'
import { addDays } from '@/domain/date'
import type { PhaseIndex } from '@/domain/cycle'
import { buildPhaseIndex, computeCycleStats } from '@/domain/cycle'
import {
  DEFAULT_WINDOW_DAYS,
  assessReadiness,
  buildPatterns,
  headlinePattern,
  sectionPatterns,
  visiblePatterns,
  type DataReadiness,
  type Pattern,
  type PatternSections,
} from '@/domain/patterns'

export interface PatternView {
  all: Pattern[]
  visible: Pattern[]
  headline: Pattern | null
  sections: PatternSections
  byId: Map<string, Pattern>
  readiness: DataReadiness
  observedIds: Set<string>
}

/**
 * 패턴 계산을 한 곳에 모읍니다.
 *
 * 여러 화면이 같은 패턴을 봐야 하는데, 화면마다 따로 계산하면 같은 관계가
 * 화면마다 다르게 보일 수 있습니다. 계산 규칙은 여기 하나뿐입니다.
 */
export function usePatterns(windowDays = DEFAULT_WINDOW_DAYS): PatternView {
  const { entries, tagIndex, cycles, observations, profile, today } = useApp()

  const cycleEnabled = profile?.modules.cycle ?? false

  const ovulationMarks = useMemo(
    () =>
      Object.values(entries)
        .filter((e) => e.ovulationMark)
        .map((e) => e.date),
    [entries],
  )

  const phaseIndex = useMemo<PhaseIndex>(() => {
    if (!cycleEnabled) return new Map<string, never>()
    // 변화 비교를 위해 직전 창까지 덮는 범위로 계산합니다.
    const start = addDays(today, -(windowDays * 2 + 10))
    return buildPhaseIndex(cycles, start, today, {
      stats: computeCycleStats(cycles),
      ovulationMarks,
      today,
      predict: false,
    })
  }, [cycles, ovulationMarks, today, windowDays, cycleEnabled])

  const all = useMemo(
    () => buildPatterns({ entries, phaseIndex, tagIndex, today, windowDays }),
    [entries, phaseIndex, tagIndex, today, windowDays],
  )

  const observedIds = useMemo(
    () => new Set(observations.map((o) => o.patternId)),
    [observations],
  )

  return useMemo(() => {
    const visible = visiblePatterns(all)
    return {
      all,
      visible,
      headline: headlinePattern(all),
      sections: sectionPatterns(all, observedIds),
      byId: new Map(all.map((p) => [p.id, p])),
      readiness: assessReadiness(Object.keys(entries).length),
      observedIds,
    }
  }, [all, observedIds, entries])
}
