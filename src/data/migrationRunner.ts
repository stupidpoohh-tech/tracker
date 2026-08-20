import { getDoc, getDocs, setDoc, type writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { doc } from 'firebase/firestore'
import { SCHEMA_VERSION } from '@/domain/models'
import { compact, paths, runBatched } from './firestore'
import {
  needsMigration,
  planMigration,
  readLocalLegacyTags,
  type LegacyEntryDoc,
  type MigrationPlan,
} from './migration'

export interface MigrationOutcome {
  ran: boolean
  plan?: MigrationPlan
}

/**
 * v3 데이터를 v4 구조로 옮깁니다. 사용자당 한 번만 실행되고, 중간에 끊겨도
 * 다음 실행에서 이어서 수행할 수 있도록 멱등하게 작성했습니다.
 */
export async function runMigration(uid: string, schemaVersion: number): Promise<MigrationOutcome> {
  if (!needsMigration(schemaVersion)) return { ran: false }

  const [entrySnap, periodSnap, catSnap, tagSnap] = await Promise.all([
    getDocs(paths.entries(uid)),
    getDoc(doc(db, 'users', uid, 'meta', 'periods')),
    getDocs(paths.categories(uid)),
    getDocs(paths.tags(uid)),
  ])

  const entries: Record<string, LegacyEntryDoc> = {}
  entrySnap.forEach((d) => {
    entries[d.id] = d.data() as LegacyEntryDoc
  })

  const rawPeriods = periodSnap.exists() ? (periodSnap.data().data as unknown) : null
  const periods = Array.isArray(rawPeriods)
    ? (rawPeriods.filter(
        (p): p is [string, string] =>
          Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string',
      ) as [string, string][])
    : null

  const existingCategories = catSnap.docs.map((d) => ({
    id: d.id,
    name: String(d.data().name ?? ''),
    order: Number(d.data().order ?? 0),
  }))
  const existingTags = tagSnap.docs.map((d) => ({
    id: d.id,
    name: String(d.data().name ?? ''),
    categoryId: String(d.data().categoryId ?? ''),
    order: Number(d.data().order ?? 0),
    archived: Boolean(d.data().archived ?? false),
  }))

  const plan = planMigration({
    entries,
    periods,
    localTags: readLocalLegacyTags(),
    existingCategories,
    existingTags,
    newId: (kind) =>
      doc(
        kind === 'tag'
          ? paths.tags(uid)
          : kind === 'category'
            ? paths.categories(uid)
            : paths.cycles(uid),
      ).id,
  })

  const existingCatIds = new Set(existingCategories.map((c) => c.id))
  const existingTagIds = new Set(existingTags.map((t) => t.id))

  const ops: ((batch: ReturnType<typeof writeBatch>) => void)[] = []

  for (const category of plan.categories) {
    if (existingCatIds.has(category.id)) continue
    ops.push((batch) =>
      batch.set(paths.category(uid, category.id), {
        name: category.name,
        order: category.order,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    )
  }
  for (const tag of plan.tags) {
    if (existingTagIds.has(tag.id)) continue
    ops.push((batch) =>
      batch.set(paths.tag(uid, tag.id), {
        name: tag.name,
        categoryId: tag.categoryId,
        order: tag.order,
        archived: tag.archived,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    )
  }
  for (const cycle of plan.cycles) {
    ops.push((batch) =>
      batch.set(
        paths.cycle(uid, cycle.id),
        {
          startDate: cycle.startDate,
          endDate: cycle.endDate ?? null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        { merge: true },
      ),
    )
  }
  for (const entry of plan.entries) {
    ops.push((batch) =>
      batch.set(
        paths.entry(uid, entry.date),
        compact({ ...entry, updatedAt: Date.now() } as Record<string, unknown>),
      ),
    )
  }

  await runBatched(db, ops)

  // 원본 백업 — 마이그레이션 결과에 문제가 생겨도 되돌릴 수 있게 남깁니다.
  await setDoc(doc(db, 'users', uid, 'meta', 'legacyV3'), plan.backup as never)
  await setDoc(
    paths.user(uid),
    { schemaVersion: SCHEMA_VERSION, migratedAt: Date.now(), updatedAt: Date.now() },
    { merge: true },
  )

  return { ran: true, plan }
}
