import type { CSSProperties } from 'react'
import { SCALE_VALUES, type Scale } from '@/domain/models'

/**
 * 1~5 척도 입력.
 *
 * 오늘 화면과 기록 화면이 같은 컨트롤을 씁니다. 두 곳의 생김새가 다르면 같은
 * 값을 다르게 읽게 됩니다.
 *
 * **색을 씁니다.** 차트에서는 높낮이가 이미 값을 표현하므로 수치별로 색을 바꾸지
 * 않지만, 입력 컨트롤에는 위치라는 단서가 없습니다. 숫자만 다섯 개 늘어놓으면
 * 어느 쪽이 높은 쪽인지 읽어야 알 수 있습니다. 계열색을 1에서 5로 갈수록 진하게
 * 깔아 방향을 눈으로 먼저 보이게 했습니다.
 *
 * 색은 보조 단서일 뿐입니다. 숫자와 이름(`aria-label`, 선택 시 표시되는 말)이
 * 그대로 남아 있어 색을 구분하지 못해도 쓸 수 있습니다. 계열색은 차트의 기분·
 * 에너지와 같은 색이라 입력과 그래프가 같은 것을 가리킨다는 것도 드러납니다.
 *
 * 명도는 다섯 단계 모두 글자 대비 4.6:1 이상이 되는 범위에서 골랐습니다
 * (`ui/scaleRamp.test.ts`가 검사합니다).
 */
export function ScaleField({
  label,
  value,
  labels,
  tint,
  onPick,
  size = 'default',
  hint,
  hideName = false,
}: {
  label: string
  value: Scale | undefined
  labels: readonly string[]
  /** 계열색 토큰. 기분은 --series-mood, 에너지는 --series-energy입니다. */
  tint: string
  onPick: (next: Scale | undefined) => void
  size?: 'default' | 'compact'
  hint?: string
  /** 바깥에 이미 같은 제목이 있을 때. 이름은 aria-label로만 남습니다. */
  hideName?: boolean
}) {
  return (
    <div className="scale-field" style={{ '--tint': tint } as CSSProperties}>
      <div className="scale-head">
        <span className="scale-name">{hideName ? '' : label}</span>
        <span className="scale-selected" aria-live="polite">
          {value ? labels[value - 1] : ''}
        </span>
      </div>
      <div
        className={`scale-track${size === 'compact' ? ' is-compact' : ''}`}
        role="radiogroup"
        aria-label={label}
      >
        {SCALE_VALUES.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            aria-label={`${label} ${v} — ${labels[v - 1]}`}
            className="scale-step"
            data-step={v}
            // 같은 값을 다시 누르면 해제됩니다. 기록하지 않은 날과 '보통'인 날은
            // 다르므로 값을 강제하지 않습니다.
            onClick={() => onPick(value === v ? undefined : v)}
          >
            {v}
          </button>
        ))}
      </div>
      {hint && !value && <p className="scale-hint">{hint}</p>}
    </div>
  )
}
