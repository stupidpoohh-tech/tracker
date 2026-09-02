import { vi } from 'vitest'
import type { ReactNode } from 'react'
import type {
  ImportMode,
  ImportResult,
  TagBundle,
  TrackerRepository,
  Unsubscribe,
} from '@/data/repository'
import {
  SCHEMA_VERSION,
  defaultProfile,
  type CycleRecord,
  type Entry,
  type EntryMap,
  type ExportBundle,
  type Observation,
  type Tag,
  type TagCategory,
  type UserProfile,
} from '@/domain/models'
import { patternUsesTag } from '@/domain/patterns'

export const TEST_UID = 'test-uid'
export const TEST_EMAIL = 'tester@example.com'

export interface SeedData {
  profile?: Partial<UserProfile>
  entries?: Entry[]
  tags?: Tag[]
  categories?: TagCategory[]
  cycles?: CycleRecord[]
  observations?: Observation[]
  /** 기록 구독을 실패시킵니다. 로딩 화면에 갇히지 않는지 확인할 때 씁니다. */
  failEntriesWith?: { code?: string; message?: string }
}

export interface FakeRepository extends TrackerRepository {
  /** 테스트에서 저장된 값을 확인하기 위한 접근자입니다. */
  readonly state: {
    profile: UserProfile
    entries: EntryMap
    tags: Tag[]
    categories: TagCategory[]
    cycles: CycleRecord[]
    observations: Observation[]
  }
  readonly calls: string[]
}

