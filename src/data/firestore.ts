import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type QuerySnapshot,
} from 'firebase/firestore'

import { db } from '@/lib/firebase'
import { APP_VERSION } from '@/lib/env'
import type { DateKey } from '@/domain/date'
import { todayKey } from '@/domain/date'
import {
  SCHEMA_VERSION,
  cycleRecordSchema,
  defaultProfile,
  observationSchema,
  entrySchema,
  tagCategorySchema,
  tagSchema,
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
import { findPreset } from '@/domain/tagPresets'
import type { ImportMode, ImportResult, TrackerRepository } from './repository'

/** Firestore 배치 상한은 500개입니다. */
const BATCH_LIMIT = 450

const paths = {
  user: (uid: string) => doc(db, 'users', uid),
  entries: (uid: string) => collection(db, 'users', uid, 'entries'),
  entry: (uid: string, date: DateKey) => doc(db, 'users', uid, 'entries', date),
  tags: (uid: string) => collection(db, 'users', uid, 'tags'),
  tag: (uid: string, id: string) => doc(db, 'users', uid, 'tags', id),
  categories: (uid: string) => collection(db, 'users', uid, 'tagCategories'),
  category: (uid: string, id: string) => doc(db, 'users', uid, 'tagCategories', id),
  cycles: (uid: string) => collection(db, 'users', uid, 'cycles'),
  cycle: (uid: string, id: string) => doc(db, 'users', uid, 'cycles', id),
  observations: (uid: string) => collection(db, 'users', uid, 'observations'),
  observation: (uid: string, id: string) => doc(db, 'users', uid, 'observations', id),
}

function newId(ref: CollectionReference<DocumentData>): string {
  return doc(ref).id
}

/** undefined 필드를 제거합니다. Firestore에 null을 남기지 않기 위한 규약입니다. */
function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v
  }
  return out as Partial<T>
}

function warnInvalid(kind: string, id: string, issue: unknown): void {
  console.warn(`[dada] ${kind} 문서 ${id}의 형식이 올바르지 않아 건너뜁니다.`, issue)
}

// ─── 매핑 ─────────────────────────────────────────────────────────────────────

function readEntries(snap: QuerySnapshot<DocumentData>): EntryMap {
  const out: EntryMap = {}
  snap.forEach((d) => {
    const raw = d.data()
    // v3 문서에는 date 필드가 없습니다. 문서 ID가 곧 날짜입니다.
    const candidate = {
      ...raw,
      date: typeof raw.date === 'string' ? raw.date : d.id,
      tagIds: Array.isArray(raw.tagIds) ? raw.tagIds : [],
      legacyTags: Array.isArray(raw.legacyTags)
        ? raw.legacyTags
        : Array.isArray(raw.tags)
          ? raw.tags
          : undefined,
      memo: typeof raw.memo === 'string' ? raw.memo : '',
      // v3는 미선택 값을 null로 저장했습니다. undefined로 정규화합니다.
      mood: raw.mood ?? undefined,
      energy: raw.energy ?? undefined,
      sleep: raw.sleep ?? undefined,
      sleepHours: raw.sleepHours ?? undefined,
      ovulationMark: raw.ovulationMark ?? undefined,
    }
    const parsed = entrySchema.safeParse(candidate)
    if (!parsed.success) {
      warnInvalid('entry', d.id, parsed.error.issues)
      return
    }
    out[parsed.data.date] = parsed.data as Entry
  })
  return out
}

function readTags(snap: QuerySnapshot<DocumentData>): Tag[] {
  const out: Tag[] = []
  snap.forEach((d) => {
    const parsed = tagSchema.safeParse({ ...d.data(), id: d.id })
    if (!parsed.success) return warnInvalid('tag', d.id, parsed.error.issues)
    out.push(parsed.data)
  })
  return out
}

function readCategories(snap: QuerySnapshot<DocumentData>): TagCategory[] {
  const out: TagCategory[] = []
  snap.forEach((d) => {
    const parsed = tagCategorySchema.safeParse({ ...d.data(), id: d.id })
    if (!parsed.success) return warnInvalid('tagCategory', d.id, parsed.error.issues)
    out.push(parsed.data)
  })
  return out
}

function readCycles(snap: QuerySnapshot<DocumentData>): CycleRecord[] {
  const out: CycleRecord[] = []
  snap.forEach((d) => {
    const raw = d.data()
    const parsed = cycleRecordSchema.safeParse({
      ...raw,
      id: d.id,
      endDate: raw.endDate ?? null,
    })
    if (!parsed.success) return warnInvalid('cycle', d.id, parsed.error.issues)
    out.push(parsed.data)
  })
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate))
}

