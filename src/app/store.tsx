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

import { logOut, onAuth, removeAccount, type User } from '@/lib/firebase'
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/env'
import { firestoreRepository } from '@/data/firestore'
import { runMigration } from '@/data/migrationRunner'
import type { ImportMode, TrackerRepository } from '@/data/repository'
import { todayKey } from '@/domain/date'
import type { DateKey } from '@/domain/date'
import {
  buildTagIndex,
  isEntryEmpty,
  type CycleRecord,
  type Entry,
  type EntryMap,
  type ExportBundle,
  type Tag,
  type TagCategory,
  type TagIndex,
  type UserProfile,
} from '@/domain/models'
import { useToast } from '@/ui/components'

export type AppStatus = 'loading' | 'anonymous' | 'ready'

/** 첫 화면이 이 시간 안에 뜨지 않으면 원인을 표시합니다. */
const LOAD_TIMEOUT_MS = 15_000

/** Firebase 오류를 사용자에게 보여줄 한 줄로 옮깁니다. */
export function describeError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? ''
  const table: Record<string, string> = {
    'permission-denied':
      'Firestore 보안 규칙이 접근을 거부했습니다. 규칙이 올바르게 게시되었는지 확인해주세요.',
    unauthenticated: '인증이 만료되었습니다. 다시 로그인해주세요.',
    unavailable: '서버에 연결하지 못했습니다. 네트워크를 확인해주세요.',
    'failed-precondition':
      '이 브라우저에서 오프라인 저장소를 열지 못했습니다. 시크릿 모드이거나 다른 탭이 열려 있는지 확인해주세요.',
    'resource-exhausted': 'Firestore 사용량 한도를 초과했습니다.',
    cancelled: '요청이 취소되었습니다.',
  }
  if (table[code]) return `${table[code]} (${code})`
  if (code) return `Firestore 오류: ${code}`
  return error instanceof Error ? error.message : String(error)
}

interface AppActions {
  saveEntry: (entry: Entry) => Promise<void>
  deleteEntry: (date: DateKey) => Promise<void>
  updateProfile: (patch: Partial<UserProfile>) => Promise<void>
  acceptConsent: () => Promise<void>

  createTag: (name: string, categoryId: string) => Promise<Tag | null>
  renameTag: (id: string, name: string) => Promise<void>
  moveTag: (id: string, categoryId: string) => Promise<void>
  setTagArchived: (id: string, archived: boolean) => Promise<void>
  purgeTag: (id: string) => Promise<number>
  createCategory: (name: string) => Promise<TagCategory | null>
  renameCategory: (id: string, name: string) => Promise<void>
  deleteCategory: (id: string, moveTagsTo: string | null) => Promise<void>
  installPreset: (presetId: string) => Promise<number>

  createCycle: (startDate: DateKey, endDate: DateKey | null) => Promise<void>
  saveCycle: (record: CycleRecord) => Promise<void>
  deleteCycle: (id: string) => Promise<void>

  exportAll: () => Promise<ExportBundle>
  importBundle: (bundle: ExportBundle, mode: ImportMode) => Promise<void>
  deleteAllEntries: () => Promise<void>
  deleteAccount: () => Promise<void>
  signOut: () => Promise<void>
}

interface AppState {
  status: AppStatus
  user: User | null
  profile: UserProfile | null
  entries: EntryMap
  tagIndex: TagIndex
  cycles: CycleRecord[]
  /** Firestore가 캐시에서만 응답 중 — 서버와 끊긴 상태입니다. */
  offline: boolean
  syncing: boolean
  migrating: boolean
  /** 초기 로딩을 끝내지 못한 이유. 정상일 때는 null입니다. */
  loadError: string | null
  today: DateKey
  actions: AppActions
}

/**
 * 화면 컴포넌트가 읽는 유일한 상태 통로입니다.
 *
 * 로그인 전 랜딩 화면에서 실제 대시보드·인사이트를 예시 데이터로 그대로
 * 보여주기 위해, 인증에 묶이지 않은 값 주입도 허용합니다(features/demo).
 */
