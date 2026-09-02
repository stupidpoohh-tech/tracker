/**
 * 랜딩 화면에 띄울 예시 데이터.
 *
 * 로그인 전 방문자에게 '실제 화면'을 보여주기 위한 것입니다. 스크린샷 이미지가
 * 아니라 진짜 대시보드·인사이트 컴포넌트를 그대로 렌더링하므로, 화면을 고치면
 * 랜딩도 같이 따라옵니다.
 *
 * 난수는 고정 시드를 씁니다. 방문할 때마다 그래프가 달라지면 신뢰를 잃습니다.
 */

import type { DateKey } from '@/domain/date'
import { addDays, weekdayIndex } from '@/domain/date'
import type { CycleRecord, Entry, Scale, SleepQuality, Tag, TagCategory } from '@/domain/models'

const DEMO_DAYS = 100
/** 마지막 생리 시작을 오늘로부터 며칠 전으로 둘지. 주기 중반이 보이도록 잡았습니다. */
const LAST_PERIOD_OFFSET = 19
const CYCLE_LENGTH = 28
const PERIOD_LENGTH = 5

/** 결정적 난수 생성기(mulberry32). 시드가 같으면 결과가 같습니다. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clampScale(value: number): Scale {
  return Math.min(5, Math.max(1, Math.round(value))) as Scale
}

export const DEMO_CATEGORIES: TagCategory[] = [
  { id: 'demo-cat-emotion', name: '정서', order: 0 },
  { id: 'demo-cat-body', name: '신체', order: 1 },
  { id: 'demo-cat-cognition', name: '인지', order: 2 },
]

export const DEMO_TAGS: Tag[] = [
  { id: 'demo-irritable', name: '짜증', categoryId: 'demo-cat-emotion', order: 0, archived: false },
  { id: 'demo-anxious', name: '불안/초조', categoryId: 'demo-cat-emotion', order: 1, archived: false },
  { id: 'demo-happy', name: '행복/만족', categoryId: 'demo-cat-emotion', order: 2, archived: false },
  { id: 'demo-drained', name: '무기력/탈진', categoryId: 'demo-cat-emotion', order: 3, archived: false },
  { id: 'demo-grateful', name: '사랑/감사', categoryId: 'demo-cat-emotion', order: 4, archived: false },
  { id: 'demo-headache', name: '두통', categoryId: 'demo-cat-body', order: 5, archived: false },
  { id: 'demo-cramps', name: '생리통', categoryId: 'demo-cat-body', order: 6, archived: false },
  { id: 'demo-fatigue', name: '피로', categoryId: 'demo-cat-body', order: 7, archived: false },
  { id: 'demo-focus', name: '집중력저하', categoryId: 'demo-cat-cognition', order: 8, archived: false },
  { id: 'demo-fog', name: '브레인포그', categoryId: 'demo-cat-cognition', order: 9, archived: false },
]

const MEMOS = [
  '잘 자고 일어나니 확실히 낫다.',
  '오후에 산책. 생각보다 도움이 됐다.',
  '회의가 많아서 진이 빠졌다.',
  '이유 없이 가라앉는 날.',
  '오랜만에 친구를 만났다.',
  '커피를 줄여봤다.',
  '밤에 자꾸 깼다.',
]

export interface DemoData {
  entries: Entry[]
  cycles: CycleRecord[]
  tags: Tag[]
  categories: TagCategory[]
}

/** 오늘 기준으로 최근 100일치 예시 기록을 만듭니다. */
export function buildDemoData(today: DateKey): DemoData {
  const rng = seeded(20260901)

  // ── 생리 기록: 오늘에서 거슬러 올라가며 28일 간격 ──────────────────────
  const cycles: CycleRecord[] = []
  const cycleStarts: DateKey[] = []
  for (let i = 0; i < 5; i++) {
    const start = addDays(today, -(LAST_PERIOD_OFFSET + i * CYCLE_LENGTH))
    if (start < addDays(today, -(DEMO_DAYS + 10))) break
    cycleStarts.push(start)
    cycles.push({
      id: `demo-cycle-${i}`,
      startDate: start,
      endDate: addDays(start, PERIOD_LENGTH - 1),
    })
  }
  cycles.reverse()
  cycleStarts.reverse()

  const dayOffsetToNextStart = (date: DateKey): number | null => {
    for (const start of cycleStarts) {
      if (start > date) {
        return Math.round(
          (new Date(`${start}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) /
            86_400_000,
        )
      }
    }
    return null
  }

  const inPeriod = (date: DateKey): boolean =>
    cycles.some((c) => date >= c.startDate && date <= (c.endDate ?? c.startDate))

  // ── 일일 기록 ─────────────────────────────────────────────────────────
  const entries: Entry[] = []
  const start = addDays(today, -(DEMO_DAYS - 1))

  for (let i = 0; i < DEMO_DAYS; i++) {
    const date = addDays(start, i)

    // 실제 사용자처럼 군데군데 빠뜨립니다. 100% 채워진 표는 오히려 덜 믿음직합니다.
    if (rng() > 0.82 && date !== today) continue

    const untilNext = dayOffsetToNextStart(date)
    const isPremenstrual = untilNext != null && untilNext >= 1 && untilNext <= 5
    const isPeriod = inPeriod(date)
    const isWeekend = weekdayIndex(date) === 0 || weekdayIndex(date) === 6

    // 수면 — 이 앱이 보여주려는 관계의 출발점입니다.
    const sleepRoll = rng()
    const sleep: SleepQuality =
      sleepRoll < 0.5 ? 'good' : sleepRoll < 0.82 ? 'little' : 'too_much'
    const sleepEffect = sleep === 'good' ? 0.9 : sleep === 'little' ? -1.0 : -0.3
    const sleepHours = sleep === 'good' ? 7 + rng() : sleep === 'little' ? 4 + rng() * 1.5 : 9.5 + rng()

    let mood = 3.1 + sleepEffect
    let energy = 3.0 + sleepEffect * 0.8

    if (isPremenstrual) {
      mood -= 1.0
      energy -= 0.6
    }
    if (isPeriod) {
      energy -= 0.8
      mood -= 0.3
    }
    if (isWeekend) mood += 0.5

    mood += (rng() - 0.5) * 0.9
    energy += (rng() - 0.5) * 0.9

    // 태그 — 구간에 따라 확률을 달리해 인사이트가 실제로 잡히게 합니다.
    const tagIds: string[] = []
    const pick = (id: string, p: number): void => {
      if (rng() < p) tagIds.push(id)
    }
    pick('demo-irritable', isPremenstrual ? 0.75 : 0.1)
    pick('demo-headache', isPremenstrual ? 0.45 : 0.09)
    pick('demo-anxious', isPremenstrual ? 0.4 : 0.16)
    pick('demo-cramps', isPeriod ? 0.7 : 0.01)
    pick('demo-fatigue', sleep === 'little' ? 0.6 : 0.14)
    pick('demo-focus', sleep === 'little' ? 0.5 : 0.12)
    pick('demo-fog', sleep === 'little' ? 0.35 : 0.08)
    pick('demo-happy', sleep === 'good' && !isPremenstrual ? 0.45 : 0.08)
    pick('demo-grateful', sleep === 'good' ? 0.25 : 0.06)
    pick('demo-drained', sleep !== 'good' ? 0.3 : 0.05)

    const entry: Entry = {
      date,
      mood: clampScale(mood),
      energy: clampScale(energy),
      sleep,
      sleepHours: Math.round(sleepHours * 2) / 2,
      tagIds,
      memo: rng() < 0.16 ? (MEMOS[Math.floor(rng() * MEMOS.length)] as string) : '',
    }
    entries.push(entry)
  }

  return { entries, cycles, tags: DEMO_TAGS, categories: DEMO_CATEGORIES }
}