function readObservations(snap: QuerySnapshot<DocumentData>): Observation[] {
  const out: Observation[] = []
  snap.forEach((d) => {
    const parsed = observationSchema.safeParse({ ...d.data(), id: d.id })
    if (!parsed.success) return warnInvalid('observation', d.id, parsed.error.issues)
    out.push(parsed.data)
  })
  return out.sort((a, b) => a.startedOn.localeCompare(b.startedOn))
}

function readProfile(uid: string, raw: DocumentData | undefined): UserProfile | null {
  if (!raw) return null
  const base = defaultProfile(uid, typeof raw.email === 'string' ? raw.email : null)
  return {
    ...base,
    ...raw,
    uid,
    modules: { ...base.modules, ...(raw.modules ?? {}) },
    reminder: { ...base.reminder, ...(raw.reminder ?? {}) },
    consent: raw.consent ?? null,
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0,
  }
}

// ─── 배치 헬퍼 ────────────────────────────────────────────────────────────────

async function runBatched(
  database: Firestore,
  items: readonly ((batch: ReturnType<typeof writeBatch>) => void)[],
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const batch = writeBatch(database)
    for (const apply of items.slice(i, i + BATCH_LIMIT)) apply(batch)
    await batch.commit()
  }
}

async function deleteCollection(
  database: Firestore,
  ref: CollectionReference<DocumentData>,
): Promise<number> {
  const snap = await getDocs(ref)
  const refs = snap.docs.map((d) => d.ref)
  await runBatched(
    database,
    refs.map((r) => (batch: ReturnType<typeof writeBatch>) => batch.delete(r)),
  )
  return refs.length
}

// ─── 구현 ─────────────────────────────────────────────────────────────────────

