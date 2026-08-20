import { z } from 'zod'
import type { DateKey } from './date'
import { isDateKey } from './date'

export const SCHEMA_VERSION = 4

// ─── 척도 ─────────────────────────────────────────────────────────────────────
export type Scale = 1 | 2 | 3 | 4 | 5
export const SCALE_VALUES: readonly Scale[] = [1, 2, 3, 4, 5]

export const MOOD_LABELS = ['매우 나쁨', '나쁨', '보통', '좋음', '매우 좋음'] as const
export const ENERGY_LABELS = ['매우 낮음', '낮음', '보통', '높음', '매우 높음'] as const

export function moodLabel(v: Scale): string {
  return MOOD_LABELS[v - 1] ?? ''
}
export function energyLabel(v: Scale): string {
  return ENERGY_LABELS[v - 1] ?? ''
}

export type SleepQuality = 'little' | 'good' | 'too_much'

export interface SleepOption {
  id: SleepQuality
  label: string
  /** 인사이트 계산용 순서. 정렬·집계에만 쓰고 크기 비교에는 쓰지 않습니다. */
  order: number
}

export const SLEEP_OPTIONS: readonly SleepOption[] = [
  { id: 'little', label: '적게 잠', order: 0 },
  { id: 'good', label: '잘 잠', order: 1 },
  { id: 'too_much', label: '많이 잠', order: 2 },
]

export function sleepLabel(id: SleepQuality): string {
  return SLEEP_OPTIONS.find((o) => o.id === id)?.label ?? ''
}

/** 기분과 에너지가 이만큼 벌어지면 '혼재 상태'로 봅니다. */
export const MIXED_STATE_THRESHOLD = 2

export function isMixedState(entry: Pick<Entry, 'mood' | 'energy'>): boolean {
  if (entry.mood == null || entry.energy == null) return false
  return Math.abs(entry.mood - entry.energy) >= MIXED_STATE_THRESHOLD
}

// ─── 기록 ─────────────────────────────────────────────────────────────────────
export interface Entry {
  date: DateKey
  mood?: Scale
  energy?: Scale
  sleep?: SleepQuality
  /** 선택 입력. 진료 리포트에서 수면 시간 추이로 쓰입니다. */
  sleepHours?: number
  /** 사용자가 직접 표시한 배란일. 주기 계산의 파생값보다 우선합니다. */
  ovulationMark?: boolean
  tagIds: string[]
  /**
   * v3 이하에서 태그 이름이 곧 ID였습니다. 마이그레이션 후에도 원본 보존을 위해
   * 지우지 않습니다. 읽기 경로는 tagIds를 우선하고, 없을 때만 이 값을 해석합니다.
   */
  legacyTags?: string[]
  memo: string
  createdAt?: number
  updatedAt?: number
}

export function emptyEntry(date: DateKey): Entry {
  return { date, tagIds: [], memo: '' }
}

/** 사용자가 실제로 무언가를 입력했는지. 빈 기록은 저장하지 않습니다. */
export function isEntryEmpty(entry: Entry): boolean {
  return (
    entry.mood == null &&
    entry.energy == null &&
    entry.sleep == null &&
    entry.sleepHours == null &&
    !entry.ovulationMark &&
    entry.tagIds.length === 0 &&
    entry.memo.trim() === ''
  )
}

export type EntryMap = Record<DateKey, Entry>

// ─── 태그 ─────────────────────────────────────────────────────────────────────
export interface TagCategory {
  id: string
  name: string
  order: number
  createdAt?: number
  updatedAt?: number
}

export interface Tag {
  id: string
  name: string
  categoryId: string
  order: number
  /** 삭제 대신 보관합니다. 과거 통계가 사라지지 않도록. */
  archived: boolean
  createdAt?: number
  updatedAt?: number
}

export interface TagIndex {
  categories: TagCategory[]
  tags: Tag[]
  byId: Map<string, Tag>
  byName: Map<string, Tag>
}

