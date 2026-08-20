/**
 * v3 → v4 마이그레이션.
 *
 * 바뀌는 것:
 * 1. 태그 이름 → 안정적 태그 ID. 이름 변경이 더 이상 과거 기록을 건드리지 않습니다.
 * 2. 태그 목록 localStorage → Firestore. 기기 간 동기화됩니다.
 * 3. 주기 정보 이원화(`entries[].cycle` + `meta/periods`) → 생리 이벤트 단일 원본.
 * 4. `null` 값 제거, `date` 필드 추가(범위 질의를 위해).
 *
 * 손실 없음이 원칙입니다. 원본 태그 이름은 `legacyTags`로 남기고, v3 원본
 * (periods 배열, 기록별 cycle 값, localStorage 태그 트리)은 `meta/legacyV3`에
 * 통째로 백업합니다.
 */

import { diffDays, isDateKey } from '@/domain/date'
import { mergeOverlappingCycles } from '@/domain/cycle'
import type { CycleRecord, Entry, Scale, SleepQuality, Tag, TagCategory } from '@/domain/models'
import { SCHEMA_VERSION } from '@/domain/models'

/** v3 localStorage 키. */
export const LEGACY_TAGS_KEY = 'dada_tags_v3'

export interface LegacyEntryDoc {
  mood?: number | null
  energy?: number | null
  sleep?: string | null
  cycle?: string | null
  tags?: string[] | null
  memo?: string | null
  // v4 필드가 이미 있을 수도 있습니다 (부분 마이그레이션 이후 재실행).
  date?: string
  tagIds?: string[]
  legacyTags?: string[]
  sleepHours?: number
  ovulationMark?: boolean
  createdAt?: number
  updatedAt?: number
}

export interface MigrationInput {
  entries: Record<string, LegacyEntryDoc>
  /** `meta/periods`의 `data` 배열. */
  periods: [string, string][] | null
  /** localStorage의 태그 트리 `{ 카테고리: [태그...] }`. */
  localTags: Record<string, string[]> | null
  /** 이미 Firestore에 있는 태그·카테고리(재실행 대비). */
  existingCategories?: TagCategory[]
  existingTags?: Tag[]
  /** ID 생성기. 테스트에서 결정적으로 바꿔 끼웁니다. */
  newId: (kind: 'tag' | 'category' | 'cycle') => string
}

export interface LegacyBackup {
  migratedAt: string
  schemaFrom: number
  periods: [string, string][] | null
  localTags: Record<string, string[]> | null
  /** 기록별 v3 cycle 값. 'none'(생리전)은 파생값이라 v4 모델에 자리가 없습니다. */
  entryCycles: Record<string, string>
}

export interface MigrationPlan {
  categories: TagCategory[]
  tags: Tag[]
  entries: Entry[]
  cycles: CycleRecord[]
  backup: LegacyBackup
  stats: {
    entryCount: number
    tagCount: number
    categoryCount: number
    cycleCount: number
    /** 기록에는 있지만 태그 목록에는 없던 태그. 유실을 막기 위해 복구합니다. */
    recoveredTagCount: number
    ovulationMarks: number
    droppedEntries: number
  }
}

const VALID_SLEEP = new Set(['little', 'good', 'too_much'])

function toScale(value: unknown): Scale | undefined {
  if (typeof value !== 'number') return undefined
  const rounded = Math.round(value)
  if (rounded < 1 || rounded > 5) return undefined
  return rounded as Scale
}

function toSleep(value: unknown): SleepQuality | undefined {
  return typeof value === 'string' && VALID_SLEEP.has(value) ? (value as SleepQuality) : undefined
}

/** 연속한 날짜들을 하나의 구간으로 묶습니다. */
export function groupConsecutive(dates: readonly string[]): [string, string][] {
  const sorted = [...new Set(dates)].sort()
  const out: [string, string][] = []
  for (const date of sorted) {
    const last = out[out.length - 1]
    if (last && diffDays(last[1], date) === 1) {
      last[1] = date
      continue
    }
    out.push([date, date])
  }
  return out
}