const AppContext = createContext<AppState | null>(null)

export { AppContext }
export type { AppState, AppActions }

const EMPTY_TAG_INDEX = buildTagIndex([], [])

export function AppProvider({
  children,
  repository = firestoreRepository,
}: {
  children: ReactNode
  repository?: TrackerRepository
}) {
  const toast = useToast()

  const [status, setStatus] = useState<AppStatus>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [entries, setEntries] = useState<EntryMap>({})
  const [categories, setCategories] = useState<TagCategory[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [cycles, setCycles] = useState<CycleRecord[]>([])
  const [offline, setOffline] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [today, setToday] = useState<DateKey>(() => todayKey())
  /**
   * 로딩을 끝내지 못한 이유. 화면에 그대로 보여주기 위해 문자열로 들고 있습니다.
   * 이게 없으면 실패가 '연결 중…' 화면으로만 나타나 원인을 알 수 없습니다.
   */
  const [loadError, setLoadError] = useState<string | null>(null)

  const uidRef = useRef<string | null>(null)

  // 자정을 넘기면 '오늘'이 바뀌어야 합니다. 앱을 켜 둔 채 날이 바뀌는 경우.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = todayKey()
      setToday((prev) => (prev === next ? prev : next))
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const onSyncError = useCallback(
    (error: unknown) => {
      // v3는 여기서 console.error만 하고 넘어가 사용자는 저장된 줄 알았습니다.
      console.error('[dada] 동기화 오류', error)
      toast.error('동기화에 실패했습니다. 네트워크를 확인해주세요.')
      // 구독이 실패하면 첫 스냅샷이 영영 오지 않습니다. 로딩 화면에 갇히지
      // 않도록 반드시 상태를 풀고 원인을 남깁니다.
      setLoadError(describeError(error))
      setSyncing(false)
      setStatus((prev) => (prev === 'loading' ? 'ready' : prev))
    },
    [toast],
  )

  useEffect(() => {
    let disposed = false
    const unsubscribers: (() => void)[] = []

    const cleanupWatchers = (): void => {
      while (unsubscribers.length > 0) unsubscribers.pop()?.()
    }

    const unsubAuth = onAuth((nextUser) => {
      cleanupWatchers()
      setUser(nextUser)
      uidRef.current = nextUser?.uid ?? null

      if (!nextUser) {
        setProfile(null)
        setEntries({})
        setCategories([])
        setTags([])
        setCycles([])
        setStatus('anonymous')
        return
      }

      setStatus('loading')
      setSyncing(true)
      setLoadError(null)

      void (async () => {
        try {
          const ensured = await repository.ensureProfile(nextUser.uid, nextUser.email)
          if (disposed) return
          setProfile(ensured)

          if (ensured.schemaVersion < 4) {
            setMigrating(true)
            try {
              const outcome = await runMigration(nextUser.uid, ensured.schemaVersion)
              if (outcome.ran && outcome.plan) {
                const { stats } = outcome.plan
                if (stats.entryCount > 0 || stats.tagCount > 0) {
                  toast.success(
                    `이전 데이터를 옮겼습니다 — 기록 ${stats.entryCount}일, 태그 ${stats.tagCount}개, 생리 기록 ${stats.cycleCount}건`,
                  )
                }
              }
            } catch (error) {
              console.error('[dada] 마이그레이션 실패', error)
              toast.error('이전 데이터 이관 중 문제가 발생했습니다. 기존 데이터는 그대로 있습니다.')
            } finally {
              if (!disposed) setMigrating(false)
            }
          }

          if (disposed) return

          unsubscribers.push(
            repository.watchProfile(nextUser.uid, (p) => p && setProfile(p), onSyncError),
            repository.watchEntries(
              nextUser.uid,
              (map, fromCache) => {
                setEntries(map)
                setOffline(fromCache)
                setSyncing(false)
                setStatus('ready')
              },
              onSyncError,
            ),
            repository.watchTags(
              nextUser.uid,
              (bundle) => {
                setCategories(bundle.categories)
                setTags(bundle.tags)
              },
              onSyncError,
            ),
            repository.watchCycles(nextUser.uid, setCycles, onSyncError),
          )
        } catch (error) {
          console.error('[dada] 초기화 실패', error)
          if (!disposed) {
            toast.error('데이터를 불러오지 못했습니다. 네트워크를 확인해주세요.')
            setLoadError(describeError(error))
            setStatus('ready')
            setSyncing(false)
          }
        }
      })()
    })

    return () => {
      disposed = true
      cleanupWatchers()
      unsubAuth()
    }
  }, [repository, onSyncError, toast])

  // 테마 적용
  useEffect(() => {
    const theme = profile?.theme ?? 'system'
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [profile?.theme])

  /**
   * 로딩 워치독.
   *
   * 첫 스냅샷이 오지 않는 원인은 여러 가지입니다(규칙 거부, IndexedDB 잠금,
   * 네트워크 차단). 어느 경우든 '연결 중…' 화면에 무한정 머무르지 않도록
   * 시간 제한을 둡니다.
   */
  useEffect(() => {
    if (status !== 'loading') return
    const timer = window.setTimeout(() => {
      setLoadError((prev) =>
        prev ??
        '서버 응답이 없습니다. 네트워크 연결, Firestore 보안 규칙, 브라우저의 저장소 차단 설정을 확인해주세요.',
      )
      setStatus('ready')
      setSyncing(false)
    }, LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  const tagIndex = useMemo(() => buildTagIndex(categories, tags), [categories, tags])

  const requireUid = useCallback((): string => {
    const uid = uidRef.current
    if (!uid) throw new Error('로그인이 필요합니다')
    return uid
  }, [])

  /** 저장소 호출을 감싸 실패를 사용자에게 반드시 알립니다. */
  const guard = useCallback(
    async <T,>(operation: () => Promise<T>, failureMessage: string): Promise<T> => {
      try {
        return await operation()
      } catch (error) {
        console.error(`[dada] ${failureMessage}`, error)
        toast.error(failureMessage)
        throw error
      }
    },
    [toast],
  )

  const actions = useMemo<AppActions>(
    () => ({
      async saveEntry(entry) {
        const uid = requireUid()
        if (isEntryEmpty(entry)) {
          if (entries[entry.date]) await guard(() => repository.deleteEntry(uid, entry.date), '기록 삭제에 실패했습니다')
          return
        }
        await guard(() => repository.saveEntry(uid, entry), '저장에 실패했습니다')
      },
      async deleteEntry(date) {
        await guard(() => repository.deleteEntry(requireUid(), date), '기록 삭제에 실패했습니다')
      },
      async updateProfile(patch) {
        await guard(() => repository.updateProfile(requireUid(), patch), '설정 저장에 실패했습니다')
      },
      async acceptConsent() {
        await guard(
          () =>
            repository.updateProfile(requireUid(), {
              consent: {
                termsVersion: TERMS_VERSION,
                privacyVersion: PRIVACY_VERSION,
                sensitiveDataConsent: true,
                acceptedAt: Date.now(),
              },
            }),
          '동의 저장에 실패했습니다',
        )
      },

      async createTag(name, categoryId) {
        const trimmed = name.trim()
        if (!trimmed) return null
        if (tagIndex.byName.has(trimmed)) {
          toast.error(`'${trimmed}' 태그는 이미 있습니다.`)
          return null
        }
        return guard(() => repository.createTag(requireUid(), trimmed, categoryId), '태그 추가에 실패했습니다')
      },
      async renameTag(id, name) {
        const trimmed = name.trim()
        if (!trimmed) return
        const clash = tagIndex.byName.get(trimmed)
        if (clash && clash.id !== id) {
          toast.error(`'${trimmed}' 태그는 이미 있습니다.`)
          return
        }
        await guard(() => repository.updateTag(requireUid(), id, { name: trimmed }), '태그 이름 변경에 실패했습니다')
      },
      async moveTag(id, categoryId) {
        await guard(() => repository.updateTag(requireUid(), id, { categoryId }), '태그 이동에 실패했습니다')
      },
      async setTagArchived(id, archived) {
        await guard(() => repository.setTagArchived(requireUid(), id, archived), '태그 보관 처리에 실패했습니다')
      },
      async purgeTag(id) {
        return guard(() => repository.purgeTag(requireUid(), id), '태그 삭제에 실패했습니다')
      },
      async createCategory(name) {
        const trimmed = name.trim()
        if (!trimmed) return null
        if (tagIndex.categories.some((c) => c.name === trimmed)) {
          toast.error(`'${trimmed}' 카테고리는 이미 있습니다.`)
          return null
        }
        return guard(() => repository.createCategory(requireUid(), trimmed), '카테고리 추가에 실패했습니다')
      },
      async renameCategory(id, name) {
        const trimmed = name.trim()
        if (!trimmed) return
        await guard(() => repository.updateCategory(requireUid(), id, { name: trimmed }), '카테고리 이름 변경에 실패했습니다')
      },
      async deleteCategory(id, moveTagsTo) {
        await guard(() => repository.deleteCategory(requireUid(), id, moveTagsTo), '카테고리 삭제에 실패했습니다')
      },
      async installPreset(presetId) {
        return guard(() => repository.installPreset(requireUid(), presetId), '태그 세트 추가에 실패했습니다')
      },

      async createCycle(startDate, endDate) {
        await guard(() => repository.createCycle(requireUid(), startDate, endDate), '생리 기록 저장에 실패했습니다')
      },
      async saveCycle(record) {
        await guard(() => repository.saveCycle(requireUid(), record), '생리 기록 저장에 실패했습니다')
      },
      async deleteCycle(id) {
        await guard(() => repository.deleteCycle(requireUid(), id), '생리 기록 삭제에 실패했습니다')
      },

      async exportAll() {
        return guard(() => repository.exportAll(requireUid()), '내보내기에 실패했습니다')
      },
      async importBundle(bundle, mode) {
        const result = await guard(
          () => repository.importBundle(requireUid(), bundle, mode),
          '가져오기에 실패했습니다',
        )
        const skippedNote = result.skipped > 0 ? ` (미래 날짜 ${result.skipped}건 제외)` : ''
        toast.success(`기록 ${result.entries}일, 태그 ${result.tags}개를 가져왔습니다${skippedNote}`)
      },
      async deleteAllEntries() {
        await guard(() => repository.deleteAllEntries(requireUid()), '삭제에 실패했습니다')
      },
      async deleteAccount() {
        const uid = requireUid()
        const currentUser = user
        if (!currentUser) throw new Error('로그인이 필요합니다')
        await guard(() => repository.purgeUserData(uid), '데이터 삭제에 실패했습니다')
        await guard(() => removeAccount(currentUser), '계정 삭제에 실패했습니다')
      },
      async signOut() {
        await logOut()
      },
    }),
    [repository, requireUid, guard, toast, tagIndex, entries, user],
  )

  const value = useMemo<AppState>(
    () => ({
      status,
      user,
      profile,
      entries,
      tagIndex,
      cycles,
      offline,
      syncing,
      migrating,
      loadError,
      today,
      actions,
    }),
    [
      status,
      user,
      profile,
      entries,
      tagIndex,
      cycles,
      offline,
      syncing,
      migrating,
      loadError,
      today,
      actions,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppProvider 안에서만 사용할 수 있습니다')
  return ctx
}

export { EMPTY_TAG_INDEX }
