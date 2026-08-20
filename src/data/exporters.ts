/**
 * 내보내기·가져오기.
 *
 * v3는 SheetJS(`xlsx`)를 npm 레지스트리가 아닌 CDN tarball로 직접 참조했습니다.
 * CI에서 깨지기 쉽고 번들도 큽니다. 여기서는 의존성 없이 UTF-8 BOM CSV를
 * 내보냅니다. 엑셀에서 그대로 열리고 한글도 깨지지 않습니다. 서식이 필요한
 * 출력물은 '진료용 리포트'의 인쇄(PDF 저장)가 담당합니다.
 */

import type { DateKey } from '@/domain/date'
import { todayKey } from '@/domain/date'
import type { CyclePhase, PhaseIndex } from '@/domain/cycle'
import { PHASE_LABELS } from '@/domain/cycle'
import {
  SCHEMA_VERSION,
  energyLabel,
  entrySchema,
  exportBundleSchema,
  isMixedState,
  legacyEntrySchema,
  moodLabel,
  resolveEntryTagIds,
  sleepLabel,
  tagName,
  type Entry,
  type ExportBundle,
  type Scale,
  type TagIndex,
} from '@/domain/models'
import { z } from 'zod'

export function downloadBlob(content: BlobPart, filename: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // revoke를 즉시 하면 사파리에서 다운로드가 취소되는 경우가 있습니다.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportJson(bundle: ExportBundle): void {
  downloadBlob(
    JSON.stringify(bundle, null, 2),
    `dada-tracker-${todayKey()}.json`,
    'application/json;charset=utf-8',
  )
}

function csvCell(value: string | number | undefined | null): string {
  if (value == null || value === '') return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const CSV_HEADERS = [
  '날짜',
  '요일',
  '기분',
  '기분_설명',
  '에너지',
  '에너지_설명',
  '혼재상태',
  '수면',
  '수면시간',
  '주기단계',
  '주기_예측여부',
  '태그',
  '메모',
] as const

export function toCsv(
  entries: readonly Entry[],
  tagIndex: TagIndex,
  phaseIndex: PhaseIndex,
): string {
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']
  const rows = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => {
      const phase = phaseIndex.get(entry.date)
      const wd = new Date(
        Date.UTC(+entry.date.slice(0, 4), +entry.date.slice(5, 7) - 1, +entry.date.slice(8, 10)),
      ).getUTCDay()
      return [
        entry.date,
        weekdays[wd] ?? '',
        entry.mood ?? '',
        entry.mood ? moodLabel(entry.mood) : '',
        entry.energy ?? '',
        entry.energy ? energyLabel(entry.energy) : '',
        isMixedState(entry) ? 'Y' : '',
        entry.sleep ? sleepLabel(entry.sleep) : '',
        entry.sleepHours ?? '',
        phase ? PHASE_LABELS[phase.phase as CyclePhase] : '',
        phase ? (phase.predicted ? '예측' : '기록') : '',
        resolveEntryTagIds(entry, tagIndex)
          .map((id) => tagName(id, tagIndex))
          .join(', '),
        entry.memo,
      ]
        .map(csvCell)
        .join(',')
    })

  // BOM이 있어야 엑셀이 UTF-8로 인식합니다.
  const BOM = '\ufeff'
  return `${BOM}${CSV_HEADERS.join(',')}\r\n${rows.join('\r\n')}\r\n`
}

export function exportCsv(
  entries: readonly Entry[],
  tagIndex: TagIndex,
  phaseIndex: PhaseIndex,
): void {
  downloadBlob(
    toCsv(entries, tagIndex, phaseIndex),
    `dada-tracker-${todayKey()}.csv`,
    'text/csv;charset=utf-8',
  )
}

// ─── 가져오기 ─────────────────────────────────────────────────────────────────

export interface ParseFailure {
  ok: false
  error: string
}
export interface ParseSuccess {
  ok: true
  bundle: ExportBundle
  /** v3 형식에서 변환했는지 */
  fromLegacy: boolean
  warnings: string[]
}
export type ParseResult = ParseSuccess | ParseFailure

const legacyMapSchema = z.record(z.string(), legacyEntrySchema)

/**
 * 업로드된 JSON을 검증합니다.
 *
 * v3는 textarea에 붙여넣은 문자열을 검증 없이 Firestore에 그대로 썼습니다.
 * 여기서는 스키마를 통과한 데이터만 받아들이고, 버린 항목을 사용자에게 알립니다.
 */
export function parseImport(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'JSON 형식이 아닙니다. 파일이 손상되지 않았는지 확인해주세요.' }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: '내용이 비어 있거나 올바른 형식이 아닙니다.' }
  }

  // v4 번들
  if ((raw as { format?: unknown }).format === 'dada-tracker') {
    const parsed = exportBundleSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: `번들 형식이 올바르지 않습니다: ${parsed.error.issues[0]?.message ?? ''}` }
    }
    return { ok: true, bundle: parsed.data, fromLegacy: false, warnings: [] }
  }

  // v3 형식 `{ "2025-01-01": { mood, tags, ... } }`
  const legacy = legacyMapSchema.safeParse(raw)
  if (!legacy.success) {
    return {
      ok: false,
      error: '알 수 없는 형식입니다. Dada Tracker에서 내보낸 JSON 파일인지 확인해주세요.',
    }
  }

  const warnings: string[] = []
  const entries: Entry[] = []
  let skipped = 0
  const periodDates: DateKey[] = []

  for (const [date, doc] of Object.entries(legacy.data)) {
    const candidate = {
      date,
      mood: doc.mood ?? undefined,
      energy: doc.energy ?? undefined,
      sleep: doc.sleep ?? undefined,
      ovulationMark: doc.cycle === 'ovulation' ? true : undefined,
      tagIds: [],
      legacyTags: doc.tags ?? undefined,
      memo: doc.memo ?? '',
    }
    const parsed = entrySchema.safeParse(candidate)
    if (!parsed.success) {
      skipped += 1
      continue
    }
    if (doc.cycle === 'period') periodDates.push(date)
    entries.push(parsed.data as Entry)
  }

  if (skipped > 0) warnings.push(`형식이 맞지 않는 기록 ${skipped}건을 건너뛰었습니다.`)
  if (entries.length === 0) return { ok: false, error: '가져올 수 있는 기록이 없습니다.' }
  warnings.push(
    '이전 버전 형식입니다. 태그는 이름으로 저장되며, 가져온 뒤 태그 화면에서 정리하실 수 있습니다.',
  )
  if (periodDates.length > 0) {
    warnings.push(`생리 기록 ${periodDates.length}일치는 가져온 뒤 주기 화면에서 확인해주세요.`)
  }

  return {
    ok: true,
    fromLegacy: true,
    warnings,
    bundle: {
      format: 'dada-tracker',
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      entries,
      tags: [],
      tagCategories: [],
      cycles: [],
    },
  }
}

/** 척도 값을 안전하게 좁힙니다. 리포트 계산에서 사용합니다. */
export function asScale(value: number | undefined): Scale | undefined {
  if (value == null) return undefined
  const r = Math.round(value)
  return r >= 1 && r <= 5 ? (r as Scale) : undefined
}
