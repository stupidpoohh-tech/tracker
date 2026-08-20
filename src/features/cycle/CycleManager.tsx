import { useMemo, useState } from 'react'
import { useApp } from '@/app/store'
import { diffDays } from '@/domain/date'
import { computeCycleStats, getCycleStatus, sortCycles } from '@/domain/cycle'
import { Icon } from '@/ui/Icon'
import { ConfirmSheet, Sheet, useToast } from '@/ui/components'
import type { CycleRecord } from '@/domain/models'

const REGULARITY_LABEL: Record<string, string> = {
  regular: '규칙적',
  irregular: '변동 있음',
  unknown: '판단 불가',
}

/**
 * 생리 기록 관리.
 *
 * v3는 이 정보를 `meta/periods`의 배열 하나에 통째로 넣고 읽기-수정-쓰기로
 * 갱신했습니다. 두 기기에서 동시에 고치면 한쪽이 유실됩니다. 이제 기록 하나가
 * 문서 하나입니다.
 */
export function CycleManager({ onClose }: { onClose: () => void }) {
  const { cycles, today, actions } = useApp()
  const toast = useToast()

  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<CycleRecord | null>(null)
  const [busy, setBusy] = useState(false)

  const sorted = useMemo(() => sortCycles(cycles).reverse(), [cycles])
  const stats = useMemo(() => computeCycleStats(cycles), [cycles])
  const status = useMemo(() => getCycleStatus(cycles, today), [cycles, today])

  const add = async (): Promise<void> => {
    if (!start) return
    if (end && end < start) {
      toast.error('종료일이 시작일보다 이릅니다.')
      return
    }
    if (cycles.some((c) => c.startDate === start)) {
      toast.error('같은 시작일의 기록이 이미 있습니다.')
      return
    }
    setBusy(true)
    try {
      await actions.createCycle(start, end || null)
      setStart('')
      setEnd('')
      toast.success('생리 기록을 추가했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="생리주기 관리" onClose={onClose}>
      <div className="stack">
        {/* 통계 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))',
            gap: 8,
          }}
        >
          {[
            { value: `${stats.averageCycleLength}일`, label: '평균 주기' },
            { value: `${stats.averagePeriodLength}일`, label: '평균 기간' },
            { value: REGULARITY_LABEL[stats.regularity] ?? '—', label: '규칙성' },
            { value: `${stats.cycleCount}건`, label: '기록 수' },
          ].map((item) => (
            <div
              key={item.label}
              className="card card-tight"
              style={{ textAlign: 'center', background: 'var(--surface-2)', borderColor: 'transparent' }}
            >
              <div style={{ fontSize: 16, fontWeight: 700 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{item.label}</div>
            </div>
          ))}
        </div>

        {stats.usesDefaults ? (
          <p className="hint">
            주기 간격을 계산하려면 생리 기록이 최소 3건 필요합니다. 그전까지는 28일 기본값으로
            표시합니다.
          </p>
        ) : (
          <p className="hint">
            최근 {stats.sampleCount}개 주기 기준 {stats.minCycleLength}~{stats.maxCycleLength}일
            (편차 {stats.variability}일).
            {status.nextPeriodStart && ` 다음 예상일은 ${status.nextPeriodStart}입니다.`}
          </p>
        )}

        {/* 추가 */}
        <div className="card stack-sm">
          <p style={{ fontSize: 13, fontWeight: 700 }}>기록 추가</p>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              type="date"
              value={start}
              max={today}
              onChange={(e) => setStart(e.target.value)}
              aria-label="시작일"
              style={{ minHeight: 40, fontSize: 13.5 }}
            />
            <span className="hint">~</span>
            <input
              className="input"
              type="date"
              value={end}
              min={start}
              max={today}
              onChange={(e) => setEnd(e.target.value)}
              aria-label="종료일 (선택)"
              style={{ minHeight: 40, fontSize: 13.5 }}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={add}
            disabled={busy || !start}
            style={{ alignSelf: 'flex-start' }}
          >
            추가
          </button>
          <p className="hint">종료일은 비워두면 진행 중으로 표시됩니다.</p>
        </div>

        {/* 목록 */}
        <div>
          <p className="section-label">기록 목록</p>
          {sorted.length === 0 ? (
            <p className="empty">아직 생리 기록이 없습니다.</p>
          ) : (
            <div className="card" style={{ padding: '0 14px', maxHeight: 320, overflowY: 'auto' }}>
              {sorted.map((record, index) => {
                const previous = sorted[index + 1]
                const gap = previous ? diffDays(previous.startDate, record.startDate) : null
                const length = record.endDate ? diffDays(record.startDate, record.endDate) + 1 : null
                return (
                  <div
                    key={record.id}
                    className="row-between"
                    style={{
                      padding: '11px 0',
                      borderTop: index === 0 ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13 }}>
                        {record.startDate}
                        <span style={{ color: 'var(--text-3)', margin: '0 5px' }}>~</span>
                        {record.endDate ?? <span style={{ color: 'var(--accent)' }}>진행 중</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                        {length ? `${length}일` : '종료일 미기록'}
                        {gap != null ? ` · 이전 주기와 ${gap}일 간격` : ''}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      {!record.endDate && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => void actions.saveCycle({ ...record, endDate: today })}
                        >
                          오늘 종료
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label="삭제"
                        onClick={() => setConfirmDelete(record)}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmSheet
          title="이 생리 기록을 삭제할까요?"
          description={`${confirmDelete.startDate} 시작 기록이 지워집니다. 평균 주기와 예측이 다시 계산됩니다.`}
          confirmLabel="삭제"
          danger
          busy={busy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            setBusy(true)
            try {
              await actions.deleteCycle(confirmDelete.id)
              setConfirmDelete(null)
              toast.success('삭제했습니다.')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </Sheet>
  )
}
