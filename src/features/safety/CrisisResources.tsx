import { CRISIS_RESOURCES } from '@/domain/tagPresets'
import { Icon } from '@/ui/Icon'

/**
 * 자해·자살 관련 태그가 선택되면 노출합니다.
 *
 * 개인용 앱이었을 때는 본인 기록이었지만, 불특정 다수에게 제공하는 순간
 * 위기 자원 안내는 선택 기능이 아니라 요건에 가깝습니다. 앱스토어 심사에서도
 * 확인하는 항목입니다.
 */
export function CrisisResources({
  compact = false,
  onDismiss,
}: {
  compact?: boolean
  onDismiss?: () => void
}) {
  return (
    <div
      className="notice notice-warn"
      role="note"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div className="row-between">
        <span className="row" style={{ gap: 6, fontWeight: 700 }}>
          <Icon name="heart" size={16} />
          지금 힘드시다면 도움을 받으실 수 있습니다
        </span>
        {onDismiss && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss} aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {!compact && (
        <p style={{ fontSize: 12.5, lineHeight: 1.7, opacity: 0.9 }}>
          아래 상담 창구는 24시간 무료로 운영됩니다. 혼자 견디지 않으셔도 됩니다.
        </p>
      )}
      <div className="stack-sm">
        {CRISIS_RESOURCES.map((resource) => (
          <a
            key={resource.name}
            href={resource.href}
            className="row-between"
            style={{
              textDecoration: 'none',
              color: 'inherit',
              background: 'var(--surface)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              minHeight: 'var(--tap)',
            }}
          >
            <span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{resource.name}</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)' }}>
                {resource.detail}
              </span>
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.01em' }}>
              {resource.contact}
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}
