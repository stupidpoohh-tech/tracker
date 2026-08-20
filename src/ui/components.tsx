import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Icon, type IconName } from './Icon'

// ─── 스피너 ───────────────────────────────────────────────────────────────────

export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? '불러오는 중'}
      style={{
        width: size,
        height: size,
        border: '2px solid var(--border)',
        borderTopColor: 'currentColor',
        borderRadius: '50%',
        display: 'inline-block',
        animation: 'spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  )
}

// ─── 토스트 ───────────────────────────────────────────────────────────────────

export type ToastKind = 'info' | 'success' | 'error'

interface Toast {
  id: number
  message: string
  kind: ToastKind
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void
  error: (message: string) => void
  success: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++
    setToasts((prev) => [...prev, { id, message, kind }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3200)
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      show,
      error: (m) => show(m, 'error'),
      success: (m) => show(m, 'success'),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-layer" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'info' ? '' : ` toast-${t.kind}`}`}>
            <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} size={16} />
            <span className="grow">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('ToastProvider 안에서만 사용할 수 있습니다')
  return ctx
}

// ─── 시트(모달) ───────────────────────────────────────────────────────────────

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row-between" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="닫기">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
        {footer && <div style={{ marginTop: 20 }}>{footer}</div>}
      </div>
    </div>
  )
}

// ─── 확인 대화상자 ────────────────────────────────────────────────────────────

export function ConfirmSheet({
  title,
  description,
  confirmLabel = '확인',
  danger,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string
  description?: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}) {
  return (
    <Sheet title={title} onClose={onCancel}>
      {description && (
        <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
          {description}
        </p>
      )}
      {children}
      <div className="row" style={{ marginTop: 20, gap: 10 }}>
        <button type="button" className="btn grow" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button
          type="button"
          className={`btn grow ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? <Spinner size={16} /> : null}
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  )
}

// ─── 설정 행 ──────────────────────────────────────────────────────────────────

export function SettingRow({
  icon,
  label,
  sub,
  onClick,
  danger,
  right,
  as = 'button',
}: {
  icon: IconName
  label: string
  sub?: string
  onClick?: () => void
  danger?: boolean
  right?: ReactNode
  as?: 'button' | 'div'
}) {
  const content = (
    <>
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          background: danger ? 'var(--danger-soft)' : 'var(--surface-2)',
          color: danger ? 'var(--danger)' : 'var(--text-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon name={icon} size={16} />
      </span>
      <span className="grow">
        <span
          style={{
            display: 'block',
            fontSize: 14,
            fontWeight: 500,
            color: danger ? 'var(--danger)' : 'var(--text)',
          }}
        >
          {label}
        </span>
        {sub && (
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginTop: 1 }}>
            {sub}
          </span>
        )}
      </span>
      {right ?? (onClick ? <Icon name="chevronRight" size={16} /> : null)}
    </>
  )

  const style: React.CSSProperties = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '13px 0',
    textAlign: 'left',
    color: 'var(--text-3)',
    minHeight: 'var(--tap)',
  }

  if (as === 'div' || !onClick) return <div style={style}>{content}</div>
  return (
    <button type="button" style={style} onClick={onClick}>
      {content}
    </button>
  )
}

export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <p className="section-label">{title}</p>
      <div
        className="card"
        style={{ padding: '0 16px', display: 'flex', flexDirection: 'column' }}
      >
        {children}
      </div>
    </section>
  )
}

// ─── 토글 ─────────────────────────────────────────────────────────────────────

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 46,
        height: 28,
        borderRadius: 999,
        background: checked ? 'var(--accent)' : 'var(--surface-3)',
        border: '1px solid ' + (checked ? 'var(--accent)' : 'var(--border)'),
        position: 'relative',
        transition: 'background 0.18s var(--ease)',
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 20 : 2,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: checked ? 'var(--on-accent)' : 'var(--surface)',
          boxShadow: 'var(--shadow-sm)',
          transition: 'left 0.18s var(--ease)',
        }}
      />
    </button>
  )
}

// ─── 에러 경계 ────────────────────────────────────────────────────────────────

import { Component, type ErrorInfo } from 'react'

interface BoundaryState {
  error: Error | null
}

/**
 * v3에는 에러 경계가 없어서 렌더 오류 하나로 빈 화면이 떴습니다.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[dada] 렌더 오류', error, info)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="page" style={{ paddingTop: 60 }}>
        <div className="card stack">
          <div className="row" style={{ color: 'var(--danger)' }}>
            <Icon name="alert" size={20} />
            <strong style={{ fontSize: 16 }}>화면을 표시하지 못했습니다</strong>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
            기록은 안전하게 보관되어 있습니다. 새로고침해도 같은 문제가 계속되면 설정에서 데이터를
            내보낸 뒤 문의해주세요.
          </p>
          <pre
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-3)',
              background: 'var(--surface-2)',
              padding: 10,
              borderRadius: 8,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {this.state.error.message}
          </pre>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      </div>
    )
  }
}
