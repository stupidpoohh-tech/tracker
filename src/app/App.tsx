import { useEffect, useMemo, useState } from 'react'
import { useApp } from './store'
import type { DateKey } from '@/domain/date'
import { registerServiceWorker, startForegroundReminder } from '@/lib/pwa'
import { Icon, type IconName } from '@/ui/Icon'
import { Spinner } from '@/ui/components'
import { AuthScreen } from '@/features/auth/AuthScreen'
import { Onboarding } from '@/features/onboarding/Onboarding'
import { Dashboard } from '@/features/dashboard/Dashboard'
import { InsightsScreen } from '@/features/insights/InsightsScreen'
import { LogScreen } from '@/features/log/LogScreen'
import { TagsScreen } from '@/features/tags/TagsScreen'
import { SettingsScreen } from '@/features/settings/SettingsScreen'

type Tab = 'dashboard' | 'insights' | 'tags' | 'settings'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'dashboard', label: '대시보드', icon: 'chart' },
  { id: 'insights', label: '인사이트', icon: 'sparkles' },
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
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

function FullScreenMessage({ message }: { message: string }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
      }}
    >
      <span
        style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="cloud" size={24} />
      </span>
      <Spinner size={24} />
      <p style={{ fontSize: 13.5, color: 'var(--text-3)' }}>{message}</p>
    </div>
  )
}

export function App() {
  const { status, profile, entries, today, migrating } = useApp()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [logDate, setLogDate] = useState<DateKey | null>(null)

  // 서비스워커 등록 — 오프라인 셸과 리마인더에 필요합니다.
  useEffect(() => {
    void registerServiceWorker()
  }, [])

  // URL의 ?log=today로 들어오면 바로 기록 화면을 엽니다 (알림 클릭 경로).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('log') === 'today') {
      setLogDate(today)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [today])

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
    return <FullScreenMessage message={migrating ? '이전 데이터를 옮기는 중…' : '연결 중…'} />
  }

  if (status === 'anonymous') return <AuthScreen />

  // 동의와 초기 설정을 마치기 전에는 기록 화면을 열지 않습니다.
  if (!profile?.consent?.sensitiveDataConsent || !profile.onboardedAt) {
    return <Onboarding />
  }

  if (logDate) {
    return <LogScreen key={logDate} initialDate={logDate} onClose={() => setLogDate(null)} />
  }

  return (
    <>
      {tab === 'dashboard' && <Dashboard onEdit={setLogDate} />}
      {tab === 'insights' && <InsightsScreen />}
      {tab === 'tags' && <TagsScreen />}
      {tab === 'settings' && <SettingsScreen />}
      <NavBar tab={tab} onChange={setTab} />
    </>
  )
}
