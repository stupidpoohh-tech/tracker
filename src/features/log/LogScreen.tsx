import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/app/store'
import { addDays, diffDays, fullLabel, relativeLabel } from '@/domain/date'
import type { DateKey } from '@/domain/date'
import { findCycleContaining, getCycleStatus } from '@/domain/cycle'
import {
  ENERGY_LABELS,
  MOOD_LABELS,
  SLEEP_OPTIONS,
  emptyEntry,
  isMixedState,
  resolveEntryTagIds,
  type Entry,
  type Scale,
  type SleepQuality,
} from '@/domain/models'
import { isRiskTagName } from '@/domain/tagPresets'
import { Icon } from '@/ui/Icon'
import { ConfirmSheet, Spinner, useToast } from '@/ui/components'
import { CrisisResources } from '@/features/safety/CrisisResources'
import { ScalePicker } from './ScalePicker'
import { TagPicker } from './TagPicker'

const AUTOSAVE_DELAY_MS = 700

type SaveState = 'idle' | 'pending' | 'saving' | 'saved'

function LogSection({
  title,
  optional,
  children,
}: {
  title: string
  optional?: string
  children: React.ReactNode
}) {
  return (
    <section className="card stack-sm">
      <div className="row-between">
        <h2 style={{ fontSize: 14, fontWeight: 700 }}>{title}</h2>
        {optional && <span className="hint">{optional}</span>}
      </div>
      {children}
    </section>
  )
}

/**
 * 하루 기록 화면.
 *
 * v3는 7단계 위저드였습니다(날짜→기분→에너지→수면→생리→태그→메모). 저장까지
 * 최소 7번 탭해야 하는 흐름은 매일 반복하는 행동에 적합하지 않습니다. 여기서는
 * 한 화면에 전부 펼치고 입력 즉시 자동 저장합니다. 저장 버튼이 없습니다.
 */
