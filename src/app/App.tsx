import { useEffect, useMemo, useState } from 'react'
import { useApp } from './store'
import type { DateKey } from '@/domain/date'
import { registerServiceWorker, startForegroundReminder } from '@/lib/pwa'
import { Icon, type IconName } from '@/ui/Icon'
import { Spinner } from '@/ui/components'
import { AuthScreen } from '@/features/auth/AuthScreen'
import { DemoAppProvider } from '@/features/demo/DemoAppProvider'
import { Onboarding } from '@/features/onboarding/Onboarding'
import { Dashboard } from '@/features/dashboard/Dashboard'
import { InsightsScreen } from '@/features/insights/InsightsScreen'
import { LogScreen } from '@/features/log/LogScreen'
import { TagsScreen } from '@/features/tags/TagsScreen'
import { SettingsScreen } from '@/features/settings/SettingsScreen'

type Tab = 'dashboard' | 'insights' | 'tags' | 'settings'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'dashboard', label: '대시보드', icon: 'activity' },
  { id: 'insights', label: '인사이트', icon: 'barChart' },
  { id: 'tags', label: '태그', icon: 'tag' },
  { id: 'settings', label: '설정', icon: 'settings' },
]

function NavBar({ tab, onChange }: { tab: Tab; onChange: (next: Tab) => void }) {
  return (
    <nav className="navbar no-print" aria-label="주요 메뉴">
      <div className="navbar-inner">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav-item"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => onChange(item.id)}
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

/** 탭 본문 + 하단 내비. 로그인 전후가 같은 화면을 씁니다. */
function AppShell({
  tab,
  onTabChange,
  onEdit,
}: {
  tab: Tab
  onTabChange: (next: Tab) => void
  onEdit: (date: DateKey) => void
}) {
  return (
    <>
      {tab === 'dashboard' && <Dashboard onEdit={onEdit} />}
      {tab === 'insights' && <InsightsScreen />}
      {tab === 'tags' && <TagsScreen />}
      {tab === 'settings' && <SettingsScreen />}
      <NavBar tab={tab} onChange={onTabChange} />
    </>
  )
}

/** 로그인 전 화면 위에 얹는 얇은 안내 줄. */
function DemoBar({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  return (
    <div className="demo-bar no-print">
      <div className="demo-bar-inner">
        <span className="demo-bar-note">예시 데이터를 보고 있습니다</span>
        <span className="demo-bar-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSignIn}>
            로그인
          </button>
          <button type="button" className="btn btn-tint btn-sm" onClick={onSignUp}>
            시작하기
          </button>
        </span>
      </div>
    </div>
  )
}

/** 로딩이 이 시간을 넘기면 '오래 걸리는 중'이라고 알립니다. */
const SLOW_LOAD_MS = 6000

function FullScreenMessage({ message, detail }: { message: string; detail?: string }) {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: '24px 20px',
        textAlign: 'center',
      }}
    >
      <Spinner size={22} />
      <p style={{ fontSize: 13.5, color: 'var(--text-3)' }}>{message}</p>
      {detail && (
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', maxWidth: 320, lineHeight: 1.7 }}>
          {detail}
        </p>
      )}
      {slow && (
        <div className="stack-sm" style={{ maxWidth: 320, marginTop: 8 }}>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.7 }}>
            예상보다 오래 걸리고 있습니다. 기록이 많으면 첫 연결에 시간이 걸릴 수 있습니다.
            1분이 지나도 그대로라면 새로고침해주세요.
          </p>
          <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      )}
    </div>
  )
}

export function App() {
  const { status, profile, entries, today, migrating, loadError } = useApp()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [logDate, setLogDate] = useState<DateKey | null>(null)
  /** null이면 앱 화면, 값이 있으면 그 모드의 인증 화면을 띄웁니다. */
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(null)

  // 서비스워커 등록 — 오프라인 셸과 리마인더에 필요합니다.
  useEffect(() => {
    void registerServiceWorker()
  }, [])

  // 알림에서 들어온 경우 바로 기록 화면을 엽니다. 로그인 상태에서만 의미가 있습니다.
  useEffect(() => {
    if (status !== 'ready') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('log') === 'today') {
      setLogDate(today)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [status, today])

  // 로그인에 성공하면 다음 로그아웃 때 다시 앱 화면부터 시작하도록 되돌립니다.
  useEffect(() => {
    if (status === 'ready') setAuthMode(null)
  }, [status])

  const lastLoggedDate = useMemo(() => {
    const keys = Object.keys(entries).sort()
    return keys[keys.length - 1] ?? null
  }, [entries])

  const reminder = profile?.reminder
  useEffect(() => {
    if (!reminder?.enabled) return
    return startForegroundReminder(() => ({
      enabled: true,
      time: reminder.time,
      lastLoggedDate,
    }))
  }, [reminder?.enabled, reminder?.time, lastLoggedDate])

  if (status === 'loading') {
    return (
      <FullScreenMessage
        message={migrating ? '이전 데이터를 옮기는 중…' : '연결 중…'}
        detail={
          migrating ? '기록이 많으면 1~2분 걸릴 수 있습니다. 화면을 닫지 말아주세요.' : undefined
        }
      />
    )
  }

  /*
   * 로그인 전에도 소개 페이지가 아니라 진짜 화면을 그대로 보여줍니다.
   * 예시 데이터를 넣은 실제 컴포넌트라 화면을 고치면 여기도 함께 바뀝니다.
   * 저장이 필요한 동작을 누르면 그때 가입 화면으로 넘깁니다.
   */
  if (status === 'anonymous') {
    if (authMode) {
      return <AuthScreen initialMode={authMode} onBack={() => setAuthMode(null)} />
    }
    return (
      <DemoAppProvider onWriteAttempt={() => setAuthMode('signup')}>
        <DemoBar onSignIn={() => setAuthMode('login')} onSignUp={() => setAuthMode('signup')} />
        <AppShell tab={tab} onTabChange={setTab} onEdit={() => setAuthMode('signup')} />
      </DemoAppProvider>
    )
  }

  // 동의와 초기 설정을 마치기 전에는 기록 화면을 열지 않습니다.
  if (!profile?.consent?.sensitiveDataConsent || !profile.onboardedAt) {
    return <Onboarding />
  }

  if (logDate) {
    return <LogScreen key={logDate} initialDate={logDate} onClose={() => setLogDate(null)} />
  }

  return (
    <>
      {loadError && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <div className="notice notice-danger stack-sm" style={{ marginTop: 16 }} role="alert">
            <span className="row" style={{ gap: 6, fontWeight: 600 }}>
              <Icon name="alert" size={15} />
              데이터를 완전히 불러오지 못했습니다
            </span>
            <span style={{ fontSize: 12.5, lineHeight: 1.7 }}>{loadError}</span>
            <button
              type="button"
              className="btn btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => window.location.reload()}
            >
              다시 시도
            </button>
          </div>
        </div>
      )}
      <AppShell tab={tab} onTabChange={setTab} onEdit={setLogDate} />
    </>
  )
}
