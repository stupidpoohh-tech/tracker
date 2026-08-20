import type { Scale } from '@/domain/models'
import { SCALE_VALUES } from '@/domain/models'

/**
 * 1~5 척도 선택기.
 *
 * 같은 값을 다시 누르면 선택이 해제됩니다. 값을 강제하지 않는 것이 중요합니다 —
 * 기록하지 않은 날과 '보통'인 날은 다릅니다.
 */
export function ScalePicker({
  value,
  onChange,
  labels,
  name,
  accent,
}: {
  value: Scale | undefined
  onChange: (next: Scale | undefined) => void
  labels: readonly string[]
  name: string
  accent: string
}) {
  return (
    <div>
      <div role="radiogroup" aria-label={name} className="row" style={{ gap: 8 }}>
        {SCALE_VALUES.map((v) => {
          const selected = value === v
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${name} ${v} — ${labels[v - 1]}`}
              onClick={() => onChange(selected ? undefined : v)}
              style={{
                flex: 1,
                minWidth: 0,
                height: 52,
                borderRadius: 'var(--radius)',
                fontSize: 17,
                fontWeight: 700,
                background: selected ? accent : 'var(--surface-2)',
                color: selected ? 'var(--on-accent)' : 'var(--text-3)',
                border: `1.5px solid ${selected ? accent : 'var(--border)'}`,
                transition: 'all 0.14s var(--ease)',
                transform: selected ? 'translateY(-2px)' : 'none',
              }}
            >
              {v}
            </button>
          )
        })}
      </div>
      <p
        className="hint"
        style={{ marginTop: 7, textAlign: 'center', color: value ? accent : 'var(--text-3)' }}
        aria-live="polite"
      >
        {value ? labels[value - 1] : '선택하지 않으면 기록되지 않습니다'}
      </p>
    </div>
  )
}
