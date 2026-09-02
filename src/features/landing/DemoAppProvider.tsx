import { useMemo, type ReactNode } from 'react'
import { AppContext, type AppActions, type AppState } from '@/app/store'
import { todayKey } from '@/domain/date'
import { SCHEMA_VERSION, buildTagIndex, defaultProfile } from '@/domain/models'
import { buildDemoData } from './demoData'

/** 데모에서는 어떤 쓰기도 일어나지 않습니다. 눌리면 가입을 안내합니다. */
function demoActions(onWriteAttempt: () => void): AppActions {
  const block = async (): Promise<never> => {
    onWriteAttempt()
    throw new Error('예시 화면에서는 저장할 수 없습니다')
  }
  return {
    saveEntry: block,
    deleteEntry: block,
    updateProfile: block,
    acceptConsent: block,
    createTag: block,
    renameTag: block,
    moveTag: block,
    setTagArchived: block,
    purgeTag: block,
    createCategory: block,
    renameCategory: block,
    deleteCategory: block,
    installPreset: block,
    createCycle: block,
    saveCycle: block,
    deleteCycle: block,
    exportAll: block,
    importBundle: block,
    deleteAllEntries: block,
    deleteAccount: block,
    signOut: block,
  }
}

/**
 * 로그인 없이 실제 화면을 보여주기 위한 상태 공급자.
 *
 * 스크린샷을 붙이는 대신 진짜 컴포넌트를 렌더링합니다. 화면을 고치면
 * 랜딩의 미리보기도 자동으로 따라오므로 둘이 어긋나지 않습니다.
 */
export function DemoAppProvider({
  children,
  onWriteAttempt,
}: {
  children: ReactNode
  onWriteAttempt: () => void
}) {
  const value = useMemo<AppState>(() => {
    const today = todayKey()
    const demo = buildDemoData(today)
    return {
      status: 'ready',
      user: null,
      profile: {
        ...defaultProfile('demo', null),
        modules: { mood: true, energy: true, sleep: true, cycle: true },
        consent: {
          termsVersion: '',
          privacyVersion: '',
          sensitiveDataConsent: true,
          acceptedAt: 0,
        },
        onboardedAt: 0,
        schemaVersion: SCHEMA_VERSION,
      },
      entries: Object.fromEntries(demo.entries.map((e) => [e.date, e])),
      tagIndex: buildTagIndex(demo.categories, demo.tags),
      cycles: demo.cycles,
      offline: false,
      syncing: false,
      migrating: false,
      loadError: null,
      today,
      actions: demoActions(onWriteAttempt),
    }
  }, [onWriteAttempt])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