export function buildTagIndex(categories: TagCategory[], tags: Tag[]): TagIndex {
  const sortedCats = [...categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  const sortedTags = [...tags].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  return {
    categories: sortedCats,
    tags: sortedTags,
    byId: new Map(sortedTags.map((t) => [t.id, t])),
    byName: new Map(sortedTags.map((t) => [t.name, t])),
  }
}

/** 기록의 태그 ID 목록. v3 이름 기반 데이터도 함께 해석합니다. */
export function resolveEntryTagIds(entry: Entry, index: TagIndex): string[] {
  if (entry.tagIds.length > 0) return entry.tagIds
  if (!entry.legacyTags?.length) return []
  const out: string[] = []
  for (const name of entry.legacyTags) {
    const tag = index.byName.get(name)
    if (tag) out.push(tag.id)
  }
  return out
}

export function tagName(id: string, index: TagIndex): string {
  return index.byId.get(id)?.name ?? id
}

// ─── 생리주기 ─────────────────────────────────────────────────────────────────
export interface CycleRecord {
  id: string
  startDate: DateKey
  /** null이면 진행 중입니다. */
  endDate: DateKey | null
  createdAt?: number
  updatedAt?: number
}

// ─── 사용자 프로필 ────────────────────────────────────────────────────────────
export interface TrackedModules {
  mood: boolean
  energy: boolean
  sleep: boolean
  cycle: boolean
}

export const DEFAULT_MODULES: TrackedModules = {
  mood: true,
  energy: true,
  sleep: true,
  cycle: false,
}

export type ThemePreference = 'system' | 'light' | 'dark'

export interface ReminderSettings {
  enabled: boolean
  /** "HH:MM" 로컬 시각 */
  time: string
}

export interface ConsentRecord {
  termsVersion: string
  privacyVersion: string
  /** 민감정보(정신건강·생리주기) 수집·이용 동의 */
  sensitiveDataConsent: boolean
  acceptedAt: number
}

export interface UserProfile {
  uid: string
  email: string | null
  displayName?: string
  modules: TrackedModules
  theme: ThemePreference
  reminder: ReminderSettings
  consent: ConsentRecord | null
  /** 위기 자원 안내 배너를 숨겼는지. 안내 자체를 끄는 것은 아닙니다. */
  crisisBannerDismissedAt?: number
  onboardedAt?: number
  createdAt?: number
  updatedAt?: number
  schemaVersion: number
}

export function defaultProfile(uid: string, email: string | null): UserProfile {
  return {
    uid,
    email,
    modules: { ...DEFAULT_MODULES },
    theme: 'system',
    reminder: { enabled: false, time: '21:00' },
    consent: null,
    schemaVersion: SCHEMA_VERSION,
  }
}

// ─── 검증 스키마 ──────────────────────────────────────────────────────────────
// Firestore와 사용자 업로드 JSON은 신뢰할 수 없는 입력으로 취급합니다.

const dateKeySchema = z.string().refine(isDateKey, { message: '날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)' })
const scaleSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
const sleepSchema = z.enum(['little', 'good', 'too_much'])

export const entrySchema = z.object({
  date: dateKeySchema,
  mood: scaleSchema.optional(),
  energy: scaleSchema.optional(),
  sleep: sleepSchema.optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  ovulationMark: z.boolean().optional(),
  tagIds: z.array(z.string()).default([]),
  legacyTags: z.array(z.string()).optional(),
  memo: z.string().max(20_000).default(''),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export const tagSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  categoryId: z.string().min(1),
  order: z.number().default(0),
  archived: z.boolean().default(false),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export const tagCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  order: z.number().default(0),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export const cycleRecordSchema = z.object({
  id: z.string().min(1),
  startDate: dateKeySchema,
  endDate: dateKeySchema.nullable().default(null),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

/** v3 형식(`{ "2025-01-01": { mood, tags, ... } }`)까지 받아들이는 가져오기 스키마. */
export const legacyEntrySchema = z.object({
  mood: z.union([scaleSchema, z.null()]).optional(),
  energy: z.union([scaleSchema, z.null()]).optional(),
  sleep: z.union([sleepSchema, z.null()]).optional(),
  cycle: z.union([z.enum(['none', 'ovulation', 'period']), z.null()]).optional(),
  tags: z.array(z.string()).optional(),
  memo: z.string().optional(),
})

export const exportBundleSchema = z.object({
  format: z.literal('dada-tracker'),
  version: z.number(),
  exportedAt: z.string(),
  entries: z.array(entrySchema),
  tags: z.array(tagSchema).default([]),
  tagCategories: z.array(tagCategorySchema).default([]),
  cycles: z.array(cycleRecordSchema).default([]),
})

export type ExportBundle = z.infer<typeof exportBundleSchema>