export function LogScreen({
  initialDate,
  onClose,
}: {
  initialDate: DateKey
  onClose: () => void
}) {
  const { entries, tagIndex, cycles, profile, today, actions } = useApp()
  const toast = useToast()

  const [date, setDate] = useState<DateKey>(initialDate)
  const [draft, setDraft] = useState<Entry>(() => entries[initialDate] ?? emptyEntry(initialDate))
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [crisisDismissed, setCrisisDismissed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const modules = profile?.modules ?? { mood: true, energy: true, sleep: true, cycle: false }

  const timerRef = useRef<number | null>(null)
  const pendingRef = useRef<Entry | null>(null)
  const savedSignatureRef = useRef<string>('')

  const signatureOf = (entry: Entry): string =>
    JSON.stringify({
      mood: entry.mood ?? null,
      energy: entry.energy ?? null,
      sleep: entry.sleep ?? null,
      sleepHours: entry.sleepHours ?? null,
      ovulationMark: entry.ovulationMark ?? false,
      tagIds: [...entry.tagIds].sort(),
      memo: entry.memo,
    })

  // 날짜를 바꾸면 그날의 기록을 불러옵니다.
  useEffect(() => {
    const existing = entries[date]
    const next = existing ?? emptyEntry(date)
    setDraft(next)
    savedSignatureRef.current = signatureOf(next)
    setSaveState('idle')
    // entries는 실시간 구독이라 자주 바뀝니다. 날짜 전환에만 반응해야 합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const flush = useCallback(async (): Promise<void> => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setSaveState('saving')
    try {
      await actions.saveEntry(pending)
      savedSignatureRef.current = signatureOf(pending)
      setSaveState('saved')
    } catch {
      setSaveState('idle')
    }
  }, [actions])

  // 언마운트 시 남은 변경을 확실히 반영합니다.
  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      const pending = pendingRef.current
      if (pending) void actions.saveEntry(pending)
    },
    [actions],
  )

  const update = useCallback(
    (patch: Partial<Entry>) => {
      setDraft((prev) => {
        const next: Entry = { ...prev, ...patch, date: prev.date }
        if (signatureOf(next) === savedSignatureRef.current) {
          pendingRef.current = null
          setSaveState('saved')
          return next
        }
        pendingRef.current = next
        setSaveState('pending')
        if (timerRef.current) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS)
        return next
      })
    },
    [flush],
  )

  const toggleTag = useCallback(
    (tagId: string) => {
      setDraft((prev) => {
        const has = prev.tagIds.includes(tagId)
        const tagIds = has ? prev.tagIds.filter((t) => t !== tagId) : [...prev.tagIds, tagId]
        const next: Entry = { ...prev, tagIds }
        pendingRef.current = next
        setSaveState('pending')
        if (timerRef.current) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS)
        return next
      })
    },
    [flush],
  )

  // ── 최근 사용 태그 ────────────────────────────────────────────────────────
  const recentTagIds = useMemo(() => {
    const seen: string[] = []
    const dates = Object.keys(entries).sort().reverse().slice(0, 30)
    for (const d of dates) {
      const entry = entries[d]
      if (!entry) continue
      for (const id of resolveEntryTagIds(entry, tagIndex)) {
        if (!seen.includes(id)) seen.push(id)
      }
      if (seen.length >= 12) break
    }
    return seen
  }, [entries, tagIndex])

  // ── 위기 자원 노출 판단 ───────────────────────────────────────────────────
  const hasRiskTag = useMemo(
    () => draft.tagIds.some((id) => isRiskTagName(tagIndex.byId.get(id)?.name ?? '')),
    [draft.tagIds, tagIndex],
  )
  const veryLowMood = draft.mood === 1

  // ── 생리주기 ──────────────────────────────────────────────────────────────
  const containingCycle = useMemo(() => findCycleContaining(cycles, date), [cycles, date])
  const cycleStatus = useMemo(() => getCycleStatus(cycles, today), [cycles, today])

  const startPeriod = async (): Promise<void> => {
    setBusy(true)
    try {
      await actions.createCycle(date, null)
      toast.success('생리 시작으로 기록했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const endPeriod = async (): Promise<void> => {
    if (!containingCycle) return
    setBusy(true)
    try {
      await actions.saveCycle({ ...containingCycle, endDate: date })
      toast.success('생리 종료일을 기록했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const removePeriod = async (): Promise<void> => {
    if (!containingCycle) return
    setBusy(true)
    try {
      await actions.deleteCycle(containingCycle.id)
      toast.success('생리 기록을 지웠습니다.')
    } finally {
      setBusy(false)
    }
  }

  const isFuture = diffDays(date, today) < 0
  const mixed = isMixedState(draft)

  const saveIndicator = (): React.ReactNode => {
    if (saveState === 'saving') return (
      <span className="row" style={{ gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
        <Spinner size={12} /> 저장 중
      </span>
    )
    if (saveState === 'saved') return (
      <span className="row" style={{ gap: 4, fontSize: 12, color: 'var(--success)' }}>
        <Icon name="check" size={13} strokeWidth={2.5} /> 저장됨
      </span>
    )
    if (saveState === 'pending') return (
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>입력 중…</span>
    )
    return null
  }

  return (
    <div className="page" style={{ paddingBottom: 48 }}>
      <header
        className="row-between"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--bg)',
          paddingTop: 'max(16px, env(safe-area-inset-top, 0px))',
          paddingBottom: 12,
          gap: 8,
        }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void flush()
            onClose()
          }}
        >
          <Icon name="chevronLeft" size={18} /> 닫기
        </button>
        {saveIndicator()}
      </header>

      {/* 날짜 이동 */}
      <div className="card card-tight row-between" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label="이전 날"
          onClick={() => {
            void flush()
            setDate((d) => addDays(d, -1))
          }}
        >
          <Icon name="chevronLeft" size={18} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{fullLabel(date)}</div>
          <label
            className="row"
            style={{ gap: 4, justifyContent: 'center', marginTop: 2, cursor: 'pointer' }}
          >
            <span style={{ fontSize: 12, color: 'var(--accent)' }}>{relativeLabel(date, today)}</span>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => {
                if (!e.target.value) return
                void flush()
                setDate(e.target.value)
              }}
              aria-label="날짜 선택"
              style={{
                width: 18,
                border: 'none',
                background: 'transparent',
                color: 'var(--accent)',
                padding: 0,
              }}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label="다음 날"
          disabled={date >= today}
          onClick={() => {
            void flush()
            setDate((d) => addDays(d, 1))
          }}
        >
          <Icon name="chevronRight" size={18} />
        </button>
      </div>

      {isFuture && (
        <div className="notice notice-warn" style={{ marginBottom: 14 }}>
          미래 날짜는 기록할 수 없습니다.
        </div>
      )}

      <div className="stack">
        {modules.mood && (
          <LogSection title="기분" optional="선택">
            <ScalePicker
              name="기분"
              value={draft.mood}
              labels={MOOD_LABELS}
              accent="var(--mood)"
              onChange={(mood) => update({ mood: mood as Scale | undefined })}
            />
          </LogSection>
        )}

        {modules.energy && (
          <LogSection title="에너지" optional="선택">
            <ScalePicker
              name="에너지"
              value={draft.energy}
              labels={ENERGY_LABELS}
              accent="var(--energy)"
              onChange={(energy) => update({ energy: energy as Scale | undefined })}
            />
          </LogSection>
        )}

        {mixed && (
          <div className="notice notice-warn row" style={{ gap: 8 }}>
            <Icon name="alert" size={16} />
            <span>
              기분과 에너지 차이가 {Math.abs((draft.mood ?? 0) - (draft.energy ?? 0))}입니다. 혼재
              상태로 표시됩니다.
            </span>
          </div>
        )}

        {modules.sleep && (
          <LogSection title="수면" optional="선택">
            <div className="row wrap" style={{ gap: 8 }}>
              {SLEEP_OPTIONS.map((option) => {
                const selected = draft.sleep === option.id
                const color = `var(--sleep-${option.id === 'too_much' ? 'much' : option.id})`
                return (
                  <button
                    key={option.id}
                    type="button"
                    className="chip"
                    aria-pressed={selected}
                    onClick={() =>
                      update({ sleep: selected ? undefined : (option.id as SleepQuality) })
                    }
                    style={
                      selected
                        ? { borderColor: color, color, background: 'var(--surface-2)', fontWeight: 700 }
                        : undefined
                    }
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: color,
                        display: 'inline-block',
                      }}
                    />
                    {option.label}
                  </button>
                )
              })}
            </div>
            <label className="row" style={{ gap: 8, marginTop: 4 }}>
              <span className="hint" style={{ flexShrink: 0 }}>
                수면 시간
              </span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min={0}
                max={24}
                step={0.5}
                value={draft.sleepHours ?? ''}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === '') return update({ sleepHours: undefined })
                  const parsed = Number(raw)
                  if (Number.isNaN(parsed)) return
                  update({ sleepHours: Math.min(24, Math.max(0, parsed)) })
                }}
                placeholder="예: 7.5"
                aria-label="수면 시간 (시간)"
                style={{ minHeight: 40, fontSize: 14 }}
              />
              <span className="hint" style={{ flexShrink: 0 }}>
                시간
              </span>
            </label>
          </LogSection>
        )}

        {modules.cycle && (
          <LogSection title="생리주기" optional="선택">
            {containingCycle ? (
              <div className="stack-sm">
                <p style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  {containingCycle.startDate === date
                    ? '이 날을 생리 시작일로 기록했습니다.'
                    : `${containingCycle.startDate} 시작 생리 기간에 포함됩니다.`}
                  {containingCycle.endDate ? ` (종료 ${containingCycle.endDate})` : ' (진행 중)'}
                </p>
                <div className="row wrap" style={{ gap: 8 }}>
                  {!containingCycle.endDate && (
                    <button type="button" className="btn btn-sm" onClick={endPeriod} disabled={busy}>
                      오늘로 종료
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={removePeriod}
                    disabled={busy}
                  >
                    이 생리 기록 지우기
                  </button>
                </div>
              </div>
            ) : (
              <div className="stack-sm">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={startPeriod}
                  disabled={busy || isFuture}
                  style={{ alignSelf: 'flex-start' }}
                >
                  <Icon name="droplet" size={15} /> 이 날 생리 시작
                </button>
                {cycleStatus.nextPeriodStart && (
                  <p className="hint">
                    최근 기록 기준 다음 예상일은 {cycleStatus.nextPeriodStart}입니다
                    {cycleStatus.stats.usesDefaults ? ' (기록이 적어 28일 기본값을 씁니다)' : ''}.
                  </p>
                )}
              </div>
            )}

            <label className="row" style={{ gap: 8, marginTop: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={draft.ovulationMark ?? false}
                onChange={(e) => update({ ovulationMark: e.target.checked || undefined })}
                style={{ width: 17, height: 17, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 13 }}>이 날을 배란일로 표시</span>
            </label>
          </LogSection>
        )}

        <LogSection title="태그" optional="복수 선택">
          <TagPicker
            tagIndex={tagIndex}
            selected={draft.tagIds}
            recentTagIds={recentTagIds}
            onToggle={toggleTag}
          />
        </LogSection>

        {(hasRiskTag || veryLowMood) && !crisisDismissed && (
          <CrisisResources onDismiss={() => setCrisisDismissed(true)} />
        )}

        <LogSection title="메모" optional="선택">
          <textarea
            className="textarea"
            value={draft.memo}
            onChange={(e) => update({ memo: e.target.value })}
            placeholder="오늘 있었던 일, 감정, 생각…"
            aria-label="메모"
          />
        </LogSection>

        {entries[date] && (
          <button
            type="button"
            className="btn btn-danger btn-block"
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="trash" size={16} /> 이 날 기록 삭제
          </button>
        )}
      </div>

      {confirmDelete && (
        <ConfirmSheet
          title="이 날의 기록을 삭제할까요?"
          description={`${fullLabel(date)}의 기분·에너지·수면·태그·메모가 모두 지워집니다. 생리 기록은 따로 관리되므로 남습니다.`}
          confirmLabel="삭제"
          danger
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setBusy(true)
            try {
              pendingRef.current = null
              await actions.deleteEntry(date)
              const cleared = emptyEntry(date)
              setDraft(cleared)
              savedSignatureRef.current = signatureOf(cleared)
              setSaveState('idle')
              setConfirmDelete(false)
              toast.success('기록을 삭제했습니다.')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}