export const firestoreRepository: TrackerRepository = {
  async ensureProfile(uid, email) {
    const ref = paths.user(uid)
    const snap = await getDoc(ref)
    const existing = readProfile(uid, snap.exists() ? snap.data() : undefined)
    if (existing) {
      // 이메일이 바뀌었으면 맞춰 둡니다.
      if (email && existing.email !== email) {
        await updateDoc(ref, { email, updatedAt: Date.now() })
        return { ...existing, email }
      }
      return existing
    }
    const profile = defaultProfile(uid, email)
    await setDoc(ref, {
      ...compact(profile as unknown as Record<string, unknown>),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdAtServer: serverTimestamp(),
      appVersion: APP_VERSION,
    })
    return profile
  },

  watchProfile(uid, onChange, onError) {
    return onSnapshot(
      paths.user(uid),
      (snap) => onChange(readProfile(uid, snap.exists() ? snap.data() : undefined)),
      onError,
    )
  },

  async updateProfile(uid, patch) {
    await setDoc(
      paths.user(uid),
      { ...compact(patch as Record<string, unknown>), updatedAt: Date.now() },
      { merge: true },
    )
  },

  /**
   * 전체 기록을 실시간 구독합니다.
   *
   * v3의 `fsGetAll`은 앱을 열 때마다 전량을 서버에서 다시 읽었습니다.
   * onSnapshot + IndexedDB 영속 캐시는 기기당 최초 1회만 전량을 받고 이후에는
   * 변경분만 내려받습니다. 기록량이 수천 건을 넘어가면 월 단위 버킷팅
   * (`users/{uid}/months/{YYYY-MM}`)으로 한 번 더 줄일 수 있습니다.
   */
  watchEntries(uid, onChange, onError) {
    return onSnapshot(
      paths.entries(uid),
      { includeMetadataChanges: true },
      (snap) => onChange(readEntries(snap), snap.metadata.fromCache),
      onError,
    )
  },

  async saveEntry(uid, entry) {
    const now = Date.now()
    const payload = compact({
      date: entry.date,
      mood: entry.mood,
      energy: entry.energy,
      sleep: entry.sleep,
      sleepHours: entry.sleepHours,
      ovulationMark: entry.ovulationMark || undefined,
      tagIds: entry.tagIds,
      legacyTags: entry.legacyTags,
      memo: entry.memo,
      createdAt: entry.createdAt ?? now,
      updatedAt: now,
    })
    await setDoc(paths.entry(uid, entry.date), payload)
  },

  async deleteEntry(uid, date) {
    await deleteDoc(paths.entry(uid, date))
  },

  async deleteAllEntries(uid) {
    await deleteCollection(db, paths.entries(uid))
  },

  watchTags(uid, onChange, onError) {
    let categories: TagCategory[] = []
    let tags: Tag[] = []
    let seenCategories = false
    let seenTags = false

    const emit = (): void => {
      if (seenCategories && seenTags) onChange({ categories, tags })
    }

    const unsubCats = onSnapshot(
      paths.categories(uid),
      (snap) => {
        categories = readCategories(snap)
        seenCategories = true
        emit()
      },
      onError,
    )
    const unsubTags = onSnapshot(
      paths.tags(uid),
      (snap) => {
        tags = readTags(snap)
        seenTags = true
        emit()
      },
      onError,
    )
    return () => {
      unsubCats()
      unsubTags()
    }
  },

  async createCategory(uid, name) {
    const ref = paths.categories(uid)
    const existing = await getDocs(ref)
    const category: TagCategory = {
      id: newId(ref),
      name: name.trim(),
      order: existing.size,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const { id, ...rest } = category
    await setDoc(paths.category(uid, id), rest)
    return category
  },

  async updateCategory(uid, id, patch) {
    const { id: _ignored, ...rest } = patch
    await setDoc(
      paths.category(uid, id),
      { ...compact(rest as Record<string, unknown>), updatedAt: Date.now() },
      { merge: true },
    )
  },

  async deleteCategory(uid, id, moveTagsTo) {
    const snap = await getDocs(paths.tags(uid))
    const affected = snap.docs.filter((d) => d.data().categoryId === id)
    const ops: ((batch: ReturnType<typeof writeBatch>) => void)[] = affected.map((d) =>
      moveTagsTo
        ? (batch) => batch.update(d.ref, { categoryId: moveTagsTo, updatedAt: Date.now() })
        : (batch) => batch.update(d.ref, { archived: true, updatedAt: Date.now() }),
    )
    ops.push((batch) => batch.delete(paths.category(uid, id)))
    await runBatched(db, ops)
  },

  async createTag(uid, name, categoryId) {
    const ref = paths.tags(uid)
    const existing = await getDocs(ref)
    const tag: Tag = {
      id: newId(ref),
      name: name.trim(),
      categoryId,
      order: existing.size,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const { id, ...rest } = tag
    await setDoc(paths.tag(uid, id), rest)
    return tag
  },

  /**
   * 태그 수정. 이름 변경도 여기입니다.
   *
   * v3는 이름이 곧 ID였기 때문에 이름을 바꾸면 과거 기록 전부를 순차적으로
   * 다시 써야 했습니다(기록 700일이면 700회 왕복). 이제 문서 1개만 바뀝니다.
   */
  async updateTag(uid, id, patch) {
    const { id: _ignored, ...rest } = patch
    await setDoc(
      paths.tag(uid, id),
      { ...compact(rest as Record<string, unknown>), updatedAt: Date.now() },
      { merge: true },
    )
  },

  async setTagArchived(uid, id, archived) {
    await setDoc(paths.tag(uid, id), { archived, updatedAt: Date.now() }, { merge: true })
  },

  async purgeTag(uid, id) {
    const [snap, obsSnap] = await Promise.all([
      getDocs(paths.entries(uid)),
      getDocs(paths.observations(uid)),
    ])
    const affected = snap.docs.filter((d) => {
      const raw = d.data()
      return Array.isArray(raw.tagIds) && raw.tagIds.includes(id)
    })
    const ops: ((batch: ReturnType<typeof writeBatch>) => void)[] = affected.map((d) => (batch) => {
      const raw = d.data()
      batch.update(d.ref, {
        tagIds: (raw.tagIds as string[]).filter((t) => t !== id),
        updatedAt: Date.now(),
      })
    })
    // 이 태그로 만들어지던 패턴은 더 이상 계산되지 않습니다. 관찰만 남으면
    // 사라진 대상을 지켜보는 중이라고 표시하게 되므로 함께 정리합니다.
    for (const d of obsSnap.docs) {
      const patternId = d.data().patternId
      if (typeof patternId === 'string' && patternUsesTag(patternId, id)) {
        ops.push((batch) => batch.delete(d.ref))
      }
    }
    ops.push((batch) => batch.delete(paths.tag(uid, id)))
    await runBatched(db, ops)
    return affected.length
  },

  async installPreset(uid, presetId) {
    const preset = findPreset(presetId)
    if (!preset) throw new Error(`알 수 없는 프리셋: ${presetId}`)

    const [catSnap, tagSnap] = await Promise.all([
      getDocs(paths.categories(uid)),
      getDocs(paths.tags(uid)),
    ])
    const existingCats = readCategories(catSnap)
    const existingTags = readTags(tagSnap)
    const catByName = new Map(existingCats.map((c) => [c.name, c]))
    const tagNames = new Set(existingTags.map((t) => t.name))

    const ops: ((batch: ReturnType<typeof writeBatch>) => void)[] = []
    let catOrder = existingCats.length
    let tagOrder = existingTags.length
    let added = 0

    for (const presetCat of preset.categories) {
      let category = catByName.get(presetCat.name)
      if (!category) {
        const id = newId(paths.categories(uid))
        category = { id, name: presetCat.name, order: catOrder++ }
        catByName.set(presetCat.name, category)
        const created = category
        ops.push((batch) =>
          batch.set(paths.category(uid, created.id), {
            name: created.name,
            order: created.order,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        )
      }
      for (const name of presetCat.tags) {
        if (tagNames.has(name)) continue
        tagNames.add(name)
        const id = newId(paths.tags(uid))
        const categoryId = category.id
        const order = tagOrder++
        added += 1
        ops.push((batch) =>
          batch.set(paths.tag(uid, id), {
            name,
            categoryId,
            order,
            archived: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        )
      }
    }
    await runBatched(db, ops)
    return added
  },

  watchCycles(uid, onChange, onError) {
    return onSnapshot(paths.cycles(uid), (snap) => onChange(readCycles(snap)), onError)
  },

  async saveCycle(uid, record) {
    const { id, ...rest } = record
    await setDoc(
      paths.cycle(uid, id),
      { ...rest, endDate: rest.endDate ?? null, updatedAt: Date.now() },
      { merge: true },
    )
  },

  async createCycle(uid, startDate, endDate) {
    const ref = paths.cycles(uid)
    const record: CycleRecord = {
      id: newId(ref),
      startDate,
      endDate,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const { id, ...rest } = record
    await setDoc(paths.cycle(uid, id), rest)
    return record
  },

  async deleteCycle(uid, id) {
    await deleteDoc(paths.cycle(uid, id))
  },

  /**
   * 관찰은 새 컬렉션입니다. 기존 문서를 건드리지 않으므로 마이그레이션이
   * 필요 없고, 되돌리려면 컬렉션만 지우면 됩니다.
   */
  watchObservations(uid, onChange, onError) {
    return onSnapshot(paths.observations(uid), (snap) => onChange(readObservations(snap)), onError)
  },

  async addObservation(uid, patternId, label, startedOn, baseline) {
    const ref = paths.observations(uid)
    const observation: Observation = {
      id: newId(ref),
      patternId,
      label,
      startedOn,
      baseline,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const { id, ...rest } = observation
    await setDoc(paths.observation(uid, id), compact(rest))
    return observation
  },

  async removeObservation(uid, id) {
    await deleteDoc(paths.observation(uid, id))
  },

  async exportAll(uid) {
    const [entrySnap, tagSnap, catSnap, cycleSnap] = await Promise.all([
      getDocs(paths.entries(uid)),
      getDocs(paths.tags(uid)),
      getDocs(paths.categories(uid)),
      getDocs(paths.cycles(uid)),
    ])
    return {
      format: 'dada-tracker',
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      entries: Object.values(readEntries(entrySnap)).sort((a, b) => a.date.localeCompare(b.date)),
      tags: readTags(tagSnap),
      tagCategories: readCategories(catSnap),
      cycles: readCycles(cycleSnap),
    } satisfies ExportBundle
  },

  async importBundle(uid, bundle, mode: ImportMode) {
    if (mode === 'replace') {
      await Promise.all([
        deleteCollection(db, paths.entries(uid)),
        deleteCollection(db, paths.tags(uid)),
        deleteCollection(db, paths.categories(uid)),
        deleteCollection(db, paths.cycles(uid)),
      ])
    }

    const ops: ((batch: ReturnType<typeof writeBatch>) => void)[] = []
    const today = todayKey()
    let skipped = 0

    for (const category of bundle.tagCategories) {
      const { id, ...rest } = category
      ops.push((batch) => batch.set(paths.category(uid, id), rest, { merge: true }))
    }
    for (const tag of bundle.tags) {
      const { id, ...rest } = tag
      ops.push((batch) => batch.set(paths.tag(uid, id), rest, { merge: true }))
    }
    for (const cycle of bundle.cycles) {
      const { id, ...rest } = cycle
      ops.push((batch) => batch.set(paths.cycle(uid, id), rest, { merge: true }))
    }
    for (const entry of bundle.entries) {
      if (entry.date > today) {
        skipped += 1
        continue
      }
      ops.push((batch) =>
        batch.set(
          paths.entry(uid, entry.date),
          compact({ ...entry, updatedAt: Date.now() }),
          { merge: mode === 'merge' },
        ),
      )
    }
    await runBatched(db, ops)

    return {
      entries: bundle.entries.length - skipped,
      tags: bundle.tags.length,
      categories: bundle.tagCategories.length,
      cycles: bundle.cycles.length,
      skipped,
    } satisfies ImportResult
  },

  async purgeUserData(uid) {
    await Promise.all([
      deleteCollection(db, paths.entries(uid)),
      deleteCollection(db, paths.tags(uid)),
      deleteCollection(db, paths.categories(uid)),
      deleteCollection(db, paths.cycles(uid)),
      deleteCollection(db, paths.observations(uid)),
      deleteCollection(db, collection(db, 'users', uid, 'meta')),
    ])
    await deleteDoc(paths.user(uid))
  },
}

export { paths, compact, runBatched }