export function createFakeRepository(seed: SeedData = {}): FakeRepository {
  const profile: UserProfile = {
    ...defaultProfile(TEST_UID, TEST_EMAIL),
    consent: {
      termsVersion: '2026-08-01',
      privacyVersion: '2026-08-01',
      sensitiveDataConsent: true,
      acceptedAt: 1,
    },
    onboardedAt: 1,
    schemaVersion: SCHEMA_VERSION,
    ...seed.profile,
  }

  const state = {
    profile,
    entries: Object.fromEntries((seed.entries ?? []).map((e) => [e.date, e])) as EntryMap,
    tags: [...(seed.tags ?? [])],
    categories: [...(seed.categories ?? [])],
    cycles: [...(seed.cycles ?? [])],
    observations: [...(seed.observations ?? [])],
  }

  const calls: string[] = []
  const listeners = {
    profile: new Set<(p: UserProfile | null) => void>(),
    entries: new Set<(m: EntryMap, fromCache: boolean) => void>(),
    tags: new Set<(b: TagBundle) => void>(),
    cycles: new Set<(c: CycleRecord[]) => void>(),
    observations: new Set<(o: Observation[]) => void>(),
  }

  const emitEntries = (): void => {
    for (const cb of listeners.entries) cb({ ...state.entries }, false)
  }
  const emitTags = (): void => {
    for (const cb of listeners.tags) cb({ categories: [...state.categories], tags: [...state.tags] })
  }
  const emitCycles = (): void => {
    for (const cb of listeners.cycles) cb([...state.cycles])
  }
  const emitObservations = (): void => {
    for (const cb of listeners.observations) cb([...state.observations])
  }
  const emitProfile = (): void => {
    for (const cb of listeners.profile) cb({ ...state.profile })
  }

  let nextId = 1
  const makeId = (prefix: string): string => `${prefix}-${nextId++}`

  const subscribe = <T,>(set: Set<T>, cb: T): Unsubscribe => {
    set.add(cb)
    return () => set.delete(cb)
  }

  return {
    state,
    calls,

    async ensureProfile() {
      calls.push('ensureProfile')
      return state.profile
    },
    watchProfile(_uid, onChange) {
      queueMicrotask(() => onChange({ ...state.profile }))
      return subscribe(listeners.profile, onChange)
    },
    async updateProfile(_uid, patch) {
      calls.push('updateProfile')
      state.profile = { ...state.profile, ...patch }
      emitProfile()
    },

    watchEntries(_uid, onChange, onError) {
      if (seed.failEntriesWith) {
        const failure = Object.assign(new Error(seed.failEntriesWith.message ?? '구독 실패'), {
          code: seed.failEntriesWith.code,
        })
        queueMicrotask(() => onError(failure))
        return () => {}
      }
      queueMicrotask(() => onChange({ ...state.entries }, false))
      return subscribe(listeners.entries, onChange)
    },
    async saveEntry(_uid, entry) {
      calls.push(`saveEntry:${entry.date}`)
      state.entries[entry.date] = entry
      emitEntries()
    },
    async deleteEntry(_uid, date) {
      calls.push(`deleteEntry:${date}`)
      delete state.entries[date]
      emitEntries()
    },
    async deleteAllEntries() {
      calls.push('deleteAllEntries')
      state.entries = {}
      emitEntries()
    },

    watchTags(_uid, onChange) {
      queueMicrotask(() => onChange({ categories: [...state.categories], tags: [...state.tags] }))
      return subscribe(listeners.tags, onChange)
    },
    async createCategory(_uid, name) {
      const category: TagCategory = { id: makeId('cat'), name, order: state.categories.length }
      state.categories.push(category)
      emitTags()
      return category
    },
    async updateCategory(_uid, id, patch) {
      state.categories = state.categories.map((c) => (c.id === id ? { ...c, ...patch } : c))
      emitTags()
    },
    async deleteCategory(_uid, id, moveTagsTo) {
      state.categories = state.categories.filter((c) => c.id !== id)
      state.tags = state.tags.map((t) =>
        t.categoryId === id ? { ...t, categoryId: moveTagsTo ?? t.categoryId, archived: !moveTagsTo } : t,
      )
      emitTags()
    },
    async createTag(_uid, name, categoryId) {
      calls.push(`createTag:${name}`)
      const tag: Tag = {
        id: makeId('tag'),
        name,
        categoryId,
        order: state.tags.length,
        archived: false,
      }
      state.tags.push(tag)
      emitTags()
      return tag
    },
    async updateTag(_uid, id, patch) {
      calls.push(`updateTag:${id}`)
      state.tags = state.tags.map((t) => (t.id === id ? { ...t, ...patch } : t))
      emitTags()
    },
    async setTagArchived(_uid, id, archived) {
      calls.push(`setTagArchived:${id}:${archived}`)
      state.tags = state.tags.map((t) => (t.id === id ? { ...t, archived } : t))
      emitTags()
    },
    async purgeTag(_uid, id) {
      calls.push(`purgeTag:${id}`)
      let affected = 0
      for (const [date, entry] of Object.entries(state.entries)) {
        if (!entry.tagIds.includes(id)) continue
        affected += 1
        state.entries[date] = { ...entry, tagIds: entry.tagIds.filter((t) => t !== id) }
      }
      state.tags = state.tags.filter((t) => t.id !== id)
      const before = state.observations.length
      state.observations = state.observations.filter((o) => !patternUsesTag(o.patternId, id))
      emitTags()
      emitEntries()
      if (state.observations.length !== before) emitObservations()
      return affected
    },
    async installPreset(_uid, presetId) {
      calls.push(`installPreset:${presetId}`)
      return 0
    },

    watchCycles(_uid, onChange) {
      queueMicrotask(() => onChange([...state.cycles]))
      return subscribe(listeners.cycles, onChange)
    },
    async saveCycle(_uid, record) {
      calls.push(`saveCycle:${record.id}`)
      const index = state.cycles.findIndex((c) => c.id === record.id)
      if (index >= 0) state.cycles[index] = record
      else state.cycles.push(record)
      emitCycles()
    },
    async createCycle(_uid, startDate, endDate) {
      calls.push(`createCycle:${startDate}`)
      const record: CycleRecord = { id: makeId('cycle'), startDate, endDate }
      state.cycles.push(record)
      emitCycles()
      return record
    },
    async deleteCycle(_uid, id) {
      calls.push(`deleteCycle:${id}`)
      state.cycles = state.cycles.filter((c) => c.id !== id)
      emitCycles()
    },

    watchObservations(_uid, onChange) {
      queueMicrotask(() => onChange([...state.observations]))
      return subscribe(listeners.observations, onChange)
    },
    async addObservation(_uid, patternId, label, startedOn, baseline) {
      calls.push(`addObservation:${patternId}`)
      const observation: Observation = { id: makeId('obs'), patternId, label, startedOn, baseline }
      state.observations.push(observation)
      emitObservations()
      return observation
    },
    async removeObservation(_uid, id) {
      calls.push(`removeObservation:${id}`)
      state.observations = state.observations.filter((o) => o.id !== id)
      emitObservations()
    },

    async exportAll() {
      return {
        format: 'dada-tracker',
        version: SCHEMA_VERSION,
        exportedAt: '2026-08-20T00:00:00.000Z',
        entries: Object.values(state.entries),
        tags: state.tags,
        tagCategories: state.categories,
        cycles: state.cycles,
      } satisfies ExportBundle
    },
    async importBundle(_uid, bundle, _mode: ImportMode) {
      for (const entry of bundle.entries) state.entries[entry.date] = entry
      emitEntries()
      return {
        entries: bundle.entries.length,
        tags: bundle.tags.length,
        categories: bundle.tagCategories.length,
        cycles: bundle.cycles.length,
        skipped: 0,
      } satisfies ImportResult
    },
    async purgeUserData() {
      calls.push('purgeUserData')
    },
  }
}

/** Firebase 모듈 전체를 대체합니다. 테스트에서 네트워크에 나가지 않습니다. */
export function mockFirebase(): void {
  vi.mock('@/lib/firebase', () => ({
    auth: {},
    db: {},
    app: {},
    onAuth: (cb: (user: unknown) => void) => {
      cb({ uid: TEST_UID, email: TEST_EMAIL, emailVerified: true })
      return () => {}
    },
    signIn: vi.fn(),
    signUp: vi.fn(),
    logOut: vi.fn(),
    resetPassword: vi.fn(),
    requestEmailVerification: vi.fn(),
    changePassword: vi.fn(),
    reauthenticate: vi.fn(),
    removeAccount: vi.fn(),
    authErrorMessage: (e: unknown) => String(e),
  }))
}

export function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>
}