export function planMigration(input: MigrationInput): MigrationPlan {
  const { entries, periods, localTags, newId } = input

  // ── 1. 카테고리·태그 목록 만들기 ─────────────────────────────────────────
  const categories: TagCategory[] = [...(input.existingCategories ?? [])]
  const tags: Tag[] = [...(input.existingTags ?? [])]
  const categoryByName = new Map(categories.map((c) => [c.name, c]))
  const tagByName = new Map(tags.map((t) => [t.name, t]))

  const ensureCategory = (name: string): TagCategory => {
    const found = categoryByName.get(name)
    if (found) return found
    const created: TagCategory = { id: newId('category'), name, order: categories.length }
    categories.push(created)
    categoryByName.set(name, created)
    return created
  }

  const ensureTag = (name: string, categoryName: string): Tag => {
    const found = tagByName.get(name)
    if (found) return found
    const category = ensureCategory(categoryName)
    const created: Tag = {
      id: newId('tag'),
      name,
      categoryId: category.id,
      order: tags.length,
      archived: false,
    }
    tags.push(created)
    tagByName.set(name, created)
    return created
  }

  for (const [categoryName, tagNames] of Object.entries(localTags ?? {})) {
    ensureCategory(categoryName)
    for (const name of tagNames) {
      if (typeof name === 'string' && name.trim()) ensureTag(name.trim(), categoryName)
    }
  }

  // 기록에만 있고 목록에서 사라진 태그를 복구합니다. v3에서는 태그를 지우면
  // 기록에서도 지워졌지만, 기기 간 localStorage 불일치로 남아 있을 수 있습니다.
  let recoveredTagCount = 0
  for (const doc of Object.values(entries)) {
    for (const name of doc.tags ?? doc.legacyTags ?? []) {
      if (typeof name !== 'string' || !name.trim()) continue
      if (tagByName.has(name.trim())) continue
      ensureTag(name.trim(), '복구된 태그')
      recoveredTagCount += 1
    }
  }

  // ── 2. 기록 변환 ────────────────────────────────────────────────────────
  const migratedEntries: Entry[] = []
  const entryCycles: Record<string, string> = {}
  const periodDatesFromEntries: string[] = []
  let ovulationMarks = 0
  let droppedEntries = 0

  for (const [date, doc] of Object.entries(entries)) {
    if (!isDateKey(date)) {
      droppedEntries += 1
      continue
    }
    if (typeof doc.cycle === 'string' && doc.cycle) {
      entryCycles[date] = doc.cycle
      if (doc.cycle === 'period') periodDatesFromEntries.push(date)
    }

    const legacyNames = (doc.tags ?? doc.legacyTags ?? []).filter(
      (n): n is string => typeof n === 'string' && n.trim().length > 0,
    )
    const mappedIds = legacyNames
      .map((n) => tagByName.get(n.trim())?.id)
      .filter((id): id is string => id != null)

    const ovulationMark = doc.ovulationMark === true || doc.cycle === 'ovulation'
    if (ovulationMark) ovulationMarks += 1

    const entry: Entry = {
      date,
      tagIds: doc.tagIds?.length ? doc.tagIds : mappedIds,
      memo: typeof doc.memo === 'string' ? doc.memo : '',
    }
    const mood = toScale(doc.mood)
    if (mood) entry.mood = mood
    const energy = toScale(doc.energy)
    if (energy) entry.energy = energy
    const sleep = toSleep(doc.sleep)
    if (sleep) entry.sleep = sleep
    if (typeof doc.sleepHours === 'number') entry.sleepHours = doc.sleepHours
    if (ovulationMark) entry.ovulationMark = true
    if (legacyNames.length > 0) entry.legacyTags = legacyNames
    if (typeof doc.createdAt === 'number') entry.createdAt = doc.createdAt

    migratedEntries.push(entry)
  }
  migratedEntries.sort((a, b) => a.date.localeCompare(b.date))

  // ── 3. 생리주기 단일화 ──────────────────────────────────────────────────
  // `meta/periods`가 1차 원본이고, 기록의 cycle='period'로만 남은 날짜를 더합니다.
  const rawSpans: [string, string][] = []
  for (const pair of periods ?? []) {
    const [start, end] = pair
    if (!isDateKey(start)) continue
    rawSpans.push([start, isDateKey(end) && end >= start ? end : start])
  }
  for (const span of groupConsecutive(periodDatesFromEntries)) rawSpans.push(span)

  const cycles = mergeOverlappingCycles(
    rawSpans
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([startDate, endDate]) => ({ id: newId('cycle'), startDate, endDate })),
  )

  return {
    categories,
    tags,
    entries: migratedEntries,
    cycles,
    backup: {
      migratedAt: new Date().toISOString(),
      schemaFrom: 3,
      periods: periods ?? null,
      localTags: localTags ?? null,
      entryCycles,
    },
    stats: {
      entryCount: migratedEntries.length,
      tagCount: tags.length,
      categoryCount: categories.length,
      cycleCount: cycles.length,
      recoveredTagCount,
      ovulationMarks,
      droppedEntries,
    },
  }
}

export function readLocalLegacyTags(): Record<string, string[]> | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LEGACY_TAGS_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string')
    }
    return out
  } catch {
    return null
  }
}

export function needsMigration(schemaVersion: number): boolean {
  return schemaVersion < SCHEMA_VERSION
}
