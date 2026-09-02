import { useState, type FormEvent } from 'react'
import { authErrorMessage, resetPassword, signIn, signUp } from '@/lib/firebase'
import { Icon } from '@/ui/Icon'
import { Spinner, useToast } from '@/ui/components'
import { LegalSheet } from '@/features/legal/LegalSheet'
import { MEDICAL_DISCLAIMER, PRIVACY, TERMS, type LegalDocument } from '@/features/legal/content'

type Mode = 'login' | 'signup' | 'reset'

const MIN_PASSWORD_LENGTH = 8

const COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  login: { title: '로그인', subtitle: '기록을 이어서 작성합니다', submit: '로그인' },
  signup: { title: '계정 만들기', subtitle: '기록은 이 계정에만 저장됩니다', submit: '가입하기' },
  reset: {
    title: '비밀번호 재설정',
    subtitle: '가입하신 이메일로 재설정 링크를 보냅니다',
    submit: '재설정 메일 보내기',
  },
}

export function AuthScreen({
  initialMode = 'login',
  onBack,
}: {
  initialMode?: Mode
  onBack?: () => void
} = {}) {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [legalDoc, setLegalDoc] = useState<LegalDocument | null>(null)

  const copy = COPY[mode]

  const switchMode = (next: Mode): void => {
    setMode(next)
    setError('')
    setPassword('')
    setPasswordConfirm('')
  }

  const validate = (): string => {
    if (!email.trim()) return '이메일을 입력해주세요.'
    if (mode === 'reset') return ''
    if (!password) return '비밀번호를 입력해주세요.'
    if (mode === 'signup') {
      if (password.length < MIN_PASSWORD_LENGTH)
        return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상으로 설정해주세요.`
      if (password !== passwordConfirm) return '비밀번호가 일치하지 않습니다.'
      if (!agreed) return '약관과 개인정보처리방침에 동의해주세요.'
    }
    return ''
  }

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const message = validate()
    if (message) {
      setError(message)
      return
    }
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') await signIn(email.trim(), password)
      else if (mode === 'signup') await signUp(email.trim(), password)
      else {
        await resetPassword(email.trim())
        toast.success('재설정 메일을 보냈습니다. 메일함을 확인해주세요.')
        switchMode('login')
      }
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 360 }}>
        {onBack && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onBack}
            style={{ marginBottom: 8 }}
          >
            <Icon name="chevronLeft" size={16} /> 돌아가기
          </button>
        )}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            <Icon name={mode === 'reset' ? 'bell' : 'lock'} size={24} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{copy.title}</h1>
          <p style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 4 }}>{copy.subtitle}</p>
        </div>

        <form className="stack" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="notice notice-danger" role="alert">
              {error}
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="auth-email">
              이메일
            </label>
            <input
              id="auth-email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          {mode !== 'reset' && (
            <div className="field">
              <label className="field-label" htmlFor="auth-password">
                비밀번호
              </label>
              <input
                id="auth-password"
                className="input"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? `${MIN_PASSWORD_LENGTH}자 이상` : ''}
              />
            </div>
          )}

          {mode === 'signup' && (
            <div className="field">
              <label className="field-label" htmlFor="auth-password-confirm">
                비밀번호 확인
              </label>
              <input
                id="auth-password-confirm"
                className="input"
                type="password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
              />
            </div>
          )}

          {mode === 'signup' && (
            /*
             * 약관 링크를 label 안에 넣지 않습니다. label 안의 버튼을 누르면
             * 브라우저에 따라 체크박스까지 함께 토글되어, 본문을 읽으려던
             * 동작이 동의로 기록될 수 있습니다.
             */
            <div className="stack-sm">
              <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <input
                  id="auth-agree"
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  style={{ width: 18, height: 18, marginTop: 3, flexShrink: 0, accentColor: 'var(--accent)' }}
                />
                <label
                  htmlFor="auth-agree"
                  className="muted"
                  style={{ fontSize: 13, lineHeight: 1.6, cursor: 'pointer' }}
                >
                  이용약관과 개인정보처리방침에 동의합니다. (필수)
                </label>
              </div>
              <div className="row" style={{ gap: 6, paddingLeft: 28 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '4px 8px', textDecoration: 'underline' }}
                  onClick={() => setLegalDoc(TERMS)}
                >
                  이용약관 읽기
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '4px 8px', textDecoration: 'underline' }}
                  onClick={() => setLegalDoc(PRIVACY)}
                >
                  개인정보처리방침 읽기
                </button>
              </div>
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <Spinner size={16} /> : null}
            {busy ? '처리 중...' : copy.submit}
          </button>
        </form>

        <div className="stack-sm" style={{ marginTop: 16, textAlign: 'center' }}>
          {mode === 'login' && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => switchMode('signup')}>
                계정이 없으신가요? 회원가입
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => switchMode('reset')}>
                비밀번호를 잊으셨나요?
              </button>
            </>
          )}
          {mode !== 'login' && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => switchMode('login')}>
              로그인으로 돌아가기
            </button>
          )}
        </div>

        <p className="hint" style={{ marginTop: 24, textAlign: 'center' }}>
          {MEDICAL_DISCLAIMER}
        </p>
      </div>

      {legalDoc && <LegalSheet document={legalDoc} onClose={() => setLegalDoc(null)} />}
    </div>
  )
}
